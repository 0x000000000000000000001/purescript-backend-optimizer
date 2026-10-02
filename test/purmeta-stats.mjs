// After building PBO: node test/purmeta-stats.mjs [compiled-output-directory]
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

function setup(t) {
  const cwd = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pbo-purmeta-stats-'));
  process.chdir(root);
  Cache.setPurmetaStatsEnabled(false)();
  Cache.beginPurmetaBuild();
  t.after(() => {
    Cache.setPurmetaStatsEnabled(false)();
    Cache.beginPurmetaBuild();
    process.chdir(cwd);
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test('profiling distinguishes blocked requests, RAM hits and disk outcomes without changing cache contents', t => {
  setup(t);
  const value = { name: 'A', contents: [1, 2, 3] };
  write('A', value);
  assert.equal(stats(), null, 'diagnostics are disabled by default');
  const bytes = fs.readFileSync('.purmeta/A.purmeta');
  Cache.setPurmetaStatsEnabled(true)();
  assert.equal(read('A').value0, value, 'enabling diagnostics must not evict or deserialize RAM');
  assert.equal(stats().reads.ramHits, 1);
  Cache.beginPurmetaBuild();
  assert.equal(stats().reads.requests, 0);
  assert.equal(stats().ram.serializedBytes, 0);
  assert.ok(read('A') instanceof Maybe.Nothing, 'previous-build data stays blocked');
  write('A', value);
  assert.deepEqual(fs.readFileSync('.purmeta/A.purmeta'), bytes, 'profiling preserves the serialized format');
  assert.equal(read('A').value0, value);
  assert.equal(read('A').value0, value);
  Cache.clearPurmetaCache();
  const restored = read('A').value0;
  assert.deepEqual(restored, value);
  assert.notEqual(restored, value);
  assert.equal(read('A').value0, restored);
  Cache.clearPurmetaCache();
  fs.unlinkSync('.purmeta/A.purmeta');
  assert.ok(read('A') instanceof Maybe.Nothing);
  const result = stats();
  assert.equal(result.schema, 1);
  assert.deepEqual(result.policy, { kind: 'lru-module-boundary', maxSerializedBytes: 64 * 1024 * 1024 });
  assert.deepEqual({ ...result.reads, ioMs: 0, deserializeMs: 0 }, {
    requests: 6, blocked: 1, ramHits: 3, ramMisses: 2,
    diskHits: 1, diskMissing: 1, errors: 0, ioAttempts: 1, files: 1,
    bytes: bytes.length, ioMs: 0, deserializations: 1, deserializeMs: 0,
  });
  assert.deepEqual({ ...result.writes, ioMs: 0, serializeMs: 0 }, {
    attempts: 1, files: 1, bytes: bytes.length, errors: 0, ioMs: 0, serializations: 1, serializeMs: 0,
  });
  assert.equal(result.ram.clearCalls, 2);
  assert.equal(result.ram.clearedEntries, 2);
  assert.equal(result.ram.clearedBytes, 2 * bytes.length);
  for (const value of [result.reads.ioMs, result.reads.deserializeMs, result.writes.ioMs, result.writes.serializeMs]) {
    assert.ok(Number.isFinite(value) && value >= 0);
  }
  for (const value of Object.values(result.memory)) assert.ok(value > 0);
  result.reads.requests = -1;
  assert.equal(stats().reads.requests, 6, 'snapshots cannot mutate the live counters');
  Cache.beginPurmetaBuild();
  assert.equal(stats().writes.files, 0);
  assert.equal(stats().ram.clearCalls, 0);
  write('A', value);
  Cache.setPurmetaStatsEnabled(false)();
  assert.equal(stats(), null);
  assert.equal(read('A').value0, value, 'disabling diagnostics leaves RAM intact');
});

test('profiled peaks and evictions reflect the serialized-byte budget at module boundaries', t => {
  setup(t);
  Cache.setPurmetaStatsEnabled(true)();
  const values = ['A', 'B', 'C', 'D'].map(name => ({ name, contents: name.repeat(17 * 1024 * 1024) }));
  for (const value of values) write(value.name, value);
  const sizes = values.map(value => fs.statSync(`.purmeta/${value.name}.purmeta`).size);
  const total = sizes.reduce((a, b) => a + b, 0);
  assert.equal(stats().ram.entries, 4);
  assert.equal(stats().ram.serializedBytes, total);
  assert.ok(total > stats().policy.maxSerializedBytes);
  Cache.trimPurmetaCache();
  assert.equal(stats().ram.evictions, 1);
  assert.equal(stats().ram.evictedBytes, sizes[0]);
  assert.equal(stats().ram.serializedBytes, total - sizes[0]);
  assert.deepEqual(read('A').value0, values[0]);
  Cache.trimPurmetaCache();
  Cache.trimPurmetaCache();
  const result = stats();
  assert.equal(result.reads.diskHits, 1);
  assert.equal(result.reads.bytes, sizes[0]);
  assert.equal(result.ram.peakSerializedBytes, total);
  assert.equal(result.ram.boundaryPeakSerializedBytes, total - sizes[0]);
  assert.equal(result.ram.trimCalls, 3);
  assert.equal(result.ram.evictions, 2);
  assert.equal(result.ram.evictedBytes, sizes[0] + sizes[1]);
  assert.ok(result.ram.boundaryPeakSerializedBytes <= result.policy.maxSerializedBytes);
  for (let i = 0; i < 3; i++) write('A', { small: true });
  assert.equal(stats().ram.entries, 3);
  assert.equal(stats().ram.serializedBytes, sizes[2] + sizes[3] + fs.statSync('.purmeta/A.purmeta').size);
});

test('profiling counts failed reads/decodes/writes while preserving the original failure behavior', t => {
  setup(t);
  Cache.setPurmetaStatsEnabled(true)();
  write('A', { value: 42 });
  const original = fs.readFileSync('.purmeta/A.purmeta');
  const writeFile = fs.writeFileSync;
  const readFile = fs.readFileSync;
  const error = console.error;
  const messages = [];
  console.error = message => messages.push(message);
  t.after(() => { fs.writeFileSync = writeFile; fs.readFileSync = readFile; console.error = error; });
  fs.writeFileSync = () => { throw new Error('write fixture'); };
  assert.throws(() => write('Bad', {}), /write fixture/);
  fs.writeFileSync = writeFile;
  assert.throws(() => write('Bad', { fn: () => {} }), /could not be cloned/);
  assert.ok(read('Bad') instanceof Maybe.Nothing, 'failed writes do not publish current-build membership');
  Cache.clearPurmetaCache();
  fs.readFileSync = () => { throw new Error('read fixture'); };
  assert.ok(read('A') instanceof Maybe.Nothing);
  fs.readFileSync = readFile;
  fs.writeFileSync('.purmeta/A.purmeta', Buffer.from([0]));
  assert.ok(read('A') instanceof Maybe.Nothing);
  fs.writeFileSync('.purmeta/A.purmeta', original);
  assert.deepEqual(read('A').value0, { value: 42 });
  const result = stats();
  assert.equal(result.writes.attempts, 3);
  assert.equal(result.writes.serializations, 3);
  assert.equal(result.writes.errors, 2);
  assert.equal(result.writes.files, 1);
  assert.equal(result.writes.bytes, original.length);
  assert.equal(result.reads.blocked, 1);
  assert.equal(result.reads.ramMisses, 3);
  assert.equal(result.reads.ioAttempts, 3);
  assert.equal(result.reads.files, 2);
  assert.equal(result.reads.bytes, original.length + 1);
  assert.equal(result.reads.deserializations, 2);
  assert.equal(result.reads.errors, 2);
  assert.equal(result.reads.diskHits, 1);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /Failed to read purmeta for A: read fixture/);
});
