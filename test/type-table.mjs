// node test/type-table.mjs [compiled-output] [corefn-output] [baseline-module.mjs]
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(join(output, name, "index.js")));
const [Decoder, C, Either] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn.TypeTable",
  "PureScript.Backend.Optimizer.CoreFn", "Data.Either",
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
for (const element of [-1, 42]) {
  assert.deepStrictEqual(right([{ type: "Array", element }]), [new C.Array(C.Any.value)], "preserve forced fallback for unresolved integer references");
}
for (const table of [["Unknown"], [{ type: "Array", element: 0.5 }], [{ type: "Func", args: [] }]]) {
  assert.ok(decode(table) instanceof Either.Left, "malformed types must remain errors");
}
console.log("PASS type table decoding: primitives, forward/shared references, independent runs, cycles, invalid indices and errors");

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
