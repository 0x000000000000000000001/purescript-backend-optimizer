module PureScript.Backend.Optimizer.Utils where

import Prelude

import Data.Array.NonEmpty as NonEmptyArray
import Data.Array.NonEmpty.Internal (NonEmptyArray)
import Partial.Unsafe (unsafePartial)

-- | A highly optimized left-fold for `NonEmptyArray` that initializes the accumulator 
-- | by applying a mapping function `g` to the first element.
-- | 
-- | It avoids the overhead of `uncons` or allocating intermediate structures.
-- | Often used in the compiler to efficiently build left-leaning AST trees 
-- | (like curried function applications `(((f x) y) z)`) from a flat array, 
-- | where the first element serves as the base of the tree.
foldl1Array :: forall a b. (b -> a -> b) -> (a -> b) -> NonEmptyArray a -> b
foldl1Array f g arr = go 1 (g (NonEmptyArray.head arr))
  where
  len = NonEmptyArray.length arr
  go ix acc
    | ix == len = acc
    | otherwise =
        go (ix + 1) (f acc (unsafePartial (NonEmptyArray.unsafeIndex arr ix)))

-- | A highly optimized right-fold for `NonEmptyArray` that initializes the accumulator 
-- | by applying a mapping function `g` to the last element.
-- | 
-- | Often used to efficiently build right-leaning AST trees 
-- | (like nested `let` bindings or curried function abstractions `\x -> \y -> \z -> ...`) 
-- | from a flat array, where the last element serves as the innermost base.
foldr1Array :: forall a b. (a -> b -> b) -> (a -> b) -> NonEmptyArray a -> b
foldr1Array f g arr = go (NonEmptyArray.length arr - 2) (g (NonEmptyArray.last arr))
  where
  go ix acc
    | ix < 0 = acc
    | otherwise =
        go (ix - 1) (f (unsafePartial (NonEmptyArray.unsafeIndex arr ix)) acc)
