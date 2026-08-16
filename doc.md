# Architecture du Pipeline de Compilation (purescript-backend-optimizer)

Voici le pipeline de compilation complet, de bout en bout, tel que l'orchestre le `Builder.purs`. C'est une chaîne de montage en entonnoir :

## 1. La Matière Première : `CoreFn`
C'est le point de départ. Le compilateur standard de PureScript livre l'AST (le code) avec tous ses types complexes, ses génériques, et ses dictionnaires de Type Classes.

## 2. Le Chef d'Orchestre : `Builder.purs`
Il prend la liste de tous les fichiers du projet (triés topologiquement, du plus bas niveau au plus haut). Il gère le cache et passe chaque fichier, un par un, dans la chaîne de montage ci-dessous.

## 3. La Spécialisation : `Monomorphize.purs`
*   **Entrée :** `CoreFn` (générique)
*   **Action :** Il lit les types, clone les fonctions génériques pour chaque type concret utilisé (ex: de `a -> a` vers `Int -> Int`), et détruit les dictionnaires (DPE). Il prépare le terrain via l'eta-expansion.
*   **Sortie :** `CoreFn` (statique et spécialisé)

## 4. La Traduction : `Convert.purs`
*   **Entrée :** `CoreFn` (statique)
*   **Action :** Le grand nettoyage. Le système de types très lourd de PureScript ne sert plus à rien pour l'exécution. `Convert` abandonne la théorie et transforme le `CoreFn` en un arbre syntaxique orienté "machine" appelé `BackendSyntax`.
*   **Sortie :** `BackendSyntax` brut.

## 5. L'Inliner et le Broyeur : `Semantics.purs`
*   **Entrée :** `BackendSyntax` brut.
*   **Action :** Le rouleau compresseur. C'est ici que se fait l'inlining, le constant folding, et l'élimination du code mort. C'est ici que l'application partielle locale est détruite et fusionnée via la bêta-réduction. L'inliner parcourt l'arbre en boucle jusqu'à ce qu'il n'y ait plus rien à optimiser.
*   **Sortie :** `BackendSyntax` (ultra optimisé).

## 6. L'Optimisation des Boucles & Appels : `Codegen/Tco.purs` (ou `Tco.purs`)
*   **Entrée :** `BackendSyntax` (ultra optimisé).
*   **Action :** Modifie l'arbre pour éviter les Stack Overflows. Il transforme les fonctions récursives terminales (Tail Recursion) en simples boucles. C'est aussi ici que les applications imbriquées sont définitivement transformées en structures à plat (`UncurriedApp`).
*   **Sortie :** `TcoExpr` (l'AST quasi final).

## 7. L'Analyse Mémorielle : `FreeVars.purs`
*   **Entrée :** `TcoExpr`.
*   **Action :** Ne modifie pas le code. Fait une passe d'inspection pour lister toutes les "variables libres" (le contexte) de chaque fonction. C'est vital pour que le backend sache exactement quelles variables emprisonner quand il devra générer une vraie closure.
*   **Sortie :** `TcoExpr` + le `Set` de variables libres.

## 8. L'Impression Finale : Backend Cible (ex: `Gopurs/CodeGen.purs`)
*   **Entrée :** L'arbre `TcoExpr` parfait et l'analyse de `FreeVars`.
*   **Action :** Fin du pipeline générique. Le backend spécifique prend le relais et traduit cet arbre pur en chaînes de caractères brutes (du texte `.go`, `.php`, ou `.java`).

*L'inlining (`Semantics`) est placé stratégiquement à l'étape 5 : juste après avoir perdu la lourdeur des types (`Convert`), mais juste avant que l'on fige la structure des boucles et des closures (`Tco` et `FreeVars`).*
