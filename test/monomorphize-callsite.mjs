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
const [C, M, Maybe, Map, Ord, Tuple] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe", "Data.Map", "Data.Ord", "Data.Tuple",
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
