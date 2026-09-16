// After building the backend: node test/source-usage.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [Json, Usage, Mono, Convert, Maybe, Either, Map, Set] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn.Json",
  "PureScript.Backend.Optimizer.CoreFn.Usage",
  "PureScript.Backend.Optimizer.Monomorphize",
  "PureScript.Backend.Optimizer.Convert",
  "Data.Maybe", "Data.Either", "Data.Map", "Data.Set",
].map(load));
const nothing = Maybe.Nothing.value;
const sourceSpan = { start: [1, 1], end: [1, 2] };
const ann = extra => ({ sourceSpan, type: null, meta: null, ...extra });
const bindingUsage = (bindingId, extra = {}) => ({ bindingId, maxUses: 1,
  hasEscapingUseContext: false, ...extra });
const variable = (name, bindingId) => ({ type: "Var", value: { identifier: name, sourcePos: [1, 1] },
  annotation: ann({ variableUse: { bindingId, lastLocalUse: true } }) });
const lambda = (name, bindingId, body) => ({ type: "Abs", argument: name, body,
  annotation: ann({ bindingUsage: bindingUsage(bindingId) }) });
const fixture = (name = "Fixture") => ({
  moduleName: [name], modulePath: `${name}.purs`, sourceSpan, imports: [], exports: ["identity"],
  reExports: {}, decls: [{ bindType: "NonRec", identifier: "identity", annotation: ann(),
    expression: lambda("x", 0, variable("x", 0)) }],
  foreign: [], comments: [], typeTable: [],
  usageAnalysis: { version: 1, phase: "corefn" },
});
const decode = json => {
  const result = Json.decodeModule(json);
  assert.ok(result instanceof Either.Right, `Expected successful decoding: ${JSON.stringify(result)}`);
  return result.value0;
};
const rejects = json => assert.ok(Json.decodeModule(json) instanceof Either.Left);
const expr = module => module.decls[0].value0.value2;
const facts = annotation => annotation.sourceUsage.value0;
const binding = module => facts(expr(module).value0).bindingUsage.value0;
const occurrence = module => facts(expr(module).value2.value0).variableUse.value0;
const rawExpr = json => json.decls[0].expression;
const collectUsage = value => {
  if (value === null || typeof value !== "object") return [];
  return [
    ...(Object.hasOwn(value, "sourceUsage") ? [value.sourceUsage] : []),
    ...Object.values(value).flatMap(collectUsage),
  ];
};

test("recognized facts retain their module-local identity and exact local values", () => {
  const module = decode(fixture());
  assert.deepEqual(binding(module), { binding: { moduleName: "Fixture", bindingId: 0 },
    maxUses: new Maybe.Just(1), hasEscapingUseContext: new Maybe.Just(false) });
  assert.deepEqual(occurrence(module), { binding: { moduleName: "Fixture", bindingId: 0 },
    lastLocalUse: new Maybe.Just(true) });
  assert.notDeepEqual(binding(module).binding, binding(decode(fixture("Other"))).binding);
});

test("a missing or unsupported root contract ignores even malformed source blocks", () => {
  for (const contract of [undefined, null, { version: 2, phase: "corefn" },
    { version: 1, phase: "optimized" }]) {
    const json = fixture();
    json.usageAnalysis = contract;
    rawExpr(json).annotation.bindingUsage = "unknown future format";
    const module = decode(json);
    assert.ok(collectUsage(module).every(value => value instanceof Maybe.Nothing));
  }
});

test("standalone decodeAnn cannot manufacture provenance or infer a contract", () => {
  const result = Json.decodeAnn([])("Fixture.purs")(rawExpr(fixture()).annotation);
  assert.ok(result instanceof Either.Right);
  assert.deepEqual(result.value0.sourceUsage, nothing);
});

test("missing and null optional facts remain unknown; legacy zero is never promoted", () => {
  for (const missing of [true, false]) {
    const json = fixture();
    const b = rawExpr(json).annotation.bindingUsage;
    const v = rawExpr(json).body.annotation.variableUse;
    if (missing) {
      delete b.maxUses;
      delete b.hasEscapingUseContext;
      delete v.lastLocalUse;
    } else {
      b.maxUses = null;
      b.hasEscapingUseContext = null;
      v.lastLocalUse = null;
    }
    rawExpr(json).annotation.usageCount = 0;
    rawExpr(json).annotation.escapes = false;
    const module = decode(json);
    assert.deepEqual(binding(module).maxUses, nothing);
    assert.deepEqual(binding(module).hasEscapingUseContext, nothing);
    assert.deepEqual(occurrence(module).lastLocalUse, nothing);
  }
});

test("large counts become unknown without the IntLiteral 2147483648 wraparound", () => {
  for (const count of [2147483648, 9007199254740992, 1e30]) {
    const json = fixture();
    rawExpr(json).annotation.bindingUsage.maxUses = count;
    assert.deepEqual(binding(decode(json)).maxUses, nothing);
  }
  const json = fixture();
  rawExpr(json).annotation.bindingUsage.maxUses = 0;
  assert.deepEqual(binding(decode(json)).maxUses, new Maybe.Just(0));
});

test("known-contract malformed numeric and boolean facts are rejected", () => {
  for (const maxUses of [-1, 0.5, "1"]) {
    const json = fixture(); rawExpr(json).annotation.bindingUsage.maxUses = maxUses; rejects(json);
  }
  for (const bindingId of [-1, 0.5, 2147483648, "0"]) {
    const json = fixture(); rawExpr(json).annotation.bindingUsage.bindingId = bindingId; rejects(json);
  }
  const json = fixture(); rawExpr(json).body.annotation.variableUse.lastLocalUse = false; rejects(json);
  const other = fixture(); rawExpr(other).annotation.bindingUsage.hasEscapingUseContext = 0; rejects(other);
});

test("duplicate IDs, unresolved occurrences and source facts on globals are rejected", () => {
  const duplicate = fixture(); rawExpr(duplicate).body = lambda("y", 0, variable("y", 0)); rejects(duplicate);
  const orphan = fixture(); rawExpr(orphan).body.annotation.variableUse.bindingId = 7; rejects(orphan);
  const global = fixture(); global.decls[0].annotation.bindingUsage = bindingUsage(4); rejects(global);
  const qualified = fixture(); rawExpr(qualified).body.value.moduleName = ["Fixture"]; rejects(qualified);
});

test("same-name nested bindings require their own identity, even if metadata is absent", () => {
  const valid = fixture(); rawExpr(valid).body = lambda("x", 1, variable("x", 1)); decode(valid);
  const wrong = fixture(); rawExpr(wrong).body = lambda("x", 1, variable("x", 0)); rejects(wrong);
  const unannotated = fixture(); rawExpr(unannotated).body = lambda("x", 1, variable("x", 0));
  delete rawExpr(unannotated).body.annotation.bindingUsage; rejects(unannotated);
});

test("invalidation removes source identities and proofs before transformed modules escape", () => {
  const original = decode(fixture());
  assert.ok(collectUsage(original).some(value => value instanceof Maybe.Just));
  const invalidated = Usage.invalidateSourceUsageModule(original);
  assert.ok(collectUsage(invalidated).every(value => value instanceof Maybe.Nothing));
  assert.ok(collectUsage(original).some(value => value instanceof Maybe.Just), "source remains immutable");
  const transformed = Mono.monomorphize(Map.empty)(Map.empty)(original);
  assert.ok(collectUsage(transformed).every(value => value instanceof Maybe.Nothing));
});

test("conversion never carries source certificates into the optimized backend IR", () => {
  const module = decode(fixture());
  const options = { analyzeCustom: () => () => nothing, currentModule: module.name,
    currentLevel: 0, toLevel: Map.empty, implementations: Map.empty,
    moduleImplementations: Map.empty, optimizationSteps: [], directives: Map.empty,
    dataTypes: Map.empty, foreignSemantics: Map.empty, rewriteLimit: 100,
    traceIdents: Set.empty };
  const result = Convert.toBackendModule(module)(options);
  assert.equal(collectUsage(result).length, 0);
});
