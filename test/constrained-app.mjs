// After building PBO, run: node test/constrained-app.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = (name) => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, Sem, Maybe, Tuple, Map] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Semantics",
  "Data.Maybe", "Data.Tuple", "Data.Map",
].map(load));

const env = {
  currentModule: "Fixture", locals: Map.empty, localsSize: 0, directives: Map.empty,
  evalExternRef: () => () => Maybe.Nothing.value,
  evalExternSpine: () => () => () => Maybe.Nothing.value,
};
const ref = (name) => new Sem.NeutVar(new C.Qualified(new Maybe.Just("Fixture"), name));
const variant = new C.ADT("Data.Variant.Variant", ["Data", "Variant", "Variant"], [C.Any.value]);
const handlers = new C.Record(new C.Row([], Maybe.Nothing.value));
const fallback = new C.Func([variant], C.String.value);
const arguments_ = ["rowToList", "matchCases", "union", "handlers", "fallback", "variant"].map(ref);
const constraints = ["RowToList", "VariantMatchCases", "Union"].map((name) =>
  new Tuple.Tuple(["Fixture", name], []));
const normalType = new C.Func([handlers, fallback, variant], C.String.value);
const constrainedType = new C.ConstrainedType(constraints, normalType);
const apply = (head, args) => Sem.evalApp(env)(head)(args);
const typeOf = (result) => {
  assert.ok(result instanceof Sem.SemTyped, "Application must retain its residual type");
  return result.value0;
};

for (const batches of [[4], [3, 1], [1, 1, 1, 1]]) {
  test(`three dictionaries and handlers leave fallback and variant (${batches.join("+")})`, () => {
    let result = new Sem.SemTyped(constrainedType, ref("onMatch"));
    let offset = 0;
    for (const count of batches) {
      result = apply(result, arguments_.slice(offset, offset + count));
      offset += count;
    }
    assert.deepStrictEqual(typeOf(result), new C.Func([fallback, variant], C.String.value));
    const complete = apply(result, arguments_.slice(offset));
    assert.deepStrictEqual(typeOf(complete), C.String.value);
  });
}

test("each dictionary consumes one constraint before normal arguments", () => {
  let result = new Sem.SemTyped(constrainedType, ref("onMatch"));
  for (let index = 0; index < constraints.length; index++) {
    result = apply(result, [arguments_[index]]);
    const remaining = constraints.slice(index + 1);
    assert.deepStrictEqual(typeOf(result), remaining.length
      ? new C.ConstrainedType(remaining, normalType) : normalType);
  }
});
