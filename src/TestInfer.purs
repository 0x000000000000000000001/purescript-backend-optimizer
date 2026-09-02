module TestInfer where

import Prelude
import Data.Map (Map)
import Data.Map as Map
import Data.Set as Set
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Tuple (Tuple(..))
import Data.Array as Array
import Data.Foldable (foldl)
import PureScript.Backend.Optimizer.CoreFn (Expr(..), ExprType(..), Ann(..), Binding(..), Bind(..), CaseAlternative(..), CaseGuard(..), Prop(..), Guard(..))
import PureScript.Backend.Optimizer.Substitute (unify, substituteExprType)

inferLocalSubstitutions :: Expr Ann -> Map String ExprType -> Map String ExprType
inferLocalSubstitutions expr env = case expr of
  ExprApp _ f_expr arg_expr ->
    let
      f_type = getExprAnnType f_expr
      arg_type = getExprAnnType arg_expr
      env1 = case f_type of
        Func args _ -> case Array.head args of
          Just argT -> unify argT arg_type env
          Nothing -> env
        _ -> env
      env2 = inferLocalSubstitutions f_expr env1
    in
      inferLocalSubstitutions arg_expr env2
  ExprAbs _ _ e -> inferLocalSubstitutions e env
  ExprLet _ binds e ->
    let
      env1 = foldl (\acc b -> case b of
        NonRec (Binding _ _ val) -> inferLocalSubstitutions val acc
        Rec bs -> foldl (\a (Binding _ _ val) -> inferLocalSubstitutions val a) acc bs
      ) env binds
    in
      inferLocalSubstitutions e env1
  ExprCase _ exprs alts ->
    let
      env1 = foldl (\acc e -> inferLocalSubstitutions e acc) env exprs
    in
      foldl (\acc (CaseAlternative _ cg) -> case cg of
        Unconditional e -> inferLocalSubstitutions e acc
        Guarded guards -> foldl (\a (Guard g e) -> inferLocalSubstitutions e (inferLocalSubstitutions g a)) acc guards
      ) env1 alts
  ExprAccessor _ e _ -> inferLocalSubstitutions e env
  ExprUpdate _ e props ->
    foldl (\acc (Prop _ val) -> inferLocalSubstitutions val acc) (inferLocalSubstitutions e env) props
  ExprTypeApp _ e _ -> inferLocalSubstitutions e env
  _ -> env

getExprAnnType :: Expr Ann -> ExprType
getExprAnnType e = case e of
  ExprVar (Ann ann) _ -> fromMaybe Any ann.type
  ExprLit (Ann ann) _ -> fromMaybe Any ann.type
  ExprApp (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprAbs (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprLet (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprCase (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprConstructor (Ann ann) _ _ _ -> fromMaybe Any ann.type
  ExprAccessor (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprUpdate (Ann ann) _ _ -> fromMaybe Any ann.type
  ExprTypeApp (Ann ann) _ _ -> fromMaybe Any ann.type

resolveSubst :: Map String ExprType -> Map String ExprType
resolveSubst subst =
  let
    step s = map (substituteExprType s) s
    loop s =
      let s' = step s
      in if s == s' then s else loop s'
  in
    loop subst
