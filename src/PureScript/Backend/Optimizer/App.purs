module PureScript.Backend.Optimizer.App
  ( coreFnModulesFromOutput
  , readCoreFnModule
  ) where

import Prelude

import Effect.Aff (Aff, attempt)
import Effect.Class (liftEffect)
import Effect.Console as Console
import Node.FS.Aff as FS
import Node.FS.Stats as Stats
import Node.Encoding (Encoding(..))
import Data.Argonaut.Parser (jsonParser)
import Data.Either (Either(..), isRight)
import Data.Bifunctor (lmap)
import Data.Argonaut.Decode.Error (printJsonDecodeError)
import Data.Array as Array
import Data.List as List
import Data.Maybe (Maybe(..))
import Data.Traversable (traverse)
import PureScript.Backend.Optimizer.CoreFn.Json (decodeModule)
import PureScript.Backend.Optimizer.CoreFn.Sort (sortModules)
import PureScript.Backend.Optimizer.CoreFn (Module, Ann)

readCoreFnModule :: String -> Aff (Maybe (Module Ann))
readCoreFnModule filePath = do
  statRes <- attempt (FS.stat filePath)
  if isRight statRes then do
    contents <- FS.readTextFile UTF8 filePath
    case jsonParser contents >>= (lmap printJsonDecodeError <<< decodeModule) of
      Left err -> do
        liftEffect $ Console.error $ "Failed to decode " <> filePath <> ": " <> err
        pure Nothing
      Right mod -> pure (Just mod)
  else
    pure Nothing

-- | Reads and sorts all CoreFn modules from an output directory (e.g. "output")
coreFnModulesFromOutput :: String -> Aff (List.List (Module Ann))
coreFnModulesFromOutput outputDir = do
  files <- FS.readdir outputDir
  validDirs <- Array.filterA
    ( \f -> do
        stat <- FS.stat (outputDir <> "/" <> f)
        pure (Stats.isDirectory stat)
    )
    files

  mbModules <- traverse (\dir -> readCoreFnModule (outputDir <> "/" <> dir <> "/corefn.json")) validDirs
  let modulesArray = Array.catMaybes mbModules
  let modulesList = List.fromFoldable modulesArray
  pure (sortModules modulesList)
