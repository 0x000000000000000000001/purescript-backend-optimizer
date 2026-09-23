-- | Source usage facts stop at the CoreFn transformation boundary. Backend
-- | analyses must derive their facts from the current IR and its lexical scopes.
module PureScript.Backend.Optimizer.CoreFn.Usage
  ( invalidateSourceUsage
  , invalidateSourceUsageModule
  , validateSourceUsageModule
  ) where

import Prelude

import Control.Monad.Error.Class (throwError)
import Control.Monad.State (StateT, evalStateT, get, modify_)
import Data.Argonaut (JsonDecodeError(..))
import Data.Either (Either)
import Data.Foldable (foldM, foldl, traverse_)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set (Set)
import Data.Set as Set
import PureScript.Backend.Optimizer.CoreFn (Ann(..), Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), Guard(..), Ident, Import(..), Literal, Module(..), ModuleName, Qualified(..), SourceBindingId(..), SourceUsage, propValue)

invalidateSourceUsage :: Ann -> Ann
invalidateSourceUsage (Ann ann) = Ann (ann { sourceUsage = Nothing })

-- Imports cannot carry source usage facts. Executable annotations occur in
-- declarations; this traversal removes identities as well as counts/proofs.
invalidateSourceUsageModule :: Module Ann -> Module Ann
invalidateSourceUsageModule (Module mod) = Module (mod
  { decls = map (map invalidateSourceUsage) mod.decls })

type Scope = Map Ident (Maybe SourceBindingId)
type Validate = StateT (Set SourceBindingId) (Either JsonDecodeError)

usage :: Ann -> SourceUsage
usage (Ann ann) = fromMaybe { bindingUsage: Nothing, variableUse: Nothing } ann.sourceUsage

failUsage :: forall a. String -> Validate a
failUsage = throwError <<< TypeMismatch

validateSourceUsageModule :: Module Ann -> Either JsonDecodeError Unit
validateSourceUsageModule mod = validateSourceUsageModuleImpl validateSourceUsageModulePS mod

-- The Go backend validates the module natively. The JavaScript backend calls
-- the PureScript implementation passed as the first argument, so the JS bundle
-- keeps the exact previous behaviour.
foreign import validateSourceUsageModuleImpl :: (Module Ann -> Either JsonDecodeError Unit) -> Module Ann -> Either JsonDecodeError Unit

validateSourceUsageModulePS :: Module Ann -> Either JsonDecodeError Unit
validateSourceUsageModulePS (Module mod) = flip evalStateT Set.empty $ do
  traverse_ (\(Import ann _) -> plain ann) mod.imports
  traverse_ top mod.decls
  where
  top = case _ of
    NonRec binding -> topBinding binding
    Rec group -> traverse_ topBinding group
  topBinding (Binding ann _ expr) = do
    plain ann
    expression mod.name Map.empty expr

plain :: Ann -> Validate Unit
plain ann = case usage ann of
  { bindingUsage: Nothing, variableUse: Nothing } -> pure unit
  _ -> failUsage "source usage facts on a nonlocal annotation"

register :: ModuleName -> Scope -> Ann -> Ident -> Validate Scope
register moduleName scope ann ident = do
  let info = usage ann
  case info.variableUse of
    Just _ -> failUsage "variableUse on a binding annotation"
    Nothing -> pure unit
  let identity = _.binding <$> info.bindingUsage
  traverse_ (\key@(SourceBindingId origin) -> do
    unless (origin.moduleName == moduleName) $ failUsage "source binding from another module"
    seen <- get
    when (Set.member key seen) $ failUsage "duplicate source bindingId"
    modify_ (Set.insert key)) identity
  -- An unannotated local still hides an annotated outer variable of that name.
  pure $ Map.insert ident identity scope

bindings :: ModuleName -> Scope -> Array (Bind Ann) -> Validate Scope
bindings moduleName = foldM step
  where
  step scope = case _ of
    NonRec (Binding ann ident expr) -> do
      expression moduleName scope expr
      register moduleName scope ann ident
    Rec group -> do
      scope' <- foldM (\env (Binding ann ident _) -> register moduleName env ann ident) scope group
      traverse_ (\(Binding _ _ expr) -> expression moduleName scope' expr) group
      pure scope'

expression :: ModuleName -> Scope -> Expr Ann -> Validate Unit
expression moduleName scope = case _ of
  ExprVar ann qualified -> do
    let info = usage ann
    case info.bindingUsage of
      Just _ -> failUsage "bindingUsage on a variable occurrence"
      Nothing -> pure unit
    traverse_ (\value -> do
      let target = case qualified of
            Qualified Nothing ident -> join (Map.lookup ident scope)
            Qualified (Just _) _ -> Nothing
      unless (target == Just value.binding) $ failUsage "variableUse outside its lexical binding") info.variableUse
  ExprAbs ann ident body -> do
    scope' <- register moduleName scope ann ident
    expression moduleName scope' body
  ExprLit ann literal -> do
    plain ann
    traverse_ (expression moduleName scope) literal
  ExprConstructor ann _ _ _ -> plain ann
  ExprAccessor ann expr _ -> do
    plain ann
    expression moduleName scope expr
  ExprUpdate ann expr fields -> do
    plain ann
    expression moduleName scope expr
    traverse_ (expression moduleName scope <<< propValue) fields
  ExprApp ann fn arg -> do
    plain ann
    expression moduleName scope fn
    expression moduleName scope arg
  ExprCase ann values alternatives -> do
    plain ann
    traverse_ (expression moduleName scope) values
    traverse_ (alternative moduleName scope) alternatives
  ExprLet ann group body -> do
    plain ann
    scope' <- bindings moduleName scope group
    expression moduleName scope' body
  ExprTypeApp ann expr _ -> do
    plain ann
    expression moduleName scope expr

alternative :: ModuleName -> Scope -> CaseAlternative Ann -> Validate Unit
alternative moduleName scope (CaseAlternative patterns result) = do
  scope' <- foldM (binder moduleName) scope patterns
  case result of
    Unconditional expr -> expression moduleName scope' expr
    Guarded guards -> traverse_ (\(Guard condition expr) -> do
      expression moduleName scope' condition
      expression moduleName scope' expr) guards

binder :: ModuleName -> Scope -> Binder Ann -> Validate Scope
binder moduleName scope = case _ of
  BinderNull ann -> plain ann $> scope
  BinderVar ann ident -> register moduleName scope ann ident
  BinderNamed ann ident inner -> do
    scope' <- register moduleName scope ann ident
    binder moduleName scope' inner
  BinderConstructor ann _ _ patterns -> do
    plain ann
    foldM (binder moduleName) scope patterns
  BinderLit ann literal -> do
    plain ann
    foldM (binder moduleName) scope (literalValues literal)

literalValues :: forall a. Literal a -> Array a
literalValues = foldl (\items item -> items <> [ item ]) []
