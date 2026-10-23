module PureScript.Backend.Optimizer.Observation (Reads, View, Observation, create, createWithAvailability) where

import Prelude

import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Effect (Effect)
import Effect.Ref as Ref
import Effect.Unsafe (unsafePerformEffect)
import PureScript.Backend.Optimizer.Convert (ExternLookup(..), PurmetaLookup)
import PureScript.Backend.Optimizer.CoreFn (Ident(..), ModuleName(..), Qualified(..))
import PureScript.Backend.Optimizer.Semantics (DirectiveLookup, EvalRef(..), InlineAccessor, InlineDirective, InlineDirectiveMap)
import PureScript.Backend.Optimizer.Semantics as Semantics

type Reads =
  { implementations :: Map (Qualified Ident) Boolean
  , directives :: Map (Qualified Ident) (Maybe (Map InlineAccessor InlineDirective))
  }

-- Immutable rank-filtered input of one attempt. Directive reads also register
-- unfinished predecessors, even when InlineNever prevents an implementation read.
type View =
  { implementation :: PurmetaLookup
  -- True only for a strictly earlier, finalized owner in this attempt's
  -- immutable snapshot. This does not load its implementation contribution.
  , availableOwner :: String -> Boolean
  , directive :: Qualified Ident -> Maybe (Map InlineAccessor InlineDirective)
  , pending :: Effect Boolean
  }

type Observation =
  { view :: View
  , implementation :: PurmetaLookup
  , directive :: DirectiveLookup
  , read :: Effect Reads
  }

create :: ModuleName -> PurmetaLookup -> InlineDirectiveMap -> (ModuleName -> Effect Unit) -> Effect Boolean -> Effect Observation
create = createWithAvailability (const false)

createWithAvailability :: (String -> Boolean) -> ModuleName -> PurmetaLookup -> InlineDirectiveMap -> (ModuleName -> Effect Unit) -> Effect Boolean -> Effect Observation
createWithAvailability availableOwner current raw implementationsDirectives awaitModule pending = do
  reads <- Ref.new { implementations: Map.empty, directives: Map.empty }
  let
    initial qual@(Qualified owner _) = unsafePerformEffect do
      case owner of
        Just name | name /= current -> awaitModule name
        _ -> pure unit
      pure (Semantics.lookupDirective (EvalExtern qual) implementationsDirectives)
    implementation moduleName ident =
      let value = raw moduleName ident
          qual = Qualified (Just (ModuleName moduleName)) (Ident ident)
      in unsafePerformEffect do
        when (ModuleName moduleName /= current) do
          previous <- Ref.read reads
          unless (Map.member qual previous.implementations) $
            Ref.modify_ (\state -> state { implementations = Map.insert qual (case value of
              ExternFound _ -> true
              _ -> false) state.implementations }) reads
        pure value
    directive ref actual = unsafePerformEffect do
      case ref of
        EvalExtern qual@(Qualified (Just owner) _) | owner /= current -> do
          previous <- Ref.read reads
          unless (Map.member qual previous.directives) do
            let value = initial qual
            Ref.modify_ (\state -> state { directives = Map.insert qual value state.directives }) reads
        _ -> pure unit
      pure (Semantics.lookupDirective ref actual)
  pure { view: { implementation: raw, availableOwner, directive: initial, pending }, implementation, directive, read: Ref.read reads }
