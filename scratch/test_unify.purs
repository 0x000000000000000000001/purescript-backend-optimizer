module TestUnify where
import Prelude
import Data.Map as Map
import Effect (Effect)
import Effect.Console (logShow)
import PureScript.Backend.Optimizer.Substitute (unify)
import PureScript.Backend.Optimizer.CoreFn (ExprType(..))

main :: Effect Unit
main = do
  let f_a_to_f_b = Func [TypeApp (TypeVar "f") [TypeVar "a"]] (TypeApp (TypeVar "f") [TypeVar "b"])
  let step_any_to_step_unit = Func [TypeApp (TypeConstructor "Data.List.Lazy.Types.Step") [Any]] (TypeApp (TypeConstructor "Data.List.Lazy.Types.Step") [Unit])
  logShow (unify f_a_to_f_b step_any_to_step_unit Map.empty)
