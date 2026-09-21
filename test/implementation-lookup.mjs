// After building PBO: node test/implementation-lookup.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, Convert, Sem, Cache, Memo, Maybe, Map, Set, Syntax] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Convert",
  "PureScript.Backend.Optimizer.Semantics", "PureScript.Backend.Optimizer.Cache",
  "PureScript.Backend.Optimizer.BoundedMemo", "Data.Maybe", "Data.Map", "Data.Set",
  "PureScript.Backend.Optimizer.Syntax",
].map(load));
const nothing = Maybe.Nothing.value;
const ann = { span: C.emptySpan, type: new Maybe.Just(C.Int.value), meta: nothing, sourceUsage: nothing };
const literal = value => new C.ExprLit(ann, new C.LitInt(value));
const variable = (module, name) => new C.ExprVar(ann, new C.Qualified(new Maybe.Just(module), name));
const moduleOf = (name, entries) => ({
  name, path: `${name}.purs`, span: C.emptySpan, imports: [], exports: entries.map(([ident]) => ident),
  reExports: [], dataDecls: [], classDecls: [], foreign: Map.empty, comments: [],
  decls: entries.map(([ident, expr]) => new C.NonRec(new C.Binding(ann, ident, expr))),
});
const options = module => ({
  instantiateNeutral: Sem.instantiateNeutralType, analyzeCustom: () => () => nothing,
  currentModule: module.name, currentLevel: 0, toLevel: Map.empty, implementations: Map.empty,
  moduleImplementations: Map.empty, optimizationSteps: [], directives: Map.empty, dataTypes: Map.empty,
  foreignSemantics: Map.empty, rewriteLimit: 100, traceIdents: Set.empty,
});
const convert = module => Convert.toBackendModule(module)(options(module));
const memoizedLookup = () => {
  const calls = [];
  const lookup = Memo.createStringMemo(512)((module, ident) => {
    calls.push([module, ident]);
    return Convert.lookupPurmetaImplementation(module)(ident);
  })();
  return { calls, lookup };
};
const convertCached = (module, lookup) => Convert.toBackendModuleWithLookup(lookup)(module)(options(module));
const binding = (result, name) => {
  const found = result.value1.bindings.flatMap(group => group.bindings).find(pair => pair.value0 === name);
  assert.ok(found, `Expected binding ${name}`);
  return found.value1;
};
const integerBinding = (result, name) => {
  let expression = binding(result, name);
  while (expression instanceof Syntax.Typed) expression = expression.value1;
  assert.ok(expression instanceof Syntax.Lit && expression.value0 instanceof C.LitInt);
  return expression.value0.value0;
};
const publish = (name, entries) => Cache.writePurmetaSync(name)(convert(moduleOf(name, entries)).value1.implementations)();
const isolatedPurmeta = t => {
  const previous = process.cwd();
  const temporary = mkdtempSync(join(tmpdir(), "pbo-implementation-lookup-"));
  process.chdir(temporary);
  Cache.beginPurmetaBuild();
  t.after(() => {
    Cache.beginPurmetaBuild();
    process.chdir(previous);
    rmSync(temporary, { recursive: true, force: true });
  });
};

test("cached external lookup preserves conversion and distinguishes same names in different modules", t => {
  isolatedPurmeta(t);
  publish("Left", [["value", literal(7)]]);
  publish("Right", [["value", literal(9)]]);
  const module = moduleOf("Consumer", [
    ["left", variable("Left", "value")], ["again", variable("Left", "value")],
    ["right", variable("Right", "value")],
  ]);
  const { lookup, calls } = memoizedLookup();
  const result = convertCached(module, lookup);
  assert.deepEqual(result, convert(module));
  assert.deepEqual(binding(result, "left"), binding(result, "again"));
  assert.notDeepEqual(binding(result, "left"), binding(result, "right"));
  assert.equal(calls.filter(([module, ident]) => module === "Left" && ident === "value").length, 1);
  assert.equal(calls.filter(([module, ident]) => module === "Right" && ident === "value").length, 1);
});

test("a forward fallback miss cannot hide a local implementation added by a later binding", t => {
  isolatedPurmeta(t);
  const module = moduleOf("Local", [
    ["before", variable("Local", "later")], ["later", literal(42)],
    ["after", variable("Local", "later")],
  ]);
  const { lookup, calls } = memoizedLookup();
  const result = convertCached(module, lookup);
  assert.deepEqual(result, convert(module));
  assert.equal(integerBinding(result, "after"), 42);
  assert.equal(integerBinding(result, "later"), 42);
  assert.notDeepEqual(binding(result, "before"), binding(result, "after"), "the first lookup really was unresolved");
  assert.equal(calls.filter(([module, ident]) => module === "Local" && ident === "later").length, 1);
});

test("local implementations take priority over a conflicting purmeta implementation", t => {
  isolatedPurmeta(t);
  publish("Local", [["value", literal(999)]]);
  const module = moduleOf("Local", [["value", literal(42)], ["use", variable("Local", "value")]]);
  const { lookup, calls } = memoizedLookup();
  const result = convertCached(module, lookup);
  assert.deepEqual(result, convert(module));
  assert.equal(integerBinding(result, "use"), 42);
  assert.equal(integerBinding(result, "value"), 42);
  assert.equal(calls.filter(([module, ident]) => module === "Local" && ident === "value").length, 0);
});

test("fresh conversion caches observe newly published, replaced and reset purmeta", t => {
  isolatedPurmeta(t);
  const module = moduleOf("Consumer", [["use", variable("Dependency", "value")]]);
  const freshConversion = () => {
    const { lookup, calls } = memoizedLookup();
    const result = convertCached(module, lookup);
    assert.deepEqual(result, convert(module));
    assert.equal(calls.filter(([module, ident]) => module === "Dependency" && ident === "value").length, 1);
    return result;
  };
  const missing = freshConversion();
  publish("Dependency", [["value", literal(7)]]);
  const first = freshConversion();
  assert.notDeepEqual(binding(first, "use"), binding(missing, "use"));
  publish("Dependency", [["value", literal(9)]]);
  const replaced = freshConversion();
  assert.notDeepEqual(binding(replaced, "use"), binding(first, "use"));
  Cache.beginPurmetaBuild();
  assert.deepEqual(freshConversion(), missing, "a new build must not load the preceding build's publication");
});
