module PureScript.Backend.Optimizer.CoreFn.Json.Text (parseModule) where

import Prelude

import Data.Argonaut.Decode.Error (JsonDecodeError, printJsonDecodeError)
import Data.Argonaut.Parser (jsonParser)
import Data.Bifunctor (lmap)
import Data.Either (Either)
import PureScript.Backend.Optimizer.CoreFn (Ann, Module)
import PureScript.Backend.Optimizer.CoreFn.Json (decodeModule)
import PureScript.Backend.Optimizer.CoreFn.Usage (validateSourceUsageModule)

-- | Parse a complete document into an owned module, including type-table
-- | resolution and source-usage validation. Errors match parsing followed by
-- | decodeModule. The Go backend constructs final values through typed cursors.
parseModule :: String -> Either String (Module Ann)
parseModule = parseModuleTextImpl parseModulePS validateSourceUsageModule printJsonDecodeError

parseModulePS :: String -> Either String (Module Ann)
parseModulePS input = jsonParser input >>= (lmap printJsonDecodeError <<< decodeModule)

foreign import parseModuleTextImpl
  :: (String -> Either String (Module Ann))
  -> (Module Ann -> Either JsonDecodeError Unit)
  -> (JsonDecodeError -> String)
  -> String
  -> Either String (Module Ann)
