const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', 'utf8');
code = code.replace(
  '                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)',
  `                              _ = if name == "polyLoopGo" then unsafePerformEffect (log ("POLYLOOPGO DICTARGS: " <> show (Array.length info.dictArgs) <> " isStatic: " <> show (case Array.uncons info.dictArgs of\\n                                Just { head: d } -> isStatic d\\n                                Nothing -> false))) else unit
                              specializedExpr = rewriteExpr globalAstMap Map.empty substFn (monomorphizeExpr modNameStr instMap Map.empty resolvedExpr)`
);
code = 'import Effect.Unsafe (unsafePerformEffect)\nimport Effect.Console (log)\nimport Data.Show (show)\nimport Data.Array as Array\n' + code;
fs.writeFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', code);
