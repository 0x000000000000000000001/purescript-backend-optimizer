module PureScript.Backend.Optimizer.BoundedMemo (createBoundedMemo, createStringMemo) where

import Data.Function.Uncurried (Fn2)
import Effect (Effect)

-- | A private, bounded cache for immutable compiler inputs. Run the Effect once
-- | per module; the callback must be pure and its result must stay immutable.
foreign import createBoundedMemo
  :: forall a b c. Int -> Fn2 a b c -> Effect (a -> b -> c)

-- | Like createBoundedMemo, with keys compared by string contents on every
-- | backend, including when native generic values otherwise use boxed identity.
foreign import createStringMemo
  :: forall a. Int -> Fn2 String String a -> Effect (String -> String -> a)
