module PureScript.Backend.Optimizer.Monomorphize
  ( InstantiationMap
  , collectInstantiations
  , collectAllTypes
  , mangleType
  , defaultToAny
  , collectAppSpine
  , getExprAnn
  , inferExprType
  , monomorphize
  ) where

import Prelude

import Data.Map (Map)
import Data.Map as Map
import Data.Set (Set)
import Data.Set as Set
import Data.Foldable (foldl, class Foldable)
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import PureScript.Backend.Optimizer.CoreFn (Ann(..), Bind(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), ExprType(..), Guard(..), Module(..), Prop(..), Ident(..), Qualified(..), unQualified, qualifiedModuleName)
import Data.Newtype (unwrap)
import Data.Tuple (Tuple(..))
import Data.String as String
import Data.String.Pattern (Pattern(..), Replacement(..))
import Data.Array as Array
import PureScript.Backend.Optimizer.Substitute (unify, substituteExprType)

type InstantiationMap = Map String (Map ExprType { dictArgs :: Array (Expr Ann) })

isStatic :: Expr Ann -> Boolean
isStatic = case _ of
  ExprVar _ (Qualified (Just _) _) -> true
  ExprVar _ (Qualified Nothing _) -> false
  ExprApp _ f arg -> isStatic f && isStatic arg
  ExprAccessor _ e _ -> isStatic e
  _ -> false

defaultToAny :: ExprType -> ExprType
defaultToAny = case _ of
  TypeVar _ -> Any
  Array t -> Array (defaultToAny t)
  Func args ret -> Func (map defaultToAny args) (defaultToAny ret)
  Record row -> Record (defaultToAny row)
  Row props tail -> Row (map (\(Tuple k v) -> Tuple k (defaultToAny v)) props) (map defaultToAny tail)
  TypeApp c args -> TypeApp (defaultToAny c) (map defaultToAny args)
  ForAll vars body -> ForAll vars (defaultToAny body)
  ConstrainedType constraints body -> ConstrainedType (map (\(Tuple c a) -> Tuple c (map defaultToAny a)) constraints) (defaultToAny body)
  ADT fn names args -> ADT fn names (map defaultToAny args)
  t -> t

mangleType :: ExprType -> String
mangleType Int = "Int"
mangleType Number = "Number"
mangleType String = "String"
mangleType Char = "Char"
mangleType Boolean = "Boolean"
mangleType Unit = "Unit"
mangleType Any = "Any"
mangleType (TypeLevelString s) = "TypeLevelString_" <> s
mangleType (Array t) = "Array_" <> mangleType t
mangleType (Func args ret) = "Func_" <> String.joinWith "_" (map mangleType args) <> "_" <> mangleType ret
mangleType (Record row) = "Record_" <> mangleType row
mangleType (Row props tail) = "Row_" <> String.joinWith "_" (map (\(Tuple k v) -> k <> "_" <> mangleType v) props) <> "_" <> maybe "Empty" mangleType tail
mangleType (TypeApp c args) = "TypeApp_" <> mangleType c <> "_" <> String.joinWith "_" (map mangleType args)
mangleType (ForAll vars body) = "ForAll_" <> String.joinWith "_" vars <> "_" <> mangleType body
mangleType (ConstrainedType constraints body) = "ConstrainedType_" <> String.joinWith "_" (map (\(Tuple c a) -> String.joinWith "_" c <> "_" <> String.joinWith "_" (map mangleType a)) constraints) <> "_" <> mangleType body
mangleType (ADT _ names args) = "ADT_" <> String.joinWith "_" names <> (if Array.length args == 0 then "" else "_" <> String.joinWith "_" (map mangleType args))
mangleType (TypeVar name) = "Var_" <> name
mangleType Any = "Any"

collectInstantiations :: InstantiationMap -> Module Ann -> InstantiationMap
collectInstantiations acc (Module m) = 
  let modNameStr = unwrap m.name
  in foldl (collectBind modNameStr) acc m.decls

collectBind :: String -> InstantiationMap -> Bind Ann -> InstantiationMap
collectBind modName acc (NonRec binding) = collectBinding modName acc binding
collectBind modName acc (Rec bindings) = foldl (collectBinding modName) acc bindings

collectBinding :: String -> InstantiationMap -> Binding Ann -> InstantiationMap
collectBinding modName acc (Binding _ _ expr) = collectExpr modName acc expr

getExprAnn :: Expr Ann -> Ann
getExprAnn = case _ of
  ExprVar ann _ -> ann
  ExprLit ann _ -> ann
  ExprApp ann _ _ -> ann
  ExprAbs ann _ _ -> ann
  ExprLet ann _ _ -> ann
  ExprCase ann _ _ -> ann
  ExprConstructor ann _ _ _ -> ann
  ExprAccessor ann _ _ -> ann
  ExprUpdate ann _ _ -> ann

inferExprType :: Expr Ann -> Maybe ExprType
inferExprType expr = case expr of
  ExprApp _ f _ ->
    let
      fTy = inferExprType f
    in case fTy of
      Just (Func args ret) ->
        if Array.length args > 1 then
          Just (Func (fromMaybe [] (Array.tail args)) ret)
        else
          Just ret
      _ -> Nothing
  _ -> let (Ann ann) = getExprAnn expr in ann.type

collectAppSpine :: Expr Ann -> { f :: Expr Ann, args :: Array (Expr Ann) }
collectAppSpine = go []
  where
  go args (ExprApp _ f x) = go (Array.cons x args) f
  go args f = { f, args }

partitionArgs :: ExprType -> Array (Expr Ann) -> { dictArgs :: Array (Expr Ann), normalArgs :: Array (Expr Ann) }
partitionArgs (ConstrainedType constraints body) args =
  let
    numDicts = Array.length constraints
    dictArgs = Array.take numDicts args
    normalArgs = Array.drop numDicts args
  in { dictArgs, normalArgs }
partitionArgs (ForAll _ body) args = partitionArgs body args
partitionArgs _ args = { dictArgs: [], normalArgs: args }

collectExpr :: String -> InstantiationMap -> Expr Ann -> InstantiationMap
collectExpr modName acc expr = case expr of
  ExprVar (Ann ann) (Qualified mbMod (Ident name)) ->
    case ann.type of
      Just t -> 
        let qualName = case mbMod of
              Just mod -> unwrap mod <> "." <> name
              Nothing -> modName <> "." <> name
        in Map.insertWith Map.union qualName (Map.singleton (defaultToAny t) { dictArgs: [] }) acc
      Nothing -> acc
  ExprApp _ _ _ ->
    let
      { f, args } = collectAppSpine expr
      acc1 = collectExpr modName acc f
      acc2 = foldl (collectExpr modName) acc1 args
    in case f of
      ExprVar (Ann ann) (Qualified mbMod (Ident name)) ->
        case ann.type of
          Just genericType@(Func fArgs fRet) ->
            let
              argTypes = Array.mapMaybe inferExprType args
              substArgs = Array.foldl (\substAcc (Tuple fArg xTy) -> unify fArg xTy substAcc) Map.empty (Array.zip fArgs argTypes)
              
              appType = let (Ann exprAnn) = getExprAnn expr in exprAnn.type
              subst = case appType of
                Just t ->
                  let remainingType = if Array.length args < Array.length fArgs then
                                        Func (Array.drop (Array.length args) fArgs) fRet
                                      else fRet
                  in unify remainingType t substArgs
                Nothing -> substArgs
                
              instType = substituteExprType subst genericType
              qualName = case mbMod of
                Just mod -> unwrap mod <> "." <> name
                Nothing -> modName <> "." <> name
                
              { dictArgs } = partitionArgs genericType args
            in
              if Map.isEmpty subst then acc2
              else Map.insertWith Map.union qualName (Map.singleton (defaultToAny instType) { dictArgs }) acc2
          _ -> acc2
      _ -> acc2

  ExprLit _ lit -> foldl (collectExpr modName) acc lit
  ExprConstructor _ _ _ _ -> acc
  ExprAccessor _ e _ -> collectExpr modName acc e
  ExprUpdate _ e props -> foldl (collectProp modName) (collectExpr modName acc e) props
  ExprAbs _ _ e -> collectExpr modName acc e
  ExprCase _ exprs alts -> foldl (collectAlt modName) (foldl (collectExpr modName) acc exprs) alts
  ExprLet _ binds e -> foldl (collectBind modName) (collectExpr modName acc e) binds

collectProp :: String -> InstantiationMap -> Prop (Expr Ann) -> InstantiationMap
collectProp modName acc (Prop _ e) = collectExpr modName acc e

collectAlt :: String -> InstantiationMap -> CaseAlternative Ann -> InstantiationMap
collectAlt modName acc (CaseAlternative _ cg) = case cg of
  Unconditional e -> collectExpr modName acc e
  Guarded guards -> foldl (collectGuard modName) acc guards

collectGuard :: String -> InstantiationMap -> Guard Ann -> InstantiationMap
collectGuard modName acc (Guard e1 e2) = collectExpr modName (collectExpr modName acc e1) e2

collectAllTypes :: Module Ann -> Set ExprType
collectAllTypes (Module m) = foldl (\a b -> collectTypesFromBind b a) Set.empty m.decls

collectTypesFromExpr :: Expr Ann -> Set ExprType -> Set ExprType
collectTypesFromExpr expr acc = case expr of
  ExprVar (Ann ann) _ -> maybe acc (\t -> Set.insert t acc) ann.type
  ExprLit (Ann ann) lit -> foldl (\a e -> collectTypesFromExpr e a) (maybe acc (\t -> Set.insert t acc) ann.type) lit
  ExprApp (Ann ann) f arg -> collectTypesFromExpr arg (collectTypesFromExpr f (maybe acc (\t -> Set.insert t acc) ann.type))
  ExprAbs (Ann ann) _ e -> collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)
  ExprLet (Ann ann) binds e -> foldl (\a b -> collectTypesFromBind b a) (collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)) binds
  ExprCase (Ann ann) exprs alts -> foldl (\a alt -> collectTypesFromAlt alt a) (foldl (flip collectTypesFromExpr) (maybe acc (\t -> Set.insert t acc) ann.type) exprs) alts
  ExprConstructor (Ann ann) _ _ _ -> maybe acc (\t -> Set.insert t acc) ann.type
  ExprAccessor (Ann ann) e _ -> collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)
  ExprUpdate (Ann ann) e props -> foldl (\a (Prop _ v) -> collectTypesFromExpr v a) (collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)) props

collectTypesFromBind :: Bind Ann -> Set ExprType -> Set ExprType
collectTypesFromBind (NonRec (Binding _ _ e)) acc = collectTypesFromExpr e acc
collectTypesFromBind (Rec binds) acc = foldl (\a (Binding _ _ e) -> collectTypesFromExpr e a) acc binds

collectTypesFromAlt :: CaseAlternative Ann -> Set ExprType -> Set ExprType
collectTypesFromAlt (CaseAlternative _ (Unconditional e)) acc = collectTypesFromExpr e acc
collectTypesFromAlt (CaseAlternative _ (Guarded guards)) acc = foldl (\a (Guard e1 e2) -> collectTypesFromExpr e2 (collectTypesFromExpr e1 a)) acc guards

mapAnn :: (ExprType -> ExprType) -> Ann -> Ann
mapAnn f (Ann ann) = Ann (ann { type = map f ann.type })

rewriteExpr :: (ExprType -> ExprType) -> Expr Ann -> Expr Ann
rewriteExpr f = go
  where
  go expr = case expr of
    ExprVar ann q -> ExprVar (mapAnn f ann) q
    ExprLit ann lit -> ExprLit (mapAnn f ann) (map go lit)
    ExprApp ann e1 e2 -> ExprApp (mapAnn f ann) (go e1) (go e2)
    ExprAbs ann id e -> ExprAbs (mapAnn f ann) id (go e)
    ExprLet ann binds e -> ExprLet (mapAnn f ann) (map goBind binds) (go e)
    ExprCase ann exprs alts -> ExprCase (mapAnn f ann) (map go exprs) (map goAlt alts)
    ExprConstructor ann t c ids -> ExprConstructor (mapAnn f ann) t c ids
    ExprAccessor ann e prop -> ExprAccessor (mapAnn f ann) (go e) prop
    ExprUpdate ann e props -> ExprUpdate (mapAnn f ann) (go e) (map goProp props)

  goBind (NonRec b) = NonRec (goBinding b)
  goBind (Rec bs) = Rec (map goBinding bs)

  goBinding (Binding ann id e) = Binding (mapAnn f ann) id (go e)

  goAlt (CaseAlternative binders cg) = CaseAlternative binders (goCaseGuard cg)

  goCaseGuard (Unconditional e) = Unconditional (go e)
  goCaseGuard (Guarded guards) = Guarded (map goGuard guards)

  goGuard (Guard e1 e2) = Guard (go e1) (go e2)

  goProp (Prop p e) = Prop p (go e)

applyDicts :: Array (Expr Ann) -> Expr Ann -> Expr Ann
applyDicts args body = go args body
  where
  go dicts e = case Array.uncons dicts of
    Nothing -> e
    Just { head: d, tail: ds' } ->
      if isStatic d then
        case e of
          ExprAbs ann id b ->
            let body' = go ds' b
            in ExprLet (getExprAnn body') [NonRec (Binding (getExprAnn d) id d)] body'
          _ -> e
      else
        case e of
          ExprAbs ann id b -> ExprAbs ann id (go ds' b)
          _ -> e

monomorphize :: InstantiationMap -> Module Ann -> Module Ann
monomorphize instMap (Module m) = 
  let modNameStr = unwrap m.name
  in Module (m { decls = Array.concatMap (monomorphizeBind modNameStr instMap) m.decls })

monomorphizeBind :: String -> InstantiationMap -> Bind Ann -> Array (Bind Ann)
monomorphizeBind modName instMap (NonRec binding) =
  map NonRec (monomorphizeBinding modName instMap binding)
monomorphizeBind modName instMap (Rec bindings) =
  [ Rec (Array.concatMap (monomorphizeBinding modName instMap) bindings) ]

monomorphizeBinding :: String -> InstantiationMap -> Binding Ann -> Array (Binding Ann)
monomorphizeBinding modName instMap (Binding ann (Ident name) expr) =
  let qualName = modName <> "." <> name
  in case Map.lookup qualName instMap of
    Just typeMap ->
      map (\(Tuple ty info) ->
        let
          genericType = let (Ann annRec) = getExprAnn expr in fromMaybe Any annRec.type
          subst = unify genericType ty Map.empty
          substFn t = substituteExprType subst t
          
          exprWithDicts = applyDicts info.dictArgs expr
          
          specializedExpr = rewriteExpr substFn (monomorphizeExpr modName instMap exprWithDicts)
          newName = Ident (name <> "_" <> mangleType ty)
        in Binding (mapAnn substFn ann) newName specializedExpr
      ) (Map.toUnfoldable typeMap) <> [ Binding ann (Ident name) (monomorphizeExpr modName instMap expr) ]
    Nothing ->
      [ Binding ann (Ident name) (monomorphizeExpr modName instMap expr) ]

monomorphizeExpr :: String -> InstantiationMap -> Expr Ann -> Expr Ann
monomorphizeExpr modName instMap expr = case expr of
  ExprApp (Ann ann) _ _ ->
    let
      { f, args } = collectAppSpine expr
      f' = monomorphizeExpr modName instMap f
      args' = map (monomorphizeExpr modName instMap) args
    in case f' of
      ExprVar (Ann varAnn) (Qualified mbMod (Ident name)) ->
        case varAnn.type of
          Just genericType@(Func fArgs fRet) ->
            let
              argTypes = Array.mapMaybe inferExprType args'
              substArgs = Array.foldl (\substAcc (Tuple fArg xTy) -> unify fArg xTy substAcc) Map.empty (Array.zip fArgs argTypes)
              
              appType = ann.type
              subst = case appType of
                Just t ->
                  let remainingType = if Array.length args' < Array.length fArgs then
                                        Func (Array.drop (Array.length args') fArgs) fRet
                                      else fRet
                  in unify remainingType t substArgs
                Nothing -> substArgs
                
              instType = substituteExprType subst genericType
              qualName = case mbMod of
                Just mod -> unwrap mod <> "." <> name
                Nothing -> modName <> "." <> name
                
              { dictArgs, normalArgs } = partitionArgs genericType args'
              filteredArgs = Array.filter (\d -> not (isStatic d)) dictArgs <> normalArgs
            in
              if Map.isEmpty subst then
                rebuildApp (Ann ann) f' args'
              else case Map.lookup qualName instMap of
                Just _ ->
                  let specializedName = Ident (name <> "_" <> mangleType (defaultToAny instType))
                      specializedVar = ExprVar (Ann varAnn) (Qualified mbMod specializedName)
                  in rebuildApp (Ann ann) specializedVar filteredArgs
                Nothing ->
                  rebuildApp (Ann ann) f' args'
          _ -> rebuildApp (Ann ann) f' args'
      _ -> rebuildApp (Ann ann) f' args'

  ExprVar ann q -> ExprVar ann q
  ExprLit ann lit -> ExprLit ann (map (monomorphizeExpr modName instMap) lit)
  ExprAbs ann id e -> ExprAbs ann id (monomorphizeExpr modName instMap e)
  ExprLet ann binds e -> ExprLet ann (map (monomorphizeBindLocal modName instMap) binds) (monomorphizeExpr modName instMap e)
  ExprCase ann exprs alts -> ExprCase ann (map (monomorphizeExpr modName instMap) exprs) (map (monomorphizeAlt modName instMap) alts)
  ExprConstructor ann t c ids -> ExprConstructor ann t c ids
  ExprAccessor ann e prop -> ExprAccessor ann (monomorphizeExpr modName instMap e) prop
  ExprUpdate ann e props -> ExprUpdate ann (monomorphizeExpr modName instMap e) (map (monomorphizeProp modName instMap) props)

monomorphizeBindLocal :: String -> InstantiationMap -> Bind Ann -> Bind Ann
monomorphizeBindLocal modName instMap (NonRec b) = NonRec (monomorphizeBindingLocal modName instMap b)
monomorphizeBindLocal modName instMap (Rec bs) = Rec (map (monomorphizeBindingLocal modName instMap) bs)

monomorphizeBindingLocal :: String -> InstantiationMap -> Binding Ann -> Binding Ann
monomorphizeBindingLocal modName instMap (Binding ann id e) = Binding ann id (monomorphizeExpr modName instMap e)

monomorphizeAlt :: String -> InstantiationMap -> CaseAlternative Ann -> CaseAlternative Ann
monomorphizeAlt modName instMap (CaseAlternative binders cg) = CaseAlternative binders (monomorphizeCaseGuard modName instMap cg)

monomorphizeCaseGuard :: String -> InstantiationMap -> CaseGuard Ann -> CaseGuard Ann
monomorphizeCaseGuard modName instMap (Unconditional e) = Unconditional (monomorphizeExpr modName instMap e)
monomorphizeCaseGuard modName instMap (Guarded guards) = Guarded (map (monomorphizeGuard modName instMap) guards)

monomorphizeGuard :: String -> InstantiationMap -> Guard Ann -> Guard Ann
monomorphizeGuard modName instMap (Guard e1 e2) = Guard (monomorphizeExpr modName instMap e1) (monomorphizeExpr modName instMap e2)

monomorphizeProp :: String -> InstantiationMap -> Prop (Expr Ann) -> Prop (Expr Ann)
monomorphizeProp modName instMap (Prop p e) = Prop p (monomorphizeExpr modName instMap e)

rebuildApp :: Ann -> Expr Ann -> Array (Expr Ann) -> Expr Ann
rebuildApp finalAnn f args = 
  case Array.uncons args of
    Nothing -> f
    Just { head, tail } -> 
      let firstApp = ExprApp finalAnn f head
      in Array.foldl (\acc arg -> ExprApp finalAnn acc arg) firstApp tail
