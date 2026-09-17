import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// After building PBO: node test/purmeta-lru.mjs [compiled-output-directory]
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('../output/', import.meta.url));
const load = name => import(pathToFileURL(path.join(output, name, 'index.js')));
const [cache, Maybe] = await Promise.all([
  'PureScript.Backend.Optimizer.Cache', 'Data.Maybe',
].map(load));
const Nothing = Symbol('Nothing');
const read = name => {
  const result = cache.readPurmetaSync(name)();
  return result instanceof Maybe.Just ? result.value0 : Nothing;
};
const write = (name, value) => cache.writePurmetaSync(name)(value)();
const fixture = name => ({name, contents: name.repeat(17 * 1024 * 1024)});

function setup(t) {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gopurs-lru-contract-'));
  process.chdir(dir);
  cache.beginPurmetaBuild();
  const calls = [];
  const originalRead = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (String(file).endsWith('.purmeta')) calls.push(path.basename(String(file)));
    return originalRead.call(this, file, ...args);
  };
  t.after(() => {
    fs.readFileSync = originalRead;
    process.chdir(cwd);
    cache.beginPurmetaBuild();
    fs.rmSync(dir, {recursive:true, force:true});
  });
  return calls;
}

test('a decoded module remains available across module boundaries', t => {
  const reads = setup(t);
  const value = fixture('A');
  write('A', value);
  cache.trimPurmetaCache();
  assert.equal(read('A'), value);
  cache.trimPurmetaCache();
  assert.equal(read('A'), value);
  assert.deepEqual(reads, []);
});

test('explicit clear evicts RAM while preserving current-build disk access', t => {
  const reads = setup(t);
  const value = fixture('A');
  write('A', value);
  cache.clearPurmetaCache();
  const decoded = read('A');
  assert.deepEqual(decoded, value);
  assert.notEqual(decoded, value);
  assert.deepEqual(reads, ['A.purmeta']);
  cache.trimPurmetaCache();
  assert.equal(read('A'), decoded);
  assert.deepEqual(reads, ['A.purmeta']);
});

test('new build refuses stale disk and retained entries until rewritten', t => {
  const reads = setup(t);
  write('A', fixture('A'));
  cache.trimPurmetaCache();
  cache.beginPurmetaBuild();
  assert.equal(read('A'), Nothing);
  cache.clearPurmetaCache();
  assert.equal(read('A'), Nothing);
  assert.deepEqual(reads, []);
  const fresh = fixture('B');
  write('A', fresh);
  assert.equal(read('A'), fresh);
});

test('eviction uses recency and occurs only at a module boundary', t => {
  const reads = setup(t);
  const values = ['A','B','C','D'].map(fixture);
  values.forEach((value, index) => write(String(index), value));
  // Four 17 MiB payloads exceed the 64 MiB budget; three fit.
  // No entry is evicted until the current module completes.
  values.forEach((value, index) => assert.equal(read(String(index)), value));
  assert.equal(read('0'), values[0]); // Make 0 most recently used; 1 is oldest.
  assert.deepEqual(reads, []);
  cache.trimPurmetaCache();
  assert.equal(read('0'), values[0]);
  assert.equal(read('2'), values[2]);
  assert.equal(read('3'), values[3]);
  assert.deepEqual(reads, []);
  assert.deepEqual(read('1'), values[1]);
  assert.deepEqual(reads, ['1.purmeta']);
});

test('replacement updates accounting instead of accumulating obsolete bytes', t => {
  const reads = setup(t);
  const a = fixture('A'), b = fixture('B'), c = fixture('C');
  for (let index=0; index<5; index++) write('A', a);
  write('B', b);
  write('C', c);
  cache.trimPurmetaCache();
  assert.equal(read('A'), a);
  assert.equal(read('B'), b);
  assert.equal(read('C'), c);
  assert.deepEqual(reads, []);
});

test('an entry larger than the budget remains cached within a module only', t => {
  const reads = setup(t);
  const large = {contents:'x'.repeat(65 * 1024 * 1024)};
  write('Large', large);
  assert.equal(read('Large'), large);
  cache.trimPurmetaCache();
  const reloaded = read('Large');
  assert.deepEqual(reloaded, large);
  assert.notEqual(reloaded, large);
  assert.equal(read('Large'), reloaded);
  assert.deepEqual(reads, ['Large.purmeta']);
  cache.trimPurmetaCache();
  assert.deepEqual(read('Large'), large);
  assert.deepEqual(reads, ['Large.purmeta','Large.purmeta']);
});
