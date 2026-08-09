const fs = require('fs');
const path = 'src/PureScript/Backend/Optimizer/Semantics.purs';
let code = fs.readFileSync(path, 'utf8');
code = code.replace(
  'evalPrimOpNumNumber :: BackendOperatorNum -> BackendSemantics -> BackendSemantics -> Maybe BackendSemantics\nevalPrimOpNumNumber op x y',
  'evalPrimOpNumNumber :: BackendOperatorNum -> BackendSemantics -> BackendSemantics -> Maybe BackendSemantics\nevalPrimOpNumNumber op x y\n  | let _ = Effect.Unsafe.unsafePerformEffect (Effect.Console.log (show op <> " " <> show (unwrapTyped (deref x)) <> " " <> show (unwrapTyped (deref y)))) = Nothing\nevalPrimOpNumNumber op x y'
);
fs.writeFileSync(path, code);
