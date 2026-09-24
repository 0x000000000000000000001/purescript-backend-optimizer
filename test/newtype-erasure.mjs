// Newtype erasure in the presence of compiler-injected VisibleTypeApp nodes.
// After building PBO (or the backend that embeds it):
//   node test/newtype-erasure.mjs [compiled-output-directory]
// The optional directory permits testing the exact PBO build used by a backend.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = (name) => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, Convert, Sem, Maybe, Map, Set, Syntax] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Convert",
  "PureScript.Backend.Optimizer.Semantics",
  "Data.Maybe", "Data.Map", "Data.Set",
  "PureScript.Backend.Optimizer.Syntax",
].map(load));

const nothing = Maybe.Nothing.value;
const just = (value) => new Maybe.Just(value);
const ann = (meta = nothing) => ({
  span: C.emptySpan, type: nothing, meta, sourceUsage: nothing,
});
const record = () => new C.ExprLit(ann(), new C.LitRecord([
  new C.Prop("map", new C.ExprLit(ann(), new C.LitString("f"))),
]));
const dictRef = () => new C.ExprVar(ann(just(C.IsNewtype.value)),
  new C.Qualified(just("Data.Functor"), "Functor$Dict"));
const plainRef = () => new C.ExprVar(ann(),
  new C.Qualified(just("Fixture"), "helper"));
const moduleOf = (expr) => ({
  name: "Fixture", path: "Fixture.purs", span: C.emptySpan, imports: [],
  exports: ["result"], reExports: [], dataDecls: [], classDecls: [],
  foreign: Map.empty, comments: [],
  decls: [new C.NonRec(new C.Binding(ann(), "result", expr))],
});
const options = {
  instantiateNeutral: Sem.instantiateNeutralType, analyzeCustom: () => () => nothing,
  currentModule: "Fixture", currentLevel: 0, toLevel: Map.empty, implementations: Map.empty,
  moduleImplementations: Map.empty, optimizationSteps: [], directives: Map.empty, dataTypes: Map.empty,
  foreignSemantics: Map.empty, rewriteLimit: 100, traceIdents: Set.empty,
};
const convert = (expr) => {
  const result = Convert.toBackendModule(moduleOf(expr))(options);
  const found = result.value1.bindings.flatMap((group) => group.bindings)
    .find((pair) => pair.value0 === "result");
  assert.ok(found, "Expected the result binding");
  let expression = found.value1;
  while (expression instanceof Syntax.Typed) expression = expression.value1;
  return expression;
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

test("a VisibleTypeApp-wrapped newtype application erases to its argument", () => {
  const wrapped = new C.ExprApp(ann(),
    new C.ExprTypeApp(ann(), dictRef(), C.Any.value), record());
  const result = convert(wrapped);
  assert.ok(result instanceof Syntax.Lit, `Expected a literal, got ${result.constructor.name}`);
  assert.ok(result.value0 instanceof C.LitRecord);
});

test("a bare newtype application still erases to its argument", () => {
  const bare = new C.ExprApp(ann(), dictRef(), record());
  const result = convert(bare);
  assert.ok(result instanceof Syntax.Lit, `Expected a literal, got ${result.constructor.name}`);
  assert.ok(result.value0 instanceof C.LitRecord);
});

test("a plain application keeps its residual type application", () => {
  const wrapped = new C.ExprApp(ann(),
    new C.ExprTypeApp(ann(), plainRef(), C.Any.value), record());
  const result = convert(wrapped);
  assert.ok(result instanceof Syntax.App, `Expected an application, got ${result.constructor.name}`);
  assert.ok(result.value0 instanceof Syntax.TypeApp);
});

console.log(`Newtype erasure regression tests: ${passed} passed, ${failed} failed (${output})`);
if (failed) process.exitCode = 1;
