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
  , buildModulesParallel
  , createRankLookup
  , effectiveDirectives
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (foldl, foldM)
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
import Effect.Ref as Ref
import Effect.Unsafe (unsafePerformEffect)
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis)
import PureScript.Backend.Optimizer.BoundedMemo (createBoundedMemo, createStringMemo)
import PureScript.Backend.Optimizer.Cache (beginPurmetaBuild, nowMillis, trimPurmetaCache, writePurmetaSync)
import PureScript.Backend.Optimizer.Convert (BackendImplementations, BackendModule, ExternLookup(..), OptimizationSteps, PurmetaLookup, lookupPurmetaImplementation, toBackendModuleWithLookup)
import PureScript.Backend.Optimizer.CoreFn (Ann, Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), Expr(..), Guard(..), Ident(..), Literal(..), Module(..), ModuleName(..), Prop(..), Qualified(..))
import PureScript.Backend.Optimizer.CoreFn as CoreFn
import PureScript.Backend.Optimizer.Semantics (BackendExpr, Ctx, ExternImpl, InlineDirectiveMap, instantiateNeutralType)
import PureScript.Backend.Optimizer.Semantics.Foreign (ForeignEval)
import PureScript.Backend.Optimizer.Syntax (BackendSyntax)

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
        lookupRaw <- liftEffect $ createStringMemo 512 (mkFn2 lookupPurmetaImplementation)
        let lookupPurmeta = lookupRaw
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
          -- Directives accumulate, as in upstream: a module sees the defaults
          -- and the directives published by every module converted so far.
          newDirectives = foldrWithIndex Map.insert directives backendMod.directives

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
buildModulesParallel runner options coreFnModules = do
  liftEffect beginPurmetaBuild
  go initialState
  where
  modules = Array.fromFoldable coreFnModules
  moduleCount = Array.length modules

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
    Just mod -> Array.mapMaybe
      (\mn -> Map.lookup mn indexByName >>= keepIndex i)
      (Set.toUnfoldable (referencedModules mod))

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
  deps = Map.fromFoldable $ Array.mapWithIndex
    ( \i _ -> Tuple i (Array.nub (importIndices i <> fromMaybe [] (Map.lookup i pairWaits))) )
    modules

  children :: Map Int (Array Int)
  children = foldl
    (\acc (Tuple i ds) -> foldl (\a d -> Map.insertWith (<>) d [ i ] a) acc ds)
    (Map.fromFoldable $ Array.mapWithIndex (\i _ -> Tuple i []) modules)
    (Map.toUnfoldable deps :: Array _)

  initialState =
    { pending: Map.fromFoldable (Array.mapWithIndex (\i m -> Tuple i m) modules)
    , depsLeft: depsLeft0
    , ready: Set.fromFoldable $ Array.mapMaybe
        (\(Tuple i n) -> if n == 0 then Just i else Nothing)
        (Map.toUnfoldable depsLeft0 :: Array _)
    , finalized: Map.empty
    , contributions: Map.empty
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
      when (not job.cached) $
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

  -- | Prochain module à convertir : un module prêt (le plus petit indice),
  -- | sinon un module en attente qui n'attend pas de prédécesseur, sinon le
  -- | plus petit indice restant. Les modules déjà en vol sont exclus.
  pickModule st
    | Set.size st.inFlight >= runner.jobs = Nothing
    | otherwise = case firstFree st.ready of
        Just i -> Just (Tuple i false)
        Nothing ->
          let
            pendingIndices = Set.toUnfoldable (Map.keys st.pending) :: Array Int
            readyToTry = Array.filter
              (\i -> not (Map.member i st.waiting) && not (Set.member i st.inFlight))
              pendingIndices
          in
            case Array.head readyToTry of
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
    firstFree indices =
      Array.find (\i -> not (Set.member i st.inFlight)) (Set.toUnfoldable indices :: Array Int)

  go st = case pickModule st of
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
    pendingRef <- liftEffect (Ref.new Set.empty)
    lookupRaw <- createRankLookup
      { indexByName
      , currentIndex: i
      , finalized: st.finalized
      }
      pendingRef
    let directives = effectiveDirectives options.directives st.accumulated st.contributions i
    let buildEnv = { implementations: Map.empty, moduleCount, moduleIndex: i }
    prepared@(Module m) <- options.onPrepareModule buildEnv coreFnModule
    mbCached <- options.onSkipModule buildEnv prepared
    case mbCached of
      Just cached -> pure
        { index: i
        , coreFnModule: prepared
        , backendMod: cached
        , steps: []
        , cached: true
        , pendingDeps: Set.empty
        , attemptMillis: 0.0
        }
      Nothing -> do
        instantiate <- liftEffect $ createBoundedMemo 512 (mkFn2 instantiateNeutralType)
        let lookupPurmeta = lookupRaw
        let
          Tuple steps backendMod = toBackendModuleWithLookup lookupPurmeta prepared
            { analyzeCustom: options.analyzeCustom
            , currentModule: m.name
            , instantiateNeutral: instantiate
            , currentLevel: 0
            , toLevel: Map.empty
            , implementations: Map.empty
            , moduleImplementations: Map.empty
            , directives
            , dataTypes: Map.empty
            , foreignSemantics: options.foreignSemantics
            , rewriteLimit: options.rewriteLimit
            , traceIdents: options.traceIdents
            , optimizationSteps: []
            }
        pending <- liftEffect (Ref.read pendingRef)
        attemptEnded <- liftEffect nowMillis
        pure
          { index: i
          , coreFnModule: prepared
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
      liftEffect $ writePurmetaSync m.name result.backendMod.implementations
      liftEffect trimPurmetaCache
      let
        woken = wake result.index st.waiting
        depsLeft' = Map.delete result.index st.depsLeft
        childIndices = fromMaybe [] (Map.lookup result.index children)
        depsLeft'' = foldl (\acc c -> Map.update (\n -> Just (n - 1)) c acc) depsLeft' childIndices
        newlyReady = Array.filter (\c -> Map.lookup c depsLeft'' == Just 0) childIndices
      flushCodegen
        { pending: Map.delete result.index st.pending
        , depsLeft: depsLeft''
        , ready: foldl (flip Set.insert) woken.ready newlyReady
        , finalized: Map.insert result.index result.backendMod.implementations st.finalized
        , contributions: Map.insert result.index result.backendMod.directives st.contributions
        , accumulated: foldrWithIndex Map.insert st.accumulated result.backendMod.directives
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
  removeContribution contrib acc = foldrWithIndex restore acc contrib

  restore key _ acc = case Map.lookup key base of
    Just value -> Map.insert key value acc
    Nothing -> Map.delete key acc

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
  let
    raw moduleName ident =
      case Map.lookup moduleName view.indexByName of
        Nothing -> ExternMissing
        Just other
          | other >= view.currentIndex -> ExternMissing
          | otherwise -> case Map.lookup other view.finalized of
              Just impls ->
                case Map.lookup (Qualified (Just (ModuleName moduleName)) (Ident ident)) impls of
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

