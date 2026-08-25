module TestErr where
import Prelude
import Data.Argonaut.Decode.Error (JsonDecodeError(..), printJsonDecodeError)
import Effect (Effect)
import Effect.Console as Console

main :: Effect Unit
main = do
  Console.log (printJsonDecodeError (AtKey "foo" (AtIndex 2 (AtIndex 0 (TypeMismatch "Expected value of type 'Object'")))))
