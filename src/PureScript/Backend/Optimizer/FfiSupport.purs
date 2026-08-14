-- | FFI Support (FfiSupport.purs)
-- | La couche PureScript du FFI Support. Fournit les fonctions permettant d'analyser et de manipuler les références vers le code écrit dans le langage cible (JS, Go, PHP) depuis PureScript.

-- Ours
module PureScript.Backend.Optimizer.FfiSupport
  ( findFfiFile
  , hashString
  ) where

import Prelude

import Effect (Effect)
import Data.Maybe (Maybe)
import Data.Nullable (Nullable, toNullable, toMaybe)

foreign import findFfiFileImpl :: String -> Array String -> Nullable String -> String -> Nullable String -> Effect (Nullable String)
foreign import hashString :: String -> String

-- | Finds the FFI file corresponding to a PureScript module
-- | extension: e.g. ".go" or ".php"
-- | extraSpagoDirs: optional extra directories to scan like "bak/spago.d/php/p"
-- | mbFfiDir: optional directory to search in (if not provided, searches .spago and local dirs)
-- | modName: the PureScript module name (e.g. "Data.Show")
-- | mbModulePath: the path to the original .purs file if known
findFfiFile :: String -> Array String -> Maybe String -> String -> Maybe String -> Effect (Maybe String)
findFfiFile extension extraSpagoDirs mbFfiDir modName mbModulePath = do
  path <- findFfiFileImpl extension extraSpagoDirs (toNullable mbFfiDir) modName (toNullable mbModulePath)
  pure (toMaybe path)
