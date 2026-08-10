module PureScript.Backend.Optimizer.Monomorphize where

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

type InstantiationMap = Map String (Set ExprType)

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
  ADT names args -> ADT names (map defaultToAny args)
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
mangleType (ADT names args) = "ADT_" <> String.joinWith "_" names <> (if Array.length args == 0 then "" else "_" <> String.joinWith "_" (map mangleType args))
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

collectExpr :: String -> InstantiationMap -> Expr Ann -> InstantiationMap
collectExpr modName acc expr = case expr of
  ExprVar (Ann ann) (Qualified mbMod (Ident name)) ->
    case ann.type of
      Just t -> 
        let qualName = case mbMod of
              Just mod -> unwrap mod <> "." <> name
              Nothing -> modName <> "." <> name
        in Map.insertWith Set.union qualName (Set.singleton (defaultToAny t)) acc
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
            in
              if Map.isEmpty subst then acc2
              else Map.insertWith Set.union qualName (Set.singleton (defaultToAny instType)) acc2
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

collectAllTypes :: Module Ann -> Set ExprType
collectAllTypes (Module m) = foldl (\a b -> collectTypesFromBind b a) Set.empty m.decls
