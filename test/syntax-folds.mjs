// node test/syntax-folds.mjs PATH_TO_COMPILED_OUTPUT
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const output = resolve(process.argv[2] ?? 'output');
const [S, C, F, M, Tuple] = await Promise.all([
  'PureScript.Backend.Optimizer.Syntax', 'PureScript.Backend.Optimizer.CoreFn',
  'Data.Foldable', 'Data.Maybe', 'Data.Tuple',
].map(name => import(pathToFileURL(resolve(output, name, 'index.js')))));
const tuple = (a, b) => new Tuple.Tuple(a, b);
const qualified = new C.Qualified(new M.Just('FoldFixture'), 'value');
const bindings = [tuple(new M.Just('argument'), 0)];
const fixtures = [
  [new S.Var(qualified), []], [new S.Local(M.Nothing.value, 0), []],
  ...[new C.LitInt(3), new C.LitNumber(-0), new C.LitString('x'), new C.LitChar('x'), new C.LitBoolean(true)]
    .map(literal => [new S.Lit(literal), []]),
  [new S.Lit(new C.LitArray([1, 2, 3])), [1, 2, 3]],
  [new S.Lit(new C.LitRecord([new C.Prop('z', 1), new C.Prop('a', 2)])), [1, 2]],
  [new S.App(1, [2, 3]), [1, 2, 3]], [new S.TypeApp(1, C.Any.value), [1]],
  [new S.Abs(bindings, 1), [1]], [new S.UncurriedApp(1, [2, 3]), [1, 2, 3]],
  [new S.UncurriedApp(1, []), [1]], [new S.UncurriedAbs(bindings, 1), [1]],
  [new S.UncurriedEffectApp(1, [2, 3]), [1, 2, 3]], [new S.UncurriedEffectAbs(bindings, 1), [1]],
  [new S.Accessor(1, new S.GetIndex(2)), [1]],
  [new S.Update(1, [new C.Prop('z', 2), new C.Prop('a', 3)]), [1, 2, 3]],
  [new S.LetRec(0, [tuple('x', 1), tuple('y', 2)], 3), [1, 2, 3]],
  [new S.Let(M.Nothing.value, 0, 1, 2), [1, 2]],
  [new S.EffectBind(M.Nothing.value, 0, 1, 2), [1, 2]],
  [new S.EffectPure(1), [1]], [new S.EffectDefer(1), [1]],
  [new S.Branch([new S.Pair(1, 2), new S.Pair(3, 4)], 5), [1, 2, 3, 4, 5]],
  [new S.PrimOp(new S.Op1(S.OpBooleanNot.value, 1)), [1]],
  [new S.PrimOp(new S.Op2(S.OpArrayIndex.value, 1, 2)), [1, 2]],
  [new S.PrimEffect(new S.EffectRefNew(1)), [1]],
  [new S.PrimEffect(new S.EffectRefRead(1)), [1]],
  [new S.PrimEffect(new S.EffectRefWrite(1, 2)), [1, 2]],
  [S.PrimUndefined.value, []],
  [new S.CtorSaturated(qualified, C.SumType.value, 'Shape', 'Cell', [tuple('x', 1), tuple('y', 2)]), [1, 2]],
  [new S.CtorDef(C.SumType.value, 'Shape', 'Cell', ['x']), []],
  [new S.Fail('failed'), []], [new S.Typed(C.Any.value, 1), [1]],
];

function check(dictionary, fixture, children) {
  const left = acc => value => `(${acc}+${value})`;
  const right = value => acc => `(${value}+${acc})`;
  assert.equal(dictionary.foldl(left)('z')(fixture), children.reduce((a, x) => left(a)(x), 'z'));
  assert.equal(dictionary.foldr(right)('z')(fixture), children.reduceRight((a, x) => right(x)(a), 'z'));
  assert.equal(dictionary.foldl(left)('z')(fixture), F.foldlDefault(dictionary)(left)('z')(fixture));
  assert.equal(dictionary.foldr(right)('z')(fixture), F.foldrDefault(dictionary)(right)('z')(fixture));
  const seen = [];
  dictionary.foldl(acc => value => { seen.push(value); return acc; })(null)(fixture);
  assert.deepEqual(seen, children);
  seen.length = 0;
  dictionary.foldr(value => acc => { seen.push(value); return acc; })(null)(fixture);
  assert.deepEqual(seen, [...children].reverse());
}

test('all syntax constructors preserve fold direction, child order and multiplicity', () => {
  for (const [fixture, children] of fixtures) check(S.foldableBackendSyntax, fixture, children);
});
test('operators and effects preserve their standalone fold contracts', () => {
  for (const [fixture, children] of fixtures) {
    if (fixture instanceof S.PrimOp) check(S.foldableBackendOperator, fixture.value0, children);
    if (fixture instanceof S.PrimEffect) check(S.foldableBackendEffect, fixture.value0, children);
  }
});
test('empty and wide child containers agree with the generic fold oracle', () => {
  for (const length of [0, 1, 2, 17, 257, 4096]) {
    const children = Array.from({ length }, (_, i) => i);
    check(S.foldableBackendSyntax, new S.Lit(new C.LitArray(children)), children);
    check(S.foldableBackendSyntax, new S.Lit(new C.LitRecord(children.map(i => new C.Prop('field' + i, i)))), children);
  }
});
