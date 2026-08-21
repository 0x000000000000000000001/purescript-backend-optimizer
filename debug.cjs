const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', 'utf8');
code = code.replace(
  '                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)',
  `                              _ = if name == "polyLoopGo" then unsafePerformEffect (log ("POLYLOOPGO DICTARGS: " <> show (Array.length info.dictArgs))) else unit
                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)`
);
fs.writeFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', code);
