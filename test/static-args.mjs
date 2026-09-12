// After building PBO: node test/static-args.mjs [compiled-output-directory]
// Pass the backend's output directory to test the exact PBO build it uses.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Maybe",
].map(load));
const ann = { type: Maybe.Nothing.value, meta: Maybe.Nothing.value };
const local = name => new C.ExprVar(ann, new C.Qualified(Maybe.Nothing.value, name));
const global = name => new C.ExprVar(ann, new C.Qualified(new Maybe.Just("Fixture"), name));
const apply = (fn, arg) => new C.ExprApp(ann, fn, arg);
const lambda = (name, body) => new C.ExprAbs(ann, name, body);

// Execute the specialized expression with the same argument order as its caller.
function evaluate(expr, globals, locals = {}) {
  if (expr instanceof C.ExprVar) {
    const qualified = expr.value1;
    return (qualified.value0 instanceof Maybe.Just ? globals : locals)[qualified.value1];
  }
  if (expr instanceof C.ExprAbs) {
    return value => evaluate(expr.value2, globals, { ...locals, [expr.value1]: value });
  }
  if (expr instanceof C.ExprApp) {
    return evaluate(expr.value1, globals, locals)(evaluate(expr.value2, globals, locals));
  }
  throw new Error(`Unexpected fixture expression: ${expr.constructor.name}`);
}

test("map keeps a dynamic callback before a static array", () => {
  const specialized = M.applyStaticArgs([])([local("callback"), global("cases")])(global("map"));
  const mapped = evaluate(specialized, {
    map: f => values => values.map(f),
    cases: [null, true, 3],
  })(value => value === null ? "null" : "not null")([null, true, 3]);
  assert.deepEqual(mapped, ["null", "not null", "not null"]);
});

for (const explicit of [false, true]) {
  for (let mask = 0; mask < 8; mask++) {
    test(`${explicit ? "lambda" : "eta expansion"} preserves argument positions, static mask ${mask}`, () => {
      const names = ["first", "second", "third"];
      const args = names.map((name, i) => mask & (1 << i) ? global(name) : local(name));
      const body = explicit
        ? names.reduceRight((rest, name) => lambda(name, rest),
            names.reduce((fn, name) => apply(fn, local(name)), global("collect")))
        : global("collect");
      const specialized = M.applyStaticArgs([])(args)(body);
      const fn = evaluate(specialized, {
        collect: a => b => c => [a, b, c], first: 11, second: 22, third: 33,
      });
      assert.deepEqual(fn(11)(22)(33), [11, 22, 33]);
    });
  }
}

test("static dictionary removal preserves the normal argument order", () => {
  const body = lambda("dict", lambda("callback", lambda("values",
    apply(apply(local("dict"), local("callback")), local("values")))));
  const specialized = M.applyStaticArgs([global("map")])(
    [local("callback"), global("cases")])(body);
  const fn = evaluate(specialized, { map: f => xs => xs.map(f), cases: [1, 2] });
  assert.deepEqual(fn(x => x + 10)([1, 2]), [11, 12]);
});
