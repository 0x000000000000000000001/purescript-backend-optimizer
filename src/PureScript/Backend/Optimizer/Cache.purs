module PureScript.Backend.Optimizer.Cache
  ( writePurmetaSync
  , readPurmetaSync
  , writeAllocProfile
  , nowMillis
  , beginPurmetaBuild
  , clearPurmetaCache
  , trimPurmetaCache
  , setPurmetaCacheBudgetBytes
  , setPurmetaStatsEnabled
  , readPurmetaStatsJson
  , logMemory
  ) where

import Prelude
import Effect (Effect)
import Data.Maybe (Maybe(..))
import Data.Map (Map)
import Data.Tuple (Tuple)
import PureScript.Backend.Optimizer.Analysis (BackendAnalysis)
import PureScript.Backend.Optimizer.CoreFn (ModuleName, Qualified, Ident)
import PureScript.Backend.Optimizer.Semantics (ExternImpl)
import Data.Newtype (unwrap)

type BackendImplementations = Map (Qualified Ident) (Tuple BackendAnalysis ExternImpl)

foreign import writePurmetaSyncImpl :: String -> BackendImplementations -> Effect Unit
foreign import readPurmetaSyncImpl :: String -> (BackendImplementations -> Maybe BackendImplementations) -> Maybe BackendImplementations -> Effect (Maybe BackendImplementations)
foreign import clearPurmetaCacheImpl :: Effect Unit
foreign import trimPurmetaCacheImpl :: Effect Unit

-- | Start a fresh publication scope, discarding RAM and previous membership.
-- | Both builders call this on each execution. JavaScript scratch files stay
-- | on disk, but cannot be read until successfully republished in this scope.
foreign import beginPurmetaBuild :: Effect Unit

-- | Override the JavaScript cache's serialized-byte budget (default 64 MiB),
-- | returning the previous value for scoped restoration. Accepts non-negative
-- | safe integer byte counts; eviction still happens only at explicit trims.
foreign import setPurmetaCacheBudgetBytes :: Number -> Effect Number

-- | Opt-in JavaScript cache diagnostics. Enabling starts new counters without
-- | changing cache contents/policy; beginPurmetaBuild resets them for each build.
foreign import setPurmetaStatsEnabled :: Boolean -> Effect Unit

-- | A detached JSON snapshot (schema 1), or "null" when disabled. Byte counts
-- | and timings use JavaScript numbers rather than 32-bit PureScript Ints.
foreign import readPurmetaStatsJson :: Effect String

-- | Publish current-scope implementations. JavaScript writes an unversioned
-- | V8 payload to .purmeta/<Module>.purmeta under the working directory before
-- | marking it readable; serialization/write errors propagate to the caller.
writePurmetaSync :: ModuleName -> BackendImplementations -> Effect Unit
writePurmetaSync mn = writePurmetaSyncImpl (unwrap mn)

-- | Read only implementations published in this process's current scope.
-- | JavaScript checks membership before RAM or disk access, even before the
-- | first beginPurmetaBuild. This is not a persistent cross-build cache.
readPurmetaSync :: ModuleName -> Effect (Maybe BackendImplementations)
readPurmetaSync mn = readPurmetaSyncImpl (unwrap mn) Just Nothing

-- | Drop the JavaScript RAM LRU, retaining current-scope disk membership.
clearPurmetaCache :: Effect Unit
clearPurmetaCache = clearPurmetaCacheImpl

trimPurmetaCache :: Effect Unit
trimPurmetaCache = trimPurmetaCacheImpl

foreign import logMemoryImpl :: String -> Effect Unit

logMemory :: String -> Effect Unit
logMemory = logMemoryImpl

-- | Profil d'allocations cumulées (pprof) pour les campagnes de mesure.
-- | Sans effet sur les backends qui ne l'implémentent pas.
foreign import writeAllocProfileImpl :: String -> Effect Unit

writeAllocProfile :: String -> Effect Unit
writeAllocProfile = writeAllocProfileImpl

-- | Horloge monotone en millisecondes, pour l'instrumentation des campagnes.
foreign import nowMillis :: Effect Number
