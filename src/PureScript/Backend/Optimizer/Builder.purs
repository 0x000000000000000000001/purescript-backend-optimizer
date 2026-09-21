-- | Monade de Construction (Builder.purs)
-- | Fournit un environnement monadique (Builder) facilitant la construction, l'imbrication et la gestion propre de portées (scoping) des déclarations locales (Let bindings) générées dynamiquement lors des passes d'optimisation.
-- | Cela garantit que les variables créées à la volée par l'optimiseur ne provoquent pas de collisions de noms.

module PureScript.Backend.Optimizer.Builder
  ( BuildEnv
  , BuildOptions
  , buildModules
  ) where

import Prelude

import Data.Function.Uncurried (mkFn2)
import Data.FoldableWithIndex (foldrWithIndex)
import Data.List (List(..))
import Data.List as List
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis)
import PureScript.Backend.Optimizer.BoundedMemo (createBoundedMemo, createStringMemo)
import PureScript.Backend.Optimizer.Convert (BackendModule, OptimizationSteps, lookupPurmetaImplementation, toBackendModuleWithLookup)
import PureScript.Backend.Optimizer.CoreFn (Ann, Ident, Module(..), Qualified)
import PureScript.Backend.Optimizer.Semantics (BackendExpr, Ctx, ExternImpl, InlineDirectiveMap, instantiateNeutralType)
import PureScript.Backend.Optimizer.Semantics.Foreign (ForeignEval)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax)
import PureScript.Backend.Optimizer.Cache (writePurmetaSync, trimPurmetaCache, beginPurmetaBuild)
import Effect.Class (class MonadEffect, liftEffect)

type BuildEnv =
  { implementations :: Map (Qualified Ident) (Tuple BackendAnalysis ExternImpl)
  , moduleCount :: Int
  , moduleIndex :: Int
  }

type BuildOptions m =
  { analyzeCustom :: Ctx -> BackendSyntax BackendExpr -> Maybe BackendAnalysis
  , directives :: InlineDirectiveMap
  , foreignSemantics :: Map (Qualified Ident) ForeignEval
  , onPrepareModule :: BuildEnv -> Module Ann -> m (Module Ann)
  , onSkipModule :: BuildEnv -> Module Ann -> m (Maybe BackendModule)
  , onCodegenModule :: BuildEnv -> Module Ann -> BackendModule -> OptimizationSteps -> m Unit
  , traceIdents :: Set (Qualified Ident)
  , rewriteLimit :: Int
  }

-- | Builds modules given a _sorted_ list of modules.
-- | See `PureScript.Backend.Optimizer.CoreFn.Sort.sortModules`.
buildModules :: forall m. MonadEffect m => BuildOptions m -> List (Module Ann) -> m Unit
buildModules options coreFnModules = do
  liftEffect beginPurmetaBuild
  void $ go { directives: options.directives, implementations: Map.empty, moduleIndex: 0, exports: Map.empty } coreFnModules
  where
  moduleCount = List.length coreFnModules
  
  go acc Nil = pure acc
  go ( { directives, implementations, moduleIndex, exports } ) (Cons coreFnModule remainingModules) = do
    let buildEnv = { implementations, moduleCount, moduleIndex }
    coreFnModule'@(Module { name, exports: modExportsArray }) <- options.onPrepareModule buildEnv coreFnModule
    mbCachedMod <- options.onSkipModule buildEnv coreFnModule'
    
    let
      modExports = Set.fromFoldable modExportsArray
      newExports = Map.insert name modExports exports

    case mbCachedMod of
      Just cachedMod -> do
        let
          newDirectives = foldrWithIndex Map.insert directives cachedMod.directives
        liftEffect $ writePurmetaSync name cachedMod.implementations
        liftEffect trimPurmetaCache
          
        go 
          { directives: newDirectives
          , implementations: Map.empty
          , moduleIndex: moduleIndex + 1
          , exports: newExports
          }
          remainingModules
      Nothing -> do
        -- Each module owns its caches. Purmeta is unchanged during conversion;
        -- local implementations and directives remain live as bindings advance.
        instantiate <- liftEffect $ createBoundedMemo 512 (mkFn2 instantiateNeutralType)
        lookupPurmeta <- liftEffect $ createStringMemo 512 (mkFn2 lookupPurmetaImplementation)
        let
          Tuple optimizationSteps backendMod = toBackendModuleWithLookup lookupPurmeta coreFnModule'
            { analyzeCustom: options.analyzeCustom
            , currentModule: name
            , instantiateNeutral: instantiate
            , currentLevel: 0
            , toLevel: Map.empty
            , implementations
            , moduleImplementations: Map.empty
            , directives
            , dataTypes: Map.empty
            , foreignSemantics: options.foreignSemantics
            , rewriteLimit: options.rewriteLimit
            , traceIdents: options.traceIdents
            , optimizationSteps: []
            }
          newDirectives = backendMod.directives
            
        options.onCodegenModule (buildEnv { implementations = backendMod.implementations }) coreFnModule' backendMod optimizationSteps
        
        -- Write this module's implementations to disk
        liftEffect $ writePurmetaSync name backendMod.implementations
        liftEffect trimPurmetaCache
        
        go
          { directives: newDirectives
          , implementations: Map.empty
          , moduleIndex: moduleIndex + 1
          , exports: newExports
          }
          remainingModules
