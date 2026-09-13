// After building PBO: node test/foreign-specialization.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord, Unfoldable] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord", "Data.Unfoldable",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type, local = false) => new C.ExprVar(ann(type),
  new C.Qualified(local ? Maybe.Nothing.value : new Maybe.Just("Fixture"), name));
const func = (args, result) => new C.Func(args, result);
const int = C.Int.value;
const applyInt = (name, genericType, instantiatedType) =>
  new C.ExprTypeApp(ann(instantiatedType), variable(name, genericType), int);

test("transitive collection never embeds a specialization of a foreign function", () => {
  const a = new C.TypeVar("a");
  const arrayInt = new C.Array(int);
  const lengthType = new C.ForAll(["a"], func([new C.Array(a)], int));
  const keepType = new C.ForAll(["a"], func([a], a));
  const wrapperType = new C.ForAll(["a"], func([a], int));
  const lengthCall = new C.ExprApp(ann(int),
    applyInt("length", lengthType, func([arrayInt], int)), variable("values", arrayInt));
  const wrapperBody = new C.ExprApp(ann(int),
    applyInt("keep", keepType, func([int], int)), lengthCall);
  const bindings = [
    new C.Binding(ann(keepType), "keep",
      new C.ExprAbs(ann(func([a], a)), "x", variable("x", a, true))),
    new C.Binding(ann(wrapperType), "wrapper",
      new C.ExprAbs(ann(func([a], int)), "ignored", wrapperBody)),
    new C.Binding(ann(int), "main", new C.ExprApp(ann(int),
      applyInt("wrapper", wrapperType, func([int], int)), new C.ExprLit(ann(int), new C.LitInt(1)))),
  ];
  const module = { name: "Fixture", decls: bindings.map(binding => new C.NonRec(binding)) };
  const insert = Map.insert(Ord.ordString);
  const entries = Map.toUnfoldable(Unfoldable.unfoldableArray);
  // length is foreign: its type is available at calls, but it has no AST binding.
  const globalAstMap = bindings.reduce((map, binding) =>
    insert(`Fixture.${binding.value1}`)(binding)(map), Map.empty);
  const raw = M.collectInstantiations(globalAstMap)(Map.empty)(module);
  assert.ok(entries(raw).some(entry => entry.value0 === "Fixture.length"));
  const transitive = M.transitiveCollect(globalAstMap)(raw);

  for (const binding of entries(transitive)) {
    for (const specialization of entries(binding.value1)) {
      const { normalArgs, dictArgs } = specialization.value1;
      assert.doesNotMatch(JSON.stringify({ normalArgs, dictArgs }), /length__/,
        `${binding.value0} embeds a reference to a foreign specialization that cannot be emitted`);
    }
  }
});
