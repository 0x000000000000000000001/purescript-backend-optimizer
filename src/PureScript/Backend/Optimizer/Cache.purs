module PureScript.Backend.Optimizer.Cache
  ( writePurmetaSync
  , readPurmetaSync
  , clearPurmetaCache
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

writePurmetaSync :: ModuleName -> BackendImplementations -> Effect Unit
writePurmetaSync mn = writePurmetaSyncImpl (unwrap mn)

readPurmetaSync :: ModuleName -> Effect (Maybe BackendImplementations)
readPurmetaSync mn = readPurmetaSyncImpl (unwrap mn) Just Nothing

clearPurmetaCache :: Effect Unit
clearPurmetaCache = clearPurmetaCacheImpl
