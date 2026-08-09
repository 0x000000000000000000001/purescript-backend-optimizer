const fs = require('fs');
const path = 'src/PureScript/Backend/Optimizer/Semantics.purs';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('unwrapTyped :: BackendSemantics -> BackendSemantics')) {
  code = code.replace(
    'evalPrimOp :: Env -> BackendOperator -> BackendSemantics',
    'unwrapTyped :: BackendSemantics -> BackendSemantics\nunwrapTyped = case _ of\n  SemTyped _ a -> unwrapTyped a\n  a -> a\n\nevalPrimOp :: Env -> BackendOperator -> BackendSemantics'
  );
}

if (!code.includes('OpNumberNum OpSubtract')) {
  code = code.replace(
    '      OpNumberNum op\n        | Just result <- evalPrimOpNumNumber op x y ->\n            result',
    '      OpNumberNum OpSubtract\n        | NeutLit (LitNumber 0.0) <- unwrapTyped (deref x) ->\n            evalPrimOp env (Op1 OpNumberNegate y)\n      OpNumberNum op\n        | Just result <- evalPrimOpNumNumber op x y ->\n            result'
  );
}

fs.writeFileSync(path, code);
