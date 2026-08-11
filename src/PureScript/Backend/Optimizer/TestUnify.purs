module PureScript.Backend.Optimizer.TestUnify where
import Prelude
import Data.Map as Map
import Effect (Effect)
import Effect.Console as Console
import PureScript.Backend.Optimizer.CoreFn (ExprType(..))
import PureScript.Backend.Optimizer.Substitute (unify)

main :: Effect Unit
main = do
  let genericType = Func [ADT "Data.Void.Void" ["Data.Void.Void"] []] (TypeVar "a")
      concrete = Func [ADT "Data.Void.Void" ["Data.Void.Void"] []] (ADT "Data.Argonaut.Core.Json" ["Data.Argonaut.Core.Json"] [])
      subst = unify genericType concrete Map.empty
  Console.log $ "subst is empty? " <> show (Map.isEmpty subst)
