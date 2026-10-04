// After building gopurs: node test/module-sort.mjs ../gopurs/gopurs/output
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../output/', import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, 'index.js')));
const [Sort, C, F, List, Array] = await Promise.all([
  'PureScript.Backend.Optimizer.CoreFn.Sort', 'PureScript.Backend.Optimizer.CoreFn',
  'Data.Foldable', 'Data.List.Types', 'Data.Array',
].map(load));
const moduleOf = (name, imports = []) => ({ name, imports: imports.map(name => new C.Import(C.emptySpan, name)) });
const sort = modules => Array.fromFoldable(List.foldableList)(Sort.sortModules(F.foldableArray)(modules)).map(m => m.name);
function* permutations(values) {
  if (!values.length) { yield []; return; }
  for (let i = 0; i < values.length; i++) {
    for (const rest of permutations(values.filter((_, j) => j !== i))) yield [values[i], ...rest];
  }
}

test('module ranks are independent of directory enumeration, preserving dependency order', () => {
  const modules = [
    moduleOf('Control.Bind', ['Data.Unit', 'Prim', 'Control.Bind']),
    moduleOf('Data.Bounded', ['Data.Unit']),
    moduleOf('Data.Unit'),
    moduleOf('Data.String.CaseInsensitive', ['Data.Unit']),
    moduleOf('Test.Assert', ['Data.Unit']),
    moduleOf('Test.Main', ['Test.Assert', 'Data.String.CaseInsensitive', 'Control.Bind']),
  ];
  const expected = ['Data.Unit', 'Control.Bind', 'Data.Bounded', 'Data.String.CaseInsensitive', 'Test.Assert', 'Test.Main'];
  let count = 0;
  for (const input of permutations(modules)) {
    assert.deepEqual(sort(input), expected, input.map(m => m.name).join(', '));
    count++;
  }
  assert.equal(count, 720);
  assert.deepEqual(sort([]), []);
});

test('self imports and cycles are visited once with stable ranks', () => {
  const modules = [moduleOf('A', ['B', 'A']), moduleOf('B', ['A']), moduleOf('C', ['B'])];
  for (const input of permutations(modules)) assert.deepEqual(sort(input), ['B', 'A', 'C']);
});
