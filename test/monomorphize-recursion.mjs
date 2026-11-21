import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
// After building PBO: node test/monomorphize-recursion.mjs [compiled-output-directory]
const output =
  process.argv[2] ?? fileURLToPath(new URL("../output/", import.meta.url));
const load = (n) => import(pathToFileURL(resolve(output, n, "index.js")));
const [C, M, Maybe, Ord] = await Promise.all(
  [
    "PureScript.Backend.Optimizer.CoreFn",
    "Data.Map",
    "Data.Maybe",
    "Data.Ord",
  ].map(load),
);
const P = await load("PureScript.Backend.Optimizer.Monomorphize");
const { Just, Nothing } = Maybe,
  int = C.Int.value,
  bool = C.Boolean.value;
const ann = (type) => ({
  span: C.emptySpan,
  meta: Nothing.value,
  sourceUsage: Nothing.value,
  type: new Just(type),
});
const q = (owner, name) =>
  new C.Qualified(owner ? new Just(owner) : Nothing.value, name);
const v = (owner, name, type) => new C.ExprVar(ann(type), q(owner, name));
const lit = (x) =>
  new C.ExprLit(
    ann(typeof x === "boolean" ? bool : int),
    typeof x === "boolean" ? new C.LitBoolean(x) : new C.LitInt(x),
  );
const tv = (n) => new C.TypeVar(n),
  fn = (args, ret) => new C.Func(args, ret),
  list = (a) => new C.ADT("Fixture.List", ["Fixture", "List"], [a]);
const full = (a, b) => fn([fn([b, a], b), b, list(a)], b);
const poly = new C.ForAll(
  ["signatureA", "signatureB"],
  full(tv("signatureA"), tv("signatureB")),
);
const refPoly = new C.ForAll(
  ["referenceA", "referenceB"],
  full(tv("referenceA"), tv("referenceB")),
);
const app = (f, x, type) => new C.ExprApp(ann(type), f, x),
  abs = (name, type, body) => new C.ExprAbs(ann(type), name, body);
const callbackType = fn([int, int], int);
const callback = (name) => v("Ops", name, callbackType);
const pair = (f, a, b, type) => app(app(f, a, fn([type], type)), b, type);
function foldCall(name, a, b, f, acc, xs) {
  let ref = v("Fixture", name, refPoly);
  ref = new C.ExprTypeApp(
    ann(new C.ForAll(["referenceB"], full(a, tv("referenceB")))),
    ref,
    a,
  );
  ref = new C.ExprTypeApp(ann(full(a, b)), ref, b);
  return app(
    app(app(ref, f, fn([b, list(a)], b)), acc, fn([list(a)], b)),
    xs,
    b,
  );
}
function fixture(shadow = false) {
  const a = tv("bodyA"),
    b = tv("bodyB"),
    ft = fn([b, a], b);
  const local = (name, type) => v(null, name, type);
  let combined = pair(local("step", ft), local("acc", b), local("head", a), b);
  if (shadow)
    combined = new C.ExprCase(
      ann(b),
      [callback("subtract")],
      [
        new C.CaseAlternative(
          [new C.BinderVar(ann(ft), "step")],
          new C.Unconditional(combined),
        ),
      ],
    );
  const empty = new C.BinderConstructor(
    ann(list(a)),
    q("Fixture", "List"),
    q("Fixture", "Nil"),
    [],
  );
  const cons = new C.BinderConstructor(
    ann(list(a)),
    q("Fixture", "List"),
    q("Fixture", "Cons"),
    [new C.BinderVar(ann(a), "head"), new C.BinderVar(ann(list(a)), "tail")],
  );
  const alternatives = [
    new C.CaseAlternative(
      [new C.BinderNull(ann(ft)), new C.BinderVar(ann(b), "acc"), empty],
      new C.Unconditional(local("acc", b)),
    ),
    new C.CaseAlternative(
      [new C.BinderVar(ann(ft), "step"), new C.BinderVar(ann(b), "acc"), cons],
      new C.Unconditional(
        foldCall(
          "fold",
          a,
          b,
          local("step", ft),
          combined,
          local("tail", list(a)),
        ),
      ),
    ),
  ];
  const body = abs(
    "stepArg",
    full(a, b),
    abs(
      "seed",
      fn([b, list(a)], b),
      abs(
        "input",
        fn([list(a)], b),
        new C.ExprCase(
          ann(b),
          [local("stepArg", ft), local("seed", b), local("input", list(a))],
          alternatives,
        ),
      ),
    ),
  );
  const fold = new C.Binding(ann(poly), "fold", body);
  const runs = ["add", "subtract", "digits"].map(
    (name) =>
      new C.NonRec(
        new C.Binding(
          ann(fn([list(int)], int)),
          name,
          abs(
            "xs",
            fn([list(int)], int),
            foldCall(
              "fold",
              int,
              int,
              callback(name),
              lit(0),
              local("xs", list(int)),
            ),
          ),
        ),
      ),
  );
  const dynamic = new C.NonRec(
    new C.Binding(
      ann(fn([callbackType, list(int)], int)),
      "dynamic",
      abs(
        "f",
        fn([callbackType, list(int)], int),
        abs(
          "xs",
          fn([list(int)], int),
          foldCall(
            "fold",
            int,
            int,
            local("f", callbackType),
            lit(0),
            local("xs", list(int)),
          ),
        ),
      ),
    ),
  );
  return {
    name: "Fixture",
    path: "Fixture.purs",
    span: C.emptySpan,
    imports: [],
    comments: [],
    decls: [new C.Rec([fold]), ...runs, dynamic],
    exports: [],
    reExports: M.empty,
    dataDecls: [],
    classDecls: [],
    foreign: M.empty,
  };
}
const binds = (mod) =>
  mod.decls.flatMap((g) => (g instanceof C.NonRec ? [g.value0] : g.value0));
function transform(mod) {
  const snapshot = JSON.stringify(mod);
  const ast = binds(mod).reduce(
    (acc, b) => M.insert(Ord.ordString)("Fixture." + b.value1)(b)(acc),
    M.empty,
  );
  const raw = P.collectInstantiations(ast)(M.empty)(mod),
    all = P.transitiveCollect(ast)(raw);
  const result = P.monomorphize(ast)(all)(mod);
  assert.equal(JSON.stringify(mod), snapshot, "source IR stays immutable");
  return result;
}
function references(expr) {
  const found = [];
  function walk(x) {
    if (!x || typeof x !== "object") return;
    if (x instanceof C.ExprVar) found.push(x);
    for (const y of Object.values(x))
      Array.isArray(y) ? y.forEach(walk) : walk(y);
  }
  walk(expr);
  return found;
}
// Small evaluator for the fixture's pure CoreFn constructs. It executes the
// transformed recursive body, rather than duplicating the desired fold result.
function evaluateModule(mod, trace) {
  const definitions = new Map(
    binds(mod).map((b) => ["Fixture." + b.value1, b.value2]),
  );
  const globals = new Map(
    ["add", "subtract", "digits"].map((name) => [
      "Ops." + name,
      (a) => (b) => {
        trace.push([name, a, b]);
        return name === "add"
          ? (a + b) | 0
          : name === "subtract"
            ? (a - b) | 0
            : (a * 10 + b) | 0;
      },
    ]),
  );
  const global = (name) => {
    if (!globals.has(name))
      globals.set(name, evalExpr(definitions.get(name), new Map()));
    return globals.get(name);
  };
  function match(b, x, env) {
    if (b instanceof C.BinderNull) return true;
    if (b instanceof C.BinderVar) {
      env.set(b.value1, x);
      return true;
    }
    if (b instanceof C.BinderConstructor) {
      if (b.value2.value1 !== x.name) return false;
      return b.value3.every((child, i) => match(child, x.fields[i], env));
    }
    throw Error("unsupported fixture binder " + b.constructor.name);
  }
  function evalExpr(e, env) {
    if (e instanceof C.ExprVar)
      return e.value1.value0 instanceof Just
        ? global(e.value1.value0.value0 + "." + e.value1.value1)
        : env.get(e.value1.value1);
    if (e instanceof C.ExprTypeApp) return evalExpr(e.value1, env);
    if (e instanceof C.ExprLit) return e.value1.value0;
    if (e instanceof C.ExprAbs)
      return (x) => evalExpr(e.value2, new Map([...env, [e.value1, x]]));
    if (e instanceof C.ExprApp)
      return evalExpr(e.value1, env)(evalExpr(e.value2, env));
    if (e instanceof C.ExprCase) {
      const values = e.value1.map((x) => evalExpr(x, env));
      for (const alt of e.value2) {
        const branch = new Map(env);
        if (alt.value0.every((b, i) => match(b, values[i], branch)))
          return evalExpr(alt.value1.value0, branch);
      }
      throw Error("unmatched case");
    }
    throw Error("unsupported fixture expression " + e?.constructor.name);
  }
  return { global };
}
const asList = (xs) =>
  xs.reduceRight((tail, head) => ({ name: "Cons", fields: [head, tail] }), {
    name: "Nil",
    fields: [],
  });
test("renamed body variables keep recursive folds specialized with static and dynamic callbacks", () => {
  const mod = fixture(),
    result = transform(mod),
    specialized = binds(result).filter((b) => b.value1.startsWith("fold__"));
  assert.equal(
    specialized.length,
    4,
    "one worker per known callback plus the dynamic callback worker",
  );
  for (const b of specialized) {
    const refs = references(b.value2).filter(
      (x) =>
        x.value1.value0 instanceof Just &&
        x.value1.value0.value0 === "Fixture" &&
        x.value1.value1.startsWith("fold"),
    );
    assert.ok(refs.length);
    assert.ok(
      refs.every((x) => x.value1.value1 === b.value1),
      "recursion stays in the same specialization",
    );
  }
  for (const xs of [
    [],
    [1],
    [1, 2, 3],
    [2147483647, 1, 1],
    [-2147483648, -1, 2],
    Array.from({ length: 120 }, (_, i) => i),
  ])
    for (const name of ["add", "subtract", "digits", "dynamic"]) {
      const before = [],
        after = [];
      const original = evaluateModule(mod, before).global("Fixture." + name),
        optimized = evaluateModule(result, after).global("Fixture." + name);
      const callback = (trace) => (a) => (b) => {
        trace.push(["dynamic", a, b]);
        return (a * 10 + b) | 0;
      };
      const a =
        name === "dynamic"
          ? original(callback(before))(asList(xs))
          : original(asList(xs));
      const b =
        name === "dynamic"
          ? optimized(callback(after))(asList(xs))
          : optimized(asList(xs));
      assert.equal(b, a, name + " " + xs.length);
      assert.deepEqual(
        after,
        before,
        "callback order and arguments are preserved",
      );
    }
});
test("a nested case binder shadows a propagated static callback", () => {
  const mod = fixture(true),
    result = transform(mod);
  const before = [],
    after = [];
  const a = evaluateModule(mod, before).global("Fixture.add")(
    asList([1, 2, 3]),
  );
  const b = evaluateModule(result, after).global("Fixture.add")(
    asList([1, 2, 3]),
  );
  assert.equal(a, -6);
  assert.equal(b, a);
  assert.deepEqual(after, before);
});
