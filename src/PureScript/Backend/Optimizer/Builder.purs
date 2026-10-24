-- | Monade de Construction (Builder.purs)
-- | Fournit un environnement monadique (Builder) facilitant la construction, l'imbrication et la gestion propre de portées (scoping) des déclarations locales (Let bindings) générées dynamiquement lors des passes d'optimisation.
-- | Cela garantit que les variables créées à la volée par l'optimiseur ne provoquent pas de collisions de noms.
-- |
-- | Deux entrées : `buildModules` (un module à la fois, comportement historique)
-- | et `buildModulesParallel` (ordonnancement par lots prêts). Les deux
-- | accumulent les directives de chaque module, comme l'amont Arista.
-- |
-- | Le builder parallèle donne à chaque tentative une vue fixe, filtrée par
-- | rang : un module ne voit que les résultats finaux de ses prédécesseurs.
-- | Une lecture d'un prédécesseur encore en cours est signalée, et la tentative
-- | est rejouée dès que ce prédécesseur est publié. La correction ne dépend donc
-- | pas de l'ordonnancement, qui n'est qu'une heuristique de performance.

module PureScript.Backend.Optimizer.Builder
  ( BuildEnv
  , BuildOptions
  , ParallelJob
  , JobScheduler
  , ParallelStats
  , buildModules
  , buildModulesWithReuse
  , BuildObservation
  , buildModulesWithObservation
  , buildModulesWithObservationAndProfile
  , buildModulesParallel
  , buildModulesParallelWithReuse
  , buildModulesParallelWithObservation
  , buildModulesParallelWithLazyContributions
  , buildModulesParallelWithLazyPreparation
  , buildModulesParallelWithSchedulingHints
  , buildModulesParallelWithRestoredHeaders
  , CachedBindingLookup
  , buildModulesParallelWithBindingLookup
  , buildModulesParallelWithBindingLookupAndProfile
  , createRankLookup
  , effectiveDirectives
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl)
import Data.FoldableWithIndex (foldrWithIndex)
import Data.Function.Uncurried (mkFn2)
import Data.List (List(..))
import Data.List as List
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Newtype (unwrap)
import Data.Set (Set)
import Data.Set as Set
import Data.Tuple (Tuple(..))
import Effect.Class (class MonadEffect, liftEffect)
import Effect (Effect)
import Effect.Ref as Ref
import Effect.Unsafe (unsafePerformEffect)
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis)
import PureScript.Backend.Optimizer.BoundedMemo (createBoundedMemo, createStringMemo)
import PureScript.Backend.Optimizer.Cache (beginPurmetaBuild, nowMillis, trimPurmetaCache, writePurmetaSync)
import PureScript.Backend.Optimizer.Convert (BackendImplementations, BackendModule, ExternLookup(..), OptimizationSteps, PurmetaLookup, lookupPurmetaImplementation, toBackendModuleWithLookupsAndProfile)
import PureScript.Backend.Optimizer.CoreFn (Ann(..), Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), Guard(..), Ident(..), Literal(..), Module(..), ModuleName(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.NativeMaps (evalRefCompare, insertEvalRefImpl, lookupQualifiedIdentImpl, memberEvalRefImpl, qualifiedIdentCompare)
import PureScript.Backend.Optimizer.Semantics (BackendExpr, Ctx, EvalRef(..), ExternImpl, InlineAccessor(..), InlineDirective(..), InlineDirectiveMap, OptimizationProfile(..), instantiateNeutralType)
import PureScript.Backend.Optimizer.Semantics.Foreign (ForeignEval)
import PureScript.Backend.Optimizer.Semantics as Semantics
import PureScript.Backend.Optimizer.Observation as Observation
import PureScript.Backend.Optimizer.Syntax (BackendSyntax)

type BuildEnv =
  { implementations :: Map (Qualified Ident) (Tuple BackendAnalysis ExternImpl)
  , moduleCount :: Int
  , moduleIndex :: Int
  }

-- Nothing is an uncovered query; Just Nothing is a verified absence. This
-- optional cache is consulted only for a finalized reused contribution.
type CachedBindingLookup = String -> String -> String -> Effect (Maybe (Maybe (Tuple BackendAnalysis ExternImpl)))

type FinalizedContribution =
  { cached :: Boolean
  , load :: Unit -> BackendImplementations
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

-- Observations are attempt-local; only finalized fresh jobs publish them, at
-- the same canonical boundary as codegen. The historical skip APIs use Nothing.
type BuildObservation m =
  { onSkipModule :: BuildEnv -> Module Ann -> Observation.View -> m (Maybe BackendModule)
  , onReads :: BuildEnv -> Module Ann -> Observation.Reads -> m Unit
  }

-- | Résultat d'une conversion de module exécutée dans un worker.
-- | `cached` reproduit la branche cache du builder historique : purmeta et
-- | directives sont publiés, mais aucun codegen n'est demandé.
type ParallelJob =
  { index :: Int
  , coreFnModule :: Module Ann
  , backendMod :: BackendModule
  , steps :: OptimizationSteps
  , cached :: Boolean
  -- | Prédécesseurs consultés pendant la tentative mais encore non finalisés.
  -- | Le coordinateur ne publie pas un tel résultat : il rejoue la conversion
  -- | après la finalisation de ces prédécesseurs.
  , pendingDeps :: Set Int
  -- | Durée murale de la tentative, en millisecondes.
  , attemptMillis :: Number
  }

-- | Ordonnanceur de tâches concurrentes fourni par le backend : `fork`
-- | soumet une conversion, `await` rend le prochain résultat disponible.
type JobScheduler m =
  { fork :: (Unit -> m ParallelJob) -> m Unit
  , await :: m ParallelJob
  }

-- | Compteurs d'ordonnancement pour les campagnes de mesure.
type ParallelStats =
  { dispatched :: Int
  , maxReady :: Int
  , fallbackDispatched :: Int
  , deferredAttempts :: Int
  , wakeups :: Int
  , waitingPeak :: Int
  , attemptMillis :: Number
  , attemptMaxMillis :: Number
  , coordinatorMillis :: Number
  , awaitMillis :: Number
  , emitMillis :: Number
  }

-- | Builds modules given a _sorted_ list of modules.
-- | See `PureScript.Backend.Optimizer.CoreFn.Sort.sortModules`.

buildModules :: forall m. MonadEffect m => BuildOptions m -> List (Module Ann) -> m Unit
buildModules = buildModulesWithReuse (\_ _ _ -> pure unit)

-- Cache consumers can restore codegen contributions at exactly the same
-- canonical boundary as a fresh module. The historical API keeps its skip
-- semantics; speculative onSkipModule calls never perform publication.
buildModulesWithReuse
  :: forall m. MonadEffect m
  => (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesWithReuse = buildModulesWithObservation Nothing

buildModulesWithObservation
  :: forall m. MonadEffect m
  => Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesWithObservation = buildModulesWithObservationAndProfile Release

buildModulesWithObservationAndProfile
  :: forall m. MonadEffect m
  => OptimizationProfile
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesWithObservationAndProfile profile observer onReuse options coreFnModules = do
  liftEffect beginPurmetaBuild
  void $ go { directives: options.directives, implementations: Map.empty, moduleIndex: 0, exports: Map.empty, privateGlobals: Set.empty } coreFnModules
  where
  moduleCount = List.length coreFnModules

  go acc Nil = pure acc
  go ( { directives, implementations, moduleIndex, exports, privateGlobals } ) (Cons coreFnModule remainingModules) = do
    let buildEnv = { implementations, moduleCount, moduleIndex }
    coreFnModule'@(Module { name, exports: modExportsArray }) <- options.onPrepareModule buildEnv coreFnModule
    lookupRaw <- liftEffect $ createStringMemo 512 (mkFn2 lookupPurmetaImplementation)
    let forcedDirectives = forcePrivateInlines (Set.union privateGlobals (untypedPrivateGlobals coreFnModule')) directives
    observed <- case observer of
      Nothing -> pure Nothing
      Just _ -> Just <$> liftEffect (Observation.create name lookupRaw forcedDirectives (\_ -> pure unit) (pure false))
    mbCachedMod <- case observer, observed of
      Just callbacks, Just inputs -> callbacks.onSkipModule buildEnv coreFnModule' inputs.view
      _, _ -> options.onSkipModule buildEnv coreFnModule'

    let
      modExports = Set.fromFoldable modExportsArray
      newExports = Map.insert name modExports exports

    case mbCachedMod of
      Just cachedMod -> do
        let
          newDirectives = foldrWithIndex (insertEvalRefImpl evalRefCompare compare) directives cachedMod.directives
        onReuse (buildEnv { implementations = cachedMod.implementations }) coreFnModule' cachedMod
        liftEffect $ writePurmetaSync name cachedMod.implementations
        liftEffect trimPurmetaCache

        go
          { directives: newDirectives
          , implementations: Map.empty
          , moduleIndex: moduleIndex + 1
          , exports: newExports
          , privateGlobals: Set.union privateGlobals (untypedPrivateGlobals coreFnModule')
          }
          remainingModules
      Nothing -> do
        -- Each module owns its caches. Purmeta is unchanged during conversion;
        -- local implementations and directives remain live as bindings advance.
        instantiate <- liftEffect $ createBoundedMemo 512 (mkFn2 instantiateNeutralType)
        let lookupPurmeta = case observed of
              Nothing -> lookupRaw
              Just inputs -> inputs.implementation
            lookupDirective = case observed of
              Nothing -> Semantics.lookupDirective
              Just inputs -> inputs.directive
        let
          Tuple optimizationSteps backendMod = toBackendModuleWithLookupsAndProfile profile lookupPurmeta lookupDirective coreFnModule'
            { analyzeCustom: options.analyzeCustom
            , currentModule: name
            , instantiateNeutral: instantiate
            , currentLevel: 0
            , toLevel: Map.empty
            , implementations
            , moduleImplementations: Map.empty
            , directives: forcedDirectives
            , dataTypes: Map.empty
            , foreignSemantics: options.foreignSemantics
            , rewriteLimit: options.rewriteLimit
            , traceIdents: options.traceIdents
            , optimizationSteps: []
            }
          -- Directives accumulate, as in upstream: a module sees the defaults
          -- and the directives published by every module converted so far.
          newDirectives = foldrWithIndex (insertEvalRefImpl evalRefCompare compare) directives backendMod.directives

        case observer, observed of
          Just callbacks, Just inputs -> do
            reads <- liftEffect inputs.read
            callbacks.onReads (buildEnv { implementations = backendMod.implementations }) coreFnModule' reads
          _, _ -> pure unit
        options.onCodegenModule (buildEnv { implementations = backendMod.implementations }) coreFnModule' backendMod optimizationSteps

        -- Write this module's implementations to disk
        liftEffect $ writePurmetaSync name backendMod.implementations
        liftEffect trimPurmetaCache

        go
          { directives: newDirectives
          , implementations: Map.empty
          , moduleIndex: moduleIndex + 1
          , exports: newExports
          , privateGlobals: Set.union privateGlobals (untypedPrivateGlobals coreFnModule')
          }
          remainingModules


-- | Private globals whose TAST carries no type annotation. Code generation
-- | cannot type a cross-module reference to one of these, so `boxUnbox` would
-- | materialize a class dictionary around an already typed value. Force their
-- | inlining everywhere, including inside their defining module.
untypedPrivateGlobals :: Module Ann -> Set (Qualified Ident)
untypedPrivateGlobals (Module m) =
  let
    exported = Set.fromFoldable m.exports
    decls = Array.concatMap flatten m.decls
    flatten = case _ of
      NonRec binding -> [ binding ]
      Rec bindings -> bindings
    privateUntyped = Set.fromFoldable (map bindingIdent (Array.filter untyped decls))
  in Set.map (Qualified (Just m.name)) (Set.difference privateUntyped exported)
  where
  bindingIdent (Binding _ ident _) = ident
  untyped (Binding (Ann ann) _ expr) = ann.type == Nothing && exprUntyped expr

exprUntyped :: Expr Ann -> Boolean
exprUntyped = case _ of
  ExprVar (Ann ann) _ -> ann.type == Nothing
  ExprLit (Ann ann) _ -> ann.type == Nothing
  ExprAbs (Ann ann) _ _ -> ann.type == Nothing
  ExprApp (Ann ann) _ _ -> ann.type == Nothing
  ExprTypeApp (Ann ann) _ _ -> ann.type == Nothing
  ExprLet (Ann ann) _ _ -> ann.type == Nothing
  ExprCase (Ann ann) _ _ -> ann.type == Nothing
  ExprConstructor (Ann ann) _ _ _ -> ann.type == Nothing
  ExprAccessor (Ann ann) _ _ -> ann.type == Nothing
  ExprUpdate (Ann ann) _ _ -> ann.type == Nothing

-- | Force inlining for references to globals that are not exported by their
-- | defining module, without overriding an explicit published directive.
forcePrivateInlines :: Set (Qualified Ident) -> InlineDirectiveMap -> InlineDirectiveMap
forcePrivateInlines privateGlobals directives =
  Array.foldl addDirective directives (Set.toUnfoldable privateGlobals :: Array (Qualified Ident))
  where
  addDirective acc qual = case memberEvalRefImpl evalRefCompare compare (EvalExtern qual) acc of
    true -> acc
    false -> insertEvalRefImpl evalRefCompare compare (EvalExtern qual) (Map.singleton InlineRef InlineAlways) acc

-- | Parallel builder. Modules are converted by `runJobs`; the coordinator
-- | remains the only writer of purmeta, directives and codegen.
-- |
-- | Chaque tentative reçoit une vue fixe des résultats finalisés, filtrée par
-- | rang, et les directives des seuls prédécesseurs antérieurs déjà publiés.
-- | Une consultation d'un prédécesseur non finalisé est signalée et la
-- | tentative est rejouée. Le codegen est émis dans l'ordre canonique des
-- | modules, quel que soit l'ordre d'achèvement des conversions.
buildModulesParallel
  :: forall m
   . MonadEffect m
  => { jobs :: Int
     , scheduler :: JobScheduler m
     , onStats :: Maybe (ParallelStats -> m Unit)
     }
  -> BuildOptions m
  -> List (Module Ann)
  -> m Unit
buildModulesParallel = buildModulesParallelWithReuse (\_ _ _ -> pure unit)

buildModulesParallelWithReuse
  :: forall m. MonadEffect m
  => (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithReuse = buildModulesParallelWithObservation Nothing

buildModulesParallelWithObservation
  :: forall m. MonadEffect m
  => Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithObservation = buildModulesParallelWithLazyContributions Nothing

-- A restored module can supply its immutable implementation contribution on
-- first read. Finality and canonical visibility are still checked before the
-- loader runs; this never exposes a future module or an unfinished attempt.
buildModulesParallelWithLazyContributions
  :: forall m. MonadEffect m
  => Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithLazyContributions = buildModulesParallelWithLazyPreparation pure

-- Restore the actual prepared AST only after both cache proofs have failed.
-- Inert placeholders still carry the exact private-global and ordering facts.
buildModulesParallelWithLazyPreparation
  :: forall m. MonadEffect m
  => (Module Ann -> m (Module Ann))
  -> Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithLazyPreparation = buildModulesParallelWithSchedulingHints Map.empty

-- Prior observations may recover scheduling edges omitted by inert headers.
-- Hints only delay attempts; all reads still use the same rank/finality view.
-- Missing, stale or future hints cannot prove reuse or reveal a contribution.
buildModulesParallelWithSchedulingHints
  :: forall m. MonadEffect m
  => Map String (Array String)
  -> (Module Ann -> m (Module Ann))
  -> Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithSchedulingHints = buildModulesParallelWithRestoredHeaders Map.empty

-- The caller may decode independently proven cache hits in a batch. They are
-- still finalized only at the canonical codegen front, using the same step as
-- completed jobs. In particular, a future header is never visible early.
-- These headers must correspond to the result of onPrepareModule, not an AST
-- that the callback would transform. The historical APIs keep their ordinary
-- per-attempt cache lookup and preparation behavior.
buildModulesParallelWithRestoredHeaders
  :: forall m. MonadEffect m
  => Map String BackendModule
  -> Map String (Array String)
  -> (Module Ann -> m (Module Ann))
  -> Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithRestoredHeaders = buildModulesParallelWithBindingLookup Nothing

buildModulesParallelWithBindingLookup
  :: forall m. MonadEffect m
  => Maybe CachedBindingLookup
  -> Map String BackendModule
  -> Map String (Array String)
  -> (Module Ann -> m (Module Ann))
  -> Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithBindingLookup = buildModulesParallelWithBindingLookupAndProfile Release

buildModulesParallelWithBindingLookupAndProfile
  :: forall m. MonadEffect m
  => OptimizationProfile
  -> Maybe CachedBindingLookup
  -> Map String BackendModule
  -> Map String (Array String)
  -> (Module Ann -> m (Module Ann))
  -> Maybe (String -> Effect BackendImplementations)
  -> Maybe (BuildObservation m)
  -> (BuildEnv -> Module Ann -> BackendModule -> m Unit)
  -> { jobs :: Int, scheduler :: JobScheduler m, onStats :: Maybe (ParallelStats -> m Unit) }
  -> BuildOptions m -> List (Module Ann) -> m Unit
buildModulesParallelWithBindingLookupAndProfile profile loadBinding restoredHeaders schedulingHints prepareFresh loadCached observer onReuse runner options coreFnModules = do
  liftEffect beginPurmetaBuild
  observations <- liftEffect (Ref.new Map.empty)
  go (initialState observations)
  where
  modules = Array.fromFoldable coreFnModules
  moduleCount = Array.length modules

  restoredAt :: Int -> Maybe BackendModule
  restoredAt i = do
    Module m <- Array.index modules i
    backend <- Map.lookup (unwrap m.name) restoredHeaders
    if backend.name == m.name then Just backend else Nothing

  needsJob :: Int -> Boolean
  needsJob i = case restoredAt i of
    Nothing -> true
    Just _ -> false

  indexByName :: Map String Int
  indexByName = Map.fromFoldable $ Array.mapWithIndex
    (\i (Module m) -> Tuple (unwrap m.name) i)
    modules

  importIndices :: Int -> Array Int
  importIndices i = case Array.index modules i of
    Nothing -> []
    Just (Module m) -> Array.mapMaybe
      (\(CoreFn.Import _ mn) -> Map.lookup (unwrap mn) indexByName >>= keepIndex i)
      m.imports

  refIndices :: Int -> Array Int
  refIndices i = case Array.index modules i of
    Nothing -> []
    Just mod@(Module m) ->
      let
        references = Set.toUnfoldable (referencedModules mod)
        owners = case Map.lookup (unwrap m.name) schedulingHints of
          Nothing -> references
          Just hints -> references <> hints
      in Array.mapMaybe (\mn -> Map.lookup mn indexByName >>= keepIndex i) owners

  -- The TAST import list contains the module itself, as well as Prim modules
  -- absent from the corpus; neither is a scheduling dependency.
  keepIndex :: Int -> Int -> Maybe Int
  keepIndex i j
    | j == i = Nothing
    | otherwise = Just j

  -- Scheduling hint only: a referenced pair keeps its relative order from the
  -- sorted list. Correctness no longer depends on these edges — every attempt
  -- reads a rank-filtered view and defers when a predecessor is missing — but
  -- the hints avoid useless retries and wasted conversions.
  pairWaits :: Map Int (Array Int)
  pairWaits = foldl stepPair
    (Map.fromFoldable (map (\i -> Tuple i []) (Array.range 0 (moduleCount - 1))))
    (Array.range 0 (moduleCount - 1))
    where
    stepPair acc i = foldl
      ( \a m -> Map.insertWith (<>) (if m > i then m else i) [ if m > i then i else m ] a)
      acc
      (refIndices i)

  deps :: Map Int (Array Int)
  deps = Map.fromFoldable $
    if Map.isEmpty restoredHeaders then
      Array.mapWithIndex (\i _ -> dependencies i) modules
    else
      map dependencies $ Array.filter needsJob $ Array.mapWithIndex (\i _ -> i) modules
    where
    dependencies i = Tuple i (Array.nub (importIndices i <> fromMaybe [] (Map.lookup i pairWaits)))

  -- Restored headers advance only at the canonical front, so they never need
  -- scheduling dependencies of their own. Retain every dependency of uncertain
  -- jobs, including edges to restored owners: their ordinary step still wakes
  -- the same readers when those owners become finalized.
  children :: Map Int (Array Int)
  children = foldl
    (\acc (Tuple i ds) -> foldl (\a d -> Map.insertWith (<>) d [ i ] a) acc ds)
    (if Map.isEmpty restoredHeaders then
      Map.fromFoldable $ Array.mapWithIndex (\i _ -> Tuple i []) modules
    else Map.empty)
    (Map.toUnfoldable deps :: Array _)

  initialState observations =
    { observations
    , pending: Map.fromFoldable (Array.mapWithIndex (\i m -> Tuple i m) modules)
    , depsLeft: depsLeft0
    , ready: Set.fromFoldable $ Array.mapMaybe
        (\(Tuple i n) -> if n == 0 then Just i else Nothing)
        (Map.toUnfoldable depsLeft0 :: Array _)
    , finalized: Map.empty
    , contributions: Map.empty
    , privateGlobals: Map.empty
    , accumulated: options.directives
    , waiting: Map.empty
    , nextCodegen: 0
    , waitingCodegen: Map.empty
    , inFlight: Set.empty
    , stats:
        { dispatched: 0
        , maxReady: 0
        , fallbackDispatched: 0
        , deferredAttempts: 0
        , wakeups: 0
        , waitingPeak: 0
        , attemptMillis: 0.0
        , attemptMaxMillis: 0.0
        , coordinatorMillis: 0.0
        , awaitMillis: 0.0
        , emitMillis: 0.0
        }
    }
    where
    depsLeft0 = map Array.length deps

  -- | Réveille les tentatives qui attendaient la finalisation de `done`.
  wake :: Int -> Map Int (Set Int) -> { ready :: Set Int, waiting :: Map Int (Set Int) }
  wake done waiting =
    foldl stepW { ready: Set.empty, waiting: Map.empty }
      (Map.toUnfoldable waiting :: Array (Tuple Int (Set Int)))
    where
    stepW acc (Tuple w needed) =
      if Set.member done needed then
        let remaining = Set.delete done needed
        in if Set.isEmpty remaining then acc { ready = Set.insert w acc.ready }
           else acc { waiting = Map.insert w remaining acc.waiting }
      else acc { waiting = Map.insert w needed acc.waiting }

  -- | Émission dans l'ordre canonique des modules, quel que soit l'ordre
  -- | d'achèvement des conversions. Les résultats en attente de leur tour
  -- | restent dans `waitingCodegen`.
  flushCodegen st = case Map.lookup st.nextCodegen st.waitingCodegen of
    Nothing -> pure st
    Just job -> do
      started <- liftEffect nowMillis
      if job.cached then
        onReuse
          { implementations: job.backendMod.implementations, moduleCount, moduleIndex: job.index }
          job.coreFnModule
          job.backendMod
      else do
        case observer of
          Just callbacks -> do
            completed <- liftEffect (Ref.read st.observations)
            case Map.lookup job.index completed of
              Just reads -> callbacks.onReads
                { implementations: job.backendMod.implementations, moduleCount, moduleIndex: job.index }
                job.coreFnModule reads
              Nothing -> pure unit
            liftEffect (Ref.modify_ (Map.delete job.index) st.observations)
          Nothing -> pure unit
        options.onCodegenModule
          { implementations: job.backendMod.implementations, moduleCount, moduleIndex: job.index }
          job.coreFnModule
          job.backendMod
          job.steps
      ended <- liftEffect nowMillis
      flushCodegen st
        { waitingCodegen = Map.delete job.index st.waitingCodegen
        , nextCodegen = st.nextCodegen + 1
        , stats = st.stats { emitMillis = st.stats.emitMillis + (ended - started) }
        }

  -- | Prefer ready modules, then speculate only when referenced predecessors
  -- | are finalized (unreferenced imports may still be pending). If no job is
  -- | in flight, the lowest remaining rank guarantees forward progress.
  pickModule st
    | Set.size st.inFlight >= runner.jobs = Nothing
    | otherwise = case firstFree st.ready of
        Just i -> Just (Tuple i false)
        Nothing ->
          let
            pendingIndices = Set.toUnfoldable (Map.keys st.pending) :: Array Int
            readyToTry = Array.filter
              (\i -> needsJob i && not (Map.member i st.waiting) && not (Set.member i st.inFlight))
              pendingIndices
          in
            case Array.find referencesReady readyToTry of
              Just i -> Just (Tuple i true)
              Nothing ->
                -- Aucun module disponible : si des tentatives sont en vol, les
                -- attendre (leurs résultats feront progresser l'état) plutôt
                -- que de reforker un module déjà en attente de prédécesseur.
                -- Le repli ultime ne sert qu'au blocage complet.
                if Set.isEmpty st.inFlight then
                  (\i -> Tuple i true) <$> firstFree (Map.keys st.pending)
                else Nothing
    where
    referencesReady i = Array.all (\d -> Map.member d st.finalized)
      (fromMaybe [] (Map.lookup i pairWaits))
    firstFree indices =
      Array.find (\i -> needsJob i && not (Set.member i st.inFlight)) (Set.toUnfoldable indices :: Array Int)

  go st = case Map.lookup st.nextCodegen st.pending, restoredAt st.nextCodegen of
    Just coreFnModule, Just backendMod -> do
      started <- liftEffect nowMillis
      let buildEnv = { implementations: Map.empty, moduleCount, moduleIndex: st.nextCodegen }
      prepared <- options.onPrepareModule buildEnv coreFnModule
      restored <- step st
        { index: st.nextCodegen, coreFnModule: prepared, backendMod, steps: []
        , cached: true, pendingDeps: Set.empty, attemptMillis: 0.0
        }
      ended <- liftEffect nowMillis
      go (restored { stats = restored.stats { coordinatorMillis = restored.stats.coordinatorMillis + ended - started } })
    _, _ -> dispatch st

  dispatch st = case pickModule st of
    Just (Tuple i isFallback) -> case Map.lookup i st.pending of
      Nothing -> go st
      Just coreFnModule -> do
        runner.scheduler.fork (mkJob st i coreFnModule)
        let
          stats' = st.stats
            { dispatched = st.stats.dispatched + if isFallback then 0 else 1
            , fallbackDispatched = st.stats.fallbackDispatched + if isFallback then 1 else 0
            , maxReady = max (Set.size st.ready) st.stats.maxReady
            }
        go (st { inFlight = Set.insert i st.inFlight, stats = stats' })
    Nothing ->
      if Set.isEmpty st.inFlight then
        case runner.onStats of
          Just report -> report (st.stats { maxReady = max (Set.size st.ready) st.stats.maxReady })
          Nothing -> pure unit
      else do
        awaitStarted <- liftEffect nowMillis
        result <- runner.scheduler.await
        awaitEnded <- liftEffect nowMillis
        coordStarted <- liftEffect nowMillis
        st' <- step st result
        coordEnded <- liftEffect nowMillis
        go
          ( st'
              { inFlight = Set.delete result.index st'.inFlight
              , stats = st'.stats
                  { awaitMillis = st'.stats.awaitMillis + (awaitEnded - awaitStarted)
                  , coordinatorMillis = st'.stats.coordinatorMillis + (coordEnded - coordStarted)
                  , maxReady = max (Set.size st.ready) st'.stats.maxReady
                  }
              }
          )

  mkJob st i coreFnModule _ = do
    attemptStarted <- liftEffect nowMillis
    let buildEnv = { implementations: Map.empty, moduleCount, moduleIndex: i }
    prepared <- options.onPrepareModule buildEnv coreFnModule
    -- An exact cached contribution does not inspect the optimizer environment.
    -- Avoid constructing all predecessor directives for these inert jobs.
    early <- case loadCached of
      Just _ -> options.onSkipModule buildEnv prepared
      Nothing -> pure Nothing
    case early of
      Just cached -> pure
        { index: i, coreFnModule: prepared, backendMod: cached, steps: []
        , cached: true, pendingDeps: Set.empty, attemptMillis: 0.0
        }
      Nothing -> mkUncachedJob st i prepared attemptStarted

  mkUncachedJob st i prepared@(Module m) attemptStarted = do
    pendingRef <- liftEffect (Ref.new Set.empty)
    lookupRaw <- createLazyRankLookup (map (\resolve -> resolve (unwrap m.name)) loadBinding)
      { indexByName
      , currentIndex: i
      , finalized: st.finalized
      }
      pendingRef
    let directives = effectiveDirectives options.directives st.accumulated st.contributions i
    let buildEnv = { implementations: Map.empty, moduleCount, moduleIndex: i }
    -- Match the sequential builder's forced inlining of untyped private
    -- bindings, including the current prepared module. Only finalized lower
    -- ranks are visible; lookup of an unfinished predecessor defers the job.
    let privateGlobals = foldrWithIndex
          (\rank globals acc -> if rank < i then Set.union globals acc else acc)
          (untypedPrivateGlobals prepared)
          st.privateGlobals
    let forcedDirectives = forcePrivateInlines privateGlobals directives
    let awaitModule (ModuleName name) = case Map.lookup name indexByName of
          Just other | other < i && not (Map.member other st.finalized) -> Ref.modify_ (Set.insert other) pendingRef
          _ -> pure unit
    let availableOwner name = case Map.lookup name indexByName of
          Just other -> other < i && Map.member other st.finalized
          Nothing -> false
    observed <- case observer of
      Nothing -> pure Nothing
      Just _ -> Just <$> liftEffect (Observation.createWithAvailability availableOwner m.name lookupRaw forcedDirectives awaitModule (not <<< Set.isEmpty <$> Ref.read pendingRef))
    mbCached <- case observer, observed of
      Just callbacks, Just inputs -> callbacks.onSkipModule buildEnv prepared inputs.view
      _, _ -> options.onSkipModule buildEnv prepared
    case mbCached of
      Just cached -> do
        pending <- liftEffect (Ref.read pendingRef)
        pure
          { index: i
          , coreFnModule: prepared
          , backendMod: cached
          , steps: []
          , cached: true
          , pendingDeps: pending
          , attemptMillis: 0.0
          }
      Nothing -> do
        actual <- prepareFresh prepared
        instantiate <- liftEffect $ createBoundedMemo 512 (mkFn2 instantiateNeutralType)
        let lookupPurmeta = case observed of
              Nothing -> lookupRaw
              Just inputs -> inputs.implementation
            lookupDirective = case observed of
              Nothing -> Semantics.lookupDirective
              Just inputs -> inputs.directive
        let
          Tuple steps backendMod = toBackendModuleWithLookupsAndProfile profile lookupPurmeta lookupDirective actual
            { analyzeCustom: options.analyzeCustom
            , currentModule: m.name
            , instantiateNeutral: instantiate
            , currentLevel: 0
            , toLevel: Map.empty
            , implementations: Map.empty
            , moduleImplementations: Map.empty
            , directives: forcedDirectives
            , dataTypes: Map.empty
            , foreignSemantics: options.foreignSemantics
            , rewriteLimit: options.rewriteLimit
            , traceIdents: options.traceIdents
            , optimizationSteps: []
            }
        pending <- liftEffect (Ref.read pendingRef)
        when (Set.isEmpty pending) $ case observed of
          Just inputs -> do
            reads <- liftEffect inputs.read
            liftEffect (Ref.modify_ (Map.insert i reads) st.observations)
          Nothing -> pure unit
        attemptEnded <- liftEffect nowMillis
        pure
          { index: i
          , coreFnModule: actual
          , backendMod
          , steps
          , cached: false
          , pendingDeps: pending
          , attemptMillis: attemptEnded - attemptStarted
          }

  step st result = do
    let (Module m) = result.coreFnModule
    if not (Set.isEmpty result.pendingDeps) then do
      -- La tentative a consulté des prédécesseurs encore en cours : rien
      -- n'est publié. On attend leur finalisation, ou on rejoue immédiatement
      -- si ce lot les a finalisés après la prise de vue.
      let
        fresh = Set.filter (\d -> not (Map.member d st.finalized)) result.pendingDeps
        stats' = st.stats
          { deferredAttempts = st.stats.deferredAttempts + 1
          , waitingPeak = max st.stats.waitingPeak (Map.size st.waiting + 1)
          , attemptMillis = st.stats.attemptMillis + result.attemptMillis
          , attemptMaxMillis = max st.stats.attemptMaxMillis result.attemptMillis
          }
      if Set.isEmpty fresh then
        pure (st { ready = Set.insert result.index st.ready, waiting = Map.delete result.index st.waiting, stats = stats' })
      else
        pure (st { ready = Set.delete result.index st.ready, waiting = Map.insert result.index fresh st.waiting, stats = stats' })
    else do
      -- Lazy cached contributions remain private to this build. The parallel
      -- resolver below consumes them directly, not the purmeta disk mirror.
      case loadCached of
        Just _ | result.cached -> pure unit
        _ -> liftEffect $ writePurmetaSync m.name result.backendMod.implementations
      liftEffect trimPurmetaCache
      let
        woken = wake result.index st.waiting
        depsLeft' = Map.delete result.index st.depsLeft
        childIndices = fromMaybe [] (Map.lookup result.index children)
        depsLeft'' = foldl (\acc c -> Map.update (\n -> Just (n - 1)) c acc) depsLeft' childIndices
        newlyReady = Array.filter
          (\c -> Map.lookup c depsLeft'' == Just 0 && not (Map.member c woken.waiting))
          childIndices
      flushCodegen
        { observations: st.observations
        , pending: Map.delete result.index st.pending
        , depsLeft: depsLeft''
        , ready: foldl (flip Set.insert)
            (Set.union (Set.delete result.index st.ready) woken.ready)
            newlyReady
        , finalized: Map.insert result.index
            { cached: result.cached && case loadCached of
                Just _ -> true
                Nothing -> false
            , load: \_ -> case loadCached of
                Just load | result.cached -> unsafePerformEffect (load (unwrap m.name))
                _ -> result.backendMod.implementations
            } st.finalized
        , contributions: Map.insert result.index result.backendMod.directives st.contributions
        , privateGlobals: Map.insert result.index (untypedPrivateGlobals result.coreFnModule) st.privateGlobals
        , accumulated: foldrWithIndex (insertEvalRefImpl evalRefCompare compare) st.accumulated result.backendMod.directives
        , waiting: woken.waiting
        , nextCodegen: st.nextCodegen
        , waitingCodegen: Map.insert result.index result st.waitingCodegen
        , inFlight: st.inFlight
        , stats: st.stats
            { wakeups = st.stats.wakeups + Set.size woken.ready
            , attemptMillis = st.stats.attemptMillis + result.attemptMillis
            , attemptMaxMillis = max st.stats.attemptMaxMillis result.attemptMillis
            }
        }

-- | Directives effectives d'une tentative : la configuration, plus toutes
-- | les contributions déjà finalisées, moins celles des modules de rang
-- | supérieur ou égal au rang courant — invisibles, comme dans le build
-- | séquentiel. Deux modules différents portent sur des clés disjointes
-- | (le filtre par module est dans Convert), donc retirer une contribution
-- | ne touche jamais une autre entrée que les siennes.
effectiveDirectives
  :: InlineDirectiveMap
  -> InlineDirectiveMap
  -> Map Int InlineDirectiveMap
  -> Int
  -> InlineDirectiveMap
effectiveDirectives base accumulated contributions currentIndex =
  -- foldrWithIndex passe (indice, élément, accumulateur) : contrairement à
  -- foldlWithIndex, l'ordre ne peut pas être confondu quand les deux types
  -- coïncident. L'ordre de parcours est sans importance, les contributions
  -- de modules différents étant disjointes.
  foldrWithIndex
    ( \rank contrib acc -> if rank >= currentIndex then removeContribution contrib acc else acc )
    accumulated
    contributions
  where
  -- The keys of a contribution form a module-local group. Remove them as one
  -- persistent-map difference rather than repeatedly copying the search path
  -- for every key. Defaults shadowed by that contribution must be restored.
  removeContribution contrib acc =
    Map.union (Map.intersection base contrib) (Map.difference acc contrib)

-- | Vue de lecture des implémentations externes pour une tentative de
-- | conversion.
-- |
-- | - un module absent de l'index (Prim, FFI, hors corpus) est une absence ;
-- | - un module de rang supérieur ou égal au rang courant reste invisible,
-- |   même finalisé, comme dans le build séquentiel ;
-- | - un prédécesseur finalisé fournit son résultat final ;
-- | - un prédécesseur antérieur encore en cours est enregistré dans le `Ref`
-- |   et signalé `ExternPending`.
createRankLookup
  :: forall m
   . MonadEffect m
  => { indexByName :: Map String Int
     , currentIndex :: Int
     , finalized :: Map Int BackendImplementations
     }
  -> Ref.Ref (Set Int)
  -> m PurmetaLookup
createRankLookup view pendingRef = do
  createLazyRankLookup Nothing (view { finalized = map (\value -> { cached: false, load: const value }) view.finalized }) pendingRef

createLazyRankLookup
  :: forall m. MonadEffect m
  => Maybe (String -> String -> Effect (Maybe (Maybe (Tuple BackendAnalysis ExternImpl))))
  -> { indexByName :: Map String Int
     , currentIndex :: Int
     , finalized :: Map Int FinalizedContribution
     }
  -> Ref.Ref (Set Int)
  -> m PurmetaLookup
createLazyRankLookup loadBinding view pendingRef = do
  let
    raw moduleName ident =
      case Map.lookup moduleName view.indexByName of
        Nothing -> ExternMissing
        Just other
          | other >= view.currentIndex -> ExternMissing
          | otherwise -> case Map.lookup other view.finalized of
              Just contribution ->
                let
                  covered = case loadBinding of
                    Just resolve | contribution.cached -> unsafePerformEffect (resolve moduleName ident)
                    _ -> Nothing
                  value = case covered of
                    Just found -> found
                    Nothing -> lookupQualifiedIdentImpl qualifiedIdentCompare (Qualified (Just (ModuleName moduleName)) (Ident ident)) (contribution.load unit)
                in case value of
                  Just impl -> ExternFound impl
                  Nothing -> ExternMissing
              Nothing -> unsafePerformEffect do
                Ref.modify_ (Set.insert other) pendingRef
                pure ExternPending
  liftEffect $ createStringMemo 512 (mkFn2 raw)

-- | Modules referenced by a module's own declarations. A conversion can look
-- | up implementations for qualifiers that are not direct imports: static
-- | arguments and specializations embed dictionaries and constants from
-- | caller modules. Waiting for the direct imports alone is therefore not
-- | enough to make purmeta reads order-independent.
referencedModules :: Module Ann -> Set String
referencedModules (Module m) = foldl (\acc b -> addBind b acc) (Set.singleton (unwrap m.name)) m.decls

addBind :: Bind Ann -> Set String -> Set String
addBind bind acc = case bind of
  NonRec binding -> addBinding binding acc
  Rec bindings -> foldl (\a b -> addBinding b a) acc bindings

addBinding :: Binding Ann -> Set String -> Set String
addBinding (Binding _ _ expr) acc = addExpr expr acc

addQual :: forall a. Qualified a -> Set String -> Set String
addQual (Qualified mbModule _) acc = case mbModule of
  Just mn -> Set.insert (unwrap mn) acc
  Nothing -> acc

addExpr :: Expr Ann -> Set String -> Set String
addExpr expr acc = case expr of
  ExprVar _ qual -> addQual qual acc
  ExprLit _ lit -> addLit lit acc
  ExprConstructor _ _ _ _ -> acc
  ExprAccessor _ inner _ -> addExpr inner acc
  ExprUpdate _ inner props -> foldl (\a (Prop _ v) -> addExpr v a) (addExpr inner acc) props
  ExprAbs _ _ body -> addExpr body acc
  ExprApp _ fn arg -> addExpr arg (addExpr fn acc)
  ExprCase _ exprs alts -> foldl (\a alt -> addAlt alt a) (foldl (\a e -> addExpr e a) acc exprs) alts
  ExprLet _ binds body -> foldl (\a b -> addBind b a) (addExpr body acc) binds
  ExprTypeApp _ inner _ -> addExpr inner acc

addLit :: Literal (Expr Ann) -> Set String -> Set String
addLit lit acc = case lit of
  LitArray exprs -> foldl (\a e -> addExpr e a) acc exprs
  LitRecord props -> foldl (\a (Prop _ v) -> addExpr v a) acc props
  _ -> acc

addAlt :: CaseAlternative Ann -> Set String -> Set String
addAlt (CaseAlternative binders guard) acc =
  addGuard guard (foldl (\a b -> addBinder b a) acc binders)

addGuard :: CaseGuard Ann -> Set String -> Set String
addGuard guard acc = case guard of
  Unconditional e -> addExpr e acc
  Guarded guards -> foldl (\a (Guard g e) -> addExpr e (addExpr g a)) acc guards

addBinder :: Binder Ann -> Set String -> Set String
addBinder binder acc = case binder of
  BinderNamed _ _ inner -> addBinder inner acc
  BinderLit _ lit -> addBinderLit lit acc
  BinderConstructor _ ty ctor binders ->
    foldl (\a b -> addBinder b a) (addQual ctor (addQual ty acc)) binders
  _ -> acc

addBinderLit :: Literal (Binder Ann) -> Set String -> Set String
addBinderLit lit acc = case lit of
  LitArray binders -> foldl (\a b -> addBinder b a) acc binders
  LitRecord props -> foldl (\a (Prop _ b) -> addBinder b a) acc props
  _ -> acc
