module Test.App where

import Prelude

import Effect (Effect)
import Effect.Aff (launchAff_)
import Effect.Class (liftEffect)
import Effect.Console as Console
import Effect.Exception (throw)
import Data.Maybe (Maybe(..))
import PureScript.Backend.Optimizer.App (readCoreFnModule)
import PureScript.Backend.Optimizer.CoreFn (Module(..), ModuleName(..), Ident(..), Qualified(..))
import Data.Array as Array
import Data.Map as Map
import Data.Set as Set
import Data.Tuple (Tuple(..))
import Node.FS.Sync as FS
import Node.Encoding (Encoding(..))
import PureScript.Backend.Optimizer.Convert (toBackendModule)
import PureScript.Backend.Optimizer.Tracer.Printer (printModuleSteps)
import Dodo as Dodo

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
  mbMod <- readCoreFnModule "output/Data.Maybe/corefn.json"
  case mbMod of
    Nothing -> do
      liftEffect $ throw "❌ Failed to read or parse output/Data.Maybe/corefn.json"
    Just coreFnMod@(Module rec) -> do
      liftEffect $ Console.log "✅ Module successfully read and parsed from JSON!"
      
      -- Let's generate the AST (BackendSyntax) and print it as a snapshot!
      let 
        toBackendOpts = 
          { analyzeCustom: \_ _ -> Nothing
          , currentModule: rec.name
          , currentLevel: 0
          , toLevel: Map.empty
          , implementations: Map.empty
          , moduleImplementations: Map.empty
          , directives: Map.empty
          , dataTypes: Map.empty
          , foreignSemantics: Map.empty
          , rewriteLimit: 10000
          , traceIdents: Set.singleton (Qualified (Just rec.name) (Ident "maybe"))
          , optimizationSteps: []
          }
        
        -- toBackendModule converts the CoreFn to the internal Optimizer AST (BackendSyntax wrapped in BackendExpr)
        Tuple optimizationSteps _backendMod = toBackendModule coreFnMod toBackendOpts
        
        -- We can use the Printer to format these steps (which contain our BackendSyntax)
        doc = printModuleSteps rec.name optimizationSteps
        formatted = Dodo.print Dodo.plainText (Dodo.twoSpaces { pageWidth = 120, ribbonRatio = 1.0 }) doc
        
      liftEffect $ do
        FS.writeTextFile UTF8 "test/snapshots/snapshot-Data.Maybe.txt" formatted
        Console.log "📸 Snapshot written to test/snapshots/snapshot-Data.Maybe.txt"
        Console.log "🎉 All done!"
