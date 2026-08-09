const fs = require('fs');
let code = fs.readFileSync('src/PureScript/Backend/Optimizer/Semantics.purs', 'utf8');

const target = `isZeroNumber :: BackendSemantics -> Boolean
isZeroNumber sem = case deref sem of
  NeutLit (LitNumber 0.0) -> true
  NeutApp (SemRef ref _ _) (Pair _ a)
    | Qualified _ (Ident name) <- propKey ref
    , name == "unsafeCoerce" -> isZeroNumber a
  NeutApp (SemRef ref _ _) (Pair _ a)
    | Qualified _ (Ident name) <- propKey ref
    , name == "magicDict" -> isZeroNumber a
  _ -> false`;

const replacement = `isZeroNumber :: BackendSemantics -> Boolean
isZeroNumber sem = case deref sem of
  NeutLit (LitNumber 0.0) -> true
  NeutApp hd [a]
    | SemRef ref _ _ <- deref hd
    , Qualified _ (Ident name) <- propKey ref
    , name == "unsafeCoerce" -> isZeroNumber a
  NeutApp hd [a]
    | SemRef ref _ _ <- deref hd
    , Qualified _ (Ident name) <- propKey ref
    , name == "magicDict" -> isZeroNumber a
  _ -> false`;

code = code.replace(target, replacement);
fs.writeFileSync('src/PureScript/Backend/Optimizer/Semantics.purs', code);
