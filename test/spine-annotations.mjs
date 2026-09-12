// After building PBO: node test/spine-annotations.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Tuple] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Tuple",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type) => new C.ExprVar(ann(type),
  new C.Qualified(new Maybe.Just("Fixture"), name));
const func = (args, result) => new C.Func(args, result);
const int = C.Int.value;
const state = new C.Record(new C.Row([
  new Tuple.Tuple("newSeed", int), new Tuple.Tuple("size", int),
], Maybe.Nothing.value));
const tuple = new C.ADT("Data.Tuple.Tuple", ["Data", "Tuple", "Tuple"], [int, state]);
const stateFn = func([state], tuple);
const transform = expr => {
  const module = { name: "Fixture", exports: ["lcgStep"],
    decls: [new C.NonRec(new C.Binding(ann(stateFn), "lcgStep", expr))] };
  return M.monomorphize(Map.empty)(Map.empty)(module).decls[0].value0.value2;
};

test("an unchanged curried call keeps each intermediate function type", () => {
  const head = variable("makeState", func([int, stateFn], stateFn));
  const partial = new C.ExprApp(ann(func([stateFn], stateFn)), head, variable("seed", int));
  const expression = new C.ExprApp(ann(stateFn), partial, variable("step", stateFn));
  assert.deepEqual(transform(expression), expression);
});

test("state @Int retains its quantifier, constraint and callback annotations", () => {
  const a = new C.TypeVar("a");
  const dictionary = new C.ADT("Fixture.MonadState", ["Fixture", "MonadState"], [state]);
  const method = func([stateFn], stateFn);
  const constrained = new C.ConstrainedType([
    new Tuple.Tuple(["Control", "Monad", "State", "Class", "MonadState"], [state, a]),
  ], method);
  const head = variable("state", new C.ForAll(["a"], constrained));
  const typeApp = new C.ExprTypeApp(ann(constrained), head, int);
  const withDictionary = new C.ExprApp(ann(method), typeApp, variable("dict", dictionary));
  const expression = new C.ExprApp(ann(stateFn), withDictionary, variable("step", stateFn));
  assert.deepEqual(transform(expression), expression);
});

test("an accessor-headed call also keeps its intermediate annotations", () => {
  const method = func([int, stateFn], stateFn);
  const record = new C.Record(new C.Row([new Tuple.Tuple("makeState", method)], Maybe.Nothing.value));
  const head = new C.ExprAccessor(ann(method), variable("dictionary", record), "makeState");
  const partial = new C.ExprApp(ann(func([stateFn], stateFn)), head, variable("seed", int));
  const expression = new C.ExprApp(ann(stateFn), partial, variable("step", stateFn));
  assert.deepEqual(transform(expression), expression);
});

test("nested unchanged calls do not repeatedly transform their leaf argument", () => {
  const depth = 12;
  const leaf = variable("seed", int);
  const leafAnn = leaf.value0;
  let leafReads = 0;
  Object.defineProperty(leaf, "value0", {
    get() {
      leafReads += 1;
      return leafAnn;
    },
  });

  let expression = leaf;
  for (let i = 0; i < depth; i += 1) {
    expression = new C.ExprApp(ann(int), variable(`identity${i}`, func([int], int)), expression);
  }
  transform(expression);

  // Count work instead of wall time; revisiting arguments twice at each level
  // reads this leaf 2 ** depth times. Allow a linear bound for additional passes.
  assert.ok(leafReads <= depth + 1,
    `leaf annotation read ${leafReads} times at nesting depth ${depth}`);
});
