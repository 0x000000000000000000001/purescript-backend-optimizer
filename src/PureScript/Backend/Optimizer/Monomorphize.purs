-- | Monomorphisation, Spécialisation et DPE (Dictionary Passing Elimination)
-- | L'une des passes d'optimisation les plus sophistiquées.
-- | Elle a pour rôle d'éliminer l'overhead de l'abstraction fonctionnelle :
-- | 1. En spécialisant le code polymorphe (générique) pour des types concrets.
-- | 2. En inlinant les dictionnaires de Type Classes pour transformer des appels dynamiques en appels directs statiques (DPE).
-- | 3. En préparant la décurryfication (via eta-expansion) pour s'assurer que l'arité des fonctions reste visible après l'élimination des dictionnaires.

module PureScript.Backend.Optimizer.Monomorphize
  ( Instantiation
  , InstantiationMap
  , collectInstantiations
  , collectAllTypes
  , mangleType
  , defaultToAny
  , collectSpine
  , SpineArg(..)
  , getExprAnn
  , inferExprType
  , monomorphize
  , extractFuncType
  , transitiveCollect
  , transitiveCollectWith
  , TransitiveResult
  , PreparedInstantiation
  , applyStaticArgs
  ) where

import Prelude

import Control.Monad.Rec.Class (class MonadRec, Step(..), tailRecM)
import Data.Array as Array
import Data.Foldable (foldl)
import Data.FunctorWithIndex (mapWithIndex)
import Data.Identity (Identity(..))
import Data.Map (Map)
import Data.Map as Map
import Data.String as String
import Data.Maybe (Maybe(..), fromMaybe, maybe)
import Data.Newtype (unwrap)
import Data.Set (Set)
import Data.Set as Set
import Data.String.Pattern (Pattern(..))
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.CoreFn (Ann(..), Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), ExprType(..), Guard(..), Ident(..), Literal(..), Module(..), ModuleName(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.CoreFn.BindingGroups (sortBindingGroups)
import PureScript.Backend.Optimizer.CoreFn.Usage (invalidateSourceUsageModule)
import PureScript.Backend.Optimizer.FfiSupport (hashString)
import PureScript.Backend.Optimizer.Substitute (substituteExprType, unify)

type Instantiation =
  { instType :: ExprType
  , dictArgs :: Array (Expr Ann)
  , normalArgs :: Array (Expr Ann)
  , callers :: Set String
  , subst :: Map String ExprType
  }

type InstantiationMap = Map String (Map String Instantiation)

type PreparedInstantiation =
  { info :: Instantiation
  , expr :: Expr Ann
  , dependencies :: Map String Int
  , contribution :: InstantiationMap
  }

type PreparedInstantiations = Map (Tuple String String) PreparedInstantiation

type TransitiveResult = Maybe
  { key :: Tuple String String
  , entry :: PreparedInstantiation
  , reused :: Boolean
  }

type TransitiveState =
  { prepared :: PreparedInstantiations
  , instantiations :: InstantiationMap
  }

-- Private identity guard for immutable compiler inputs, not semantic equality.
-- Reboxing may cause a cache miss; it must never permit an approximate hit.
foreign import sameIdentity :: forall a. a -> a -> Boolean

sameInstantiationInputs :: Instantiation -> Instantiation -> Boolean
sameInstantiationInputs a b =
  sameIdentity a.instType b.instType
    && sameIdentity a.subst b.subst
    && sameArguments a.dictArgs b.dictArgs
    && sameArguments a.normalArgs b.normalArgs
  where
  -- The native bridge may rebuild the array container while retaining its items.
  sameArguments xs ys = Array.length xs == Array.length ys
    && Array.all identity (Array.zipWith sameIdentity xs ys)


isStatic :: Expr Ann -> Boolean
isStatic = case _ of
  ExprVar _ (Qualified (Just _) _) -> true
  ExprVar _ (Qualified Nothing _) -> false
  ExprApp _ f arg -> isStatic f && isStatic arg
  ExprAccessor _ e _ -> isStatic e
  -- We deliberately do NOT consider data values (literals, constructors) as static.
  -- Specializing on data values breaks recursive functions where the accumulator 
  -- changes (e.g. `foldl`), because PBO blindly substitutes the initial static value 
  -- everywhere in the body, ruining the loop state.
  ExprLit _ _ -> false
  ExprConstructor _ _ _ _ -> false
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


mangleExpr :: forall a. Expr a -> String
mangleExpr = case _ of
  ExprVar _ (Qualified mbMod (Ident name)) ->
    "Var_" <> maybe "" (\(ModuleName mn) -> mn <> "_") mbMod <> name
  ExprLit _ (LitInt i) -> "LitInt_" <> show i
  ExprLit _ (LitNumber n) -> "LitNum_" <> show n
  ExprLit _ (LitString s) -> "LitStr_" <> s
  ExprLit _ (LitChar _) -> "LitChar"
  ExprLit _ (LitBoolean b) -> "LitBool_" <> show b
  ExprLit _ _ -> "LitUnk"
  ExprApp _ f arg -> "App_" <> mangleExpr f <> "_" <> mangleExpr arg
  ExprAccessor _ e prop -> "Acc_" <> prop <> "_" <> mangleExpr e
  ExprConstructor _ _ (Ident c) _ -> "Ctor_" <> c
  _ -> "Unk"

specializationKey :: ExprType -> Array (Expr Ann) -> Array (Expr Ann) -> String
specializationKey instType dictArgs normalArgs =
  mangleType (defaultToAny instType)
    <> "_dict_" <> mangleArgs dictArgs
    <> "_args_" <> mangleArgs normalArgs
  where
  -- The static values, their positions, and the supplied arity all determine
  -- the specialized body. Dynamic arguments retain their own placeholders.
  mangleArgs args =
    show (Array.length args) <> ":"
      <> show (map (\arg -> if isStatic arg then Just (mangleExpr arg) else Nothing) args)

collectInstantiations :: Map String (Binding Ann) -> InstantiationMap -> Module Ann -> InstantiationMap
collectInstantiations globalAstMap acc (Module m) =
  foldl collectTopBind acc m.decls
  where
  modNameStr = unwrap m.name
  -- Qualify free globals once at the top-level boundary. References left
  -- unqualified are lexical locals, including nested let and case bindings.
  collectTopBinding acc1 (Binding _ _ expr) =
    collectExpr globalAstMap modNameStr acc1 (resolveGlobals modNameStr Set.empty expr)
  collectTopBind acc1 = case _ of
    NonRec binding -> collectTopBinding acc1 binding
    Rec bindings -> foldl collectTopBinding acc1 bindings

collectBind :: Map String (Binding Ann) -> String -> InstantiationMap -> Bind Ann -> InstantiationMap
collectBind globalAstMap modName acc (NonRec binding) = collectBinding globalAstMap modName acc binding
collectBind globalAstMap modName acc (Rec bindings) = foldl (collectBinding globalAstMap modName) acc bindings

collectBinding :: Map String (Binding Ann) -> String -> InstantiationMap -> Binding Ann -> InstantiationMap
collectBinding globalAstMap modName acc (Binding _ _ expr) = collectExpr globalAstMap modName acc expr

getExprAnn :: Expr Ann -> Ann
getExprAnn = case _ of
  ExprVar ann _ -> ann
  ExprLit ann _ -> ann
  ExprApp ann _ _ -> ann
  ExprAbs ann _ _ -> ann
  ExprLet ann _ _ -> ann
  ExprTypeApp ann _ _ -> ann
  ExprCase ann _ _ -> ann
  ExprConstructor ann _ _ _ -> ann
  ExprAccessor ann _ _ -> ann
  ExprUpdate ann _ _ -> ann

inferExprType :: Expr Ann -> Maybe ExprType
inferExprType expr = let (Ann ann) = getExprAnn expr in ann.type

extractFuncType :: ExprType -> Maybe { fArgs :: Array ExprType, fRet :: ExprType }
extractFuncType = case _ of
  Func fArgs fRet -> Just { fArgs, fRet }
  ForAll _ body -> extractFuncType body
  ConstrainedType _ body -> extractFuncType body
  _ -> Nothing

data SpineArg = SpineApp (Expr Ann) | SpineTypeApp ExprType

collectSpine :: Expr Ann -> { f_var :: Expr Ann, spine :: Array SpineArg }
collectSpine = go []
  where
  go acc (ExprApp _ f x) = go (Array.cons (SpineApp x) acc) f
  go acc (ExprTypeApp _ f t) = go (Array.cons (SpineTypeApp t) acc) f
  go acc f = { f_var: f, spine: acc }

getSpineArgs :: Array SpineArg -> Array (Expr Ann)
getSpineArgs = Array.mapMaybe (case _ of
  SpineApp e -> Just e
  _ -> Nothing)

getSpineTypeArgs :: Array SpineArg -> Array ExprType
getSpineTypeArgs = Array.mapMaybe (case _ of
  SpineTypeApp t -> Just t
  _ -> Nothing)

buildSubst :: ExprType -> Array ExprType -> Map String ExprType
buildSubst (ForAll vars body) typeArgs =
  let
    subst1 = Map.fromFoldable (Array.zip vars typeArgs)
    subst2 = buildSubst body (Array.drop (Array.length vars) typeArgs)
  in Map.union subst1 subst2
buildSubst (ConstrainedType _ body) typeArgs = buildSubst body typeArgs
buildSubst _ _ = Map.empty

partitionArgs :: ExprType -> Array (Expr Ann) -> { dictArgs :: Array (Expr Ann), normalArgs :: Array (Expr Ann) }
partitionArgs (ConstrainedType constraints _) args =
  let
    numDicts = Array.length constraints
    dictArgs = Array.take numDicts args
    normalArgs = Array.drop numDicts args
  in
    { dictArgs, normalArgs }
partitionArgs (ForAll _ body) args = partitionArgs body args
partitionArgs _ args = { dictArgs: [], normalArgs: args }



stripStaticConstraints :: Array (Expr Ann) -> ExprType -> ExprType
stripStaticConstraints dictArgs = case _ of
  ConstrainedType constraints body ->
    let
      newConstraints = Array.mapMaybe (\(Tuple d c) -> if isStatic d then Nothing else Just c) (Array.zip dictArgs constraints)
      remainingConstraints = Array.drop (Array.length dictArgs) constraints
      finalConstraints = newConstraints <> remainingConstraints
    in
      if Array.length finalConstraints == 0 then stripStaticConstraints dictArgs body else ConstrainedType finalConstraints (stripStaticConstraints dictArgs body)
  ForAll vars body -> ForAll vars (stripStaticConstraints dictArgs body)
  t -> t

collectExpr :: Map String (Binding Ann) -> String -> InstantiationMap -> Expr Ann -> InstantiationMap
collectExpr globalAstMap modName acc expr = case expr of
  ExprVar (Ann ann) (Qualified (Just mod) (Ident name)) ->
    let
      qualName = unwrap mod <> "." <> name
      trueGenericType = case Map.lookup qualName globalAstMap of
        Just (Binding (Ann bAnn) _ _) -> bAnn.type
        Nothing -> ann.type
    in
      case trueGenericType of
        Just t ->
          Map.insertWith (\new old -> Map.unionWith mergeInstantiation new old) qualName (Map.singleton (mangleType (defaultToAny t)) { instType: defaultToAny t, dictArgs: [], normalArgs: [], callers: Set.singleton modName, subst: Map.empty }) acc
        Nothing -> acc
  ExprVar _ (Qualified Nothing _) -> acc
  ExprApp _ _ _ ->
    let
      { f_var, spine } = collectSpine expr
      args = getSpineArgs spine
      typeArgs = getSpineTypeArgs spine
      acc1 = collectExpr globalAstMap modName acc f_var
      acc2 = foldl (collectExpr globalAstMap modName) acc1 args
    in
      case f_var of
        ExprVar (Ann varAnn) (Qualified (Just mod) (Ident name)) ->
          let
             qualName = unwrap mod <> "." <> name
             trueGenericType = case Map.lookup qualName globalAstMap of
               Just (Binding (Ann bAnn) _ _) -> case bAnn.type of
                 Just t -> t
                 Nothing -> fromMaybe Any varAnn.type
               Nothing -> fromMaybe Any varAnn.type
             genericType = trueGenericType
             substFromTypeArgs = buildSubst genericType typeArgs
             
             unifySpine :: ExprType -> Array (Expr Ann) -> Map String ExprType -> Map String ExprType
             unifySpine _ [] s = s
             unifySpine (ForAll _ t) args' s = unifySpine t args' s
             unifySpine (ConstrainedType constraints t) args' s =
               let numConstraints = Array.length constraints
               in unifySpine t (Array.drop numConstraints args') s
             unifySpine (Func paramTypes ret) args' s =
               let
                 numParams = Array.length paramTypes
                 appliedArgs = Array.take numParams args'
                 remainingArgs = Array.drop numParams args'
                 s1 = foldl (\currentSubst (Tuple paramType appliedArg) ->
                        let actualType = case getExprAnn appliedArg of Ann a -> fromMaybe Any a.type
                        in unify paramType actualType currentSubst
                      ) s (Array.zip paramTypes appliedArgs)
               in
                 unifySpine ret remainingArgs s1
             unifySpine _ _ s = s
             
             subst = unifySpine genericType args substFromTypeArgs
             stripForAlls = case _ of
               ForAll _ b -> stripForAlls b
               x -> x
             instType = stripTypeVariables (substituteExprType subst (stripForAlls genericType))
             { dictArgs, normalArgs } = partitionArgs genericType args
          in
             if not (hasTypeVariables genericType) then acc2
             else if hasTypeVariables instType then acc2
             else
               let specKey = specializationKey instType dictArgs normalArgs
               in Map.insertWith (\new old -> Map.unionWith mergeInstantiation new old) qualName (Map.singleton specKey { instType: defaultToAny instType, dictArgs, normalArgs, callers: Set.singleton modName, subst }) acc2
        _ -> acc2

  ExprLit _ lit -> foldl (collectExpr globalAstMap modName) acc lit
  ExprConstructor _ _ _ _ -> acc
  ExprAccessor _ e _ -> collectExpr globalAstMap modName acc e
  ExprUpdate _ e props -> foldl (collectProp globalAstMap modName) (collectExpr globalAstMap modName acc e) props
  ExprAbs _ _ e -> collectExpr globalAstMap modName acc e
  ExprTypeApp _ e _ -> collectExpr globalAstMap modName acc e
  ExprCase _ exprs alts -> foldl (collectAlt globalAstMap modName) (foldl (collectExpr globalAstMap modName) acc exprs) alts
  ExprLet _ binds e -> foldl (collectBind globalAstMap modName) (collectExpr globalAstMap modName acc e) binds

collectProp :: Map String (Binding Ann) -> String -> InstantiationMap -> Prop (Expr Ann) -> InstantiationMap
collectProp globalAstMap modName acc (Prop _ e) = collectExpr globalAstMap modName acc e

collectAlt :: Map String (Binding Ann) -> String -> InstantiationMap -> CaseAlternative Ann -> InstantiationMap
collectAlt globalAstMap modName acc (CaseAlternative _ cg) = case cg of
  Unconditional e -> collectExpr globalAstMap modName acc e
  Guarded guards -> foldl (collectGuard globalAstMap modName) acc guards

collectGuard :: Map String (Binding Ann) -> String -> InstantiationMap -> Guard Ann -> InstantiationMap
collectGuard globalAstMap modName acc (Guard e1 e2) = collectExpr globalAstMap modName (collectExpr globalAstMap modName acc e1) e2

collectAllTypes :: Module Ann -> Set ExprType
collectAllTypes (Module m) = foldl (\a b -> collectTypesFromBind b a) Set.empty m.decls

type LocalInstMap = Map Ident { genericType :: ExprType, insts :: Array (Map String ExprType) }

collectLocalExpr :: Set Ident -> Set Ident -> LocalInstMap -> Expr Ann -> LocalInstMap
collectLocalExpr targets recs acc expr = case expr of
  ExprApp ann f arg ->
    let
      spineRec = collectSpine (ExprApp ann f arg)
      f_var = spineRec.f_var
      spine = spineRec.spine
      typeArgs = getSpineTypeArgs spine
      args = getSpineArgs spine
      
      acc1 = case f_var of
        ExprVar _ (Qualified Nothing id) | Set.member id targets && not (Set.member id recs) ->
          let
            genericType = case getExprAnn f_var of Ann a -> fromMaybe Any a.type
            substFromTypeArgs = buildSubst genericType typeArgs
            
            unifySpine :: ExprType -> Array (Expr Ann) -> Map String ExprType -> Map String ExprType
            unifySpine _ [] s = s
            unifySpine (ForAll _ t) args' s = unifySpine t args' s
            unifySpine (ConstrainedType constraints t) args' s =
              let numConstraints = Array.length constraints
              in unifySpine t (Array.drop numConstraints args') s
            unifySpine (Func paramTypes ret) args' s =
              let
                numParams = Array.length paramTypes
                appliedArgs = Array.take numParams args'
                remainingArgs = Array.drop numParams args'
                s1 = foldl (\currentSubst (Tuple paramType appliedArg) ->
                       let actualType = case getExprAnn appliedArg of Ann a -> fromMaybe Any a.type
                       in unify paramType actualType currentSubst
                     ) s (Array.zip paramTypes appliedArgs)
              in
                unifySpine ret remainingArgs s1
            unifySpine _ _ s = s
            
            finalSubst = unifySpine genericType args substFromTypeArgs
          in
            if not (Map.isEmpty finalSubst) then
              let
                stripForAlls = case _ of
                  ForAll _ b -> stripForAlls b
                  x -> x
                instType = stripTypeVariables (substituteExprType finalSubst (stripForAlls genericType))
              in
                if (hasTypeVariables genericType) && (hasTypeVariables instType && instType == stripForAlls genericType) then
                  acc
                else
                  Map.insertWith (\old new -> { genericType: new.genericType, insts: Array.nub (old.insts <> new.insts) }) id { genericType, insts: [finalSubst] } acc
            else if genericType == Any then
              -- Compiler-generated pattern continuations have no type annotation.
              -- An empty substitution cannot specialize or restore their type;
              -- cloning them at every call duplicates all nested continuations.
              acc
            else
              -- Even if finalSubst is empty, we must record the genericType so it can be restored!
              Map.insertWith (\old new -> { genericType: new.genericType, insts: Array.nub (old.insts <> new.insts) }) id { genericType, insts: [Map.empty] } acc
        _ -> collectLocalExpr targets recs acc f_var
      
      acc2 = foldl (collectLocalExpr targets recs) acc1 args
    in
      acc2
  ExprLit _ lit -> foldl (collectLocalExpr targets recs) acc lit
  ExprConstructor _ _ _ _ -> acc
  ExprAccessor _ e _ -> collectLocalExpr targets recs acc e
  ExprUpdate _ e props -> foldl (\a (Prop _ v) -> collectLocalExpr targets recs a v) (collectLocalExpr targets recs acc e) props
  ExprAbs _ _ e -> collectLocalExpr targets recs acc e
  ExprTypeApp _ e _ -> collectLocalExpr targets recs acc e
  ExprCase _ exprs alts ->
    foldl (\a (CaseAlternative _ cg) -> case cg of
      Unconditional e' -> collectLocalExpr targets recs a e'
      Guarded guards -> foldl (\a2 (Guard e1 e2) -> collectLocalExpr targets recs (collectLocalExpr targets recs a2 e1) e2) a guards
    ) (foldl (collectLocalExpr targets recs) acc exprs) alts
  ExprLet _ binds e -> foldl (\a b -> collectLocalBind targets recs a b) (collectLocalExpr targets recs acc e) binds
  ExprVar _ _ -> acc

collectLocalBind :: Set Ident -> Set Ident -> LocalInstMap -> Bind Ann -> LocalInstMap
collectLocalBind targets recs acc = case _ of
  NonRec (Binding _ _ e) -> collectLocalExpr targets recs acc e
  Rec binds -> 
    let newRecs = Set.fromFoldable (map (\(Binding _ id _) -> id) binds)
        combinedRecs = Set.union recs newRecs
    in foldl (\a (Binding _ _ e) -> collectLocalExpr targets combinedRecs a e) acc binds

collectTypesFromExpr :: Expr Ann -> Set ExprType -> Set ExprType
collectTypesFromExpr expr acc = case expr of
  ExprVar (Ann ann) _ -> maybe acc (\t -> Set.insert t acc) ann.type
  ExprLit (Ann ann) lit -> foldl (\a e -> collectTypesFromExpr e a) (maybe acc (\t -> Set.insert t acc) ann.type) lit
  ExprApp (Ann ann) f arg -> collectTypesFromExpr arg (collectTypesFromExpr f (maybe acc (\t -> Set.insert t acc) ann.type))
  ExprAbs (Ann ann) _ e -> collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)
  ExprLet (Ann ann) binds e -> foldl (\a b -> collectTypesFromBind b a) (collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)) binds
  ExprTypeApp (Ann ann) e _ -> collectTypesFromExpr e (maybe acc (\t -> Set.insert t acc) ann.type)
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

rewriteExpr :: Map String (Binding Ann) -> Map Ident (Expr Ann) -> Map String (Expr Ann) -> (ExprType -> ExprType) -> Expr Ann -> Expr Ann
rewriteExpr globalAstMap = goLocals
  where
  goLocals locals globalSubst f = go
    where
    go expr = case expr of
      ExprVar ann q@(Qualified mbMod (Ident name)) ->
        let
          qualName = case mbMod of
            Just mod -> unwrap mod <> "." <> name
            Nothing -> name
        in case Map.lookup qualName globalSubst of
          Just newExpr -> newExpr
          Nothing -> 
            let 
              -- A global function's quantifiers belong to its own declaration.
              -- Its TypeApp arguments carry instantiations from the caller.
              newAnn = case mbMod, ann of
                Just _, Ann { type: Just (ForAll _ _) } -> ann
                _, _ -> mapAnn f ann
            in ExprVar newAnn q
      ExprLit ann lit -> ExprLit (mapAnn f ann) (map go lit)
      ExprApp ann e1 e2 -> ExprApp (mapAnn f ann) (go e1) (go e2)
      ExprAbs ann id e -> ExprAbs (mapAnn f ann) id (goLocals (Map.delete id locals) globalSubst f e)
      ExprLet ann binds e ->
        let
          binds' = map goBind binds
          newLocals = foldl
            ( \acc b -> case b of
                NonRec (Binding _ ident val) -> Map.insert ident val acc
                _ -> acc
            )
            locals
            binds'
          e' = goLocals newLocals globalSubst f e

          foldFn b acc = case b of
            NonRec (Binding _ ident val) ->
              if Set.member ident acc.used then
                { used: Set.union (Set.delete ident acc.used) (collectFreeVars val), binds: Array.cons b acc.binds }
              else
                acc
            Rec bs ->
              let
                bound = foldl (\a (Binding _ ident _) -> Set.insert ident a) Set.empty bs
                isUsed = Array.any (\(Binding _ ident _) -> Set.member ident acc.used) bs
              in
                if isUsed then
                  let
                    usedByRec = foldl (\a (Binding _ _ val) -> Set.union a (collectFreeVars val)) acc.used bs
                    newUsed = Set.difference usedByRec bound
                  in
                    { used: newUsed, binds: Array.cons b acc.binds }
                else
                  acc

          filtered = Array.foldr foldFn { used: collectFreeVars e', binds: [] } binds'
        in
          if Array.length filtered.binds == 0 then e' else ExprLet (mapAnn f ann) filtered.binds e'
      ExprTypeApp ann e t ->
        ExprTypeApp (mapAnn f ann) (go e) (f t)
      ExprCase ann exprs alts ->
        let
          exprs' = map go exprs
        in
          case exprs', alts of
            [ e1 ], [ CaseAlternative [ BinderConstructor _ _ _ [ BinderVar _ ident ] ] (Unconditional e2) ] ->
              case resolveDict e1 of
                Just lit -> goLocals (Map.insert ident (ExprLit (getExprAnn e1) lit) locals) globalSubst f e2
                Nothing -> ExprCase (mapAnn f ann) exprs' (map goAlt alts)
            _, _ -> ExprCase (mapAnn f ann) exprs' (map goAlt alts)
      ExprConstructor ann t c ids -> ExprConstructor (mapAnn f ann) t c ids
      ExprAccessor ann e prop ->
        let
          e' = go e
        in
          case resolveDict e' of
            Just (LitRecord props) ->
              case Array.find (\(Prop p _) -> p == prop) props of
                Just (Prop _ val) -> go val
                Nothing -> ExprAccessor (mapAnn f ann) e' prop
            Just (LitArray _) ->
              ExprAccessor (mapAnn f ann) e' prop
            _ -> ExprAccessor (mapAnn f ann) e' prop
      ExprUpdate ann e props -> ExprUpdate (mapAnn f ann) (go e) (map goProp props)

    resolveDict :: Expr Ann -> Maybe (Literal (Expr Ann))
    resolveDict e = case e of
      ExprLit _ lit@(LitRecord _) -> Just lit
      ExprApp _ (ExprConstructor _ _ _ _) e' -> resolveDict e'
      ExprVar _ (Qualified mbMod ident) ->
        case mbMod of
          Nothing -> case Map.lookup ident locals of
            Just val -> resolveDict val
            Nothing -> Nothing
          Just (ModuleName mn) ->
            let
              fullName = mn <> "." <> (\(Ident n) -> n) ident
            in
              case Map.lookup fullName globalAstMap of
                Just (Binding _ _ val) -> resolveDict (resolveGlobals mn Set.empty val)
                Nothing -> Nothing
      ExprApp _ (ExprVar _ (Qualified _ (Ident ctorName))) arg | String.contains (Pattern "$Dict") ctorName -> resolveDict arg
      _ -> Nothing

    goBind (NonRec b) = NonRec (goBinding b)
    goBind (Rec bs) = Rec (map goBinding bs)

    goBinding (Binding ann id e) =
      let
        ann' = mapAnn f ann
      in
        Binding ann' id (go e)

    goAlt (CaseAlternative binders cg) = CaseAlternative (map goBinder binders) (goCaseGuard cg)

    goBinder binder = map (mapAnn f) binder

    goCaseGuard (Unconditional e) = Unconditional (go e)
    goCaseGuard (Guarded guards) = Guarded (map goGuard guards)

    goGuard (Guard e1 e2) = Guard (go e1) (go e2)

    goProp (Prop p e) = Prop p (go e)


substituteVars :: Map Ident (Expr Ann) -> Expr Ann -> Expr Ann
substituteVars subst = go
  where
  go = case _ of
    ExprVar ann (Qualified Nothing ident) ->
      case Map.lookup ident subst of
        Just e -> e
        Nothing -> ExprVar ann (Qualified Nothing ident)
    ExprVar ann q -> ExprVar ann q
    ExprLit ann lit -> ExprLit ann (map go lit)
    ExprApp ann f arg -> ExprApp ann (go f) (go arg)
    ExprAbs ann ident body ->
      ExprAbs ann ident (substituteVars (Map.delete ident subst) body)
    ExprLet ann binds body ->
      let
        bound = foldl
          ( \acc -> case _ of
              NonRec (Binding _ ident _) -> Set.insert ident acc
              Rec bs -> foldl (\acc2 (Binding _ ident _) -> Set.insert ident acc2) acc bs
          )
          Set.empty
          binds
        subst' = Map.filterKeys (\k -> not (Set.member k bound)) subst
      in
        ExprLet ann
          (map (\b -> case b of
              NonRec (Binding annB ident expr) -> NonRec (Binding annB ident (substituteVars subst' expr))
              Rec bs -> Rec (map (\(Binding annB ident expr) -> Binding annB ident (substituteVars subst' expr)) bs)
          ) binds)
          (substituteVars subst' body)
    ExprConstructor ann t c idents -> ExprConstructor ann t c idents
    ExprTypeApp ann e t -> ExprTypeApp ann (go e) t
    ExprCase ann exprs alts -> ExprCase ann (map go exprs) (map (\(CaseAlternative binders guard) -> CaseAlternative binders (goGuard subst guard)) alts)
    ExprAccessor ann e prop -> ExprAccessor ann (go e) prop
    ExprUpdate ann e props -> ExprUpdate ann (go e) (map (\(Prop p v) -> Prop p (go v)) props)

  goGuard guardSubst (Unconditional e) = Unconditional (substituteVars guardSubst e)
  goGuard guardSubst (Guarded guards) = Guarded (map (\(Guard e1 e2) -> Guard (substituteVars guardSubst e1) (substituteVars guardSubst e2)) guards)

applyStaticArgs :: Array (Expr Ann) -> Array (Expr Ann) -> Expr Ann -> Expr Ann
applyStaticArgs dictArgs normalArgs functionBody =
  let
    -- Traverse every supplied argument once so retained dynamic dictionary
    -- binders are not consumed again as normal parameters.
    args = map (Tuple "dict") dictArgs <> map (Tuple "norm") normalArgs
    result = goCollect args functionBody
  in
    substituteVars result.subst result.expr
  where
  goCollect args e = case Array.uncons args of
    Nothing -> { subst: Map.empty, expr: e }
    Just { head: Tuple prefix a, tail: as' } ->
      if isStatic a then
        case e of
          ExprAbs ann id b ->
            let
              rest = goCollect as' b
            in
              { subst: Map.insert id a rest.subst, expr: keepUnused prefix ann id rest.expr }
          _ -> 
            let
              freshId = Ident ("__eta_" <> prefix <> "_" <> show (Array.length as'))
              ann = getExprAnn e
              etaBody = applyEtaArgument freshId a e
              rest = goCollect as' etaBody
            in
              { subst: Map.insert freshId a rest.subst, expr: keepUnused prefix ann freshId rest.expr }
      else
        case e of
          ExprAbs _ id b -> 
            let rest = goCollect as' b
            in { subst: rest.subst, expr: ExprAbs (getExprAnn e) id rest.expr }
          _ ->
            let
              freshId = Ident ("__eta_" <> prefix <> "_" <> show (Array.length as'))
              ann = getExprAnn e
              etaBody = applyEtaArgument freshId a e
              rest = goCollect as' etaBody
            in
              { subst: rest.subst, expr: ExprAbs ann freshId rest.expr }

  applyEtaArgument ident arg fn =
    let
      Ann ann = getExprAnn fn
      step = ann.type >>= consumeType
      argAnn = Ann (ann { type = map _.argType step })
      resultAnn = Ann (ann { type = map _.resultType step })
    in
      ExprApp resultAnn fn (ExprVar argAnn (Qualified Nothing ident))
    where
    consumeType = case _ of
      ForAll vars body -> map (\step -> step { resultType = ForAll vars step.resultType }) (consumeType body)
      ConstrainedType constraints body -> case Array.uncons constraints of
        Just { tail } -> Just
          { argType: fromMaybe Any (inferExprType arg)
          , resultType: if Array.null tail then body else ConstrainedType tail body
          }
        Nothing -> consumeType body
      Func paramTypes ret -> case Array.uncons paramTypes of
        Just { head, tail } -> Just
          { argType: head
          , resultType: if Array.null tail then ret else Func tail ret
          }
        Nothing -> consumeType ret
      _ -> Nothing

  -- Normal arguments remain in the caller's spine, so retain each placeholder
  -- in its original position relative to dynamic parameters. Static dictionaries
  -- are removed from the caller's spine and do not need a placeholder.
  keepUnused prefix ann id e =
    if prefix == "norm" then ExprAbs ann (Ident (unwrap id <> "_unused")) e
    else e

getBindIdents :: Array (Bind Ann) -> Array Ident
getBindIdents = Array.concatMap case _ of
  NonRec (Binding _ id _) -> [ id ]
  Rec binds -> map (\(Binding _ id _) -> id) binds

monomorphize :: Map String (Binding Ann) -> InstantiationMap -> Module Ann -> Module Ann
monomorphize globalAstMap instMap (Module m) =
  let
    modNameStr = unwrap m.name

    getInjectedBindsFor qualName = case Map.lookup qualName instMap of
      Just typeMap ->
        let
          processBinding = case Map.lookup qualName globalAstMap of
            Just (Binding ann (Ident name) expr) ->
              Array.mapMaybe
                ( \(Tuple specKey info) ->
                    if hasTypeVariables info.instType then Nothing
                    else
                      let
                        definerMod = case String.split (Pattern ".") qualName of
                          parts -> String.joinWith "." (fromMaybe [] (Array.init parts))
                      in
                        if modNameStr == definerMod then
                          let
                            stripForAlls = case _ of
                              ForAll _ b -> stripForAlls b
                              x -> x
                            substFn t = stripStaticConstraints info.dictArgs (substituteExprType info.subst (stripForAlls t))
                            astSubstFn t = substituteExprType info.subst (stripForAlls t)

                            exprWithDicts = applyStaticArgs info.dictArgs info.normalArgs expr
                            resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts

                            finalTy = stripTypeVariables (substFn info.instType)

                            -- Recursive calls need the same spine rewrite as other
                            -- calls, including removal of static dictionaries.
                            specializedExpr = monomorphizeExpr modNameStr instMap Map.empty (rewriteExpr globalAstMap Map.empty Map.empty astSubstFn resolvedExpr)

                            etaExpandedExpr = case specializedExpr of
                              ExprAbs _ _ _ -> specializedExpr
                              _ | Array.length info.dictArgs == 0 && Array.length info.normalArgs == 0 -> specializedExpr
                              _ ->
                                let
                                  monomorphizedAnn = mapAnn (\_ -> finalTy) ann
                                in
                                  case extractFuncType finalTy of
                                    Just { fArgs } ->
                                      let
                                        idents = Array.mapWithIndex (\i _ -> Ident ("__eta" <> show i)) fArgs
                                        vars = map (\id -> ExprVar monomorphizedAnn (Qualified Nothing id)) idents
                                        app = foldl (\acc v -> ExprApp monomorphizedAnn acc v) specializedExpr vars
                                      in
                                        Array.foldr (\id acc -> ExprAbs monomorphizedAnn id acc) app idents
                                    Nothing -> specializedExpr

                            newName = Ident (name <> "__" <> hashString specKey)
                            -- Dynamic dictionaries still have runtime parameters.
                            -- Keep their constraints after removing only static ones.
                            newBinding = Rec [ Binding (mapAnn substFn ann) newName etaExpandedExpr ]
                          in
                            Just newBinding
                        else Nothing
                )
                (Map.toUnfoldable typeMap :: Array _)
            Nothing -> []
        in
          processBinding
      Nothing -> []

    processDecl bind =
      let
        originalBinds = monomorphizeBind modNameStr instMap Map.empty bind
        injectedBinds = case bind of
          NonRec (Binding _ (Ident name) _) -> getInjectedBindsFor (modNameStr <> "." <> name)
          Rec bindings -> Array.concatMap (\(Binding _ (Ident name) _) -> getInjectedBindsFor (modNameStr <> "." <> name)) bindings
      in originalBinds <> injectedBinds

    finalDecls = sortBindingGroups m.name (Array.concatMap processDecl m.decls)
    newIdents = getBindIdents finalDecls
  in
    -- Specialization and dictionary inlining change use counts and lexical
    -- identities. No source certificate survives this public boundary.
    invalidateSourceUsageModule $ Module (m { decls = finalDecls, exports = newIdents })

monomorphizeBind :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Bind Ann -> Array (Bind Ann)
monomorphizeBind modName instMap localDicts (NonRec binding) =
  [ NonRec (monomorphizeBinding modName instMap localDicts binding) ]
monomorphizeBind modName instMap localDicts (Rec bindings) =
  [ Rec (map (monomorphizeBinding modName instMap localDicts) bindings) ]

monomorphizeBinding :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Binding Ann -> Binding Ann
monomorphizeBinding modName instMap localDicts (Binding ann (Ident name) expr) =
  Binding ann (Ident name) (monomorphizeExpr modName instMap localDicts (resolveGlobals modName Set.empty expr))

collectFreeVars :: Expr Ann -> Set Ident
collectFreeVars = case _ of
  ExprVar _ (Qualified Nothing ident) -> Set.singleton ident
  ExprVar _ _ -> Set.empty
  ExprLit _ lit -> foldl (\acc e -> Set.union acc (collectFreeVars e)) Set.empty lit
  ExprApp _ e1 e2 -> Set.union (collectFreeVars e1) (collectFreeVars e2)
  ExprAbs _ ident e -> Set.delete ident (collectFreeVars e)
  ExprLet _ binds e ->
    let
      bound = foldl
        ( \acc b -> case b of
            NonRec (Binding _ ident _) -> Set.insert ident acc
            Rec bs -> foldl (\a (Binding _ ident _) -> Set.insert ident a) acc bs
        )
        Set.empty
        binds
      used = foldl
        ( \acc b -> case b of
            NonRec (Binding _ _ val) -> Set.union acc (collectFreeVars val)
            Rec bs -> foldl (\a (Binding _ _ val) -> Set.union a (collectFreeVars val)) acc bs
        )
        (collectFreeVars e)
        binds
    in
      Set.difference used bound
  ExprTypeApp _ e _ ->
    collectFreeVars e
  ExprCase _ exprs alts ->
    foldl (\acc alt -> Set.union acc (collectFreeVarsAlt alt)) (foldl (\acc e -> Set.union acc (collectFreeVars e)) Set.empty exprs) alts
  ExprConstructor _ _ _ _ -> Set.empty
  ExprAccessor _ e _ -> collectFreeVars e
  ExprUpdate _ e props -> foldl (\acc (Prop _ val) -> Set.union acc (collectFreeVars val)) (collectFreeVars e) props

collectFreeVarsAlt :: CaseAlternative Ann -> Set Ident
collectFreeVarsAlt (CaseAlternative binders cg) =
  let
    bound = foldl (\acc binder -> Set.union acc (binderIdents binder)) Set.empty binders
    used = case cg of
      Unconditional e -> collectFreeVars e
      Guarded guards -> foldl (\acc (Guard g e) -> Set.union acc (Set.union (collectFreeVars g) (collectFreeVars e))) Set.empty guards
  in
    Set.difference used bound

monomorphizeExpr :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Expr Ann -> Expr Ann
monomorphizeExpr modName instMap localDicts rootExpr = case rootExpr of
  ExprVar ann ident@(Qualified mbMod (Ident name)) ->
    case mbMod of
      Nothing -> case Map.lookup (Ident name) localDicts of
        Just d -> d
        Nothing -> ExprVar ann ident
      _ -> ExprVar ann ident
  expr | isAppOrTypeApp expr ->
    let
      Ann ann = getExprAnn expr
      { f_var, spine } = collectAnnotatedSpine expr
      f_var' = monomorphizeExpr modName instMap localDicts f_var
      annotatedSpine' = map (\(Tuple appAnn arg) -> Tuple appAnn case arg of
        SpineApp e -> SpineApp (monomorphizeExpr modName instMap localDicts e)
        SpineTypeApp t -> SpineTypeApp t) spine
      spine' = map (\(Tuple _ arg) -> arg) annotatedSpine'
      transformedExpr = foldl applyAnnotatedSpine f_var' annotatedSpine'

      typeArgs = getSpineTypeArgs spine'
      args' = getSpineArgs spine'
    in
      case f_var' of
        ExprVar (Ann varAnn) (Qualified (Just mod) (Ident name)) ->
          let
             genericType = fromMaybe Any varAnn.type
             subst = buildSubst genericType typeArgs
             stripForAlls = case _ of
               ForAll _ b -> stripForAlls b
               x -> x
             instType = stripTypeVariables (substituteExprType subst (stripForAlls genericType))
             { dictArgs, normalArgs } = partitionArgs genericType args'
             qualName = unwrap mod <> "." <> name
             filteredArgs = Array.filter (\d -> not (isStatic d)) dictArgs <> normalArgs
             
          in
             if hasTypeVariables instType then
               transformedExpr
             else
               case Map.lookup qualName instMap of
                    Just typeMap ->
                      let specKey = specializationKey instType dictArgs normalArgs
                      in case Map.lookup specKey typeMap of
                        Just _ ->
                          let
                             specializedName = Ident (name <> "__" <> hashString specKey)
                             stripForAlls2 = case _ of
                               ForAll _ b -> stripForAlls2 b
                               x -> x
                             -- varAnn binds the call site's type variables; info.subst
                             -- belongs to the definition and may use different names.
                             substFn t = stripStaticConstraints dictArgs (substituteExprType subst (stripForAlls2 t))
                             newAnn = varAnn { type = map substFn varAnn.type }
                             definerMod = case String.split (Pattern ".") qualName of
                               parts -> String.joinWith "." (fromMaybe [] (Array.init parts))
                             resolvedMod = Just (ModuleName definerMod)
                             specializedVar = ExprVar (Ann newAnn) (Qualified resolvedMod specializedName)
                          in
                             rebuildSpecializedCall (Ann ann) specializedVar filteredArgs
                        Nothing -> transformedExpr
                    Nothing -> transformedExpr
        _ -> transformedExpr

  ExprLit ann lit -> ExprLit ann (map (monomorphizeExpr modName instMap localDicts) lit)
  ExprAbs ann id e -> ExprAbs ann id (monomorphizeExpr modName instMap localDicts e)
  ExprLet ann binds e ->
    let
      newLocalDicts = Array.foldl
        ( \acc b -> case b of
            NonRec (Binding _ id bindExpr) | isStatic bindExpr -> Map.insert id bindExpr acc
            _ -> acc
        )
        localDicts
        binds

      boundIds = foldl (\acc -> case _ of
          NonRec (Binding _ id _) -> Set.insert id acc
          Rec bs -> foldl (\a (Binding _ id _) -> Set.insert id a) acc bs
        ) Set.empty binds
        
      localInstMap = collectLocalExpr boundIds Set.empty Map.empty (ExprLet ann binds e)
      
    in
      if Map.isEmpty localInstMap then
        ExprLet ann (map (monomorphizeBindLocal modName instMap newLocalDicts) binds) (monomorphizeExpr modName instMap newLocalDicts e)
      else
        let
          injectType ty expr =
            let
              stripForAlls = case _ of
                ForAll _ b -> stripForAlls b
                x -> x
            in
              case stripForAlls ty, expr of
                Func paramTypes ret, ExprAbs (Ann a) argId bodyExpr ->
                  if Array.length paramTypes > 1 then
                    let nextTy = Func (Array.drop 1 paramTypes) ret
                    in ExprAbs (Ann (a { type = Just ty })) argId (injectType nextTy bodyExpr)
                  else if Array.length paramTypes == 1 then
                    ExprAbs (Ann (a { type = Just ty })) argId (injectType ret bodyExpr)
                  else
                    ExprAbs (Ann (a { type = Just ty })) argId bodyExpr
                _, ExprAbs (Ann a) argId bodyExpr ->
                  ExprAbs (Ann (a { type = Just ty })) argId bodyExpr
                _, _ -> expr

          processBinds = foldl (\acc bind -> 
            case bind of
              NonRec b@(Binding bAnn id bExpr) ->
                case Map.lookup id localInstMap of
                  Just { genericType, insts: substList } ->
                     let
                       fixedAnn = case bAnn of Ann a -> Ann (a { type = Just genericType })
                       fixedExpr = injectType genericType bExpr
                       specs = Array.mapMaybe (\substType ->
                           let
                             instType = stripTypeVariables (substituteExprType substType genericType)
                             specKey = mangleType (defaultToAny instType)
                             mangledId = Ident (unwrap id <> "__" <> hashString specKey)
                             specExpr = rewriteExpr Map.empty Map.empty Map.empty (\t -> substituteExprType substType (stripTypeVariables t)) fixedExpr
                             newBind = Binding (mapAnn (\t -> substituteExprType substType (stripTypeVariables t)) fixedAnn) mangledId specExpr
                           in
                             Just { specKey, mangledId, newBind }
                       ) substList
                       
                       newBinds = [NonRec b] <> map (\s -> NonRec s.newBind) specs
                       polyMapEntry = Map.fromFoldable (map (\s -> Tuple s.specKey s.mangledId) specs)
                     in
                       { binds: acc.binds <> newBinds, polyMap: Map.insert id polyMapEntry acc.polyMap }
                  Nothing -> { binds: Array.snoc acc.binds bind, polyMap: acc.polyMap }
              
              Rec bs ->
                let
                  specs = foldl (\accRec (Binding bAnn id bExpr) ->
                    case Map.lookup id localInstMap of
                      Just { genericType, insts: substList } ->
                         let
                           fixedAnn = case bAnn of Ann a -> Ann (a { type = Just genericType })
                           fixedExpr = injectType genericType bExpr
                           s = Array.mapMaybe (\substType ->
                               let
                                 instType = stripTypeVariables (substituteExprType substType genericType)
                                 specKey = mangleType (defaultToAny instType)
                                 mangledId = Ident (unwrap id <> "__" <> hashString specKey)
                                 specExpr = rewriteExpr Map.empty Map.empty Map.empty (\t -> substituteExprType substType (stripTypeVariables t)) fixedExpr
                                 newBind = Binding (mapAnn (\t -> substituteExprType substType (stripTypeVariables t)) fixedAnn) mangledId specExpr
                               in
                                 Just { specKey, mangledId, newBind }
                           ) substList
                         in
                           { newBinds: accRec.newBinds <> map _.newBind s
                           , polyMap: Map.insert id (Map.fromFoldable (map (\x -> Tuple x.specKey x.mangledId) s)) accRec.polyMap 
                           }
                      Nothing -> accRec
                  ) { newBinds: [], polyMap: acc.polyMap } bs
                in
                  -- Specialized bodies can still pass the original recursive
                  -- function as a value, so both must share the same scope.
                  if Array.length specs.newBinds > 0 then
                    { binds: Array.snoc acc.binds (Rec (specs.newBinds <> bs)), polyMap: specs.polyMap }
                  else
                    { binds: Array.snoc acc.binds (Rec bs), polyMap: acc.polyMap }
          ) { binds: [], polyMap: Map.empty } binds

          polys = processBinds.polyMap
          
          go expr = case expr of
            ExprApp _ _ _ ->
              let
                spineRec = collectAnnotatedSpine expr
                f_var = spineRec.f_var
                spine = map (\(Tuple _ arg) -> arg) spineRec.spine
                transformedSpine = map (\(Tuple appAnn arg) -> Tuple appAnn case arg of
                  SpineApp e' -> SpineApp (go e')
                  SpineTypeApp t -> SpineTypeApp t) spineRec.spine
                fallback = foldl applyAnnotatedSpine (go f_var) transformedSpine
              in
                case f_var of
                  ExprVar varAnn (Qualified Nothing id) | Just insts <- Map.lookup id polys ->
                    let
                      typeArgs = getSpineTypeArgs spine
                      args = getSpineArgs spine
                      
                      genericType = case getExprAnn f_var of Ann a -> fromMaybe Any a.type
                      substFromTypeArgs = buildSubst genericType typeArgs
                      
                      unifySpine :: ExprType -> Array (Expr Ann) -> Map String ExprType -> Map String ExprType
                      unifySpine _ [] s = s
                      unifySpine (ForAll _ t) args' s = unifySpine t args' s
                      unifySpine (ConstrainedType constraints t) args' s =
                        let numConstraints = Array.length constraints
                        in unifySpine t (Array.drop numConstraints args') s
                      unifySpine (Func paramTypes ret) args' s =
                        let
                          numParams = Array.length paramTypes
                          appliedArgs = Array.take numParams args'
                          remainingArgs = Array.drop numParams args'
                          s1 = foldl (\currentSubst (Tuple paramType appliedArg) ->
                                 let actualType = case getExprAnn appliedArg of Ann a -> fromMaybe Any a.type
                                 in unify paramType actualType currentSubst
                               ) s (Array.zip paramTypes appliedArgs)
                        in
                          unifySpine ret remainingArgs s1
                      unifySpine _ _ s = s
                      
                      substType = unifySpine genericType args substFromTypeArgs
                    in
                        let
                          instType = stripTypeVariables (substituteExprType substType genericType)
                          specKey = mangleType (defaultToAny instType)
                        in
                          case Map.lookup specKey insts of
                            Just mangledId ->
                              let
                                newVar = ExprVar (mapAnn (\_ -> defaultToAny instType) varAnn) (Qualified Nothing mangledId)
                                valueSpine = Array.filter (\(Tuple _ arg) -> case arg of
                                  SpineApp _ -> true
                                  SpineTypeApp _ -> false) transformedSpine
                              in
                                foldl applyAnnotatedSpine newVar valueSpine
                            Nothing -> fallback
                  _ -> fallback
            ExprLit annLit lit -> ExprLit annLit (map go lit)
            ExprAbs annAbs id e' -> ExprAbs annAbs id (go e')
            ExprLet annLet binds' e' -> ExprLet annLet (map goBind binds') (go e')
            ExprTypeApp annTy e' t -> ExprTypeApp annTy (go e') t
            ExprCase annCase exprs alts -> ExprCase annCase (map go exprs) (map goAlt alts)
            ExprConstructor annCtor t c ids -> ExprConstructor annCtor t c ids
            ExprAccessor annAcc e' prop -> ExprAccessor annAcc (go e') prop
            ExprUpdate annUp e' props -> ExprUpdate annUp (go e') (map goProp props)
            ExprVar _ _ -> expr

          goBind (NonRec (Binding bAnn id e')) = NonRec (Binding bAnn id (go e'))
          goBind (Rec binds') = Rec (map (\(Binding bAnn id e') -> Binding bAnn id (go e')) binds')
          goAlt (CaseAlternative binders cg) = CaseAlternative binders (goCaseGuard cg)
          goCaseGuard (Unconditional e') = Unconditional (go e')
          goCaseGuard (Guarded guards) = Guarded (map (\(Guard e1 e2) -> Guard (go e1) (go e2)) guards)
          goProp (Prop p e') = Prop p (go e')

          rewrittenBinds = map goBind processBinds.binds
          rewrittenE = go e
        in
          ExprLet ann (map (monomorphizeBindLocal modName instMap newLocalDicts) rewrittenBinds) (monomorphizeExpr modName instMap newLocalDicts rewrittenE)
  ExprCase ann exprs alts -> ExprCase ann (map (monomorphizeExpr modName instMap localDicts) exprs) (map (monomorphizeAlt modName instMap localDicts) alts)
  ExprConstructor ann t c ids -> ExprConstructor ann t c ids
  ExprAccessor ann e prop -> ExprAccessor ann (monomorphizeExpr modName instMap localDicts e) prop
  ExprUpdate ann e props -> ExprUpdate ann (monomorphizeExpr modName instMap localDicts e) (map (monomorphizeProp modName instMap localDicts) props)
  _ -> rootExpr
  where
  -- Keep the original head boundary and each application's TAST annotation.
  collectAnnotatedSpine = go []
    where
    go spine = case _ of
      ExprApp ann fn arg -> go (Array.cons (Tuple ann (SpineApp arg)) spine) fn
      ExprTypeApp ann fn ty -> go (Array.cons (Tuple ann (SpineTypeApp ty)) spine) fn
      head -> { f_var: head, spine }

  -- Reuse transformed arguments when no specialization applies.
  applyAnnotatedSpine fn (Tuple ann arg) = case arg of
    SpineApp e -> ExprApp ann fn e
    SpineTypeApp t -> ExprTypeApp ann fn t

  isAppOrTypeApp (ExprApp _ _ _) = true
  isAppOrTypeApp (ExprTypeApp _ _ _) = true
  isAppOrTypeApp _ = false

monomorphizeBindLocal :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Bind Ann -> Bind Ann
monomorphizeBindLocal modName instMap localDicts (NonRec b) = NonRec (monomorphizeBindingLocal modName instMap localDicts b)
monomorphizeBindLocal modName instMap localDicts (Rec bs) = Rec (map (monomorphizeBindingLocal modName instMap localDicts) bs)

monomorphizeBindingLocal :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Binding Ann -> Binding Ann
monomorphizeBindingLocal modName instMap localDicts (Binding ann id e) = 
  Binding ann id (monomorphizeExpr modName instMap localDicts e)

monomorphizeAlt :: String -> InstantiationMap -> Map Ident (Expr Ann) -> CaseAlternative Ann -> CaseAlternative Ann
monomorphizeAlt modName instMap localDicts (CaseAlternative binders cg) = CaseAlternative binders (monomorphizeCaseGuard modName instMap localDicts cg)

monomorphizeCaseGuard :: String -> InstantiationMap -> Map Ident (Expr Ann) -> CaseGuard Ann -> CaseGuard Ann
monomorphizeCaseGuard modName instMap localDicts (Unconditional e) = Unconditional (monomorphizeExpr modName instMap localDicts e)
monomorphizeCaseGuard modName instMap localDicts (Guarded guards) = Guarded (map (monomorphizeGuard modName instMap localDicts) guards)

monomorphizeGuard :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Guard Ann -> Guard Ann
monomorphizeGuard modName instMap localDicts (Guard e1 e2) = Guard (monomorphizeExpr modName instMap localDicts e1) (monomorphizeExpr modName instMap localDicts e2)

monomorphizeProp :: String -> InstantiationMap -> Map Ident (Expr Ann) -> Prop (Expr Ann) -> Prop (Expr Ann)
monomorphizeProp modName instMap localDicts (Prop p e) = Prop p (monomorphizeExpr modName instMap localDicts e)

rebuildSpecializedCall :: Ann -> Expr Ann -> Array (Expr Ann) -> Expr Ann
rebuildSpecializedCall (Ann sourceAnn) f args = Array.foldl applyArgument f args
  where
  -- Each application consumes one remaining runtime parameter. In particular,
  -- a partial application must not inherit the saturated call's result type.
  applyArgument acc arg =
    let resultType = inferExprType acc >>= consumeArgument
    in ExprApp (Ann (sourceAnn { type = resultType })) acc arg

  consumeArgument = case _ of
    ForAll _ body -> consumeArgument body
    ConstrainedType constraints body -> case Array.uncons constraints of
      Just { tail } -> Just (if Array.null tail then body else ConstrainedType tail body)
      Nothing -> consumeArgument body
    Func params result -> case Array.uncons params of
      Just { tail } -> Just (if Array.null tail then result else Func tail result)
      Nothing -> consumeArgument result
    _ -> Nothing

hasTypeVariables :: ExprType -> Boolean
hasTypeVariables (TypeVar v) = String.take 1 v == String.toLower (String.take 1 v) && v /= "gopurs_runtime.Value"
hasTypeVariables (Func args ret) = Array.any hasTypeVariables args || hasTypeVariables ret
hasTypeVariables (Array t) = hasTypeVariables t
hasTypeVariables (Record row) = hasTypeVariables row
hasTypeVariables (Row props tail) =
  let
    tailHas = case tail of
      Nothing -> false
      Just t -> hasTypeVariables t
  in
    Array.any (\(Tuple _ v) -> hasTypeVariables v) props || tailHas
hasTypeVariables (TypeApp c args) = hasTypeVariables c || Array.any hasTypeVariables args
hasTypeVariables (ForAll _ body) = hasTypeVariables body
hasTypeVariables (ConstrainedType constraints body) = Array.any (\(Tuple _ a) -> Array.any hasTypeVariables a) constraints || hasTypeVariables body
hasTypeVariables Int = false
hasTypeVariables String = false
hasTypeVariables Char = false
hasTypeVariables Number = false
hasTypeVariables Boolean = false
hasTypeVariables Unit = false
hasTypeVariables (TypeLevelString _) = false
hasTypeVariables (ADT _ _ args) = Array.any hasTypeVariables args
hasTypeVariables Any = true

stripTypeVariables :: ExprType -> ExprType
stripTypeVariables (ForAll _ t) = stripTypeVariables t
stripTypeVariables (ConstrainedType _ t) = stripTypeVariables t
stripTypeVariables t = t

resolveGlobals :: String -> Set Ident -> Expr Ann -> Expr Ann
resolveGlobals definerMod = go
  where
  go bound = case _ of
    ExprVar ann (Qualified Nothing ident) ->
      if Set.member ident bound then
        ExprVar ann (Qualified Nothing ident)
      else
        ExprVar ann (Qualified (Just (ModuleName definerMod)) ident)
    ExprVar ann q -> ExprVar ann q
    ExprAbs ann ident body ->
      ExprAbs ann ident (go (Set.insert ident bound) body)
    ExprApp ann f arg ->
      ExprApp ann (go bound f) (go bound arg)
    ExprLet ann binds body ->
      let
        bound' = foldl
          ( \acc -> case _ of
              NonRec (Binding _ ident _) -> Set.insert ident acc
              Rec bs -> foldl (\acc2 (Binding _ ident _) -> Set.insert ident acc2) acc bs
          )
          bound
          binds
        binds' = map
          ( \b -> case b of
              NonRec (Binding annB ident expr) -> NonRec (Binding annB ident (go bound' expr))
              Rec bs -> Rec (map (\(Binding annB ident expr) -> Binding annB ident (go bound' expr)) bs)
          )
          binds
      in
        ExprLet ann binds' (go bound' body)
    ExprConstructor ann t c idents ->
      ExprConstructor ann t c idents
    ExprTypeApp ann e t ->
      ExprTypeApp ann (go bound e) t
    ExprCase ann exprs alts ->
      ExprCase ann (map (go bound) exprs)
        ( map
            ( \(CaseAlternative binders guard) ->
                let
                  binders' = map (resolveGlobalsBinder definerMod) binders
                  bound' = foldl (\acc binder -> Set.union (binderIdents binder) acc) bound binders'

                  goGuard cgGuard = case cgGuard of
                    Unconditional e -> Unconditional (go bound' e)
                    Guarded guards -> Guarded (map (\(Guard g e) -> Guard (go bound' g) (go bound' e)) guards)

                in
                  CaseAlternative binders' (goGuard guard)
            )
            alts
        )
    ExprAccessor ann expr p -> ExprAccessor ann (go bound expr) p
    ExprUpdate ann expr updates -> ExprUpdate ann (go bound expr) (map (\(Prop p e) -> Prop p (go bound e)) updates)
    ExprLit ann lit -> ExprLit ann (map (go bound) lit)

resolveGlobalsBinder :: String -> Binder Ann -> Binder Ann
resolveGlobalsBinder definerMod = case _ of
  BinderConstructor ann t c binders ->
    let
      t' = case t of
        Qualified Nothing pn -> Qualified (Just (ModuleName definerMod)) pn
        _ -> t
      c' = case c of
        Qualified Nothing id -> Qualified (Just (ModuleName definerMod)) id
        _ -> c
    in
      BinderConstructor ann t' c' (map (resolveGlobalsBinder definerMod) binders)
  BinderNamed ann ident b -> BinderNamed ann ident (resolveGlobalsBinder definerMod b)
  BinderLit ann lit -> BinderLit ann (map (resolveGlobalsBinder definerMod) lit)
  b -> b

binderIdents :: forall a. Binder a -> Set Ident
binderIdents = case _ of
  BinderVar _ ident -> Set.singleton ident
  BinderConstructor _ _ _ binders -> foldl (\acc b -> Set.union (binderIdents b) acc) Set.empty binders
  BinderNamed _ ident binder -> Set.insert ident (binderIdents binder)
  BinderLit _ lit -> foldl (\acc b -> Set.union (binderIdents b) acc) Set.empty lit
  _ -> Set.empty

-- Map.insertWith passes the existing value first: preserve its payload and
-- union callers, whether collecting directly or replaying a cached contribution.
mergeInstantiation :: Instantiation -> Instantiation -> Instantiation
mergeInstantiation first next = first { callers = Set.union first.callers next.callers }

mergeInstantiations :: InstantiationMap -> InstantiationMap -> InstantiationMap
mergeInstantiations = Map.unionWith (Map.unionWith mergeInstantiation)

-- Conservative dependencies of monomorphizeExpr, including globals in local
-- dictionaries and static arguments. Local specialization only introduces local
-- names; every global it can consult comes from this prepared expression.
collectDependencies :: Expr Ann -> Set String
collectDependencies = go Set.empty
  where
  go acc = case _ of
    ExprVar _ (Qualified (Just mod) (Ident name)) -> Set.insert (unwrap mod <> "." <> name) acc
    ExprVar _ _ -> acc
    ExprLit _ lit -> foldl go acc lit
    ExprConstructor _ _ _ _ -> acc
    ExprApp _ f x -> go (go acc f) x
    ExprTypeApp _ e _ -> go acc e
    ExprAbs _ _ e -> go acc e
    ExprAccessor _ e _ -> go acc e
    ExprUpdate _ e props -> foldl (\a (Prop _ v) -> go a v) (go acc e) props
    ExprLet _ binds e -> foldl goBind (go acc e) binds
    ExprCase _ exprs alts -> foldl goAlt (foldl go acc exprs) alts
  goBind acc = case _ of
    NonRec (Binding _ _ e) -> go acc e
    Rec binds -> foldl (\a (Binding _ _ e) -> go a e) acc binds
  goAlt acc (CaseAlternative _ guard) = case guard of
    Unconditional e -> go acc e
    Guarded guards -> foldl (\a (Guard g e) -> go (go a g) e) acc guards

specializationCount :: InstantiationMap -> String -> Int
specializationCount instantiations name = maybe 0 Map.size (Map.lookup name instantiations)

-- Within one transitiveCollect call keys only grow, and globalAstMap is fixed.
-- Equal cardinalities therefore imply equal key sets. Payload/caller changes
-- cannot affect monomorphizeExpr, which only tests membership of those keys.
sameDependencySizes :: InstantiationMap -> Map String Int -> Boolean
sameDependencySizes instantiations dependencies = Array.all
  (\(Tuple name size) -> specializationCount instantiations name == size)
  (Map.toUnfoldable dependencies :: Array _)

transitiveCollect :: Map String (Binding Ann) -> InstantiationMap -> InstantiationMap
transitiveCollect globalAstMap initialMap =
  unwrap $ transitiveCollectWith (Identity <<< map (\job -> job unit)) globalAstMap initialMap

-- | Evaluate a round's independent jobs, returning results in input order.
-- | Jobs only read immutable snapshots. The ordered merge and the barrier
-- | between fixed-point rounds remain here, independently of the dispatcher.
transitiveCollectWith
  :: forall m
   . MonadRec m
  => (Array (Unit -> TransitiveResult) -> m (Array TransitiveResult))
  -> Map String (Binding Ann)
  -> InstantiationMap
  -> m InstantiationMap
transitiveCollectWith runJobs globalAstMap initialMap =
  tailRecM loop { prepared: Map.empty, instantiations: initialMap }
  where
  loop :: TransitiveState -> m (Step TransitiveState InstantiationMap)
  loop { prepared, instantiations: currentMap } = do
    let
      -- Foreign declarations have no AST body from which to emit a specialization.
      -- Keep their collected type information, but never embed nonexistent
      -- specialized foreign names in another specialization's static arguments.
      specializationMap = Map.filterKeys (\name -> Map.member name globalAstMap) currentMap
      jobs = Array.concatMap
        ( \(Tuple qualName typeMap) ->
            map
              (\(Tuple specKey info) _ -> collectEntry specializationMap prepared qualName specKey info)
              (Map.toUnfoldable typeMap :: Array _)
        )
        (Map.toUnfoldable currentMap :: Array _)
    results <- runJobs jobs
    let
      collected = Array.foldl mergeResult { instantiations: currentMap, prepared } results
      newMap = collected.instantiations

      countCallers m = Array.foldl
        ( \acc (Tuple _ typeMap) ->
            acc + Array.foldl (\a (Tuple _ info) -> a + Set.size info.callers) 0 (Map.toUnfoldable typeMap :: Array _)
        )
        0
        (Map.toUnfoldable m :: Array _)
      callers1 = countCallers currentMap
      callers2 = countCallers newMap
    pure $ if callers1 == callers2 then Done currentMap else Loop collected

  collectEntry :: InstantiationMap -> PreparedInstantiations -> String -> String -> Instantiation -> TransitiveResult
  collectEntry specializationMap prepared qualName specKey info =
    let
      definerMod = case String.split (Pattern ".") qualName of
        parts -> String.joinWith "." (fromMaybe [] (Array.init parts))

      genericExprOpt = Map.lookup qualName globalAstMap
    in
      case genericExprOpt of
        Just (Binding _ _ expr) ->
          if hasTypeVariables info.instType || Set.isEmpty info.callers then Nothing
          else
            let
              stripForAlls = case _ of
                ForAll _ b -> stripForAlls b
                x -> x
              astSubstFn t = substituteExprType info.subst (stripForAlls t)
              cacheKey = Tuple qualName specKey
              previous = case Map.lookup cacheKey prepared of
                Just old | sameInstantiationInputs old.info info -> Just old
                _ -> Nothing
              reused = case previous of
                Just cached | sameDependencySizes specializationMap cached.dependencies -> Just cached
                _ -> Nothing
              entry = case reused of
                Just cached -> cached
                _ ->
                  let
                    substitutedExpr = case previous of
                      Just cached -> cached.expr
                      Nothing ->
                        let
                          exprWithDicts = applyStaticArgs info.dictArgs info.normalArgs expr
                          resolvedExpr = resolveGlobals definerMod Set.empty exprWithDicts
                        in rewriteExpr globalAstMap Map.empty Map.empty astSubstFn resolvedExpr
                    dependencies = case previous of
                      Just cached -> mapWithIndex (\name _ -> specializationCount specializationMap name) cached.dependencies
                      Nothing -> Map.fromFoldable (map (\name -> Tuple name (specializationCount specializationMap name)) (Set.toUnfoldable (collectDependencies substitutedExpr) :: Array String))
                    specializedExpr = monomorphizeExpr definerMod specializationMap Map.empty substitutedExpr
                  in
                    { info
                    , expr: substitutedExpr
                    , dependencies
                    , contribution: collectExpr globalAstMap definerMod Map.empty specializedExpr
                    }
            in
              Just
                { key: cacheKey
                , entry
                , reused: case reused of
                    Just _ -> true
                    Nothing -> false
                }
        Nothing -> Nothing

  mergeResult :: TransitiveState -> TransitiveResult -> TransitiveState
  mergeResult acc = case _ of
    Nothing -> acc
    Just { key, entry, reused } ->
      { instantiations: mergeInstantiations acc.instantiations entry.contribution
      , prepared: if reused then acc.prepared else Map.insert key entry acc.prepared
      }
