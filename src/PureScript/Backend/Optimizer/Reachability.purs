module PureScript.Backend.Optimizer.Reachability
  ( moduleReachability
  ) where

import Prelude

import Data.Array as Array
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis(..))
import PureScript.Backend.Optimizer.Convert (BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident, ModuleName(..), Qualified(..))
import PureScript.Backend.Optimizer.Semantics (ExternImpl)

-- | Computes the set of reachable modules starting from a list of entry modules.
moduleReachability :: Array ModuleName -> Map ModuleName BackendModule -> Set ModuleName
moduleReachability entryMods modulesMap =
  go Set.empty entryMods
  where
    go :: Set ModuleName -> Array ModuleName -> Set ModuleName
    go seen unvisited =
      if Array.null unvisited then
        seen
      else
        let
          newDepsArray = Array.concatMap getModuleDeps unvisited
          newSeen = Set.union seen (Set.fromFoldable unvisited)
          nextUnvisited = Array.filter (\dep -> not (Set.member dep newSeen)) newDepsArray
        in
          go newSeen nextUnvisited

    getModuleDeps :: ModuleName -> Array ModuleName
    getModuleDeps modName =
      case Map.lookup modName modulesMap of
        Just backendMod ->
          let
            -- Collect all dependencies of all identifiers in this module
            allDeps = Array.concatMap (\(Tuple _ (Tuple (BackendAnalysis analysis) _)) -> Array.fromFoldable analysis.deps) (Map.toUnfoldable backendMod.implementations :: Array (Tuple (Qualified Ident) (Tuple BackendAnalysis ExternImpl)))
            
            -- Also add explicit imports just in case there are side-effect only imports
            explicitImports = Array.fromFoldable backendMod.imports
            
            -- Extract ModuleNames from the qualified idents
            implicitImports = Array.mapMaybe (\(Qualified mbMod _) -> mbMod) allDeps
          in
            explicitImports <> implicitImports
        Nothing ->
          []
