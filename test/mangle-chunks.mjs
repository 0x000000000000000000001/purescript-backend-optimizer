// Exact names are ABI: compare with the frozen original compiled mangler.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [outputArg, referenceArg, outArg] = process.argv.slice(2);
assert(outputArg && referenceArg && outArg);
const output = resolve(outputArg), out = resolve(outArg);
assert(!existsSync(out)); mkdirSync(out, { recursive: true });
const reference = readFileSync(resolve(referenceArg), 'utf8').replace(/from (["'])([^"']+)\1/g, (_, quote, path) => {
  assert(path.startsWith('../') || path === './foreign.js');
  const target = path.startsWith('../') ? join(output, path.slice(3)) : join(output, 'PureScript.Backend.Optimizer.Monomorphize/foreign.js');
  return 'from ' + JSON.stringify(pathToFileURL(target).href);
});
const referenceModule = join(out, 'reference.mjs'); writeFileSync(referenceModule, reference);
const [before, after, C, T, M] = await Promise.all([referenceModule,
  ...['PureScript.Backend.Optimizer.Monomorphize', 'PureScript.Backend.Optimizer.CoreFn', 'Data.Tuple', 'Data.Maybe']
    .map(name => join(output, name, 'index.js'))].map(path => import(pathToFileURL(path))));
const pair = (a, b) => new T.Tuple(a, b), nothing = M.Nothing.value, just = value => new M.Just(value);
const primitives = [C.Int.value, C.Number.value, C.String.value, C.Char.value, C.Boolean.value, C.Unit.value, C.Any.value];
const names = ['', 'a', '_', 'a__b', 'Module.Name', 'α', '😀', '\ud800', '\udfff', '0'];
const leaves = [...primitives, ...names.flatMap(name => [new C.TypeVar(name), new C.TypeLevelString(name)])];
const forms = (a, b, names) => [new C.Array(a), new C.Func([], a), new C.Func([a, b], b),
  new C.Record(a), new C.Row([], nothing), new C.Row([], just(a)), new C.Row([pair(names[0] ?? '', a), pair('_', b)], just(b)),
  new C.TypeApp(a, []), new C.TypeApp(a, [a, b]), new C.ForAll([], a), new C.ForAll(names, b),
  new C.ConstrainedType([], a), new C.ConstrainedType([pair([], []), pair(names, [a, b])], b),
  new C.ADT('ignored', [], []), new C.ADT('ignored', names, []), new C.ADT('ignored', names, [a, b])];
let checks = 0;
const check = ty => { assert.equal(after.mangleType(ty), before.mangleType(ty)); checks++; };
assert.equal(before.mangleType(new C.Func([], C.Int.value)), 'Func__Int');
assert.equal(before.mangleType(new C.Record(new C.Row([], nothing))), 'Record_Row__Empty');
for (const leaf of leaves) { check(leaf); for (const ty of forms(leaf, leaf, names)) check(ty); }
let seed = 0x243f6a88;
const pick = values => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return values[(seed >>> 0) % values.length]; };
function type(depth) {
  if (!depth || pick([true, false, false])) return pick(leaves);
  return pick(forms(type(depth - 1), type(depth - 1), [pick(names), pick(names)]));
}
for (let i = 0; i < 2000; i++) check(type(6));
let deep = C.Int.value;
for (let i = 0; i < 256; i++) deep = new C.Array(deep);
check(deep); check(new C.Func(Array.from({ length: 4096 }, () => pick(leaves)), deep));
console.log(`Type mangling: ${checks} exact differential names, all constructors, empty lists/rows, Unicode and wide/deep types passed`);
