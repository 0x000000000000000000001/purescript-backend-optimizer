-- | Dead Code Elimination (Reachability.purs)
-- | Génère un graphe de dépendances (orienté) en partant du point d'entrée (fonction main).
-- | Toutes les fonctions, variables et modules qui ne peuvent pas être atteints en traversant ce graphe sont considérés comme du code mort et sont purement et simplement supprimés de l'AST, réduisant ainsi drastiquement la taille du binaire final.

module PureScript.Backend.Optimizer.Reachability
  ( moduleReachability
  ) where

import Data.Array as Array
import Data.Foldable (foldl)
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis(..))
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident, ModuleName, Qualified(..))
import PureScript.Backend.Optimizer.Semantics (ExternImpl)

-- | Computes the set of reachable modules starting from a list of entry modules.
moduleReachability :: forall r. Array ModuleName -> Map ModuleName { imports :: Set ModuleName, implementations :: Map (Qualified Ident) (Tuple BackendAnalysis ExternImpl) | r } -> Set ModuleName
moduleReachability entryMods modulesMap =
  go Set.empty entryMods
  where
  go :: Set ModuleName -> Array ModuleName -> Set ModuleName
  go seen unvisited =
    if Array.null unvisited then
      seen
    else
      let
        newSeen = Set.union seen (Set.fromFoldable unvisited)

        -- Use a Set to accumulate new dependencies to avoid huge arrays
        newDepsSet = foldl (\acc modName -> Set.union acc (getModuleDeps modName)) Set.empty unvisited

        nextUnvisitedSet = Set.difference newDepsSet newSeen
      in
        go newSeen (Array.fromFoldable nextUnvisitedSet)

  getModuleDeps :: ModuleName -> Set ModuleName
  getModuleDeps modName =
    case Map.lookup modName modulesMap of
      Just backendMod ->
        let
          impls = Map.toUnfoldable backendMod.implementations :: Array (Tuple (Qualified Ident) (Tuple BackendAnalysis ExternImpl))

          -- Accumulate module names directly into a Set to avoid massive intermediate arrays
          allMods = foldl
            ( \acc (Tuple _ (Tuple (BackendAnalysis analysis) _)) ->
                foldl
                  ( \acc2 (Qualified mbMod _) ->
                      case mbMod of
                        Just m -> Set.insert m acc2
                        Nothing -> acc2
                  )
                  acc
                  analysis.deps
            )
            Set.empty
            impls

          explicitImports = backendMod.imports
        in
          Set.union explicitImports allMods
      Nothing ->
        Set.empty

