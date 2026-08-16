-- | Utilitaires de Débogage (Debug.purs)
-- | Fonctions d'injection de logs (traceWhen, spyWhen) et de profilage temporel (time). Fournit un système conditionnel permettant de logger des états internes du compilateur si et seulement si les flags de débogage sont activés, minimisant l'impact sur les performances en mode production.

module PureScript.Backend.Optimizer.Debug (traceWhen, spyWhen, time) where

import Prelude

import Debug (class DebugWarning)

traceWhen :: forall a b. DebugWarning => Boolean -> a -> b -> b
traceWhen bool a b = if bool then traceImpl a \_ -> b else b

spyWhen :: forall a. DebugWarning => Boolean -> a -> a
spyWhen bool a = traceWhen bool a a

foreign import time_ :: forall a. String -> (Unit -> a) -> a

foreign import traceImpl :: forall a b. a -> (Unit -> b) -> b

time :: forall a. DebugWarning => String -> (Unit -> a) -> a
time = time_
