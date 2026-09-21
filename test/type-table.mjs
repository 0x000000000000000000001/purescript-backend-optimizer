// node test/type-table.mjs [compiled-output] [corefn-output] [baseline-module.mjs]
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(join(output, name, "index.js")));
const [Decoder, C, Either, Tuple] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn.TypeTable",
  "PureScript.Backend.Optimizer.CoreFn", "Data.Either", "Data.Tuple",
].map(load));
const decode = table => Decoder.decodeTypeTableST(table)();
const right = table => {
  const result = decode(table);
  assert.ok(result instanceof Either.Right, JSON.stringify(result));
  return result.value0;
};

assert.deepStrictEqual(right([]), []);
assert.deepStrictEqual(right(["Int", "String", "Boolean"]), [C.Int.value, C.String.value, C.Boolean.value]);
const forward = [{ type: "Func", args: [1, 1], ret: 1 }, { type: "Array", element: 2 }, "String"];
const before = JSON.stringify(forward);
const values = right(forward);
assert.deepStrictEqual(values, [new C.Func([new C.Array(C.String.value), new C.Array(C.String.value)], new C.Array(C.String.value)), new C.Array(C.String.value), C.String.value]);
assert.equal(values[0].value0[0], values[1], "references should share the resolved type");
assert.equal(values[0].value0[1], values[1]);
assert.equal(values[0].value1, values[1]);
assert.equal(JSON.stringify(forward), before, "decoding must not mutate the input table");
assert.deepStrictEqual(right(forward), values, "each decoding must start with an empty result table");
assert.deepStrictEqual(right([{ type: "Array", element: 0 }]), [new C.Array(C.Any.value)]);
assert.deepStrictEqual(right([{ type: "Array", element: 1 }, { type: "Array", element: 0 }]), [new C.Array(C.Any.value), new C.Array(new C.Array(C.Any.value))]);
const cascaded = right([
  { type: "Array", element: 1 }, { type: "Array", element: 0 },
  { type: "Array", element: 3 }, { type: "Array", element: 2 },
  { type: "Func", args: [1, 3], ret: 0 },
]);
assert.deepStrictEqual(cascaded.slice(0, 4), [
  new C.Array(C.Any.value), new C.Array(new C.Array(C.Any.value)),
  new C.Array(C.Any.value), new C.Array(new C.Array(C.Any.value)),
], "resolve between forced cycles, keeping the first unresolved index");
assert.equal(cascaded[1].value0, cascaded[0]);
assert.equal(cascaded[3].value0, cascaded[2]);
assert.equal(cascaded[4].value0[0], cascaded[1]);
assert.equal(cascaded[4].value0[1], cascaded[3]);
assert.equal(cascaded[4].value1, cascaded[0]);
assert.deepStrictEqual(right([
  { type: "Array", element: 1 }, { type: "Array", element: 2 },
  { type: "Array", element: 1 },
]), [new C.Array(C.Any.value), new C.Array(C.Any.value), new C.Array(new C.Array(C.Any.value))],
"force the first unresolved index even when it only depends on a later cycle");
for (const element of [-1, 42]) {
  assert.deepStrictEqual(right([{ type: "Array", element }]), [new C.Array(C.Any.value)], "preserve forced fallback for unresolved integer references");
}
// Exercise every caller of resolveArgs, including the empty result and forced
// references. Repeated and out-of-order arguments must retain their positions.
for (const [name, json, expected] of [
  ["Adt", args => ({ type: "Adt", fqn: ["Test", "Args"], args }), args => new C.ADT("Test.Args", ["Test", "Args"], args)],
  ["TypeApp", args => ({ type: "TypeApp", constructor: 1, args }), args => new C.TypeApp(C.Int.value, args)],
  ["Func", args => ({ type: "Func", args, ret: 1 }), args => new C.Func(args, C.Int.value)],
  ["ConstrainedType", args => ({ type: "ConstrainedType", constraints: [{ fqn: ["Eq"], args }], body: 1 }), args => new C.ConstrainedType([new Tuple.Tuple(["Eq"], args)], C.Int.value)],
]) {
  for (const [ids, types, description] of [
    [[], [], "empty arguments"],
    [[2, 1, 2], [C.String.value, C.Int.value, C.String.value], "ordered and repeated forward references"],
    [[0, 1, 0], [C.Any.value, C.Int.value, C.Any.value], "self references forced to Any"],
    [[2, -1, 42, 1], [C.String.value, C.Any.value, C.Any.value, C.Int.value], "absent references forced to Any"],
  ]) {
    assert.deepStrictEqual(right([json(ids), "Int", "String"]), [expected(types), C.Int.value, C.String.value], `${name}: ${description}`);
  }
}

const argumentError = decode(["Unknown"]);
const returnError = decode([{ type: "Array" }]);
assert.ok(argumentError instanceof Either.Left);
assert.ok(returnError instanceof Either.Left);
assert.notDeepStrictEqual(argumentError, returnError, "error-priority checks require distinct errors");
for (const [args, expected] of [[[1, 2], argumentError], [[2, 1], returnError]]) {
  assert.deepStrictEqual(decode([
    { type: "Func", args, ret: 3 }, "Unknown", { type: "Array" }, "Int",
  ]), expected, "resolved arguments must retain the first error in argument order");
}
for (const args of [[1, 2], [2, 1]]) {
  // Arg 1 fails, arg 2 is cyclic, and ret fails differently. During settling,
  // sequence Maybe gives Nothing priority over Left in either argument order;
  // Func must therefore select the return error instead of the argument error.
  assert.deepStrictEqual(decode([
    { type: "Func", args, ret: 3 }, "Unknown", { type: "Array", element: 2 }, { type: "Array" },
  ]), returnError, "an unresolved argument before or after an error must keep all arguments pending");
}
for (const args of [[1, 42], [42, 1]]) {
  assert.deepStrictEqual(decode([
    { type: "Func", args, ret: 2 }, "Unknown", "Int",
  ]), argumentError, "forcing an absent argument must retain an already resolved error");
}
for (const table of [["Unknown"], [{ type: "Array", element: 0.5 }], [{ type: "Func", args: [] }]]) {
  assert.ok(decode(table) instanceof Either.Left, "malformed types must remain errors");
}
assert.deepStrictEqual(decode([
  { type: "Array", element: 2 }, "Unknown", { type: "Func", args: [] },
]), decode([{ type: "Func", args: [] }]), "return the error at the first table index, even when a later index fails in an earlier round");
for (const dependent of [
  { type: "TypeApp", constructor: 1, args: null },
  { type: "Row", fields: [{ label: "x", type: 1 }], tail: "invalid" },
  { type: "ConstrainedType", constraints: [{ fqn: ["Eq"], args: [1] }], body: "invalid" },
]) {
  assert.deepStrictEqual(decode([dependent, "Unknown"]), decode(["Unknown"]),
    "a reference error must retain priority over a later malformed JSON field");
}
for (const [cyclic, resolved] of [
  [{ type: "TypeApp", constructor: 0, args: null }, { type: "TypeApp", constructor: 1, args: null }],
  [{ type: "Row", fields: [{ label: "x", type: 0 }], tail: "invalid" }, { type: "Row", fields: [], tail: "invalid" }],
  [{ type: "ConstrainedType", constraints: [{ fqn: ["Eq"], args: [0] }], body: "invalid" }, { type: "ConstrainedType", constraints: [], body: "invalid" }],
]) {
  assert.deepStrictEqual(decode([cyclic]), decode([resolved, "Any"]),
    "forcing a cycle must still expose the deferred malformed JSON field");
}
console.log("PASS type table decoding: primitives, forward/shared references, independent runs, cascading cycles, argument traversal, invalid indices and deferred error order");

if (process.argv[3]) {
  if (!process.argv[4]) throw new Error("Corpus comparison also requires a baseline module path");
  const baseline = await import(pathToFileURL(resolve(process.argv[4])));
  const corpus = resolve(process.argv[3]);
  let modules = 0;
  let types = 0;
  for (const entry of readdirSync(corpus, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(corpus, entry.name, "corefn.json");
    if (!existsSync(file)) continue;
    const table = JSON.parse(readFileSync(file, "utf8")).typeTable ?? [];
    assert.deepStrictEqual(decode(table), baseline.decodeTypeTableST(table)(), entry.name);
    modules++;
    types += table.length;
  }
  console.log(`PASS baseline comparison: ${modules} modules, ${types} types`);
}
