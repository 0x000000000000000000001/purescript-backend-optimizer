import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target = """monomorphize :: Map String (Binding Ann) -> InstantiationMap -> Module Ann -> Module Ann
monomorphize globalAstMap instMap (Module m) =
  let
    modNameStr = unwrap m.name
    decls' = Array.concatMap (monomorphizeBind modNameStr instMap Map.empty) m.decls"""

replacement = """monomorphize :: Map String (Binding Ann) -> InstantiationMap -> Module Ann -> Module Ann
monomorphize globalAstMap instMap (Module m) =
  let
    modNameStr = unwrap m.name
    filteredInstMap = Map.filterWithKey (\\k _ -> Map.member k globalAstMap) instMap
    decls' = Array.concatMap (monomorphizeBind modNameStr filteredInstMap Map.empty) m.decls"""

content = content.replace(target, replacement)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
