# Différences avec l'Upstream (Arista Networks)

Ce document liste les changements majeurs entre le dépôt officiel d'Arista Networks et ce fork (`main`). Le fork transforme radicalement l'outil d'origine pour en faire un compilateur fortement typé (AOT).

### 1. 🚀 Les Nouvelles Passes d'Optimisation
Ces fichiers n'existent tout simplement pas chez Arista, ce sont des ajouts purs de cette architecture :
*   **`[NOUVEAU]` `Monomorphize.purs` (+767 lignes)** : Le mastodonte. C'est l'usine à clones qui élimine les Type Classes (DPE) et dévirtualise le code polymorphe pour de meilleures performances.
*   **`[NOUVEAU]` `FreeVars.purs` (+148 lignes)** : L'analyseur de portée. Essentiel pour extraire l'environnement (variables libres) avant de générer des closures.
*   **`[NOUVEAU]` `Substitute.purs` (+199 lignes)** : Le moteur mathématique d'unification et de substitution de variables de types, utilisé par `Monomorphize`.
*   **`[NOUVEAU]` `Reachability.purs` (+69 lignes)** : Un analyseur inédit pour vérifier l'accessibilité du code (Dead Code Elimination approfondi).

### 2. 🧬 La Révolution du TAST (Le typage fort)
L'upstream utilise le `CoreFn` standard de PureScript (où les types sont effacés). Ce fork a été lourdement modifié pour comprendre le `tcorefn` (TAST) :
*   **`[MODIFIÉ]` `CoreFn.purs` et `CoreFn/Json.purs` (~460 lignes modifiées)** : Ajout du parsing du TAST. Conservation de `ann.type`, lecture globale de `dataDecls` et `classDecls`, support de `ForAll` et `ConstrainedType`. C'est le socle fondamental qui rend la monomorphisation possible.

### 3. ⚙️ Le Cœur du Moteur
*   **`[MODIFIÉ]` `Semantics.purs` (~480 lignes modifiées)** : L'inliner a été fortement revu (plus agressif, gestion des nouveaux nœuds/types introduits).
*   **`[MODIFIÉ]` `Convert.purs` (~450 lignes modifiées)** : La traduction depuis le `CoreFn` a été adaptée pour gérer les types explicites et la nouvelle structure de l'arbre.
*   **`[MODIFIÉ]` `Syntax.purs` (~190 lignes modifiées)** : L'AST interne de l'optimiseur (`BackendSyntax`) a été enrichi pour supporter de nouvelles informations sémantiques.
*   **`[MODIFIÉ]` `Builder.purs` (~50 lignes modifiées)** : Le chef d'orchestre a été mis à jour pour insérer les nouveaux modules (`Monomorphize`, `FreeVars`) dans la chaîne de montage.
*   **`[MODIFIÉ]` `Codegen/Tco.purs` (~90 lignes modifiées)** : Ajustements sur la Tail Call Optimization.

### 4. 🛠️ L'Outillage et l'Intégration
*   **`[NOUVEAU]` `FfiSupport.purs` & `.js` (+164 lignes)** : Ajout du support FFI avec des utilitaires (comme `hashString` utilisé pour "mangler" les noms de fonctions clonées dans `Monomorphize`).
*   **`[NOUVEAU]` `App.purs` & `.js` (+160 lignes)** : Réécriture du point d'entrée/CLI de l'application.
*   **`[NOUVEAU]` Scripts de patching (`patch_compiler.cjs`, `patch_convert.cjs`, `patch_tco.sh`, etc.)** : À la racine du projet, de nouveaux scripts (bash/JS) ont été ajoutés pour patcher l'environnement de compilation "à la volée".
