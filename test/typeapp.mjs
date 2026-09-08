// After building PBO, run: node test/typeapp.mjs [compiled-output-directory]
// The optional directory permits testing the exact PBO build used by a backend.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = (name) => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, S, Sem, Sub, Maybe, Tuple, Map, Ord, Foldable] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Syntax",
  "PureScript.Backend.Optimizer.Semantics",
  "PureScript.Backend.Optimizer.TypeSubstitution",
  "Data.Maybe", "Data.Tuple", "Data.Map", "Data.Ord", "Data.Foldable",
].map(load));

const pair = (left, right) => new Tuple.Tuple(left, right);
const variable = (name) => new C.TypeVar(name);
const func = (args, result) => new C.Func(args, result);
const forall = (vars, body) => new C.ForAll(vars, body);
const typed = (type, expr) => new S.Typed(type, expr);
const local = (name, level) => new S.Local(new Maybe.Just(name), level);
const lambda = (names, body) => new S.Abs(names.map((name, level) =>
  pair(new Maybe.Just(name), level)), body);
const a = variable("a");
const b = variable("b");
const int = C.Int.value;
const string = C.String.value;
const nothing = Maybe.Nothing.value;
const substitution = (entries) => Map.fromFoldable(Ord.ordString)(Foldable.foldableArray)(
  entries.map(([name, type]) => pair(name, type)));
const substitute = (entries, type) => Sub.substitute(substitution(entries))(type);
const instantiate = (type, expr) => {
  const result = Sem.instantiateNeutralType(type)(expr);
  assert.ok(result instanceof Maybe.Just, "An explicit quantifier must be instantiated");
  return result.value0;
};
const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
let passed = 0;
let failed = 0;
const test = (name, run) => {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}\n${error.stack}`);
  }
};

test("independent instantiations leave the shared generic AST unchanged", () => {
  const generic = freeze(typed(forall(["a"], func([a], a)),
    lambda(["value"], typed(a, local("value", 0)))));
  for (const type of [int, string, b, int]) {
    assert.deepStrictEqual(instantiate(type, generic),
      typed(func([type], type), lambda(["value"], typed(type, local("value", 0)))));
  }
  assert.deepStrictEqual(generic, typed(forall(["a"], func([a], a)),
    lambda(["value"], typed(a, local("value", 0)))));
});

test("an inner ForAll shadows the instantiated variable in all its annotations", () => {
  const innerType = forall(["a"], func([a], a));
  const inner = typed(innerType, new S.Abs([pair(new Maybe.Just("innerValue"), 2)],
    typed(a, local("innerValue", 2))));
  const generic = typed(forall(["a"], func([a], a)), lambda(["outerValue"],
    new S.Let(new Maybe.Just("inner"), 1, inner, typed(a, local("outerValue", 0)))));
  assert.deepStrictEqual(instantiate(int, generic), typed(func([int], int),
    lambda(["outerValue"], new S.Let(new Maybe.Just("inner"), 1,
      inner, typed(int, local("outerValue", 0))))));
});

test("successive @b @String arguments cannot capture the caller's free b", () => {
  const generic = typed(forall(["a", "b"], func([a, b], a)),
    lambda(["left", "right"], typed(a, local("left", 0))));
  const first = instantiate(b, generic);
  assert.ok(first.value0 instanceof C.ForAll);
  const [fresh] = first.value0.value0;
  assert.notEqual(fresh, "b", "The remaining binder must be alpha-renamed");
  assert.deepStrictEqual(first, typed(forall([fresh], func([b, variable(fresh)], b)),
    lambda(["left", "right"], typed(b, local("left", 0)))));
  assert.deepStrictEqual(instantiate(string, first), typed(func([b, string], b),
    lambda(["left", "right"], typed(b, local("left", 0)))));
});

test("alpha-renaming also updates annotations bound by the remaining quantifier", () => {
  const generic = typed(forall(["a", "b"], func([a, b], b)),
    lambda(["left", "right"], typed(b, local("right", 1))));
  const first = instantiate(b, generic);
  const [fresh] = first.value0.value0;
  assert.deepStrictEqual(first.value1.value1, typed(variable(fresh), local("right", 1)));
  assert.deepStrictEqual(instantiate(string, first), typed(func([b, string], string),
    lambda(["left", "right"], typed(string, local("right", 1)))));
});

test("fresh binders avoid names occurring only in nested expression annotations", () => {
  const reserved = variable("b_typeapp0");
  const generic = typed(forall(["a", "b"], func([a, b], a)),
    lambda(["left", "right"], new S.Let(new Maybe.Just("unused"), 2,
      typed(reserved, S.PrimUndefined.value), typed(a, local("left", 0)))));
  const first = instantiate(b, generic);
  const [fresh] = first.value0.value0;
  assert.notEqual(fresh, "b");
  assert.notEqual(fresh, "b_typeapp0");
  assert.deepStrictEqual(first.value1.value1.value2,
    typed(reserved, S.PrimUndefined.value));
});

test("nested TypeApp arguments specialize while the reference's own ForAll stays generic", () => {
  const reference = typed(forall(["a"], func([a], a)),
    new S.Var(new C.Qualified(new Maybe.Just("Fixture"), "identity")));
  const generic = typed(forall(["a"], func([a], a)),
    new S.TypeApp(reference, a));
  assert.deepStrictEqual(instantiate(int, generic), typed(func([int], int),
    new S.TypeApp(reference, int)));
});

test("substitution is simultaneous rather than recursively replacing inserted variables", () => {
  assert.deepStrictEqual(substitute([["a", b], ["b", int]], func([a, b], a)),
    func([b, int], b));
});

test("substitution preserves an inner quantifier that shadows its key", () => {
  const type = forall(["a"], func([a], a));
  assert.deepStrictEqual(substitute([["a", int]], type), type);
});

test("capture avoidance preserves free variables and renames bound occurrences", () => {
  const result = substitute([["a", b]], forall(["b"], func([a, b], a)));
  assert.ok(result instanceof C.ForAll);
  const [fresh] = result.value0;
  assert.notEqual(fresh, "b");
  assert.deepStrictEqual(result, forall([fresh], func([b, variable(fresh)], b)));
});

test("records retain field order, open row tails, arrays, and ADT arguments", () => {
  const type = new C.Record(new C.Row([
    pair("zeta", a),
    pair("alpha", new C.Array(a)),
    pair("middle", new C.ADT("Data.Maybe.Maybe", ["Data", "Maybe", "Maybe"], [a])),
  ], new Maybe.Just(variable("row"))));
  assert.deepStrictEqual(substitute([["a", int], ["row", variable("remaining")]], type),
    new C.Record(new C.Row([
      pair("zeta", int),
      pair("alpha", new C.Array(int)),
      pair("middle", new C.ADT("Data.Maybe.Maybe", ["Data", "Maybe", "Maybe"], [int])),
    ], new Maybe.Just(variable("remaining")))));
});

test("constraints and higher-kinded type applications substitute structurally", () => {
  const constructor = new C.ADT("Data.Maybe.Maybe", ["Data", "Maybe", "Maybe"], []);
  const type = new C.ConstrainedType([
    pair(["Fixture", "Class"], [a, new C.TypeApp(variable("f"), [a])]),
  ], func([new C.TypeApp(variable("f"), [a])], new C.Array(a)));
  assert.deepStrictEqual(substitute([["a", string], ["f", constructor]], type),
    new C.ConstrainedType([
      pair(["Fixture", "Class"], [string, new C.TypeApp(constructor, [string])]),
    ], func([new C.TypeApp(constructor, [string])], new C.Array(string))));
});

test("closed row tails and opaque primitive types are preserved", () => {
  for (const type of [C.Any.value, C.Unit.value, C.Boolean.value, C.Number.value,
    C.Char.value, new C.TypeLevelString("label"), new C.Row([], nothing)]) {
    assert.deepStrictEqual(substitute([["a", int]], type), type);
  }
});

test("expressions without an explicit quantifier cannot guess an instantiation", () => {
  for (const expr of [local("value", 0), typed(a, local("value", 0)),
    typed(func([a], a), local("function", 0)),
    typed(forall([], func([a], a)), local("function", 0))]) {
    assert.ok(Sem.instantiateNeutralType(int)(expr) instanceof Maybe.Nothing);
  }
});

const extern = (body, directive = Sem.InlineAlways.value) => {
  const name = new C.Qualified(new Maybe.Just("Fixture"), "external");
  const env = {
    currentModule: "Fixture", locals: Map.empty, localsSize: 0,
    evalExternRef: () => () => nothing,
    evalExternSpine: () => () => () => nothing,
    directives: Map.singleton(new Sem.EvalExtern(name))(
      Map.singleton(Sem.InlineRef.value)(directive)),
  };
  // The explicit directive bypasses size-based heuristics. No analysis is needed.
  const implementation = pair({}, new Sem.ExternExpr([], body));
  return { name, env, evaluate: (spine) => Sem.evalExternFromImpl(env)(name)(implementation)(spine) };
};

test("an unconsumable external TypeApp cannot be erased by the runtime spine fallback", () => {
  const body = typed(func([a], a), lambda(["value"], typed(a, local("value", 0))));
  const { evaluate } = extern(body);
  const argument = new Sem.NeutLit(new C.LitInt(1));
  assert.ok(evaluate([new Sem.ExternTypeApp(int), new Sem.ExternApp([argument])])
    instanceof Maybe.Nothing);
});

test("a TypeApp after a value argument cannot instantiate the initial function scope", () => {
  const body = typed(func([int], forall(["a"], func([a], a))),
    lambda(["first"], typed(forall(["a"], func([a], a)),
      new S.Abs([pair(new Maybe.Just("second"), 1)], typed(a, local("second", 1))))));
  const { evaluate } = extern(body);
  assert.ok(evaluate([
    new Sem.ExternApp([new Sem.NeutLit(new C.LitInt(1))]),
    new Sem.ExternTypeApp(string),
  ]) instanceof Maybe.Nothing);
});

test("unapplied and partially applied external quantifiers keep the lexical body pending", () => {
  const body = typed(forall(["a", "b"], func([a, b], a)),
    lambda(["left", "right"], typed(a, local("left", 0))));
  const { evaluate } = extern(body);
  assert.ok(evaluate([]) instanceof Maybe.Nothing);
  assert.ok(evaluate([new Sem.ExternTypeApp(int)]) instanceof Maybe.Nothing);
});

test("InlineNever retains type arguments when it returns an opaque external reference", () => {
  const body = typed(forall(["a"], func([a], a)),
    lambda(["value"], typed(a, local("value", 0))));
  const { name, evaluate } = extern(body, Sem.InlineNever.value);
  const argument = new Sem.NeutLit(new C.LitInt(1));
  for (const withValue of [false, true]) {
    const spine = [new Sem.ExternTypeApp(int)];
    if (withValue) spine.push(new Sem.ExternApp([argument]));
    const result = evaluate(spine);
    // Nothing delegates to SemRef, which retains the entire original spine.
    if (result instanceof Maybe.Nothing) continue;
    assert.ok(result instanceof Maybe.Just);
    const reference = new Sem.SemTypeApp(int, new Sem.NeutStop(name));
    assert.deepStrictEqual(result.value0,
      withValue ? new Sem.NeutApp(reference, [argument]) : reference);
  }
});

test("curried and uncurried fallback calls preserve residual type applications", () => {
  const { name, env } = extern(local("unused", 0));
  const head = new Sem.SemTypeApp(int, new Sem.NeutVar(name));
  const args = [new Sem.NeutLit(new C.LitInt(1))];
  for (const [evaluate, Application] of [
    [Sem.evalApp, Sem.NeutApp],
    [Sem.evalUncurriedApp, Sem.NeutUncurriedApp],
    [Sem.evalUncurriedEffectApp, Sem.NeutUncurriedEffectApp],
  ]) {
    assert.deepStrictEqual(evaluate(env)(head)(args), new Application(head, args));
  }
});

console.log(`TypeApp scope regression tests: ${passed} passed, ${failed} failed (${output})`);
if (failed) process.exitCode = 1;
