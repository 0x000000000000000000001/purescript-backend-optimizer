// After building PBO: node test/parallel-scheduling.mjs [compiled-output-directory]
// Keep ready work, bound speculation, and preserve implicit-dependency retries.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [B, C, Cache, Maybe, Map, Set, List, Foldable, Syntax, EffectClass] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder",
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Cache",
  "Data.Maybe", "Data.Map", "Data.Set", "Data.List", "Data.Foldable",
  "PureScript.Backend.Optimizer.Syntax",
  "Effect.Class",
].map(load));

const nothing = Maybe.Nothing.value;
const just = value => new Maybe.Just(value);
const ann = { span: C.emptySpan, type: just(C.Int.value), meta: nothing, sourceUsage: nothing };
const literal = value => new C.ExprLit(ann, new C.LitInt(value));
const variable = (module, name) => new C.ExprVar(ann, new C.Qualified(just(module), name));
const moduleOf = (name, entries, imports = []) => ({
  name, path: `${name}.purs`, span: C.emptySpan,
  imports: imports.map(moduleName => new C.Import(ann, moduleName)),
  exports: entries.map(([ident]) => ident), reExports: [],
  dataDecls: [], classDecls: [], foreign: Map.empty, comments: [],
  decls: entries.map(([ident, expr]) => new C.NonRec(new C.Binding(ann, ident, expr))),
});
const options = (collect, prepared) => ({
  directives: Map.empty,
  analyzeCustom: () => () => nothing,
  foreignSemantics: Map.empty,
  traceIdents: Set.empty,
  rewriteLimit: 10000,
  onPrepareModule: () => coreFnModule => () => {
    if (prepared) prepared.push(coreFnModule.name);
    return coreFnModule;
  },
  onSkipModule: () => () => () => nothing,
  onCodegenModule: () => coreFnModule => backendMod => steps => () => {
    collect.push({ name: coreFnModule.name, backendMod, steps });
  },
});
const runReference = modules => {
  const collect = [];
  B.buildModules(EffectClass.monadEffectEffect)(options(collect))(List.fromFoldable(Foldable.foldableArray)(modules))();
  return collect;
};
const runParallel = (modules, scheduler, jobs, prepared) => {
  const collect = [];
  let stats = null;
  B.buildModulesParallel(EffectClass.monadEffectEffect)({
    jobs, scheduler, onStats: new Maybe.Just(value => () => { stats = value; }),
  })(options(collect, prepared))(List.fromFoldable(Foldable.foldableArray)(modules))();
  return { collect, stats };
};
const fifoScheduler = () => {
  const queue = [];
  return {
    fork: job => () => { queue.push(job); },
    await: () => { const job = queue.shift(); return job(undefined)(); },
  };
};
const eagerLifoScheduler = () => {
  const results = [];
  return {
    fork: job => () => { results.push(job(undefined)()); },
    await: () => results.pop(),
  };
};
const scriptedScheduler = positions => {
  const queue = [];
  let index = 0;
  return {
    fork: job => () => { queue.push(job); },
    await: () => {
      const requested = positions[index] ?? 0;
      index += 1;
      const position = Math.min(requested, queue.length - 1);
      const job = queue.splice(position, 1)[0];
      assert.ok(job, "scripted scheduler drained before the build finished");
      return job(undefined)();
    },
  };
};
const isolatedPurmeta = t => {
  const previous = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), "pbo-parallel-scheduling-"));
  process.chdir(temporary);
  Cache.beginPurmetaBuild();
  t.after(() => {
    Cache.beginPurmetaBuild();
    process.chdir(previous);
    rmSync(temporary, { recursive: true, force: true });
  });
};
const bindingOf = (collected, module, ident) => {
  const entry = collected.find(item => item.name === module);
  assert.ok(entry, `Expected module ${module}`);
  const pair = entry.backendMod.bindings.flatMap(group => group.bindings)
    .find(binding => binding.value0 === ident);
  assert.ok(pair, `Expected binding ${module}.${ident}`);
  let expression = pair.value1;
  while (expression instanceof Syntax.Typed) expression = expression.value1;
  return expression;
};
const codegenOrder = collected => collected.map(entry => entry.name);

test("a completion keeps previously ready modules dispatchable", t => {
  isolatedPurmeta(t);
  const modules = [0, 1, 2, 3].map(index =>
    moduleOf(`M${index}`, [["value", literal(index * 10)]]));
  const reference = runReference(modules);
  const { collect, stats } = runParallel(modules, fifoScheduler(), 2);
  assert.ok(stats, "onStats must report at the end of the build");
  assert.deepEqual(codegenOrder(collect), ["M0", "M1", "M2", "M3"]);
  assert.deepEqual(collect, reference);
  assert.equal(stats.dispatched, 4, "independent ready modules must be dispatched normally");
  assert.equal(stats.fallbackDispatched, 0, "ready modules do not need speculative fallback");
  assert.equal(stats.deferredAttempts, 0);
});
test("fallback skips unfinished referenced predecessors but may run dead imports", t => {
  isolatedPurmeta(t);
  const modules = [
    moduleOf("Source", [["value", literal(9)]]),
    moduleOf("Uses", [["use", variable("Source", "value")]]),
    moduleOf("DeadImport", [["dead", literal(42)]], ["Source"]),
  ];
  const reference = runReference(modules), prepared = [];
  const { collect, stats } = runParallel(modules, fifoScheduler(), 2, prepared);
  assert.ok(stats);
  assert.equal(stats.deferredAttempts, 0, "unfinished referenced predecessors must not be speculated");
  assert.equal(stats.fallbackDispatched, 1, "a dead import remains worth a speculative attempt");
  assert.deepEqual(prepared.slice(0, 2), ["Source", "DeadImport"]);
  assert.deepEqual(collect, reference);
  assert.ok(bindingOf(collect, "Uses", "use") instanceof Syntax.Lit);
});
test("an implicit dependency from an inverted-rank reference is replayed and woken", t => {
  isolatedPurmeta(t);
  const modules = [
    moduleOf("Base", [["wrap", variable("Late", "value")]]),
    moduleOf("Late", [["value", literal(7)]]),
    moduleOf("Consumer", [["use", variable("Base", "wrap")]]),
  ];
  const reference = runReference(modules), prepared = [];
  const { collect, stats } = runParallel(modules, eagerLifoScheduler(), 2, prepared);
  assert.ok(stats);
  assert.equal(stats.deferredAttempts, 1, "the hidden Late lookup rejects exactly one attempt");
  assert.equal(stats.wakeups, 1);
  assert.ok(stats.waitingPeak >= 1);
  assert.equal(prepared.filter(name => name === "Consumer").length, 2);
  assert.deepEqual(collect, reference);
  assert.ok(bindingOf(collect, "Consumer", "use") instanceof Syntax.Lit);
});
test("a waiting module is not re-dispatched by a soft-import completion", t => {
  isolatedPurmeta(t);
  const modules = [
    moduleOf("Base", [["wrap", variable("Late", "value")]]),
    moduleOf("Soft", [["value", literal(5)]]),
    moduleOf("Late", [["value", literal(7)]]),
    moduleOf("Consumer", [["use", variable("Base", "wrap")]], ["Soft"]),
  ];
  const reference = runReference(modules), prepared = [];
  const { collect, stats } = runParallel(modules, scriptedScheduler([0, 2, 0, 0, 0, 0]), 4, prepared);
  assert.ok(stats);
  assert.equal(stats.deferredAttempts, 1, "the implicit Late lookup is paid exactly once");
  assert.equal(stats.wakeups, 1);
  assert.equal(prepared.filter(name => name === "Consumer").length, 2,
    "the soft import's finalization must not requeue an already waiting Consumer");
  assert.deepEqual(collect, reference);
  assert.ok(bindingOf(collect, "Consumer", "use") instanceof Syntax.Lit);
});
