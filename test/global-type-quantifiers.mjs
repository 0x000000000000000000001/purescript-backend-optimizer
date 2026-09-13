// After building PBO: node test/global-type-quantifiers.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type, local = false) => new C.ExprVar(ann(type),
  new C.Qualified(local ? Maybe.Nothing.value : new Maybe.Just("Fixture"), name));
const func = (args, result) => new C.Func(args, result);

test("specializing a caller preserves the callee's own type quantifier", () => {
  const a = new C.TypeVar("a");
  const int = C.Int.value;
  const pair = type => new C.ADT("Data.Tuple.Tuple", ["Data", "Tuple", "Tuple"], [type, type]);
  const pairA = pair(a);
  const pairInt = pair(int);
  const singletonType = new C.ForAll(["a"], func([a], new C.Array(a)));
  const wrapperType = new C.ForAll(["a"], func([pairA], new C.Array(pairA)));
  const specializedWrapperType = func([pairInt], new C.Array(pairInt));
  const singletonAtPair = new C.ExprTypeApp(ann(func([pairA], new C.Array(pairA))),
    variable("singleton", singletonType), pairA);
  const wrapperAtInt = new C.ExprTypeApp(ann(specializedWrapperType),
    variable("wrapper", wrapperType), int);
  const bindings = [
    new C.Binding(ann(singletonType), "singleton",
      new C.ExprAbs(ann(func([a], new C.Array(a))), "x",
        new C.ExprLit(ann(new C.Array(a)), new C.LitArray([variable("x", a, true)])))),
    new C.Binding(ann(wrapperType), "wrapper",
      new C.ExprAbs(ann(func([pairA], new C.Array(pairA))), "pair",
        new C.ExprApp(ann(new C.Array(pairA)), singletonAtPair, variable("pair", pairA, true)))),
    new C.Binding(ann(specializedWrapperType), "main",
      new C.ExprAbs(ann(specializedWrapperType), "pair",
        new C.ExprApp(ann(new C.Array(pairInt)), wrapperAtInt, variable("pair", pairInt, true)))),
  ];
  const module = { name: "Fixture", exports: ["main"], decls: bindings.map(binding => new C.NonRec(binding)) };
  const insert = Map.insert(Ord.ordString);
  const globalAstMap = bindings.reduce((map, binding) =>
    insert(`Fixture.${binding.value1}`)(binding)(map), Map.empty);
  const collected = M.collectInstantiations(globalAstMap)(Map.empty)(module);
  // Isolate rewriting the caller; the callee stays polymorphic for inspection.
  const instantiations = Map.filterKeys(Ord.ordString)(name => name === "Fixture.wrapper")(collected);
  const rewritten = M.monomorphize(globalAstMap)(instantiations)(module);
  const rewrittenBindings = rewritten.decls.flatMap(decl => decl instanceof C.NonRec ? [decl.value0] : decl.value0);
  const wrapper = rewrittenBindings.find(binding => binding.value1.startsWith("wrapper__")
    && JSON.stringify(binding.value0.type.value0) === JSON.stringify(specializedWrapperType));
  assert.ok(wrapper, "the wrapper must be specialized at Int");

  const typeApplications = [];
  const visit = node => {
    if (!node || typeof node !== "object") return;
    if (node instanceof C.ExprTypeApp && node.value1 instanceof C.ExprVar
      && node.value1.value1.value1 === "singleton") typeApplications.push(node);
    for (const value of Object.values(node)) visit(value);
  };
  visit(wrapper.value2);
  assert.equal(typeApplications.length, 1);
  assert.deepEqual(typeApplications[0].value2, pairInt,
    "the type argument belongs to the caller and must become Tuple Int Int");
  assert.deepEqual(typeApplications[0].value1.value0.type.value0, singletonType,
    "the callee's bound a must remain independent of the caller's a = Int");
});
