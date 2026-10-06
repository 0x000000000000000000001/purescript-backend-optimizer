// Observe real specialization decisions, not a second implementation of the
// tracking logic. Forced-cache-miss differential coverage lives alongside this
// fixture in monomorphize-cache.mjs.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const [outputArg, archiveArg] = process.argv.slice(2);
assert(outputArg && archiveArg, 'specialization-reads.mjs COMPILED_OUTPUT NEW_ARCHIVE');
const output = resolve(outputArg), archive = resolve(archiveArg);
assert(!existsSync(archive)); mkdirSync(archive, { recursive: true });
const compiled = join(output, 'PureScript.Backend.Optimizer.Monomorphize/index.js');
const source = readFileSync(compiled, 'utf8');
const { build } = createRequire(join(output, '../package.json'))('esbuild');
const bundle = await build({ stdin: { contents: source + '\nexport { specializeTracked, sameLookupResults, specializationKey, monomorphizeExpr };',
  resolveDir: dirname(compiled), loader: 'js' }, bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'shared-constructor-identities', setup(plugin) {
    plugin.onResolve({ filter: /.*/ }, args => ({ path: pathToFileURL(resolve(args.resolveDir, args.path)).href, external: true }));
  } }] });
const bundled = join(archive, 'monomorphize.mjs'); writeFileSync(bundled, bundle.outputFiles[0].text);
const Mono = await import(pathToFileURL(bundled));
const [C, M, Maybe, Ord, Set, U, FFI, Tuple] = await Promise.all([
  'PureScript.Backend.Optimizer.CoreFn/index.js', 'Data.Map/index.js', 'Data.Maybe/index.js',
  'Data.Ord/index.js', 'Data.Set/index.js', 'Data.Unfoldable/index.js',
  'PureScript.Backend.Optimizer.Monomorphize/foreign.js',
  'Data.Tuple/index.js',
].map(path => import(pathToFileURL(join(output, path)))));
const nothing = Maybe.Nothing.value, just = value => new Maybe.Just(value);
const ann = type => ({ type: just(type), meta: nothing, span: C.emptySpan, sourceUsage: nothing });
const fn = type => new C.Func([type], type), variable = new C.TypeVar('a');
const generic = new C.ForAll(['a'], fn(variable));
const global = new C.ExprVar(ann(generic), new C.Qualified(just('Fixture'), 'choose'));
const literals = [new C.ExprLit(ann(C.Int.value), new C.LitInt(7)), new C.ExprLit(ann(C.String.value), new C.LitString('seven'))];
const types = [C.Int.value, C.String.value];
const call = (type, literal, head = global) => new C.ExprApp(ann(type), new C.ExprTypeApp(ann(fn(type)), head, type), literal);
const calls = types.map((type, index) => call(type, literals[index]));
const keys = types.map((type, index) => Mono.specializationKey(fn(type))([])([literals[index]]));
const entry = {}, insert = M.insert(Ord.ordString), entries = M.toUnfoldable(U.unfoldableArray);
const table = values => M.singleton('Fixture.choose')(values);
const tracked = (map, expr = calls[0]) => {
  const original = JSON.stringify(expr), raw = Mono.specializeTracked('Caller')(map)(expr);
  const result = raw instanceof Tuple.Tuple ? { expr: raw.value0, lookups: raw.value1 } : raw;
  assert.deepEqual(result.expr, Mono.monomorphizeExpr('Caller')(map)(M.empty)(expr));
  assert.equal(JSON.stringify(expr), original);
  return result;
};

test('absent globals invalidate only when that global appears', () => {
  const observed = tracked(M.empty).lookups;
  assert.deepEqual(entries(observed).map(pair => [pair.value0, pair.value1]), [['Fixture.choose', nothing]]);
  assert.equal(Mono.sameLookupResults(M.empty)(observed), true);
  assert.equal(Mono.sameLookupResults(M.singleton('Other.name')(M.empty))(observed), true);
  assert.equal(Mono.sameLookupResults(table(M.empty))(observed), false);
});

test('unrelated specializations do not invalidate a missed exact key', () => {
  const old = M.singleton('unrelated')(entry), observed = tracked(table(old)).lookups;
  assert.deepEqual(Set.toUnfoldable(U.unfoldableArray)(entries(observed)[0].value1.value0), [keys[0]]);
  assert.equal(Mono.sameLookupResults(table(insert('another')(entry)(old)))(observed), true);
  assert.equal(Mono.sameLookupResults(table(insert(keys[0])(entry)(old)))(observed), false);
  const found = tracked(table(insert(keys[0])(entry)(old)));
  assert.equal(M.size(found.lookups), 0, 'successful membership is permanently stable in a monotone fixed point');
  assert.notDeepEqual(found.expr, calls[0], 'the successful lookup must really rewrite the call');
});

test('all missed keys survive repeated reads, deferred bodies and local static aliases', () => {
  const local = new C.ExprVar(ann(generic), new C.Qualified(nothing, 'alias'));
  const aliased = new C.ExprLet(ann(C.Int.value), [new C.NonRec(new C.Binding(ann(generic), 'alias', global))],
    call(types[0], literals[0], local));
  const expr = new C.ExprAbs(ann(C.Any.value), 'deferred', new C.ExprLit(ann(C.Any.value), new C.LitArray([...calls, aliased, ...calls])));
  const observed = tracked(table(M.empty), expr).lookups;
  assert.deepEqual(Set.toUnfoldable(U.unfoldableArray)(entries(observed)[0].value1.value0), keys.toSorted());
  for (const key of keys) assert.equal(Mono.sameLookupResults(table(M.singleton(key)(entry)))(observed), false);
  assert.equal(Mono.sameLookupResults(table(M.singleton('other')(entry)))(observed), true);
});

test('tracked evaluation is deferred, completes before observation and reruns per Effect execution', () => {
  let calls = 0;
  const effect = FFI.evaluateTracked(() => ++calls);
  assert.equal(calls, 0);
  assert.equal(effect(), 1); assert.equal(calls, 1);
  assert.equal(effect(), 2); assert.equal(calls, 2);
  const failure = new Error('tracked transform');
  assert.throws(FFI.evaluateTracked(() => { throw failure; }), error => error === failure);
});
