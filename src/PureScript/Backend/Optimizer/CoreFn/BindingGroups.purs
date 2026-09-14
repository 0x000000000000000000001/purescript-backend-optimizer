module PureScript.Backend.Optimizer.CoreFn.BindingGroups
  ( sortBindingGroups
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldMap, foldl, foldr)
import Data.List (List(..))
import Data.List as List
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.CoreFn (Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), Guard(..), Ident, ModuleName, Prop(..), Qualified(..))

-- Specialization can introduce references to declarations that originally came
-- later. Sort the resulting dependency graph before the sequential optimizer
-- sees it. Existing recursive groups stay intact; new cycles merge groups.
sortBindingGroups :: forall a. ModuleName -> Array (Bind a) -> Array (Bind a)
sortBindingGroups moduleName groups = Array.fromFoldable components.result
  where
  vertices = Array.mapWithIndex (\index _ -> index) groups
  owners = Map.fromFoldable $ Array.concatMap identity $
    Array.mapWithIndex (\index group -> map (\(Binding _ name _) -> Tuple name index) (bindings group)) groups
  graph = Map.fromFoldable $ Array.mapWithIndex (\index group ->
    Tuple index $ Array.fromFoldable $ Set.fromFoldable $
      Array.mapMaybe (flip Map.lookup owners) $
        Array.fromFoldable $ foldMap (\(Binding _ _ expr) -> references moduleName Set.empty expr) (bindings group)) groups
  reversed = foldl (\acc vertex -> foldl
    (\next dependency -> Map.insertWith append dependency [ vertex ] next)
    acc (neighbors graph vertex)) Map.empty vertices
  order = walk graph Set.empty (List.fromFoldable vertices)
  components = foldl collect { seen: Set.empty, result: Nil } order.order
  collect acc vertex
    | Set.member vertex acc.seen = acc
    | otherwise =
        let
          component = walk reversed acc.seen (Cons vertex Nil)
          members = Array.sort (Array.fromFoldable component.order)
          memberGroups = Array.mapMaybe (Array.index groups) members
          merged = case memberGroups of
            [ group ] | not (Array.elem vertex (neighbors graph vertex)) -> group
            _ -> Rec (Array.concatMap bindings memberGroups)
        in
          { seen: component.seen, result: Cons merged acc.result }

bindings :: forall a. Bind a -> Array (Binding a)
bindings (NonRec binding) = [ binding ]
bindings (Rec group) = group

type Graph = Map Int (Array Int)

neighbors :: Graph -> Int -> Array Int
neighbors graph vertex = fromMaybe [] (Map.lookup vertex graph)

data Visit = Enter Int | Leave Int

-- Explicit stacks keep both Kosaraju traversals safe for large generated modules.
walk :: Graph -> Set Int -> List Int -> { seen :: Set Int, order :: List Int }
walk graph initialSeen roots = go initialSeen Nil (map Enter roots)
  where
  go seen order = case _ of
    Cons (Enter vertex) rest
      | Set.member vertex seen -> go seen order rest
      | otherwise -> go (Set.insert vertex seen) order $
          foldr (Cons <<< Enter) (Cons (Leave vertex) rest) (neighbors graph vertex)
    Cons (Leave vertex) rest -> go seen (Cons vertex order) rest
    Nil -> { seen, order }

references :: forall a. ModuleName -> Set Ident -> Expr a -> Set Ident
references moduleName = go
  where
  reference bound (Qualified qualifier name) = case qualifier of
    Just owner | owner == moduleName -> Set.singleton name
    Nothing | not (Set.member name bound) -> Set.singleton name
    _ -> Set.empty

  go bound = case _ of
    ExprVar _ name -> reference bound name
    ExprLit _ literal -> foldMap (go bound) literal
    ExprConstructor _ _ _ _ -> Set.empty
    ExprAccessor _ expr _ -> go bound expr
    ExprUpdate _ expr props -> go bound expr <> foldMap (\(Prop _ value) -> go bound value) props
    ExprAbs _ name body -> go (Set.insert name bound) body
    ExprApp _ fn arg -> go bound fn <> go bound arg
    ExprTypeApp _ expr _ -> go bound expr
    ExprCase _ values alternatives -> foldMap (go bound) values <> foldMap (alternative bound) alternatives
    ExprLet _ groups body ->
      let
        scoped = foldl localGroup { bound, refs: Set.empty } groups
      in
        scoped.refs <> go scoped.bound body

  localGroup acc = case _ of
    NonRec (Binding _ name expr) ->
      { bound: Set.insert name acc.bound, refs: acc.refs <> go acc.bound expr }
    Rec group ->
      let
        bound = foldl (\scope (Binding _ name _) -> Set.insert name scope) acc.bound group
      in
        { bound, refs: acc.refs <> foldMap (\(Binding _ _ expr) -> go bound expr) group }

  alternative bound (CaseAlternative patterns guard) =
    foldMap (patternReferences bound) patterns <> case guard of
      Unconditional expr -> go scoped expr
      Guarded guards -> foldMap (\(Guard condition expr) -> go scoped condition <> go scoped expr) guards
    where
    scoped = bound <> foldMap patternNames patterns

  patternNames = case _ of
    BinderNull _ -> Set.empty
    BinderVar _ name -> Set.singleton name
    BinderNamed _ name pattern -> Set.insert name (patternNames pattern)
    BinderLit _ literal -> foldMap patternNames literal
    BinderConstructor _ _ _ patterns -> foldMap patternNames patterns

  patternReferences bound = case _ of
    BinderNamed _ _ pattern -> patternReferences bound pattern
    BinderLit _ literal -> foldMap (patternReferences bound) literal
    BinderConstructor _ _ constructor patterns -> reference bound constructor <> foldMap (patternReferences bound) patterns
    _ -> Set.empty
