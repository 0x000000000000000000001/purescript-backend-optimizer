// node test/optimizer-observation.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const [B, C, Convert, O, S, M, Set, List, F, U, Maybe, T, E] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Convert", "PureScript.Backend.Optimizer.Observation",
  "PureScript.Backend.Optimizer.Semantics", "Data.Map", "Data.Set", "Data.List",
  "Data.Foldable", "Data.Unfoldable", "Data.Maybe", "Data.Tuple", "Effect.Class",
].map(name => import(pathToFileURL(resolve(output, name, "index.js")))));
const nothing = Maybe.Nothing.value, just = value => new Maybe.Just(value);
const q = (module, ident) => new C.Qualified(just(module), ident);
const entries = M.toUnfoldable(U.unfoldableArray);
const ann = { span: C.emptySpan, type: just(C.Int.value), meta: nothing, sourceUsage: nothing };
const literal = value => new C.ExprLit(ann, new C.LitInt(value));
const variable = (owner, ident) => new C.ExprVar(ann, q(owner, ident));
const moduleOf = (name, bindings, comments = []) => ({ name, path: name + ".purs", span: C.emptySpan, imports: [],
  exports: bindings.map(([name]) => name), reExports: [], dataDecls: [], classDecls: [], foreign: M.empty, comments,
  decls: bindings.map(([ident, value]) => new C.NonRec(new C.Binding(ann, ident, value))) });

test("observations retain initial directives, absences and pending owners despite local overrides", () => {
  const awaited = [];
  const before = M.singleton(new S.EvalExtern(q("Producer", "f")))(M.singleton(S.InlineRef.value)(S.InlineNever.value));
  const after = M.singleton(new S.EvalExtern(q("Producer", "f")))(M.singleton(S.InlineRef.value)(S.InlineAlways.value));
  const raw = () => () => Convert.ExternMissing.value;
  const observer = O.create("Consumer")(raw)(before)(owner => () => { awaited.push(owner); })(() => awaited.length > 0)();
  assert.deepEqual(observer.directive(new S.EvalExtern(q("Producer", "f")))(after), S.lookupDirective(new S.EvalExtern(q("Producer", "f")))(after));
  assert.equal(observer.implementation("Producer")("missing"), Convert.ExternMissing.value);
  observer.directive(new S.EvalExtern(q("Consumer", "local")))(M.empty);
  assert.equal(observer.view.pending(), true);
  const observed = observer.read();
  assert.deepEqual(entries(observed.directives), [new T.Tuple(q("Producer", "f"), just(M.singleton(S.InlineRef.value)(S.InlineNever.value)))]);
  assert.deepEqual(entries(observed.implementations), [new T.Tuple(q("Producer", "missing"), false)]);
  assert.deepEqual(awaited, ["Producer"]);
  assert.equal(observer.view.directive(q("Other", "missing")), nothing);
  assert.deepEqual(awaited, ["Producer", "Other"], "cache validation must also register directive-only pending owners");
});

test("only final attempts publish canonical reads, including hidden and forced-inline references", t => {
  const cwd = process.cwd(), directory = mkdtempSync(join(tmpdir(), "pbo-observation-"));
  process.chdir(directory);
  t.after(() => { process.chdir(cwd); rmSync(directory, { recursive: true, force: true }); });
  const untyped = { ...ann, type: nothing };
  const privateModule = moduleOf("Private", []);
  privateModule.decls = [new C.NonRec(new C.Binding(untyped, "hidden", new C.ExprLit(untyped, new C.LitInt(7))))];
  const modules = [
    moduleOf("Ahead", [["value", variable("Later", "value")]]),
    moduleOf("Producer", [["value", literal(42)]], [new C.LineComment("@inline export value never")]),
    privateModule,
    moduleOf("Consumer", [["blocked", variable("Producer", "value")], ["private", variable("Private", "hidden")], ["absent", variable("Missing", "value")]]),
    moduleOf("Later", [["value", literal(3)]]),
    moduleOf("Tail", [["value", variable("Consumer", "blocked")]]),
  ];
  const list = List.fromFoldable(F.foldableArray)(modules);
  const run = (order, observe) => {
    const bodies = [], reads = [], events = [], queue = [];
    let stats;
    const options = { directives: M.empty, analyzeCustom: () => () => nothing, foreignSemantics: M.empty,
      traceIdents: Set.empty, rewriteLimit: 10000, onPrepareModule: () => mod => () => mod,
      onSkipModule: () => () => () => nothing,
      onCodegenModule: () => mod => backend => () => () => { events.push("body:" + mod.name); bodies.push(backend); } };
    const observation = { onSkipModule: () => mod => view => () => {
      // This reader is absent from the module's syntax/import scheduling hints.
      // A speculative Tail must wait even though only its directive is read.
      if (mod.name === "Tail") view.directive(q("Later", "value"));
      return nothing;
    }, onReads: () => mod => value => () => {
      events.push("reads:" + mod.name);
      reads.push({ name: mod.name, implementations: entries(value.implementations), directives: entries(value.directives) });
    } };
    const observed = observe ? just(observation) : nothing;
    if (order === "sequential") B.buildModulesWithObservation(E.monadEffectEffect)(observed)(() => () => () => () => {})(options)(list)();
    else B.buildModulesParallelWithObservation(E.monadEffectEffect)(observed)(() => () => () => () => {})({ jobs: 8,
      scheduler: { fork: job => () => { queue.push(order === "eager" ? job(undefined)() : job); },
        await: () => order === "eager" ? queue.shift() : queue.pop()(undefined)() },
      onStats: just(value => () => { stats = value; }),
    })(options)(list)();
    return { bodies, reads, events, stats };
  };
  const reference = run("sequential", false), sequential = run("sequential", true);
  assert.deepEqual(sequential.bodies, reference.bodies);
  for (const order of ["eager", "lifo"]) {
    const parallel = run(order, true);
    assert.deepEqual(parallel.bodies, reference.bodies, order);
    assert.deepEqual(parallel.reads, sequential.reads, order);
    assert.deepEqual(parallel.events, modules.flatMap(mod => ["reads:" + mod.name, "body:" + mod.name]), order);
    if (order === "lifo") assert.ok(parallel.stats.deferredAttempts > 0, "fixture must execute a pending directive-only cache lookup");
  }
  const consumer = sequential.reads.find(entry => entry.name === "Consumer");
  assert.ok(consumer.implementations.some(({ value0, value1 }) => value0.value0.value0 === "Missing" && value1 === false));
  const privateRead = consumer.directives.find(({ value0 }) => value0.value0.value0 === "Private");
  assert.deepEqual(privateRead.value1, just(M.singleton(S.InlineRef.value)(S.InlineAlways.value)));
  const ahead = sequential.reads.find(entry => entry.name === "Ahead");
  assert.ok(ahead.implementations.some(({ value0, value1 }) => value0.value0.value0 === "Later" && value1 === false));
});
