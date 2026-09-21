// Final-IR liveness remains authoritative after source annotations are invalidated.
// After building PBO: node test/usage-metadata.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, S, Sem, Analysis, Maybe, Map, Tuple, Ord] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Syntax",
  "PureScript.Backend.Optimizer.Semantics", "PureScript.Backend.Optimizer.Analysis",
  "Data.Maybe", "Data.Map", "Data.Tuple", "Data.Ord",
].map(load));

const nothing = Maybe.Nothing.value;
const lookup = () => () => nothing;
const ctx = {
  currentModule: "Fixture", currentLevel: 0, lookupExtern: lookup, effect: false,
  analyze: () => Analysis.analyze(Sem.hasAnalysisBackendExpr)(Sem.hasSyntaxBackendExpr)(lookup),
};
const env = {
  instantiateNeutral: Sem.instantiateNeutralType,
  currentModule: "Fixture", locals: Map.empty, localsSize: 0, directives: Map.empty,
  evalExternRef: lookup, evalExternSpine: () => () => () => nothing,
};
const current = new C.Qualified(new Maybe.Just("Fixture"), "main");
const build = Sem.build(ctx);
const optimize = expr => Sem.optimize(false)(ctx)(env)(current)(20)(expr).value1;
const syntax = expr => Sem.freeze(expr).value1;
const int = value => build(new S.Lit(new C.LitInt(value)));
const local = (name, level) => build(new S.Local(new Maybe.Just(name), level));
const lambda = (name, level, body) => build(new S.Abs([
  new Tuple.Tuple(new Maybe.Just(name), level),
], body));
const record = () => build(new S.Lit(new C.LitRecord([new C.Prop("x", int(42))])));
const recordType = new C.Record(new C.Row([
  new Tuple.Tuple("x", C.Int.value),
], nothing));

const fixtures = [
  {
    name: "identity application", type: new C.Func([C.Int.value], C.Int.value),
    head: () => lambda("x", 0, local("x", 0)),
    apply: head => build(new S.App(head, [int(42)])),
    expected: () => int(42),
  },
  {
    name: "constant record projection", type: recordType,
    head: record, apply: head => build(new S.Accessor(head, new S.GetProp("x"))),
    expected: () => int(42),
  },
  {
    name: "constant record update", type: recordType,
    head: record, apply: head => build(new S.Update(head, [new C.Prop("x", int(7))])),
    expected: () => build(new S.Lit(new C.LitRecord([new C.Prop("x", int(7))]))),
  },
];

for (const fixture of fixtures) {
  test(`${fixture.name} reduces from the current backend tree`, () => {
    const actual = optimize(fixture.apply(fixture.head()));
    assert.deepStrictEqual(syntax(actual), syntax(fixture.expected()));
  });
}

test("beta reduction recomputes both uses of a substituted local", () => {
  const x = local("x", 1);
  const duplicate = lambda("x", 1, build(new S.Lit(new C.LitArray([x, x]))));
  const input = lambda("y", 0, build(new S.App(duplicate, [local("y", 0)])));
  const before = JSON.stringify(input);
  const result = optimize(input);
  const body = result.value1.value1;
  assert.ok(body.value1 instanceof S.Lit);
  assert.ok(body.value1.value0 instanceof C.LitArray);
  const actualUsage = Map.lookup(Ord.ordInt)(0)(body.value0.usages);
  assert.ok(actualUsage instanceof Maybe.Just);
  assert.equal(actualUsage.value0.total, 2);
  assert.equal(JSON.stringify(input), before, "Optimization must not mutate its input");
});

test("large expressions recompute occurrence counts in the chunked optimization path", () => {
  const body = build(new S.Lit(new C.LitArray(Array.from({ length: 2100 }, () => local("x", 0)))));
  const input = lambda("x", 0, body);
  assert.ok(input.value0.size > 2000, "The fixture must use chunked optimization");
  const result = optimize(input);
  const actualUsage = Map.lookup(Ord.ordInt)(0)(result.value1.value1.value0.usages);
  assert.ok(actualUsage instanceof Maybe.Just);
  assert.equal(actualUsage.value0.total, 2100);
});
