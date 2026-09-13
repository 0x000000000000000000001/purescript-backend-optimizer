// After building PBO: node test/static-dictionaries.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord, Tuple] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord", "Data.Tuple",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type, local = false) => new C.ExprVar(ann(type),
  new C.Qualified(local ? Maybe.Nothing.value : new Maybe.Just("Fixture"), name));
const func = (args, result) => new C.Func(args, result);
const int = C.Int.value;

test("different static dictionaries at the same type retain distinct behavior", () => {
  const a = new C.TypeVar("a");
  const dictType = type => new C.ADT("Fixture.Choice", ["Fixture", "Choice"], [type]);
  const constrained = new C.ConstrainedType([
    new Tuple.Tuple(["Fixture", "Choice"], [a]),
  ], func([a], int));
  const chooseType = new C.ForAll(["a"], constrained);
  const dictionary = (name, result) => new C.Binding(ann(dictType(int)), name,
    new C.ExprLit(ann(dictType(int)), new C.LitRecord([
      new C.Prop("choose", new C.ExprAbs(ann(func([int], int)), "x",
        new C.ExprLit(ann(int), new C.LitInt(result)))),
    ])));
  const call = name => new C.ExprApp(ann(int),
    new C.ExprApp(ann(func([int], int)),
      new C.ExprTypeApp(ann(constrained), variable("choose", chooseType), int),
      variable(name, dictType(int))),
    new C.ExprLit(ann(int), new C.LitInt(7)));
  const bindings = [
    dictionary("ascending", 1), dictionary("descending", -1),
    new C.Binding(ann(chooseType), "choose",
      new C.ExprAbs(ann(constrained), "dict", new C.ExprAbs(ann(func([a], int)), "x",
        new C.ExprApp(ann(int), new C.ExprAccessor(ann(func([a], int)),
          variable("dict", dictType(a), true), "choose"), variable("x", a, true))))),
    new C.Binding(ann(new C.Array(int)), "main",
      new C.ExprLit(ann(new C.Array(int)), new C.LitArray([call("ascending"), call("descending")]))),
  ];
  const module = { name: "Fixture", exports: ["main"], decls: bindings.map(b => new C.NonRec(b)) };
  const insert = Map.insert(Ord.ordString);
  const globalAstMap = bindings.reduce((map, binding) => insert(`Fixture.${binding.value1}`)(binding)(map), Map.empty);
  const instantiations = M.collectInstantiations(globalAstMap)(Map.empty)(module);
  const rewritten = M.monomorphize(globalAstMap)(instantiations)(module);
  const globals = Object.fromEntries(rewritten.decls.flatMap(decl =>
    (decl instanceof C.NonRec ? [decl.value0] : decl.value0).map(b => [b.value1, b.value2])));
  const evaluate = (expr, locals = {}) => {
    if (expr instanceof C.ExprVar) return expr.value1.value0 instanceof Maybe.Nothing
      ? locals[expr.value1.value1] : evaluate(globals[expr.value1.value1]);
    if (expr instanceof C.ExprAbs) return value => evaluate(expr.value2, { ...locals, [expr.value1]: value });
    if (expr instanceof C.ExprApp) return evaluate(expr.value1, locals)(evaluate(expr.value2, locals));
    if (expr instanceof C.ExprTypeApp) return evaluate(expr.value1, locals);
    if (expr instanceof C.ExprAccessor) return evaluate(expr.value1, locals)[expr.value2];
    if (expr instanceof C.ExprLit) {
      if (expr.value1 instanceof C.LitInt) return expr.value1.value0;
      if (expr.value1 instanceof C.LitArray) return expr.value1.value0.map(value => evaluate(value, locals));
      if (expr.value1 instanceof C.LitRecord) return Object.fromEntries(expr.value1.value0.map(prop => [prop.value0, evaluate(prop.value1, locals)]));
    }
    throw new Error(`Unexpected fixture expression: ${expr?.constructor.name}`);
  };
  assert.deepEqual(evaluate(globals.main), [1, -1]);
});
