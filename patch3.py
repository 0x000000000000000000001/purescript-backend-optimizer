import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target = """                else
                  let
                    specializedName = Ident (name <> "__" <> hashString (mangleType (defaultToAny instType)))
                  in
                    case Map.lookup qualName instMap of
                      Just _ ->"""

replacement = """                else
                  let
                    specializedName = Ident (name <> "__" <> hashString (mangleType (defaultToAny instType)))
                    _ = if String.contains (Pattern "polyLoopGo") name then trace ("polyLoopGo in monomorphizeExpr: ELSE branch!") (\\_ -> unit) else unit
                  in
                    case Map.lookup qualName instMap of
                      Just _ ->"""

content = content.replace(target, replacement)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
