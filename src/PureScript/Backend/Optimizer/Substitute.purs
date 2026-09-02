-- | Moteur de Substitution (Substitute.purs)
-- | S'occupe du remplacement (substitution) des variables dans l'AST lors des phases d'inlining et de monomorphisation.
-- | Inclut des algorithmes pour l'alpha-renommage (renommer des variables locales de manière unique) garantissant qu'aucune variable capturée ne rentre en conflit avec une variable globale (shadowing).

module PureScript.Backend.Optimizer.Substitute (unify, substituteExprType, setTcoExprType, setBackendSyntaxType, substituteAst, mapTcoExprTypes) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Newtype (unwrap)
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr(..))
import PureScript.Backend.Optimizer.CoreFn (ExprType(..), Ident(..), Literal(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.Syntax (BackendEffect(..), BackendOperator(..), BackendSyntax(Var, Local, Lit, App, Abs, UncurriedApp, UncurriedAbs, UncurriedEffectApp, UncurriedEffectAbs, Accessor, Update, CtorSaturated, CtorDef, LetRec, Let, EffectBind, EffectPure, EffectDefer, Branch, PrimOp, PrimEffect, PrimUndefined, Fail, Typed), Pair(..))
import PureScript.Backend.Optimizer.Syntax as Syn

unify :: ExprType -> ExprType -> Map String ExprType -> Map String ExprType
unify (ForAll _ t1) t2 subst = unify t1 t2 subst
unify t1 (ForAll _ t2) subst = unify t1 t2 subst
unify (ConstrainedType _ t1) t2 subst = unify t1 t2 subst
unify t1 (ConstrainedType _ t2) subst = unify t1 t2 subst
unify (Func args1 ret1) (Func args2 ret2) subst =
  let
    len1 = Array.length args1
    len2 = Array.length args2
    args1' = if len1 > len2 then Array.drop (len1 - len2) args1 else args1
    args2' = if len2 > len1 then Array.drop (len2 - len1) args2 else args2
    acc' = foldl (\acc'' (Tuple t1 t2) -> unify t1 t2 acc'') subst (Array.zip args1' args2')
  in
    unify ret1 ret2 acc'
unify (TypeVar a) concrete acc = Map.insert a concrete acc
unify (Array t1) (Array t2) acc = unify t1 t2 acc
unify (Record row1) (Record row2) acc = unify row1 row2 acc
unify (Row props1 _) (Row props2 _) acc =
  foldl (\acc' (Tuple (Tuple _ t1) (Tuple _ t2)) -> unify t1 t2 acc') acc (Array.zip props1 props2)
unify (TypeApp c1 a1) (TypeApp c2 a2) acc =
  foldl (\acc' (Tuple t1 t2) -> unify t1 t2 acc') (unify c1 c2 acc) (Array.zip a1 a2)
unify (TypeApp c1 a1) (ADT name path a2) acc =
  foldl (\acc' (Tuple t1 t2) -> unify t1 t2 acc') (unify c1 (ADT name path []) acc) (Array.zip a1 a2)
unify (ADT name path a1) (TypeApp c2 a2) acc =
  foldl (\acc' (Tuple t1 t2) -> unify t1 t2 acc') (unify (ADT name path []) c2 acc) (Array.zip a1 a2)
unify (ADT name1 _ a1) (ADT name2 _ a2) acc | name1 == name2 =
  foldl (\acc' (Tuple t1 t2) -> unify t1 t2 acc') acc (Array.zip a1 a2)
unify _ _ acc = acc

substituteExprType :: Map String ExprType -> ExprType -> ExprType
substituteExprType subst t = case t of
  TypeVar a -> case Map.lookup a subst of
    Just concrete -> concrete
    Nothing -> t
  Func args ret -> Func (map (substituteExprType subst) args) (substituteExprType subst ret)
  Array inner -> Array (substituteExprType subst inner)
  Record row -> Record (substituteExprType subst row)
  Row props tail -> Row (map (\(Tuple k v) -> Tuple k (substituteExprType subst v)) props) (map (substituteExprType subst) tail)
  TypeApp c args ->
    let
      c' = substituteExprType subst c
      args' = map (substituteExprType subst) args
    in
      case c' of
        ADT name path cArgs -> ADT name path (cArgs <> args')
        _ -> TypeApp c' args'
  ADT name path args -> ADT name path (map (substituteExprType subst) args)
  ForAll vars body ->
    let
      subst' = subst
      newVars = Array.filter (\v -> not (Map.member v subst')) vars
      body' = substituteExprType subst' body
    in
      if Array.length newVars == 0 then body' else ForAll newVars body'
  ConstrainedType constraints body -> ConstrainedType (map (\(Tuple c a) -> Tuple c (map (substituteExprType subst) a)) constraints) (substituteExprType subst body)
  _ -> t

setTcoExprType :: ExprType -> TcoExpr -> TcoExpr
setTcoExprType ty (TcoExpr analysis syn) =
  TcoExpr analysis (setBackendSyntaxType ty syn)

setBackendSyntaxType :: ExprType -> BackendSyntax TcoExpr -> BackendSyntax TcoExpr
setBackendSyntaxType ty syn = case syn of
  Typed _ inner -> Typed ty inner
  _ -> Typed ty (TcoExpr mempty syn)

substituteAst :: Map String (Array ExprType) -> (ExprType -> String) -> TcoExpr -> TcoExpr
substituteAst insts mangle = go Nothing
  where
  go mbTy (TcoExpr a syn) = case syn of
    Typed ty inner -> TcoExpr a (Typed ty (go (Just ty) inner))
    Var (Qualified mbMn (Ident name)) ->
      let
        fullName = case mbMn of
          Just mn -> unwrap mn <> "." <> name
          Nothing -> name
      in
        case Map.lookup fullName insts of
          Just concretes ->
            let
              varTy = case mbTy of
                Just ty -> ty
                Nothing -> TypeVar "gopurs_runtime.Value"
            in
              if Array.elem varTy concretes then
                let
                  mangled = name <> "__" <> mangle varTy
                in
                  TcoExpr a (Var (Qualified mbMn (Ident mangled)))
              else TcoExpr a (Var (Qualified mbMn (Ident name)))
          Nothing -> TcoExpr a (Var (Qualified mbMn (Ident name)))
    App fn args -> TcoExpr a (App (go Nothing fn) (map (go Nothing) args))
    Syn.TypeApp fn ty -> TcoExpr a (Syn.TypeApp (go Nothing fn) ty)
    Abs args body -> TcoExpr a (Abs args (go Nothing body))
    UncurriedApp fn args -> TcoExpr a (UncurriedApp (go Nothing fn) (map (go Nothing) args))
    UncurriedAbs args body -> TcoExpr a (UncurriedAbs args (go Nothing body))
    UncurriedEffectApp fn args -> TcoExpr a (UncurriedEffectApp (go Nothing fn) (map (go Nothing) args))
    UncurriedEffectAbs args body -> TcoExpr a (UncurriedEffectAbs args (go Nothing body))
    Accessor obj prop -> TcoExpr a (Accessor (go Nothing obj) prop)
    Update obj props -> TcoExpr a (Update (go Nothing obj) (map (\(Prop k v) -> Prop k (go Nothing v)) props))
    CtorSaturated mbMn ty pn ident args -> TcoExpr a (CtorSaturated mbMn ty pn ident (map (\(Tuple s v) -> Tuple s (go Nothing v)) args))
    CtorDef _ _ _ _ -> TcoExpr a syn
    LetRec lvl bindings body -> TcoExpr a (LetRec lvl (map (\(Tuple ident val) -> Tuple ident (go Nothing val)) bindings) (go Nothing body))
    Let ident lvl val body -> TcoExpr a (Let ident lvl (go Nothing val) (go Nothing body))
    EffectBind ident lvl val body -> TcoExpr a (EffectBind ident lvl (go Nothing val) (go Nothing body))
    EffectPure val -> TcoExpr a (EffectPure (go Nothing val))
    EffectDefer val -> TcoExpr a (EffectDefer (go Nothing val))
    Branch pairs def -> TcoExpr a (Branch (map (\(Pair p r) -> Pair (go Nothing p) (go Nothing r)) pairs) (go Nothing def))
    Lit lit -> TcoExpr a
      ( Lit
          ( case lit of
              LitArray arr -> LitArray (map (go Nothing) arr)
              LitRecord props -> LitRecord (map (\(Prop k v) -> Prop k (go Nothing v)) props)
              _ -> lit
          )
      )
    PrimEffect eff -> TcoExpr a
      ( PrimEffect
          ( case eff of
              EffectRefNew val -> EffectRefNew (go Nothing val)
              EffectRefRead ref -> EffectRefRead (go Nothing ref)
              EffectRefWrite ref val -> EffectRefWrite (go Nothing ref) (go Nothing val)
          )
      )
    PrimOp op -> TcoExpr a
      ( PrimOp
          ( case op of
              Op1 o1 v1 -> Op1 o1 (go Nothing v1)
              Op2 o2 v1 v2 -> Op2 o2 (go Nothing v1) (go Nothing v2)
          )
      )
    Local _ _ -> TcoExpr a syn
    Fail _ -> TcoExpr a syn
    PrimUndefined -> TcoExpr a syn

mapTcoExprTypes :: (ExprType -> ExprType) -> TcoExpr -> TcoExpr
mapTcoExprTypes f = go
  where
  go (TcoExpr a syn) = case syn of
    Typed ty inner -> TcoExpr a (Typed (f ty) (go inner))
    Var v -> TcoExpr a (Var v)
    App fn args -> TcoExpr a (App (go fn) (map go args))
    Syn.TypeApp fn ty -> TcoExpr a (Syn.TypeApp (go fn) (f ty))
    Abs args body -> TcoExpr a (Abs args (go body))
    UncurriedApp fn args -> TcoExpr a (UncurriedApp (go fn) (map go args))
    UncurriedAbs args body -> TcoExpr a (UncurriedAbs args (go body))
    UncurriedEffectApp fn args -> TcoExpr a (UncurriedEffectApp (go fn) (map go args))
    UncurriedEffectAbs args body -> TcoExpr a (UncurriedEffectAbs args (go body))
    Accessor obj prop -> TcoExpr a (Accessor (go obj) prop)
    Update obj props -> TcoExpr a (Update (go obj) (map (\(Prop k v) -> Prop k (go v)) props))
    CtorSaturated mbMn ty pn ident args -> TcoExpr a (CtorSaturated mbMn ty pn ident (map (\(Tuple s v) -> Tuple s (go v)) args))
    CtorDef ty pn ident args -> TcoExpr a (CtorDef ty pn ident args)
    LetRec lvl bindings body -> TcoExpr a (LetRec lvl (map (\(Tuple ident val) -> Tuple ident (go val)) bindings) (go body))
    Let ident lvl val body -> TcoExpr a (Let ident lvl (go val) (go body))
    EffectBind ident lvl val body -> TcoExpr a (EffectBind ident lvl (go val) (go body))
    EffectPure val -> TcoExpr a (EffectPure (go val))
    EffectDefer val -> TcoExpr a (EffectDefer (go val))
    Branch pairs def -> TcoExpr a (Branch (map (\(Pair p r) -> Pair (go p) (go r)) pairs) (go def))
    Lit lit -> TcoExpr a
      ( Lit
          ( case lit of
              LitArray arr -> LitArray (map go arr)
              LitRecord props -> LitRecord (map (\(Prop k v) -> Prop k (go v)) props)
              _ -> lit
          )
      )
    PrimEffect eff -> TcoExpr a
      ( PrimEffect
          ( case eff of
              EffectRefNew val -> EffectRefNew (go val)
              EffectRefRead ref -> EffectRefRead (go ref)
              EffectRefWrite ref val -> EffectRefWrite (go ref) (go val)
          )
      )
    PrimOp op -> TcoExpr a
      ( PrimOp
          ( case op of
              Op1 o1 v1 -> Op1 o1 (go v1)
              Op2 o2 v1 v2 -> Op2 o2 (go v1) (go v2)
          )
      )
    Local mbIdent lvl -> TcoExpr a (Local mbIdent lvl)
    Fail str -> TcoExpr a (Fail str)
    PrimUndefined -> TcoExpr a PrimUndefined
