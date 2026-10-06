// Differential checks at Convert's public boundary, including adversarial names.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const output = resolve(process.argv[2] ?? 'output');
const [C, Convert, Sem, Native, M, Set, Maybe, Ord, Ordering, U] = await Promise.all([
  'PureScript.Backend.Optimizer.CoreFn', 'PureScript.Backend.Optimizer.Convert',
  'PureScript.Backend.Optimizer.Semantics', 'PureScript.Backend.Optimizer.NativeMaps',
  'Data.Map', 'Data.Set', 'Data.Maybe', 'Data.Ord', 'Data.Ordering', 'Data.Unfoldable',
].map(name => import(pathToFileURL(resolve(output, name, 'index.js')))));
const nothing = Maybe.Nothing.value, entries = M.toUnfoldable(U.unfoldableArray);
const insert = M.insert(Sem.ordEvalRef);
const modules = ['', 'A', 'A\0', 'A.B', 'A0', 'Z', 'é', '𐐀', '\ud800', '\udfff', '\uffff'];
const inner = M.singleton(Sem.InlineRef.value)(Sem.InlineAlways.value);
let directives = M.empty;
for (const name of modules) for (const ident of ['', 'x', 'x\0', 'y', '𐐀'])
  directives = insert(new Sem.EvalExtern(new C.Qualified(new Maybe.Just(name), ident)))(inner)(directives);
directives = insert(new Sem.EvalExtern(new C.Qualified(nothing, 'unqualified')))(inner)(directives);
directives = insert(new Sem.EvalLocal(new Maybe.Just('local'), 0))(inner)(directives);

test('Convert publishes exactly its own module range without changing inherited directives', () => {
  const before = entries(directives);
  for (const name of [...modules, 'Absent', 'A.A', 'A\0x']) {
    const mod = { name, path: `${name}.purs`, span: C.emptySpan, imports: [], exports: [],
      reExports: [], dataDecls: [], classDecls: [], foreign: M.empty, comments: [], decls: [] };
    const options = { instantiateNeutral: Sem.instantiateNeutralType, analyzeCustom: () => () => nothing,
      currentModule: name, currentLevel: 0, toLevel: M.empty, implementations: M.empty,
      moduleImplementations: M.empty, optimizationSteps: [], directives, dataTypes: M.empty,
      foreignSemantics: M.empty, rewriteLimit: 100, traceIdents: Set.empty };
    const actual = Convert.toBackendModule(mod)(options).value1.directives;
    const expected = M.filterKeys(Sem.ordEvalRef)(key => key instanceof Sem.EvalExtern &&
      key.value0.value0 instanceof Maybe.Just && key.value0.value0.value0 === name)(directives);
    assert.deepEqual(entries(actual), entries(expected), JSON.stringify(name));
    assert.deepEqual(entries(directives), before);
  }
});

test('range fallback preserves inclusive membership for empty, narrow and full ranges', () => {
  let map = M.empty;
  for (let i = -64; i < 64; i++) map = M.insert(Ord.ordInt)(i)(i * 3)(map);
  const original = entries(map);
  for (const [low, high] of [[-100, 100], [0, 0], [-100, -99], [99, 100], [-9, 17], [2, 1]]) {
    const classify = key => key < low ? Ordering.LT.value : key > high ? Ordering.GT.value : Ordering.EQ.value;
    const actual = Native.filterRange(Ord.ordInt)(classify)(map);
    assert.deepEqual(entries(actual), original.filter(({ value0 }) => value0 >= low && value0 <= high));
  }
  assert.deepEqual(entries(map), original);
});
