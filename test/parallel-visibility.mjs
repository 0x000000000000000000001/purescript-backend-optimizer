// After building PBO: node test/parallel-visibility.mjs [compiled-output-directory]
//
// Vérifie le contrat de visibilité du builder parallèle :
// - une vue par rang n'expose jamais un module postérieur, même finalisé ;
// - un prédécesseur antérieur non finalisé est signalé et la tentative est
//   rejouée plus tard ;
// - le résultat final reste identique au builder séquentiel, y compris quand
//   les tâches se terminent dans le désordre.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [B, C, Convert, Cache, Maybe, Map, Set, List, Foldable, Ord, Ref, Syntax, Tuple, EffectClass] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Convert", "PureScript.Backend.Optimizer.Cache",
  "Data.Maybe", "Data.Map", "Data.Set", "Data.List", "Data.Foldable", "Data.Ord",
  "Effect.Ref", "PureScript.Backend.Optimizer.Syntax", "Data.Tuple", "Effect.Class",
].map(load));
const nothing = Maybe.Nothing.value;
const externMissing = Convert.ExternMissing.value;
const externPending = Convert.ExternPending.value;
const just = value => new Maybe.Just(value);
const ann = { span: C.emptySpan, type: just(C.Int.value), meta: nothing, sourceUsage: nothing };
const literal = value => new C.ExprLit(ann, new C.LitInt(value));
const variable = (module, name) => new C.ExprVar(ann, new C.Qualified(just(module), name));
const moduleOf = (name, entries, comments = []) => ({
  name, path: `${name}.purs`, span: C.emptySpan, imports: [], exports: entries.map(([ident]) => ident),
  reExports: [], dataDecls: [], classDecls: [], foreign: Map.empty, comments,
  decls: entries.map(([ident, expr]) => new C.NonRec(new C.Binding(ann, ident, expr))),
});

const options = collect => ({
  directives: Map.empty,
  analyzeCustom: () => () => nothing,
  foreignSemantics: Map.empty,
  traceIdents: Set.empty,
  rewriteLimit: 10000,
  onPrepareModule: () => mod => () => mod,
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

// Termine les tâches du lot dans l'ordre inverse, tout en renvoyant les
// résultats dans l'ordre d'entrée, comme un coordinateur réel. Avec
// `m = Effect`, une tâche est une fonction qui rend le calcul à exécuter.
const executeJob = job => job(undefined)();
const reversedJobs = jobs => () => {
  const results = new Array(jobs.length);
  for (let index = jobs.length - 1; index >= 0; index--) results[index] = executeJob(jobs[index]);
  return results;
};
const inOrderJobs = jobs => () => jobs.map(executeJob);

const runParallel = (modules, runJobs, jobs = 4) => {
  const collect = [];
  B.buildModulesParallel(EffectClass.monadEffectEffect)({ jobs, runJobs, onStats: Maybe.Nothing.value })(options(collect))(List.fromFoldable(Foldable.foldableArray)(modules))();
  return collect;
};

const bindingOf = (collected, module, ident) => {
  const entry = collected.find(item => item.name === module);
  assert.ok(entry, `Expected module ${module}`);
  const pair = entry.backendMod.bindings.flatMap(group => group.bindings).find(binding => binding.value0 === ident);
  assert.ok(pair, `Expected binding ${module}.${ident}`);
  let expression = pair.value1;
  while (expression instanceof Syntax.Typed) expression = expression.value1;
  return expression;
};

const isolatedPurmeta = t => {
  const previous = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), "pbo-parallel-visibility-"));
  process.chdir(temporary);
  Cache.beginPurmetaBuild();
  t.after(() => {
    Cache.beginPurmetaBuild();
    process.chdir(previous);
    rmSync(temporary, { recursive: true, force: true });
  });
};

test("rank lookup hides later modules, defers missing predecessors and reports outsiders as absent", () => {
  const qualified = (module, ident) => new C.Qualified(just(module), ident);
  const populated = entries => Map.fromFoldable(C.ordQualified(C.ordIdent))(Foldable.foldableArray)(entries);
  const indexByName = Map.fromFoldable(Ord.ordString)(Foldable.foldableArray)([
    new Tuple.Tuple("A", 0), new Tuple.Tuple("B", 1), new Tuple.Tuple("C", 2),
  ]);
  const laterImpls = populated([new Tuple.Tuple(qualified("C", "value"), "impl-C")]);
  const finalized = Map.fromFoldable(Ord.ordInt)(Foldable.foldableArray)([new Tuple.Tuple(2, laterImpls)]);
  const pendingRef = Ref.new(Set.empty)();
  const view = B.createRankLookup(EffectClass.monadEffectEffect)({ indexByName, currentIndex: 1, finalized })(pendingRef)();

  assert.equal(view("C")("value"), externMissing, "a later finalized module stays invisible");
  assert.equal(view("Z")("value"), externMissing, "a module outside the build is absent");
  assert.equal(Set.member(Ord.ordInt)(2)(Ref.read(pendingRef)()), false, "invisible modules are not recorded");
  assert.equal(view("A")("value"), externPending, "a missing predecessor is pending");
  assert.equal(Set.member(Ord.ordInt)(0)(Ref.read(pendingRef)()), true);

  const presentImpls = populated([new Tuple.Tuple(qualified("A", "value"), "impl-A")]);
  const withPredecessor = Map.fromFoldable(Ord.ordInt)(Foldable.foldableArray)([
    new Tuple.Tuple(0, presentImpls), new Tuple.Tuple(2, laterImpls),
  ]);
  const pendingRef2 = Ref.new(Set.empty)();
  const view2 = B.createRankLookup(EffectClass.monadEffectEffect)({ indexByName, currentIndex: 1, finalized: withPredecessor })(pendingRef2)();
  const found = view2("A")("value");
  assert.ok(found instanceof Convert.ExternFound, "a finalized predecessor is visible");
  assert.equal(found.value0, "impl-A");
  assert.equal(view2("A")("other"), externMissing, "an absent ident of a visible module is absent");
  assert.equal(Set.member(Ord.ordInt)(0)(Ref.read(pendingRef2)()), false);
});

test("parallel conversion matches the sequential reference with completed work out of order", t => {
  isolatedPurmeta(t);
  const modules = [
    moduleOf("Ahead", [["use", variable("Behind", "value")]]),
    moduleOf("Base", [["value", literal(9)]]),
    moduleOf("Behind", [["value", literal(7)]]),
    moduleOf("User", [["use", variable("Base", "value")]]),
  ];
  const reference = runReference(modules);
  for (const runJobs of [inOrderJobs, reversedJobs]) {
    const parallel = runParallel(modules, runJobs);
    assert.deepEqual(parallel, reference);
  }
  assert.ok(!(bindingOf(reference, "Ahead", "use") instanceof Syntax.Lit),
    "a later module must not be inlined into an earlier one");
  assert.ok(bindingOf(reference, "User", "use") instanceof Syntax.Lit,
    "an earlier finalized module is inlined in the reference");
});

test("parallel directive contributions match sequential accumulation", t => {
  isolatedPurmeta(t);
  const modules = [
    moduleOf("A", [["f", literal(42)]], [new C.LineComment("@inline export f never")]),
    moduleOf("B", [["use", variable("A", "f")]]),
    moduleOf("C", [["use", variable("A", "f")]]),
  ];
  const reference = runReference(modules);
  const parallel = runParallel(modules, inOrderJobs, 2);
  assert.deepEqual(parallel, reference);
  for (const [module, ident] of [["B", "use"], ["C", "use"]]) {
    assert.ok(!(bindingOf(reference, module, ident) instanceof Syntax.Lit), `${module}.${ident} must keep the call`);
    assert.ok(!(bindingOf(parallel, module, ident) instanceof Syntax.Lit), `${module}.${ident} must keep the call in parallel`);
  }
});
