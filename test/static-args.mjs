// After building PBO: node test/static-args.mjs [compiled-output-directory]
// Pass the backend's output directory to test the exact PBO build it uses.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord, Tuple] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord", "Data.Tuple",
].map(load));
const ann = { type: Maybe.Nothing.value, meta: Maybe.Nothing.value };
const local = name => new C.ExprVar(ann, new C.Qualified(Maybe.Nothing.value, name));
const global = name => new C.ExprVar(ann, new C.Qualified(new Maybe.Just("Fixture"), name));
const apply = (fn, arg) => new C.ExprApp(ann, fn, arg);
const lambda = (name, body) => new C.ExprAbs(ann, name, body);

// Execute the specialized expression with the same argument order as its caller.
function evaluate(expr, globals, locals = {}) {
  if (expr instanceof C.ExprVar) {
    const qualified = expr.value1;
    return (qualified.value0 instanceof Maybe.Just ? globals : locals)[qualified.value1];
  }
  if (expr instanceof C.ExprAbs) {
    return value => evaluate(expr.value2, globals, { ...locals, [expr.value1]: value });
  }
  if (expr instanceof C.ExprApp) {
    return evaluate(expr.value1, globals, locals)(evaluate(expr.value2, globals, locals));
  }
  throw new Error(`Unexpected fixture expression: ${expr.constructor.name}`);
}

test("map keeps a dynamic callback before a static array", () => {
  const specialized = M.applyStaticArgs([])([local("callback"), global("cases")])(global("map"));
  const mapped = evaluate(specialized, {
    map: f => values => values.map(f),
    cases: [null, true, 3],
  })(value => value === null ? "null" : "not null")([null, true, 3]);
  assert.deepEqual(mapped, ["null", "not null", "not null"]);
});

for (const explicit of [false, true]) {
  for (let mask = 0; mask < 8; mask++) {
    test(`${explicit ? "lambda" : "eta expansion"} preserves argument positions, static mask ${mask}`, () => {
      const names = ["first", "second", "third"];
      const args = names.map((name, i) => mask & (1 << i) ? global(name) : local(name));
      const body = explicit
        ? names.reduceRight((rest, name) => lambda(name, rest),
            names.reduce((fn, name) => apply(fn, local(name)), global("collect")))
        : global("collect");
      const specialized = M.applyStaticArgs([])(args)(body);
      const fn = evaluate(specialized, {
        collect: a => b => c => [a, b, c], first: 11, second: 22, third: 33,
      });
      assert.deepEqual(fn(11)(22)(33), [11, 22, 33]);
    });
  }
}

test("static dictionary removal preserves the normal argument order", () => {
  const body = lambda("dict", lambda("callback", lambda("values",
    apply(apply(local("dict"), local("callback")), local("values")))));
  const specialized = M.applyStaticArgs([global("map")])(
    [local("callback"), global("cases")])(body);
  const fn = evaluate(specialized, { map: f => xs => xs.map(f), cases: [1, 2] });
  assert.deepEqual(fn(x => x + 10)([1, 2]), [11, 12]);
});

for (let mask = 0; mask < 4; mask++) {
  test(`dynamic dictionary keeps its position before normal arguments, static mask ${mask}`, () => {
    const names = ["first", "second"];
    const normalArgs = names.map((name, i) => mask & (1 << i) ? global(name) : local(name));
    const body = lambda("dict", lambda("first", lambda("second",
      ["dict", ...names].reduce((fn, name) => apply(fn, local(name)), global("collect")))));
    const specialized = M.applyStaticArgs([local("dict")])(normalArgs)(body);
    const fn = evaluate(specialized, {
      collect: dictionary => first => second => [dictionary, first, second],
      first: 22, second: 33,
    });
    assert.deepEqual(fn(11)(22)(33), [11, 22, 33]);
  });
}

test("eta expansion advances each parameter and application annotation", () => {
  const typedAnn = type => ({ ...ann, type: new Maybe.Just(type) });
  const int = C.Int.value;
  const string = C.String.value;
  const pair = new C.ADT("Data.Tuple.Tuple", ["Data", "Tuple", "Tuple"], [int, string]);
  const fullType = new C.Func([int, string], pair);
  const residualType = new C.Func([string], pair);
  const head = new C.ExprVar(typedAnn(fullType), new C.Qualified(new Maybe.Just("Fixture"), "pair"));
  const args = [int, string].map((type, i) =>
    new C.ExprVar(typedAnn(type), new C.Qualified(Maybe.Nothing.value, `arg${i}`)));
  const outer = M.applyStaticArgs([])(args)(head);
  assert.ok(outer instanceof C.ExprAbs);
  assert.deepEqual(outer.value0.type, new Maybe.Just(fullType));
  const inner = outer.value2;
  assert.ok(inner instanceof C.ExprAbs);
  assert.deepEqual(inner.value0.type, new Maybe.Just(residualType));
  const saturated = inner.value2;
  assert.ok(saturated instanceof C.ExprApp);
  assert.deepEqual(saturated.value0.type, new Maybe.Just(pair));
  assert.deepEqual(saturated.value2.value0.type, new Maybe.Just(string));
  assert.equal(saturated.value2.value1.value1, inner.value1);
  const partial = saturated.value1;
  assert.ok(partial instanceof C.ExprApp);
  assert.deepEqual(partial.value0.type, new Maybe.Just(residualType));
  assert.deepEqual(partial.value2.value0.type, new Maybe.Just(int));
  assert.equal(partial.value2.value1.value1, outer.value1);
});

test("a recursive specialization removes the static dictionary from its own calls", () => {
  const typedAnn = type => ({ ...ann, type: new Maybe.Just(type) });
  const a = new C.TypeVar("a");
  const int = C.Int.value;
  const func = type => new C.Func([type], type);
  const constrained = type => new C.ConstrainedType([
    new Tuple.Tuple(["Fixture", "Class"], [type]),
  ], func(type));
  const generic = new C.ForAll(["a"], constrained(a));
  const variable = (name, type, module = Maybe.Nothing.value) =>
    new C.ExprVar(typedAnn(type), new C.Qualified(module, name));
  const call = (type, dictionary, value) => new C.ExprApp(typedAnn(type),
    new C.ExprApp(typedAnn(func(type)),
      new C.ExprTypeApp(typedAnn(constrained(type)),
        variable("loop", generic, new Maybe.Just("Fixture")), type), dictionary), value);
  const loop = new C.Binding(typedAnn(generic), "loop",
    new C.ExprAbs(typedAnn(constrained(a)), "dict",
      new C.ExprAbs(typedAnn(func(a)), "value",
        call(a, variable("dict", C.Any.value), variable("value", a)))));
  const invoke = new C.Binding(typedAnn(func(int)), "invoke",
    new C.ExprAbs(typedAnn(func(int)), "value", call(int,
      variable("dictionary", C.Any.value, new Maybe.Just("Fixture")), variable("value", int))));
  const module = { name: "Fixture", decls: [new C.Rec([loop]), new C.NonRec(invoke)] };
  const insert = Map.insert(Ord.ordString);
  const globals = insert("Fixture.loop")(loop)(insert("Fixture.invoke")(invoke)(Map.empty));
  const instantiations = M.collectInstantiations(globals)(Map.empty)(module);
  const result = M.monomorphize(globals)(instantiations)(module);
  const bindings = result.decls.flatMap(bind => bind instanceof C.Rec ? bind.value0 : [bind.value0]);
  const specialized = bindings.find(binding => binding.value1.startsWith("loop__")
    && binding.value0.type instanceof Maybe.Just
    && binding.value0.type.value0 instanceof C.Func
    && binding.value0.type.value0.value0[0] === int);
  assert.ok(specialized, "the recursive function must have an Int specialization");
  let body = specialized.value2;
  const params = [];
  while (body instanceof C.ExprAbs) {
    params.push(body.value1);
    body = body.value2;
  }
  const spine = M.collectSpine(body);
  const values = spine.spine.filter(arg => arg instanceof M.SpineApp).map(arg => arg.value0);
  assert.equal(params.length, 1, "only the dynamic value parameter remains");
  assert.equal(spine.f_var.value1.value1, specialized.value1, "the recursive call targets its specialization");
  assert.equal(values.length, params.length, "the recursive call must not retain the removed dictionary");
  assert.equal(values[0].value1.value1, "value");
});
