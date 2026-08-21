import sys

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "r") as f:
    content = f.read()

target = """            _ -> rebuildApp (Ann ann) f' args'
        _ -> rebuildApp (Ann ann) f' args'"""

replacement = """            _ ->
              let traceResult = if String.contains (Pattern "polyLoopGo") name then trace ("polyLoopGo in monomorphizeExpr: extractFuncType returned Nothing!") (\\_ -> unit) else unit
              in case traceResult of _ -> rebuildApp (Ann ann) f' args'
        _ -> rebuildApp (Ann ann) f' args'"""

content = content.replace(target, replacement)

with open("src/PureScript/Backend/Optimizer/Monomorphize.purs", "w") as f:
    f.write(content)
