# TODO: Résoudre la fuite d'abstraction Go (Go Leak) dans FreeVars

L'objectif est d'implémenter l'**Option 1** (Séparation par les données) pour retirer toute logique spécifique à Go (`sanitizeName`) de l'optimiseur générique.

## 1. Dans l'Optimiseur (`purescript-backend-optimizer/src/PureScript/Backend/Optimizer/FreeVars.purs`)
- [ ] **Supprimer `sanitizeName`** : Retirer la fonction et sa liste de mots-clés Go (`chan`, `defer`, `func`, etc.). L'optimiseur ne doit plus connaître Go.
- [ ] **Modifier les types de retour** :
  - `freeVars :: TcoExpr -> Set String` devient `freeVars :: TcoExpr -> Set (Tuple (Maybe Ident) Level)`.
  - `paramTypes :: TcoExpr -> Map String ExprType` devient `paramTypes :: TcoExpr -> Map (Tuple (Maybe Ident) Level) ExprType`.
- [ ] **Supprimer/Modifier `localId`** : Retirer la fonction `localId` (qui formatait en String) et modifier le parcours de l'arbre pour insérer directement les `Tuple mbIdent lvl` bruts dans les collections.

## 2. Dans le Backend (`gopurs/gopurs/src/Gopurs/CodeGen.purs`)
- [ ] **Rapatrier `sanitizeName`** : Copier-coller la fonction `sanitizeName` (et ses règles Go) depuis l'ancien `FreeVars` directement dans `CodeGen.purs`.
- [ ] **Recréer `localId`** : Créer une fonction locale `localId :: Maybe Ident -> Level -> String` qui utilise ce `sanitizeName` local (actuellement appelé par ex. ligne 1619).
- [ ] **Créer un Adapter** : Aux endroits où `CodeGen` appelle `FreeVars.freeVars` et `FreeVars.paramTypes`, ajouter un `Set.map` (ou équivalent) en utilisant le nouveau `localId` pour transformer les Tuples reçus en `Set String` ou `Map String ExprType`. Cela évite d'avoir à refactorer tout le reste du générateur de code Go.
