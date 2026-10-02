// After building PBO: node test/purmeta-budget.mjs [compiled-output-directory]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const output = process.argv[2] ? path.resolve(process.argv[2]) : fileURLToPath(new URL('../output/', import.meta.url));
const load = name => import(pathToFileURL(path.join(output, name, 'index.js')));
const [Cache, Maybe] = await Promise.all(['PureScript.Backend.Optimizer.Cache', 'Data.Maybe'].map(load));
const stats = () => JSON.parse(Cache.readPurmetaStatsJson());
const write = (name, value) => Cache.writePurmetaSync(name)(value)();
const read = name => Cache.readPurmetaSync(name)();
const setBudget = bytes => Cache.setPurmetaCacheBudgetBytes(bytes)();
const defaultBytes = 64 * 1024 * 1024;

function setup(t) {
  const cwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pbo-purmeta-budget-'));
  const previous = setBudget(defaultBytes);
  assert.equal(previous, defaultBytes, 'unconfigured callers retain the existing default');
  process.chdir(root);
  Cache.beginPurmetaBuild();
  Cache.setPurmetaStatsEnabled(true)();
  t.after(() => {
    setBudget(previous);
    Cache.beginPurmetaBuild();
    Cache.setPurmetaStatsEnabled(false)();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test('budget changes preserve entries until a boundary and survive beginPurmetaBuild', t => {
  setup(t);
  const value = { contents: 'current module' };
  write('A', value);
  assert.equal(setBudget(0), defaultBytes);
  assert.equal(read('A').value0, value, 'changing the budget does not evict mid-module');
  assert.ok(stats().ram.serializedBytes > 0);
  Cache.trimPurmetaCache();
  assert.equal(stats().ram.serializedBytes, 0);
  assert.equal(stats().ram.entries, 0);
  Cache.beginPurmetaBuild();
  assert.equal(stats().policy.maxSerializedBytes, 0);
  assert.ok(read('A') instanceof Maybe.Nothing, 'the budget cannot bypass current-build membership');
  assert.equal(setBudget(defaultBytes), 0);
  assert.equal(stats().policy.maxSerializedBytes, defaultBytes);
});

test('a custom byte budget uses LRU recency and preserves current-build disk fallback', t => {
  setup(t);
  const values = ['A', 'B', 'C'].map(name => ({ name, contents: name.repeat(100) }));
  for (const value of values) write(value.name, value);
  const sizes = values.map(value => fs.statSync(`.purmeta/${value.name}.purmeta`).size);
  setBudget(sizes[0] + sizes[2]);
  assert.equal(read('A').value0, values[0]);
  Cache.trimPurmetaCache();
  assert.equal(stats().ram.evictions, 1);
  assert.equal(stats().ram.evictedBytes, sizes[1]);
  assert.equal(stats().ram.serializedBytes, sizes[0] + sizes[2]);
  assert.equal(read('A').value0, values[0]);
  assert.equal(read('C').value0, values[2]);
  const restored = read('B').value0;
  assert.deepEqual(restored, values[1]);
  assert.notEqual(restored, values[1]);
  assert.equal(read('B').value0, restored);
  assert.equal(stats().reads.diskHits, 1);
  Cache.trimPurmetaCache();
  assert.ok(stats().ram.serializedBytes <= stats().policy.maxSerializedBytes);
});

test('zero retains within-module reuse but empties RAM at every module boundary', t => {
  setup(t);
  setBudget(0);
  const value = { value: 42 };
  write('A', value);
  assert.equal(read('A').value0, value);
  Cache.trimPurmetaCache();
  const restored = read('A').value0;
  assert.deepEqual(restored, value);
  assert.equal(read('A').value0, restored);
  assert.equal(stats().reads.diskHits, 1);
  Cache.trimPurmetaCache();
  assert.deepEqual(read('A').value0, value);
  assert.equal(stats().reads.diskHits, 2);
  assert.equal(stats().ram.boundaryPeakSerializedBytes, 0);
  assert.equal(stats().ram.boundaryPeakEntries, 0);
});

test('invalid limits fail before changing policy; byte counts are not truncated to 32 bits', t => {
  setup(t);
  for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, 2 ** 53, '64', null, undefined]) {
    assert.throws(() => setBudget(invalid), /non-negative safe integer byte count/);
    assert.equal(stats().policy.maxSerializedBytes, defaultBytes);
  }
  assert.equal(setBudget(4 * 1024 ** 3), defaultBytes);
  assert.equal(stats().policy.maxSerializedBytes, 4294967296);
  assert.equal(setBudget(Number.MAX_SAFE_INTEGER), 4294967296);
  assert.equal(stats().policy.maxSerializedBytes, Number.MAX_SAFE_INTEGER);
});
