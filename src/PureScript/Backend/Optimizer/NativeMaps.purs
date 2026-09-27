-- | Entrées `Data.Map` à comparateur natif (backend Go).
-- |
-- | Ces FFI sont volontairement séparées de `FfiSupport` : le test
-- | `test/native-ffi-support.mjs` compile `FfiSupport.go` seul, alors que ce
-- | module dépend du B-tree de `gopurs-ordered-collections` et des
-- | constructeurs générés (`Data.Maybe`, `Qualified`) présents dans le paquet
-- | `purescript` de la sortie native.
module PureScript.Backend.Optimizer.NativeMaps
  ( QualifiedIdentCompare
  , qualifiedIdentCompare
  , lookupQualifiedIdentImpl
  , insertQualifiedIdentImpl
  , StringCompare
  , stringCompare
  , lookupStringImpl
  , insertStringImpl
  ) where

import Prelude

import Data.Map (Map)
import Data.Maybe (Maybe)

-- | Comparateur natif des clés `Qualified Ident`. Côté Go c'est une fonction
-- | `func(a, b interface{}) int` qui déballe directement la représentation
-- | mémoire (`Qualified[string]` décodé du CoreFn ou `Qualified[Value]` des
-- | valeurs construites par l'optimiseur : module puis ident), sans traverser
-- | les dictionnaires `Ord` boxés. Côté JS la valeur est inutilisée : les
-- | entrées retombent sur `Data.Map`.
foreign import data QualifiedIdentCompare :: Type

foreign import qualifiedIdentCompare :: QualifiedIdentCompare

-- | `lookup` d'une `Map (Qualified Ident)` avec le comparateur natif. Le
-- | paramètre de type `k` est concrètement `Qualified Ident` ; il reste
-- | générique ici pour éviter un cycle d'imports avec `CoreFn`.
foreign import lookupQualifiedIdentImpl :: forall k a. QualifiedIdentCompare -> k -> Map k a -> Maybe a

-- | `insert` d'une `Map (Qualified Ident)` avec le comparateur natif.
foreign import insertQualifiedIdentImpl :: forall k a. QualifiedIdentCompare -> k -> a -> Map k a -> Map k a

-- | Comparateur natif des clés `String` (et de leurs newtypes `Ident`,
-- | `ModuleName`, `ProperName`…) : `strings.Compare` sur la chaîne déballée,
-- | sans dictionnaire `Ord`.
foreign import data StringCompare :: Type

foreign import stringCompare :: StringCompare

foreign import lookupStringImpl :: forall k a. StringCompare -> k -> Map k a -> Maybe a

foreign import insertStringImpl :: forall k a. StringCompare -> k -> a -> Map k a -> Map k a
