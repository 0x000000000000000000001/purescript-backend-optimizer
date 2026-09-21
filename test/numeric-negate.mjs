// After building PBO, run: node test/numeric-negate.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = (name) => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, S, Sem, Foreign, Maybe, Map, Lazy] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Syntax",
  "PureScript.Backend.Optimizer.Semantics",
  "PureScript.Backend.Optimizer.Semantics.Foreign",
  "Data.Maybe", "Data.Map", "Data.Lazy",
].map(load));

const env = {
  instantiateNeutral: Sem.instantiateNeutralType,
  currentModule: "Fixture", locals: Map.empty, localsSize: 0, directives: Map.empty,
  evalExternRef: () => () => Maybe.Nothing.value,
  evalExternSpine: () => () => () => Maybe.Nothing.value,
};
const qualified = (module, name) => new C.Qualified(new Maybe.Just(module), name);
const negateName = qualified("Data.Ring", "negate");
const semantics = Map.lookup(C.ordQualified(C.ordIdent))(negateName)(Foreign.coreForeignSemantics);
const dictionary = (module, name) => {
  const qual = qualified(module, name);
  return new Sem.SemRef(new Sem.EvalExtern(qual), [], Lazy.defer(() => new Sem.NeutStop(qual)));
};
const number = (value) => new Sem.NeutLit(new C.LitNumber(value));
const integer = (value) => new Sem.NeutLit(new C.LitInt(value));
const specialize = (dict) => {
  assert.ok(semantics instanceof Maybe.Just, "Numeric negate semantics must be registered");
  return semantics.value0(env)(negateName)([new Sem.ExternApp([dict])]);
};
const apply = (dict, value) => {
  const result = specialize(dict);
  assert.ok(result instanceof Maybe.Just, "The primitive Ring dictionary must be recognized");
  return Sem.evalApp(env)(result.value0)([value]);
};

test("negating positive zero produces negative zero without resolving the dictionary", () => {
  const result = apply(dictionary("Data.Ring", "ringNumber"), number(0));
  assert.ok(result instanceof Sem.NeutLit);
  assert.ok(result.value0 instanceof C.LitNumber);
  assert.equal(1 / result.value0.value0, -Infinity);
});

test("negating negative zero produces positive zero", () => {
  const result = apply(dictionary("Data.Ring", "ringNumber"), number(-0));
  assert.ok(result instanceof Sem.NeutLit);
  assert.equal(1 / result.value0.value0, Infinity);
});

test("a dynamic Number uses unary negation", () => {
  const value = new Sem.NeutVar(qualified("Fixture", "number"));
  const result = apply(dictionary("Data.Ring", "ringNumber"), value);
  assert.deepStrictEqual(result, new Sem.NeutPrimOp(new S.Op1(S.OpNumberNegate.value, value)));
});

test("the Int dictionary uses integer negation", () => {
  const result = apply(dictionary("Data.Ring", "ringInt"), integer(42));
  assert.deepStrictEqual(result, integer(-42));
  const value = new Sem.NeutVar(qualified("Fixture", "integer"));
  assert.deepStrictEqual(apply(dictionary("Data.Ring", "ringInt"), value),
    new Sem.NeutPrimOp(new S.Op1(S.OpIntNegate.value, value)));
});

test("custom Ring dictionaries keep their own semantics", () => {
  for (const [module, name] of [["Fixture", "ringNumber"], ["Data.Ring", "ringUnit"]]) {
    assert.ok(specialize(dictionary(module, name)) instanceof Maybe.Nothing);
  }
});
