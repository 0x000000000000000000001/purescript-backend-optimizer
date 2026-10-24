// node test/optimization-profile.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const [B, C, S, Syn, M, Set, List, F, Maybe, T, E, U, A] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Semantics", "PureScript.Backend.Optimizer.Syntax",
  "Data.Map", "Data.Set", "Data.List", "Data.Foldable", "Data.Maybe", "Data.Tuple", "Effect.Class", "Data.Unfoldable",
  "PureScript.Backend.Optimizer.Analysis",
].map(name => import(pathToFileURL(resolve(output, name, "index.js")))));
const nothing = Maybe.Nothing.value, just = value => new Maybe.Just(value);
const q = (owner, ident) => new C.Qualified(just(owner), ident);
const int = C.Int.value, fn = new C.Func([int], int);
const ann = type => ({ span: C.emptySpan, type: just(type), meta: nothing, sourceUsage: nothing });
const literal = value => new C.ExprLit(ann(int), new C.LitInt(value));
const variable = (owner, ident, type = fn) => new C.ExprVar(ann(type), q(owner, ident));
const constantFunction = new C.ExprAbs(ann(fn), "x", literal(42));
const app = func => new C.ExprApp(ann(int), func, literal(7));
const moduleOf = (name, bindings, comments = []) => ({ name, path: name + ".purs", span: C.emptySpan, imports: [],
  exports: bindings.map(([name]) => name), reExports: [], dataDecls: [], classDecls: [], foreign: M.empty, comments,
  decls: bindings.map(([ident, value]) => new C.NonRec(new C.Binding(C.exprAnn(value), ident, value))) });
const modules = comments => [
  moduleOf("Producer", [["calculate", constantFunction]], comments),
  moduleOf("Consumer", [["answer", app(variable("Producer", "calculate"))]]),
];
const stripTyped = expr => expr instanceof Syn.Typed ? stripTyped(expr.value1) : expr;
const answer = result => stripTyped(result.at(-1).bindings[0].bindings[0].value1);
const binding = (result, name) => result.at(-1).bindings.flatMap(group => group.bindings)
  .find(entry => entry.value0 === name).value1;

// Independent evaluator of the ordinary syntax exercised below. Unexpected
// forms fail the test instead of being silently treated as equivalent output.
function evaluate(expr, locals = [], globals = {}) {
  if (expr instanceof Syn.Typed) return evaluate(expr.value1, locals, globals);
  if (expr instanceof Syn.TypeApp) return evaluate(expr.value0, locals, globals);
  if (expr instanceof Syn.Local) return locals[expr.value1];
  if (expr instanceof Syn.Var) {
    const key = `${expr.value0.value0.value0}.${expr.value0.value1}`;
    assert.ok(key in globals, `Missing runtime binding ${key}`);
    return globals[key];
  }
  if (expr instanceof Syn.Lit) {
    if (expr.value0 instanceof C.LitInt || expr.value0 instanceof C.LitBoolean) return expr.value0.value0;
    if (expr.value0 instanceof C.LitRecord)
      return Object.fromEntries(expr.value0.value0.map(prop => [prop.value0, evaluate(prop.value1, locals, globals)]));
  }
  if (expr instanceof Syn.Abs || expr instanceof Syn.UncurriedAbs) return (...args) => {
    const scope = locals.slice();
    expr.value0.forEach((param, i) => { scope[param.value1] = args[i]; });
    return evaluate(expr.value1, scope, globals);
  };
  if (expr instanceof Syn.Let) {
    const scope = locals.slice();
    scope[expr.value1] = evaluate(expr.value2, locals, globals);
    return evaluate(expr.value3, scope, globals);
  }
  if (expr instanceof Syn.Branch) {
    for (const pair of expr.value0) if (evaluate(pair.value0, locals, globals)) return evaluate(pair.value1, locals, globals);
    return evaluate(expr.value1, locals, globals);
  }
  if (expr instanceof Syn.App || expr instanceof Syn.UncurriedApp)
    return evaluate(expr.value0, locals, globals)(...expr.value1.map(arg => evaluate(arg, locals, globals)));
  if (expr instanceof Syn.Accessor) return evaluate(expr.value0, locals, globals)[expr.value1.value0];
  if (expr instanceof Syn.EffectPure) return () => evaluate(expr.value0, locals, globals);
  if (expr instanceof Syn.EffectDefer) return () => evaluate(expr.value0, locals, globals)();
  if (expr instanceof Syn.EffectBind) return () => {
    const scope = locals.slice();
    scope[expr.value1] = evaluate(expr.value2, locals, globals)();
    return evaluate(expr.value3, scope, globals)();
  };
  throw new Error(`Unexpected syntax: ${expr.constructor.name}`);
}

function references(expr, owner, ident) {
  if (expr instanceof Syn.Var && expr.value0.value0.value0 === owner && expr.value0.value1 === ident) return true;
  return expr !== null && typeof expr === "object" && Object.values(expr).some(child => references(child, owner, ident));
}

function run(profile, source, order = "sequential", reads = null) {
  const cwd = process.cwd(), directory = mkdtempSync(join(tmpdir(), "pbo-profile-"));
  process.chdir(directory);
  try {
    const bodies = [], queue = [];
    const options = { directives: M.empty, analyzeCustom: () => () => nothing, foreignSemantics: M.empty,
      traceIdents: Set.empty, rewriteLimit: 10000, onPrepareModule: () => mod => () => mod,
      onSkipModule: () => () => () => nothing,
      onCodegenModule: () => () => backend => () => () => { bodies.push(backend); } };
    const list = List.fromFoldable(F.foldableArray)(source);
    const reuse = () => () => () => () => {};
    const observer = reads === null ? nothing : just({
      onSkipModule: () => () => () => () => nothing,
      onReads: () => mod => value => () => { reads.push({ module: mod.name,
        implementations: M.toUnfoldable(U.unfoldableArray)(value.implementations),
        directives: M.toUnfoldable(U.unfoldableArray)(value.directives) }); },
    });
    if (order === "sequential") {
      const build = profile === null ? B.buildModulesWithObservation(E.monadEffectEffect)
        : B.buildModulesWithObservationAndProfile(E.monadEffectEffect)(profile);
      build(observer)(reuse)(options)(list)();
    } else {
      const build = profile === null ? B.buildModulesParallelWithBindingLookup(E.monadEffectEffect)
        : B.buildModulesParallelWithBindingLookupAndProfile(E.monadEffectEffect)(profile);
      build(nothing)(M.empty)(M.empty)(mod => () => mod)(nothing)(observer)(reuse)({ jobs: 4,
        scheduler: { fork: job => () => { queue.push(job); }, await: () => queue.pop()(undefined)() },
        onStats: nothing,
      })(options)(list)();
    }
    return bodies;
  } finally {
    process.chdir(cwd);
    rmSync(directory, { recursive: true, force: true });
  }
}

test("dev retains an ordinary imported call while release and historical APIs inline it", () => {
  for (const order of ["sequential", "lifo"]) {
    const historical = run(null, modules([]), order), release = run(S.Release.value, modules([]), order);
    assert.deepEqual(release, historical, `${order}: release must preserve the existing API`);
    assert.deepEqual(answer(release), new Syn.Lit(new C.LitInt(42)));
    const dev = answer(run(S.Dev.value, modules([]), order));
    assert.ok(dev instanceof Syn.App, `${order}: dev must retain a runtime call`);
    assert.deepEqual(stripTyped(dev.value0), new Syn.Var(q("Producer", "calculate")));
  }
});

test("dev honors explicit always/never directives and retains local simplification", () => {
  for (const directive of ["always", "never"]) {
    const source = modules([new C.LineComment(`@inline export calculate ${directive}`)]);
    for (const profile of [S.Dev.value, S.Release.value]) {
      const result = answer(run(profile, source));
      assert.equal(references(result, "Producer", "calculate"), directive === "never", directive);
      assert.equal(evaluate(result, [], { "Producer.calculate": () => 42 }), 42);
    }
  }
  const local = [moduleOf("Local", [["calculate", constantFunction], ["answer", app(variable("Local", "calculate"))]])];
  for (const profile of [S.Dev.value, S.Release.value]) {
    const result = binding(run(profile, local), "answer");
    assert.equal(references(result, "Local", "calculate"), false);
    assert.equal(evaluate(result), 42);
  }
});

test("dev preserves known dictionary member resolution", () => {
  const dictType = new C.Record(new C.Row([new T.Tuple("run", fn)], nothing));
  const dictionary = new C.ExprLit(ann(dictType), new C.LitRecord([new C.Prop("run", constantFunction)]));
  const accessor = new C.ExprAccessor(ann(fn), variable("Producer", "dictionary", dictType), "run");
  const source = [moduleOf("Producer", [["dictionary", dictionary]]), moduleOf("Consumer", [["answer", app(accessor)]])];
  const dev = run(S.Dev.value, source);
  assert.deepEqual(dev, run(S.Release.value, source));
  assert.deepEqual(answer(dev), new Syn.Lit(new C.LitInt(42)));
});

test("sequential and reverse worker completion preserve each profile independently", () => {
  const source = modules([]);
  const releaseBefore = run(S.Release.value, source);
  assert.deepEqual(run(S.Dev.value, source, "lifo"), run(S.Dev.value, source));
  assert.deepEqual(run(S.Release.value, source, "lifo"), releaseBefore);
  assert.deepEqual(run(null, source), releaseBefore, "a dev build cannot change the default profile");
});

test("dev still records imported implementations and directives for incremental invalidation", () => {
  const sequential = [], parallel = [];
  const source = modules([]);
  run(S.Dev.value, source, "sequential", sequential);
  run(S.Dev.value, source, "lifo", parallel);
  assert.deepEqual(parallel, sequential);
  const reads = sequential.find(entry => entry.module === "Consumer");
  assert.ok(reads.implementations.some(entry => entry.value1 &&
    entry.value0.value0.value0 === "Producer" && entry.value0.value1 === "calculate"));
  assert.ok(reads.directives.some(entry => entry.value0.value0.value0 === "Producer" &&
    entry.value0.value1 === "calculate"));
});

test("dev retains newtype erasure through explicit type applications", () => {
  const head = new C.ExprVar({ ...ann(fn), meta: just(C.IsNewtype.value) }, q("Producer", "Wrapper"));
  const wrapped = new C.ExprApp(ann(int), new C.ExprTypeApp(ann(fn), head, int), literal(7));
  const source = [moduleOf("Consumer", [["answer", wrapped]])];
  const dev = run(S.Dev.value, source);
  assert.deepEqual(dev, run(S.Release.value, source));
  assert.deepEqual(answer(dev), new Syn.Lit(new C.LitInt(7)));
});

function optimizerFixture() {
  const lookup = () => () => nothing;
  const ctx = { currentModule: "Probe", currentLevel: 0, lookupExtern: lookup, effect: false,
    analyze: context => (context.effect ? A.analyzeEffectBlock : A.analyze)
      (S.hasAnalysisBackendExpr)(S.hasSyntaxBackendExpr)(lookup) };
  const env = { currentModule: "Probe", locals: M.empty, localsSize: 0, directives: M.empty,
    lookupDirective: S.lookupDirective, instantiateNeutral: S.instantiateNeutralType,
    evalExternRef: lookup, evalExternSpine: () => () => () => nothing };
  const build = S.build(ctx), integer = n => build(new Syn.Lit(new C.LitInt(n)));
  const local = (name, level) => build(new Syn.Local(just(name), level));
  const abs = (name, level, body) => build(new Syn.Abs([new T.Tuple(just(name), level)], body));
  const call = (func, arg) => build(new Syn.App(func, [arg]));
  const record = value => build(new Syn.Lit(new C.LitRecord([new C.Prop("x", value), new C.Prop("y", value)])));
  const choose = (yes, no) => build(new Syn.Branch([new Syn.Pair(local("flag", 0), yes)], no));
  const discardedCall = (level = 0) => {
    const foreign = call(build(new Syn.Var(q("Foreign", "compute"))), integer(0));
    const body = build(new Syn.App(build(new Syn.Abs([
      new T.Tuple(just("a"), level + 1), new T.Tuple(just("b"), level + 2),
    ], integer(1))), [local("y", level), local("y", level)]));
    return build(new Syn.Let(just("y"), level, foreign, body));
  };
  const optimize = input => {
    const result = S.optimize(true)(ctx)(env)(q("Probe", "probe"))(30)(input);
    const frozen = S.freeze(result.value1);
    return { result, syntax: frozen.value1, analysis: frozen.value0, passes: result.value0.length - 1 };
  };
  return { build, integer, local, abs, call, record, choose, discardedCall, optimize };
}

test("normalization reaches the fixed point for multi-round branch semantics", () => {
  const { build, integer, local, abs, call, record, choose, optimize } = optimizerFixture();
  const inputs = [
    [abs("flag", 0, build(new Syn.Accessor(call(abs("n", 1, record(local("n", 1))),
      choose(integer(1), integer(2))), new Syn.GetProp("x")))), [2, 1], 2],
    [abs("flag", 0, call(call(abs("a", 1, local("a", 1)),
      choose(abs("x", 1, record(local("x", 1))), abs("x", 1, record(integer(9))))), integer(3))),
      [{ x: 9, y: 9 }, { x: 3, y: 3 }], 3],
  ];
  for (const [input, expected, passes] of inputs) {
    const result = optimize(input);
    assert.equal(result.passes, passes);
    assert.deepEqual([false, true].map(flag => evaluate(result.syntax)(flag)), expected);
    assert.equal(result.analysis.rewrite, false);
    assert.deepEqual(M.toUnfoldable(U.unfoldableArray)(result.analysis.usages), [], "closed lambda has no free locals");
  }
});

test("normalization completes unused-binding rewrites before freezing their dependencies", () => {
  const { discardedCall, optimize } = optimizerFixture();
  // y initially has two uses, so its opaque binding survives until pass one.
  // That pass removes both uses; merely freezing its RewriteInline would emit
  // Foreign.compute without recording its dependency or importing the module.
  const input = discardedCall();
  assert.ok(input instanceof S.ExprSyntax);
  const result = optimize(input);
  assert.equal(result.passes, 2);
  assert.equal(references(result.syntax, "Foreign", "compute"), false);
  assert.equal(result.analysis.rewrite, false);
  assert.deepEqual(M.toUnfoldable(U.unfoldableArray)(result.analysis.usages), []);
  assert.equal(evaluate(result.syntax), 1);
  assert.deepEqual(Set.toUnfoldable(U.unfoldableArray)(result.analysis.deps), []);
});

test("normalization preserves effect order while completing rewrites inside effect blocks", () => {
  const { build, discardedCall, optimize } = optimizerFixture();
  const input = build(new Syn.EffectBind(just("first"), 0, build(new Syn.Var(q("Foreign", "first"))),
    build(new Syn.EffectBind(just("second"), 1, build(new Syn.Var(q("Foreign", "second"))),
      build(new Syn.EffectPure(discardedCall(2)))))));
    const result = optimize(input), events = [];
    const effect = evaluate(result.syntax, [], { "Foreign.first": () => { events.push(11); return 11; },
      "Foreign.second": () => { events.push(22); return 22; }, "Foreign.compute": () => 99 });
    assert.deepEqual(events, [], "optimization must not move effects into construction");
    assert.equal(effect(), 1);
    assert.deepEqual(events, [11, 22]);
    assert.equal(result.analysis.rewrite, false);
    assert.deepEqual(M.toUnfoldable(U.unfoldableArray)(result.analysis.usages), []);
    const deps = Set.toUnfoldable(U.unfoldableArray)(result.analysis.deps).map(entry => entry.value1).sort();
    assert.deepEqual(deps, ["first", "second"]);
});

test("dev completes unused-binding normalization during module conversion", () => {
  const localVar = name => new C.ExprVar(ann(int), new C.Qualified(nothing, name));
  const inner = new C.ExprAbs(ann(fn), "b", literal(1));
  const outer = new C.ExprAbs(ann(new C.Func([int], fn)), "a", inner);
  const body = new C.ExprApp(ann(int), new C.ExprApp(ann(fn), outer, localVar("y")), localVar("y"));
  const expression = new C.ExprLet(ann(int), [new C.NonRec(new C.Binding(ann(int), "y", app(variable("Foreign", "compute"))))], body);
  const source = [moduleOf("Consumer", [["answer", expression]])];
  const dev = run(S.Dev.value, source), release = run(S.Release.value, source);
  assert.equal(references(answer(dev), "Foreign", "compute"), false);
  assert.deepEqual(Set.toUnfoldable(U.unfoldableArray)(dev[0].imports), []);
  assert.deepEqual(Set.toUnfoldable(U.unfoldableArray)(release[0].imports), []);
  assert.equal(evaluate(answer(dev)), 1);
  assert.equal(evaluate(answer(release)), 1);
});
