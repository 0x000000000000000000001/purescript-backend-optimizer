import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target = """monomorphize :: Map String Binding -> InstantiationMap -> Module Ann -> Module Ann
monomorphize globalAstMap instMap (Module m) =
  let
    modNameStr = unwrap m.name

    decls' = Array.concatMap (monomorphizeBind modNameStr instMap Map.empty) m.decls"""

replacement = """monomorphize :: Map String Binding -> InstantiationMap -> Module Ann -> Module Ann
monomorphize globalAstMap instMap (Module m) =
  let
    modNameStr = unwrap m.name
    filteredInstMap = Map.filterWithKey (\\k _ -> Map.member k globalAstMap) instMap
    decls' = Array.concatMap (monomorphizeBind modNameStr filteredInstMap Map.empty) m.decls"""

content = content.replace(target, replacement)

# Replace all instances of `instMap` with `filteredInstMap` inside the `injectedBinds` array concatMap
target2 = """                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)"""
replacement2 = """                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr filteredInstMap Map.empty resolvedExpr)"""

content = content.replace(target2, replacement2)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
