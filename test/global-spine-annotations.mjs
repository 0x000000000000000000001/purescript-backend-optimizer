// After building PBO: node test/global-spine-annotations.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const fn = (args, result) => new C.Func(args, result);
const variable = (name, type, local = false) => new C.ExprVar(ann(type),
  new C.Qualified(local ? Maybe.Nothing.value : new Maybe.Just("Fixture"), name));
const int = C.Int.value;
const a = new C.TypeVar("a");

test("global specialization preserves the type of every intermediate application", () => {
  const generic = new C.ForAll(["a"], fn([a, a], a));
  const choose = new C.Binding(ann(generic), "choose",
    new C.ExprAbs(ann(fn([a, a], a)), "left",
      new C.ExprAbs(ann(fn([a], a)), "right", variable("left", a, true))));
  const partial = new C.ExprApp(ann(fn([int], int)),
    new C.ExprTypeApp(ann(fn([int, int], int)), variable("choose", generic), int),
    variable("left", int, true));
  const call = new C.ExprApp(ann(int), partial, variable("right", int, true));
  const caller = new C.Binding(ann(fn([int, int], int)), "caller",
    new C.ExprAbs(ann(fn([int, int], int)), "left",
      new C.ExprAbs(ann(fn([int], int)), "right", call)));
  const bindings = [choose, caller];
  const module = { name: "Fixture", exports: ["caller"],
    decls: bindings.map(binding => new C.NonRec(binding)) };
  const globals = bindings.reduce((map, binding) =>
    Map.insert(Ord.ordString)(`Fixture.${binding.value1}`)(binding)(map), Map.empty);
  const instances = M.collectInstantiations(globals)(Map.empty)(module);
  const rewritten = M.monomorphize(globals)(instances)(module);
  const result = rewritten.decls.find(bind => bind.value0.value1 === "caller").value0.value2.value2.value2;
  assert.ok(result.value1.value1.value1.value1.startsWith("choose__"), "the call must select a specialization");
  assert.deepEqual(result.value0.type, new Maybe.Just(int));
  assert.deepEqual(result.value1.value0.type, new Maybe.Just(fn([int], int)));
  assert.deepEqual(result.value1.value1.value0.type, new Maybe.Just(fn([int, int], int)));
});
