module PureScript.Backend.Optimizer.App
  ( coreFnModulesFromOutput
  , readCoreFnModule
  , CLIArgs
  , parseCLIArgs
  , checkCache
  , writeCache
  , loadDirectives
  ) where

import Prelude

import Effect (Effect)

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
import Data.Maybe (Maybe(..), isJust)
import Data.Traversable (traverse)
import PureScript.Backend.Optimizer.CoreFn.Json (decodeModule)
import PureScript.Backend.Optimizer.CoreFn.Sort (sortModules)
import PureScript.Backend.Optimizer.CoreFn (Module, Ann)
import Data.String as String
import Data.String.Pattern (Pattern(..))
import Data.Map (Map)
import PureScript.Backend.Optimizer.Directives (parseDirectiveFile)
import PureScript.Backend.Optimizer.Directives.Defaults (defaultDirectives)
import PureScript.Backend.Optimizer.Semantics (InlineDirectiveMap)

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

type CLIArgs =
  { mbMainModule :: Maybe String
  , mbAutoloadPath :: Maybe String
  , mbFfiDir :: Maybe String
  , bundle :: Boolean
  }

parseCLIArgs :: Array String -> CLIArgs
parseCLIArgs argsRaw =
  let
    args = Array.concatMap (\s -> String.split (Pattern " ") s) argsRaw
    getArg key = case Array.elemIndex key args of
      Just i -> Array.index args (i + 1)
      Nothing -> Nothing
  in
    { mbMainModule: getArg "--main"
    , mbAutoloadPath: getArg "--autoload-path"
    , mbFfiDir: getArg "--ffi"
    , bundle: isJust (Array.elemIndex "--bundle" args)
    }

foreign import stringify :: forall a. String -> a -> String
foreign import parseImpl :: forall a. (a -> Maybe a) -> Maybe a -> String -> String -> Maybe a

parse :: forall a. String -> String -> Maybe a
parse version = parseImpl Just Nothing version

-- | Checks if the corefn file hasn't been modified since the cache was written.
-- | Returns Just BackendModule if cache is hit, Nothing otherwise.
checkCache :: forall a. String -> String -> String -> Aff (Maybe a)
checkCache version corefnPath cachePath = do
  corefnStatRes <- attempt (FS.stat corefnPath)
  cacheStatRes <- attempt (FS.stat cachePath)
  case corefnStatRes, cacheStatRes of
    Right corefnStat, Right cacheStat | Stats.modifiedTimeMs cacheStat >= Stats.modifiedTimeMs corefnStat -> do
      cacheContent <- FS.readTextFile UTF8 cachePath
      pure (parse version cacheContent)
    _, _ -> pure Nothing

-- | Writes a BackendModule to the cache file.
writeCache :: forall a. String -> String -> a -> Aff Unit
writeCache version cachePath backendMod = do
  FS.writeTextFile UTF8 cachePath (stringify version backendMod)

-- | Loads and parses default directives, printing any errors to the console
loadDirectives :: Aff InlineDirectiveMap
loadDirectives = do
  let parsedDirectives = parseDirectiveFile defaultDirectives
  when (not (Array.null parsedDirectives.errors)) do
    liftEffect $ Console.log "DIRECTIVE PARSE ERRORS"
    -- could iterate and print errors here if needed
  pure parsedDirectives.directives
