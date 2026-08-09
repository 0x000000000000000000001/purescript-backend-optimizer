const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Semantics.purs', 'utf8');

const target = `      OpNumberNum OpSubtract
        | NeutLit (LitNumber 0.0) <- deref x ->
            evalPrimOp env (Op1 OpNumberNegate y)
`;
const replacement = `      OpNumberNum OpSubtract
        | isZeroNumber x ->
            evalPrimOp env (Op1 OpNumberNegate y)
`;

code = code.replace(target, replacement);

const isZeroNumberFunc = `
isZeroNumber :: BackendSemantics -> Boolean
isZeroNumber sem = case deref sem of
  NeutLit (LitNumber 0.0) -> true
  NeutApp _ (SemRef ref _ _) (Pair _ a)
    | Qualified _ (Ident name) <- propKey ref
    , name == "unsafeCoerce" -> isZeroNumber a
  NeutApp _ (SemRef ref _ _) (Pair _ a)
    | Qualified _ (Ident name) <- propKey ref
    , name == "magicDict" -> isZeroNumber a
  _ -> false
`;

code = code + isZeroNumberFunc;

fs.writeFileSync('src/PureScript/Backend/Optimizer/Semantics.purs', code);
