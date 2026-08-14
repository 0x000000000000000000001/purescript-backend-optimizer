module Test.App where

import Prelude

import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Effect.Console as Console
import Effect.Exception (throw)
import Data.Maybe (Maybe(..))
import PureScript.Backend.Optimizer.App (readCoreFnModule)
import PureScript.Backend.Optimizer.CoreFn (Module(..), ModuleName(..), Ident(..))
import Data.Array as Array

assertEqual :: forall a. Eq a => Show a => String -> a -> a -> Effect Unit
assertEqual msg expected actual = 
  if expected == actual then
    Console.log $ "✅ [" <> msg <> "] OK."
  else
    throw $ "❌ [" <> msg <> "] Assertion failed. Expected: " <> show expected <> ", got: " <> show actual

moduleNameString :: ModuleName -> String
moduleNameString (ModuleName s) = s

identString :: Ident -> String
identString (Ident s) = s

main :: Effect Unit
main = launchAff_ do
  liftEffect $ Console.log "=== Starting tcorefn Parser Sandbox ==="
  mbMod <- readCoreFnModule "output/Data.Unit/corefn.json"
  case mbMod of
    Nothing -> do
      liftEffect $ throw "❌ Failed to read or parse output/Data.Unit/corefn.json"
    Just (Module rec) -> do
      liftEffect $ Console.log "✅ Module successfully read and parsed from JSON!"
      
      -- Assertions
      liftEffect $ assertEqual "Module name" "Data.Unit" (moduleNameString rec.name)
      liftEffect $ assertEqual "Imports count" 1 (Array.length rec.imports)
      liftEffect $ assertEqual "Exports count" 1 (Array.length rec.exports)
      liftEffect $ assertEqual "Decls count" 0 (Array.length rec.decls)
      
      -- Let's check the export contains "unit"
      liftEffect $ assertEqual "First export is unit" "unit" (case Array.head rec.exports of
        Just id -> identString id
        Nothing -> "missing")
      
      liftEffect $ Console.log "🎉 All assertions passed successfully!"
