// After building PBO: node test/static-argument-keys.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord",
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type, local = false) => new C.ExprVar(ann(type),
  new C.Qualified(local ? Maybe.Nothing.value : new Maybe.Just("Fixture"), name));
const func = (args, result) => new C.Func(args, result);

test("the same static argument in different positions keeps distinct specializations", () => {
  const a = new C.TypeVar("a");
  const int = C.Int.value;
  const pairType = type => func([type, type], new C.Array(type));
  const generic = new C.ForAll(["a"], pairType(a));
  const callerType = func([int], new C.Array(int));
  const caller = (name, staticFirst) => {
    const fixed = variable("fixed", int);
    const dynamic = variable("value", int, true);
    const args = staticFirst ? [fixed, dynamic] : [dynamic, fixed];
    const head = new C.ExprTypeApp(ann(pairType(int)), variable("pair", generic), int);
    const applied = new C.ExprApp(ann(new C.Array(int)),
      new C.ExprApp(ann(func([int], new C.Array(int))), head, args[0]), args[1]);
    return new C.Binding(ann(callerType), name,
      new C.ExprAbs(ann(callerType), "value", applied));
  };
  const bindings = [
    new C.Binding(ann(int), "fixed", new C.ExprLit(ann(int), new C.LitInt(11))),
    new C.Binding(ann(generic), "pair",
      new C.ExprAbs(ann(pairType(a)), "left",
        new C.ExprAbs(ann(func([a], new C.Array(a))), "right",
          new C.ExprLit(ann(new C.Array(a)), new C.LitArray([
            variable("left", a, true), variable("right", a, true),
          ]))))),
    caller("staticFirst", true), caller("staticSecond", false),
    new C.Binding(ann(callerType), "partial",
      new C.ExprApp(ann(callerType),
        new C.ExprTypeApp(ann(pairType(int)), variable("pair", generic), int),
        variable("fixed", int))),
  ];
  const module = { name: "Fixture", decls: bindings.map(binding => new C.NonRec(binding)) };
  const insert = Map.insert(Ord.ordString);
  const globalAstMap = bindings.reduce((map, binding) =>
    insert(`Fixture.${binding.value1}`)(binding)(map), Map.empty);
  const instantiations = M.collectInstantiations(globalAstMap)(Map.empty)(module);
  const rewritten = M.monomorphize(globalAstMap)(instantiations)(module);
  const globals = Object.fromEntries(rewritten.decls.flatMap(decl =>
    (decl instanceof C.NonRec ? [decl.value0] : decl.value0).map(binding => [binding.value1, binding.value2])));
  const evaluate = (expr, locals = {}) => {
    if (expr instanceof C.ExprVar) return expr.value1.value0 instanceof Maybe.Nothing
      ? locals[expr.value1.value1] : evaluate(globals[expr.value1.value1]);
    if (expr instanceof C.ExprAbs) return value => evaluate(expr.value2, { ...locals, [expr.value1]: value });
    if (expr instanceof C.ExprApp) return evaluate(expr.value1, locals)(evaluate(expr.value2, locals));
    if (expr instanceof C.ExprTypeApp) return evaluate(expr.value1, locals);
    if (expr instanceof C.ExprLit && expr.value1 instanceof C.LitInt) return expr.value1.value0;
    if (expr instanceof C.ExprLit && expr.value1 instanceof C.LitArray)
      return expr.value1.value0.map(value => evaluate(value, locals));
    throw new Error(`Unexpected fixture expression: ${expr?.constructor.name}`);
  };
  assert.deepEqual([
    evaluate(globals.staticFirst)(22), evaluate(globals.staticSecond)(22),
    evaluate(globals.partial)(22),
  ], [[11, 22], [22, 11], [11, 22]]);
  assert.equal(Object.keys(globals).filter(name => name.startsWith("pair__")).length, 3,
    "different argument positions and supplied arities need distinct specialization keys");
});
