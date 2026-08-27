const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', 'utf8');
code = code.replace(
    'let _ = if name == "mempty" then unsafePerformEffect (Effect.Class.Console.log ("mempty SKIPPED monomorphization! genericType hasVars: " <> show (hasTypeVariables genericType) <> ", instType hasVars: " <> show (hasTypeVariables instType))) else unit',
    'let _ = if name == "mempty" then unsafePerformEffect (Effect.Class.Console.log ("mempty SKIPPED! args length: " <> show (Array.length args\'))) else unit'
);
fs.writeFileSync('src/PureScript/Backend/Optimizer/Monomorphize.purs', code);
