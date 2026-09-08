module PureScript.Backend.Optimizer.TypeSubstitution
  ( substitute
  , underForAll
  , underForAllAvoid
  , typeVariables
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldMap, foldl)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (fromMaybe)
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.CoreFn (ExprType(..))

-- | Simultaneous substitution: inserted types retain their own free variables.
substitute :: Map String ExprType -> ExprType -> ExprType
substitute substitution = go
  where
  go ty = case ty of
    TypeVar name -> fromMaybe ty (Map.lookup name substitution)
    Array item -> Array (go item)
    ADT name path args -> ADT name path (map go args)
    TypeApp fn args -> TypeApp (go fn) (map go args)
    Func args result -> Func (map go args) (go result)
    Row fields tail -> Row (map (map go) fields) (map go tail)
    Record row -> Record (go row)
    ForAll vars body ->
      let
        scoped = underForAll substitution vars body
      in
        ForAll scoped.vars (substitute scoped.substitution scoped.body)
    ConstrainedType constraints body ->
      ConstrainedType (map (map (map go)) constraints) (go body)
    _ -> ty

-- | Return the scope for both the quantified type and its expression annotations.
-- | The body is unchanged; the effective substitution also performs alpha-renaming.
underForAll
  :: Map String ExprType
  -> Array String
  -> ExprType
  -> { vars :: Array String, body :: ExprType, substitution :: Map String ExprType }
underForAll = underForAllAvoid Set.empty

-- | Extra names can include variables found only in nested expression annotations.
underForAllAvoid
  :: Set String
  -> Map String ExprType
  -> Array String
  -> ExprType
  -> { vars :: Array String, body :: ExprType, substitution :: Map String ExprType }
underForAllAvoid avoid substitution vars body =
  let
    scoped = foldl (flip Map.delete) substitution vars
    captures = foldMap freeVariables (Map.values scoped)
    used = avoid
      <> Set.fromFoldable vars
      <> typeVariables body
      <> Map.keys substitution
      <> foldMap typeVariables (Map.values substitution)
    renamed = foldl (rename captures)
      { vars: [], substitution: scoped, used }
      vars
  in
    { vars: renamed.vars, body, substitution: renamed.substitution }
  where
  rename captures state name
    | Set.member name captures =
        let
          fresh = freshName state.used name 0
        in
          { vars: Array.snoc state.vars fresh
          , substitution: Map.insert name (TypeVar fresh) state.substitution
          , used: Set.insert fresh state.used
          }
    | otherwise = state { vars = Array.snoc state.vars name }

  freshName used name index =
    let
      candidate = name <> "_typeapp" <> show index
    in
      if Set.member candidate used then freshName used name (index + 1)
      else candidate

-- | Include bound names when reserving fresh names, even in nested quantifiers.
typeVariables :: ExprType -> Set String
typeVariables = collectVariables true

freeVariables :: ExprType -> Set String
freeVariables = collectVariables false

collectVariables :: Boolean -> ExprType -> Set String
collectVariables includeBound = go
  where
  go = case _ of
    TypeVar name -> Set.singleton name
    Array item -> go item
    ADT _ _ args -> foldMap go args
    TypeApp fn args -> go fn <> foldMap go args
    Func args result -> foldMap go args <> go result
    Row fields tail -> foldMap (\(Tuple _ ty) -> go ty) fields <> foldMap go tail
    Record row -> go row
    ForAll vars body ->
      if includeBound then Set.fromFoldable vars <> go body
      else Set.difference (go body) (Set.fromFoldable vars)
    ConstrainedType constraints body ->
      foldMap (\(Tuple _ args) -> foldMap go args) constraints <> go body
    _ -> Set.empty
