module TestST where

import Prelude
import Control.Monad.ST as ST
import Control.Monad.ST.Ref as STRef

test :: Int
test = ST.run do
  r <- STRef.new 0
  STRef.read r
