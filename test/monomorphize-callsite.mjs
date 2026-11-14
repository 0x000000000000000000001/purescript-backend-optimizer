// After building PBO: node test/monomorphize-callsite.mjs [compiled-output-directory]
// Use a backend's output directory to test the exact PBO build it consumes.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Map, Ord, Tuple, Set] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord", "Data.Tuple", "Data.Set",
].map(load));

const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const variable = (name, type, global = false) => new C.ExprVar(ann(type),
  new C.Qualified(global ? new Maybe.Just("Fixture") : Maybe.Nothing.value, name));
const int = C.Int.value;
const unary = type => new C.Func([type], type);
const bindingsOf = module => module.decls.flatMap(bind =>
  bind instanceof C.Rec ? bind.value0 : [bind.value0]);

function typeVariables(type) {
  if (type instanceof C.TypeVar) return [type.value0];
  if (Array.isArray(type)) return type.flatMap(typeVariables);
  if (type !== null && typeof type === "object") return Object.values(type).flatMap(typeVariables);
  return [];
}

for (const dictionaryMode of ["none", "static", "dynamic"]) {
  test(`call-site ForAll names are instantiated independently of the definition (${dictionaryMode} dictionary)`, () => {
    const hasDictionary = dictionaryMode !== "none";
    const dynamicDictionary = dictionaryMode === "dynamic";
    const dictionaryType = new C.ADT("Fixture.Marker", ["Fixture", "Marker"], [int]);
    const signature = type => hasDictionary
      ? new C.ConstrainedType([new Tuple.Tuple(["Fixture", "Marker"], [type])], unary(type))
      : unary(type);
    // These are alpha-equivalent types, but their substitution maps have
    // different keys. A definition's a$def -> Int cannot rewrite a$call.
    const definitionVariable = new C.TypeVar("a$def");
    const callVariable = new C.TypeVar("a$call");
    const definitionType = new C.ForAll(["a$def"], signature(definitionVariable));
    const callType = new C.ForAll(["a$call"], signature(callVariable));
    let definitionBody = new C.ExprAbs(ann(unary(definitionVariable)), "value",
      variable("value", definitionVariable));
    if (hasDictionary) {
      definitionBody = new C.ExprAbs(ann(signature(definitionVariable)), "dictionary", definitionBody);
    }
    const definition = new C.Binding(ann(definitionType), "identity", definitionBody);
    let applied = new C.ExprTypeApp(ann(signature(int)), variable("identity", callType, true), int);
    if (hasDictionary) {
      applied = new C.ExprApp(ann(unary(int)), applied, dynamicDictionary
        ? variable("dictionary", dictionaryType)
        : variable("markerInt", dictionaryType, true));
    }
    applied = new C.ExprApp(ann(int), applied, variable("value", int));
    let invokeBody = new C.ExprAbs(ann(unary(int)), "value", applied);
    const invokeType = dynamicDictionary ? new C.Func([dictionaryType, int], int) : unary(int);
    if (dynamicDictionary) invokeBody = new C.ExprAbs(ann(invokeType), "dictionary", invokeBody);
    const invoke = new C.Binding(ann(invokeType), "invoke", invokeBody);
    const module = { name: "Fixture", decls: [new C.NonRec(definition), new C.NonRec(invoke)] };
    const insert = Map.insert(Ord.ordString);
    const globals = insert("Fixture.identity")(definition)(insert("Fixture.invoke")(invoke)(Map.empty));
    const instantiations = M.collectInstantiations(globals)(Map.empty)(module);
    const result = M.monomorphize(globals)(instantiations)(module);
    const bindings = bindingsOf(result);
    const rewrittenInvoke = bindings.find(binding => binding.value1 === "invoke");
    let application = rewrittenInvoke.value2;
    while (application instanceof C.ExprAbs) application = application.value2;
    const spine = M.collectSpine(application);
    const specializedName = spine.f_var.value1.value1;
    assert.match(specializedName, /^identity__/, "the caller must target an actual specialization");
    const specialized = bindings.find(binding => binding.value1 === specializedName);
    assert.ok(specialized, "the called specialization must exist");
    assert.deepEqual(specialized.value0.type, new Maybe.Just(dynamicDictionary ? signature(int) : unary(int)),
      "the specialized definition is concrete and retains its dynamic dictionary constraint");
    const valueArgs = spine.spine.filter(arg => arg instanceof M.SpineApp);
    assert.equal(valueArgs.length, dynamicDictionary ? 2 : 1,
      "only static dictionaries are removed from the call site");
    assert.equal(valueArgs.at(-1).value0.value1.value1, "value");
    if (dynamicDictionary) {
      assert.equal(valueArgs[0].value0.value1.value1, "dictionary");
      assert.deepEqual(application.value1.value0.type, new Maybe.Just(unary(int)),
        "applying the dynamic dictionary leaves Int -> Int");
    }
    assert.equal(spine.spine.some(arg => arg instanceof M.SpineTypeApp), false,
      "the specialized call no longer has a TypeApp");
    const callAnnotation = spine.f_var.value0.type;
    assert.deepEqual(typeVariables(callAnnotation), [],
      "the specialized call annotation must not retain the call-site variable a$call");
    assert.deepEqual(callAnnotation, new Maybe.Just(dynamicDictionary ? signature(int) : unary(int)),
      "the call is concrete and retains exactly its dynamic dictionary constraint");
    assert.deepEqual(application.value0.type, new Maybe.Just(int),
      "the saturated application result remains Int");
  });
}

test("eta expansion preserves callback parameter and intermediate application types", () => {
  const parameter = new C.TypeVar("a");
  const maybe = type => new C.ADT("Data.Maybe.Maybe", ["Data", "Maybe", "Maybe"], [type]);
  const callback = type => new C.Func([type], maybe(type));
  const signature = type => new C.Func([callback(type), type], int);
  const constrained = type => new C.ConstrainedType([new Tuple.Tuple(["Fixture", "Marker"], [type])], signature(type));
  const definitionType = new C.ForAll(["a"], constrained(parameter));
  const zero = new C.ExprLit(ann(int), new C.LitInt(0));
  // A binding between the dictionary and value lambdas requires eta expansion
  // after specialization. The callback's result differs from the enclosing Int.
  const body = new C.ExprAbs(ann(constrained(parameter)), "dictionary",
    new C.ExprLet(ann(signature(parameter)), [new C.NonRec(new C.Binding(ann(int), "token", zero))],
      new C.ExprAbs(ann(signature(parameter)), "callback",
        new C.ExprAbs(ann(new C.Func([parameter], int)), "value", variable("token", int)))));
  const definition = new C.Binding(ann(definitionType), "inspect", body);
  let applied = new C.ExprTypeApp(ann(constrained(int)), variable("inspect", definitionType, true), int);
  applied = new C.ExprApp(ann(signature(int)), applied,
    variable("markerInt", new C.ADT("Fixture.Marker", ["Fixture", "Marker"], [int]), true));
  const invoke = new C.Binding(ann(signature(int)), "invoke", applied);
  const module = { name: "Fixture", decls: [new C.NonRec(definition), new C.NonRec(invoke)] };
  const insert = Map.insert(Ord.ordString);
  const globals = insert("Fixture.inspect")(definition)(insert("Fixture.invoke")(invoke)(Map.empty));
  const instantiations = M.collectInstantiations(globals)(Map.empty)(module);
  const result = M.monomorphize(globals)(instantiations)(module);
  const specialized = bindingsOf(result).find(binding => binding.value1.startsWith("inspect__"));
  assert.ok(specialized);
  const firstLambda = specialized.value2;
  const secondLambda = firstLambda.value2;
  assert.ok(firstLambda instanceof C.ExprAbs);
  assert.ok(secondLambda instanceof C.ExprAbs);
  assert.equal(firstLambda.value1, "__eta0");
  assert.equal(secondLambda.value1, "__eta1");
  assert.deepEqual(firstLambda.value0.type, new Maybe.Just(signature(int)));
  assert.deepEqual(secondLambda.value0.type, new Maybe.Just(new C.Func([int], int)));
  const lastApplication = secondLambda.value2;
  const firstApplication = lastApplication.value1;
  assert.deepEqual(lastApplication.value0.type, new Maybe.Just(int));
  assert.deepEqual(firstApplication.value0.type, new Maybe.Just(new C.Func([int], int)));
  assert.deepEqual(firstApplication.value2.value0.type, new Maybe.Just(callback(int)));
  assert.deepEqual(lastApplication.value2.value0.type, new Maybe.Just(int));
});

test("eta expansion retains an unapplied dictionary before ordinary parameters", () => {
  const parameter = new C.TypeVar("a");
  const marker = type => new Tuple.Tuple(["Fixture", "Marker"], [type]);
  const dictionaryType = new C.ADT("Fixture.Marker", ["Fixture", "Marker"], [int]);
  const signature = type => new C.Func([C.String.value, type], int);
  const remaining = type => new C.ConstrainedType([marker(type)], signature(type));
  const constrained = type => new C.ConstrainedType([marker(type), marker(type)], signature(type));
  const definitionType = new C.ForAll(["a"], constrained(parameter));
  const zero = new C.ExprLit(ann(int), new C.LitInt(0));
  const body = new C.ExprAbs(ann(constrained(parameter)), "staticDictionary",
    new C.ExprLet(ann(remaining(parameter)), [new C.NonRec(new C.Binding(ann(int), "token", zero))],
      new C.ExprAbs(ann(remaining(parameter)), "dynamicDictionary",
        new C.ExprAbs(ann(signature(parameter)), "label",
          new C.ExprAbs(ann(new C.Func([parameter], int)), "value", variable("token", int))))));
  const definition = new C.Binding(ann(definitionType), "inspect", body);
  const module = { name: "Fixture", decls: [new C.NonRec(definition)] };
  const insert = Map.insert(Ord.ordString);
  const globals = insert("Fixture.inspect")(definition)(Map.empty);
  // Call-site instType can omit constraints already represented by dictArgs.
  const info = { instType: signature(int),
    dictArgs: [variable("markerInt", dictionaryType, true)], normalArgs: [],
    subst: insert("a")(int)(Map.empty), callers: Set.empty };
  const instantiations = insert("Fixture.inspect")(insert("partial-dictionary")(info)(Map.empty))(Map.empty);
  const specialized = bindingsOf(M.monomorphize(globals)(instantiations)(module))
    .find(binding => binding.value1.startsWith("inspect__"));
  assert.ok(specialized);
  const lambdas = [];
  let expression = specialized.value2;
  while (expression instanceof C.ExprAbs) {
    lambdas.push(expression);
    expression = expression.value2;
  }
  assert.equal(lambdas.length, 3, "dictionary, String and Int must each have a binder");
  assert.deepEqual(lambdas.map(lambda => lambda.value0.type),
    [remaining(int), signature(int), new C.Func([int], int)].map(type => new Maybe.Just(type)));
  const applications = [];
  while (expression instanceof C.ExprApp) {
    applications.unshift(expression);
    expression = expression.value1;
  }
  assert.deepEqual(applications.map(application => application.value2.value0.type),
    [dictionaryType, C.String.value, int].map(type => new Maybe.Just(type)));
  assert.deepEqual(applications.map(application => application.value0.type),
    [signature(int), new C.Func([int], int), int].map(type => new Maybe.Just(type)));
});

for (const recursive of [false, true]) {
  test(`local specialization preserves runtime dictionary parameters (recursive=${recursive})`, () => {
    const parameter = new C.TypeVar("a");
    const signature = type => new C.ConstrainedType(
      [new Tuple.Tuple(["Fixture", "Marker"], [type])], unary(type));
    const generic = new C.ForAll(["a"], signature(parameter));
    const local = new C.Binding(ann(generic), "identity",
      new C.ExprAbs(ann(signature(parameter)), "dictionary",
        new C.ExprAbs(ann(unary(parameter)), "value", variable("value", parameter))));
    let call = new C.ExprTypeApp(ann(signature(int)), variable("identity", generic), int);
    call = new C.ExprApp(ann(unary(int)), call,
      variable("markerInt", new C.ADT("Fixture.Marker", ["Fixture", "Marker"], [int]), true));
    call = new C.ExprApp(ann(int), call, variable("value", int));
    const invoke = new C.Binding(ann(unary(int)), "invoke",
      new C.ExprAbs(ann(unary(int)), "value",
        new C.ExprLet(ann(int), [recursive ? new C.Rec([local]) : new C.NonRec(local)], call)));
    const module = { name: "Fixture", decls: [new C.NonRec(invoke)] };
    const result = M.monomorphize(Map.empty)(Map.empty)(module);
    const body = bindingsOf(result)[0].value2.value2;
    assert.ok(body instanceof C.ExprLet);
    const bindings = body.value1.flatMap(bind => bind instanceof C.Rec ? bind.value0 : [bind.value0]);
    const specialized = bindings.find(binding => binding.value1.startsWith("identity__"));
    assert.ok(specialized, "local specialization must be emitted");
    assert.deepEqual(specialized.value0.type, new Maybe.Just(signature(int)),
      "local specialization retains the dictionary it still accepts");
    const spine = M.collectSpine(body.value2);
    assert.deepEqual(spine.f_var.value0.type, new Maybe.Just(signature(int)));
    assert.equal(spine.spine.filter(arg => arg instanceof M.SpineApp).length, 2);
  });
}
