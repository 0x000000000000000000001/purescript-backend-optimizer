// After building PBO: node test/monomorphize-cache.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
// The output can belong to a backend workspace using PBO as a local dependency.
const { build } = createRequire(resolve(output, "../package.json"))("esbuild");
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, M, Maybe, Ord, Set, U] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "Data.Map.Internal", "Data.Maybe",
  "Data.Ord", "Data.Set", "Data.Unfoldable",
].map(load));
const compiled = resolve(output, "PureScript.Backend.Optimizer.Monomorphize/index.js");
const source = await readFile(compiled, "utf8");
assert.match(source, /var sameInstantiationInputs\s*=/, "rebuild PBO with the transitive cache first");
assert.match(source, /var sameDependencySizes\s*=/, "rebuild PBO with the dependency-aware cache first");
const temporary = await mkdtemp(resolve(tmpdir(), "pbo-monomorphize-cache-"));
after(() => rm(temporary, { recursive: true, force: true }));

async function variant(name, forceMiss) {
  // Only the guard is replaced. All constructors and dependency modules remain
  // shared with the fixtures, so instanceof and prototype comparisons are real.
  const bundled = await build({
    stdin: {
      contents: source + `
        const cacheChecks = { checks: 0, hits: 0, dependencyChecks: 0, dependencyHits: 0, dependencyMisses: 0 };
        const originalInputsGuard = sameInstantiationInputs;
        sameInstantiationInputs = a => b => {
          const same = originalInputsGuard(a)(b);
          cacheChecks.checks++;
          if (same) cacheChecks.hits++;
          return same;
        };
        const originalDependencyGuard = sameDependencySizes;
        sameDependencySizes = instantiations => dependencies => {
          const same = originalDependencyGuard(instantiations)(dependencies);
          cacheChecks.dependencyChecks++;
          cacheChecks[same ? "dependencyHits" : "dependencyMisses"]++;
          return same;
        };
        export { sameInstantiationInputs as inputsGuard,
          sameDependencySizes as dependencyGuard, collectDependencies as dependencies, cacheChecks };
      `,
      resolveDir: dirname(compiled),
      sourcefile: `${name}.js`,
      loader: "js",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [{
      name: "shared-dependencies-and-cache-miss-control",
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, args => {
          if (forceMiss && args.path === "./foreign.js") return { path: "identity", namespace: "cache-miss" };
          return { path: pathToFileURL(resolve(args.resolveDir, args.path)).href, external: true };
        });
        plugin.onLoad({ filter: /.*/, namespace: "cache-miss" }, () => ({
          contents: "export const sameIdentity = _a => _b => false;", loader: "js",
        }));
      },
    }],
  });
  const target = resolve(temporary, `${name}.mjs`);
  await writeFile(target, bundled.outputFiles[0].text);
  return import(pathToFileURL(target));
}
const [cached, reference] = await Promise.all([variant("cached", false), variant("reference", true)]);
const nothing = Maybe.Nothing.value, just = value => new Maybe.Just(value);
const int = C.Int.value, ii = new C.Func([int], int);
const ann = type => ({ span: C.emptySpan, meta: nothing, sourceUsage: nothing, type: just(type) });
const variable = name => new C.ExprVar(ann(ii), new C.Qualified(just("Chain"), name));
const insert = M.insert(Ord.ordString), entries = M.toUnfoldable(U.unfoldableArray);
const singleton = M.singleton;
const info = (changes = {}) => ({
  instType: ii, subst: M.empty, dictArgs: [], normalArgs: [],
  callers: Set.singleton("Caller"), ...changes,
});
const seedInfo = info();
const initial = singleton("Chain.f0")(singleton("seed")(seedInfo));

function chain(length, end = "leaf") {
  let global = M.empty;
  for (let i = 0; i < length; i++) {
    const name = `f${i}`;
    const body = variable(i + 1 < length ? `f${i + 1}` : end);
    global = insert(`Chain.${name}`)(new C.Binding(ann(ii), name, body))(global);
  }
  const identity = new C.ExprAbs(ann(ii), "x", new C.ExprVar(ann(int), new C.Qualified(nothing, "x")));
  return insert(`Chain.${end}`)(new C.Binding(ann(ii), end, identity))(global);
}

function collectBoth(global, input = initial) {
  const expected = reference.transitiveCollect(global)(input);
  const actual = cached.transitiveCollect(global)(input);
  // Replaying a contribution can rebalance persistent Maps. Compare every key,
  // AST, substitution and caller without depending on their internal tree shape.
  assert.deepStrictEqual(normalize(actual), normalize(expected));
  return actual;
}

const setValues = Set.toUnfoldable(U.unfoldableArray);
function normalize(map) {
  return entries(map).map(({ value0: name, value1: instantiations }) => [name,
    entries(instantiations).map(({ value0: key, value1: value }) => [key, {
      ...value,
      subst: entries(value.subst).map(({ value0, value1 }) => [value0, value1]),
      callers: setValues(value.callers),
    }]),
  ]);
}

function resetChecks() {
  for (const key of Object.keys(cached.cacheChecks)) cached.cacheChecks[key] = 0;
}

test("cache guard ignores callers and rebuilt array containers, but invalidates every prefix input", () => {
  const argument = variable("argument");
  const original = info({ dictArgs: [argument], normalArgs: [argument] });
  const guard = other => cached.inputsGuard(original)(other);
  assert.equal(guard({ ...original, callers: Set.singleton("OtherCaller") }), true);
  assert.equal(guard({ ...original, dictArgs: [...original.dictArgs], normalArgs: [...original.normalArgs] }), true);
  for (const changes of [
    { instType: new C.Func([int], int) },
    { subst: singleton("a")(int) },
    { dictArgs: [] }, { dictArgs: [argument, argument] },
    { dictArgs: [variable("argument")] },
    { normalArgs: [] }, { normalArgs: [argument, argument] },
    { normalArgs: [variable("argument")] },
  ]) assert.equal(guard({ ...original, ...changes }), false);
});

test("transitive cache keeps discovering specializations after earlier bodies hit", () => {
  resetChecks();
  const actual = collectBoth(chain(8));
  const names = entries(actual).map(entry => entry.value0);
  for (const name of [...Array.from({ length: 8 }, (_, i) => `Chain.f${i}`), "Chain.leaf"]) {
    assert.ok(names.includes(name), `must discover ${name}`);
  }
  assert.ok(cached.cacheChecks.hits > 0, "exercise cache reuse, not only cache misses");
  assert.ok(cached.cacheChecks.dependencyHits > 0, "reuse complete contributions after dependencies stabilize");
  assert.ok(cached.cacheChecks.dependencyMisses > 0, "newly discovered dependencies must invalidate contributions");
  assert.equal(reference.cacheChecks.hits, 0, "reference always recomputes the prefix");
  assert.equal(reference.cacheChecks.dependencyChecks, 0, "forced prefix misses also disable contribution reuse");
});

test("transitive cache is local to each call even when specialization inputs are reused", () => {
  // Change f0 itself: the exact same seed info is passed to both calls. A cache
  // surviving the first call would therefore return the wrong prepared body.
  collectBoth(chain(1, "firstLeaf"));
  const changed = collectBoth(chain(1, "secondLeaf"));
  const names = entries(changed).map(entry => entry.value0);
  assert.ok(names.includes("Chain.secondLeaf"));
  assert.ok(!names.includes("Chain.firstLeaf"), "must not reuse bodies from another global AST");
  // Repeating the first request after the second must also remain independent.
  const repeated = collectBoth(chain(1, "firstLeaf"));
  assert.ok(!entries(repeated).some(entry => entry.value0 === "Chain.secondLeaf"));
});

test("identical specialization inputs for different globals do not share prepared bodies", () => {
  const first = chain(1, "firstLeaf");
  let global = insert("Chain.f1")(new C.Binding(ann(ii), "f1", variable("secondLeaf")))(first);
  global = insert("Chain.secondLeaf")(
    new C.Binding(ann(ii), "secondLeaf", new C.ExprAbs(ann(ii), "x", new C.ExprLit(ann(int), new C.LitInt(7)))),
  )(global);
  const input = insert("Chain.f1")(singleton("seed")(seedInfo))(initial);
  const names = entries(collectBoth(global, input)).map(entry => entry.value0);
  assert.ok(names.includes("Chain.firstLeaf"));
  assert.ok(names.includes("Chain.secondLeaf"));
});

test("caller propagation remains live while cached expression prefixes are reused", () => {
  const callers = Set.insert(Ord.ordString)("OtherCaller")(seedInfo.callers);
  const input = singleton("Chain.f0")(singleton("seed")({ ...seedInfo, callers }));
  const result = collectBoth(chain(5), input);
  const f0 = entries(result).find(entry => entry.value0 === "Chain.f0").value1;
  const seed = entries(f0).find(entry => entry.value0 === "seed").value1;
  assert.equal(Set.size(seed.callers), 2);
  assert.ok(entries(result).some(entry => entry.value0 === "Chain.leaf"));
});

test("dependency guard watches absent and growing globals, but ignores unrelated keys and caller changes", () => {
  const watched = singleton("Chain.target")(0);
  assert.equal(cached.dependencyGuard(M.empty)(watched), true);
  assert.equal(cached.dependencyGuard(singleton("Unrelated.target")(singleton("new")(seedInfo)))(watched), true);
  const one = singleton("Chain.target")(singleton("first")(seedInfo));
  assert.equal(cached.dependencyGuard(one)(watched), false, "an absent specialization can become available");
  const oneWatched = singleton("Chain.target")(1);
  assert.equal(cached.dependencyGuard(one)(oneWatched), true);
  const changedCallers = singleton("Chain.target")(singleton("first")({
    ...seedInfo, callers: Set.insert(Ord.ordString)("OtherCaller")(seedInfo.callers),
  }));
  assert.equal(cached.dependencyGuard(changedCallers)(oneWatched), true);
  const changedPayload = singleton("Chain.target")(singleton("first")(info({ normalArgs: [variable("other")] })));
  assert.equal(cached.dependencyGuard(changedPayload)(oneWatched), true, "only specialization membership is read");
  const two = singleton("Chain.target")(insert("second")(seedInfo)(singleton("first")(seedInfo)));
  assert.equal(cached.dependencyGuard(two)(oneWatched), false);
});

test("dependency collection includes nested arguments, static aliases, recursive bindings and guards", () => {
  const local = new C.ExprVar(ann(ii), new C.Qualified(nothing, "local"));
  const root = new C.ExprLet(ann(ii), [
    new C.NonRec(new C.Binding(ann(ii), "local", variable("alias"))),
    new C.Rec([new C.Binding(ann(ii), "recursive", variable("recursiveTarget"))]),
  ], new C.ExprCase(ann(ii), [variable("scrutinee")], [
    new C.CaseAlternative([], new C.Guarded([
      new C.Guard(variable("guard"), new C.ExprApp(ann(ii), local,
        new C.ExprApp(ann(ii), variable("outer"),
          new C.ExprTypeApp(ann(ii), variable("inner"), int)))),
    ])),
    new C.CaseAlternative([], new C.Unconditional(new C.ExprUpdate(ann(ii),
      new C.ExprAccessor(ann(ii), variable("record"), "field"),
      [new C.Prop("updated", new C.ExprLit(ann(ii), new C.LitRecord([
        new C.Prop("nested", new C.ExprAbs(ann(ii), "x", variable("recordValue"))),
      ])))]))),
  ]));
  assert.deepStrictEqual(setValues(cached.dependencies(root)), [
    "Chain.alias", "Chain.guard", "Chain.inner", "Chain.outer", "Chain.record",
    "Chain.recordValue", "Chain.recursiveTarget", "Chain.scrutinee",
  ]);
});

const typeVariable = new C.TypeVar("a");
const identityType = new C.ForAll(["a"], new C.Func([typeVariable], typeVariable));
const literal = value => new C.ExprLit(ann(int), new C.LitInt(value));
const foreignIdentityCall = value => new C.ExprApp(ann(int),
  new C.ExprTypeApp(ann(ii), new C.ExprVar(ann(identityType),
    new C.Qualified(just("Foreign"), "identity")), int), literal(value));

test("cached contributions preserve existing payloads and union callers on duplicate specialization keys", () => {
  // Foreign calls stay unspecialized, so both bodies contribute the same key on
  // every round. Dynamic argument values have the same key but distinct ASTs.
  let global = chain(7);
  global = insert("Chain.aSource")(new C.Binding(ann(ii), "aSource", foreignIdentityCall(1)))(global);
  global = insert("Chain.zSource")(new C.Binding(ann(ii), "zSource", foreignIdentityCall(2)))(global);
  const prior = cached.collectInstantiations(global)(M.empty)({
    name: "ExistingCaller",
    decls: [new C.NonRec(new C.Binding(ann(int), "prior", foreignIdentityCall(99)))],
  });
  let input = insert("Chain.f0")(singleton("seed")(seedInfo))(prior);
  input = insert("Chain.aSource")(singleton("seed")(seedInfo))(input);
  input = insert("Chain.zSource")(singleton("seed")(seedInfo))(input);
  resetChecks();
  const collectedCall = result => {
    const target = entries(result).find(({ value0 }) => value0 === "Foreign.identity").value1;
    const calls = entries(target).map(({ value1 }) => value1).filter(value => value.normalArgs.length === 1);
    assert.equal(calls.length, 1);
    return calls[0];
  };
  const call = collectedCall(collectBoth(global, input));
  assert.deepStrictEqual(call.normalArgs, [literal(99)], "insertWith preserves its existing payload on cache hits");
  assert.deepStrictEqual(setValues(call.callers), ["Chain", "ExistingCaller"]);
  const withoutPrior = insert("Chain.zSource")(singleton("seed")(seedInfo))(
    insert("Chain.aSource")(singleton("seed")(seedInfo))(initial));
  const first = collectedCall(collectBoth(global, withoutPrior));
  assert.deepStrictEqual(first.normalArgs, [literal(1)], "the first contributing body supplies a new key's payload");
  assert.ok(cached.cacheChecks.dependencyHits > 0);
});

test("a newly specialized static argument invalidates the enclosing call's cached contribution", () => {
  const qualify = (module, name, type) => new C.ExprVar(ann(type), new C.Qualified(just(module), name));
  const aa = new C.Func([typeVariable], typeVariable);
  const factoryType = new C.ForAll(["a"], new C.Func([typeVariable], ii));
  const useType = new C.ForAll(["a"], new C.Func([aa], aa));
  const factoryCall = new C.ExprApp(ann(ii),
    qualify("Generic", "factory", new C.Func([int], ii)), qualify("Values", "value", int));
  const outerCall = new C.ExprApp(ann(ii),
    qualify("Generic", "use", new C.Func([ii], ii)), factoryCall);
  const local = (name, type) => new C.ExprVar(ann(type), new C.Qualified(nothing, name));
  let global = chain(6);
  global = insert("Chain.aNested")(new C.Binding(ann(ii), "aNested", outerCall))(global);
  global = insert("Generic.factory")(new C.Binding(ann(factoryType), "factory",
    new C.ExprAbs(ann(new C.Func([typeVariable], ii)), "unused",
      new C.ExprAbs(ann(ii), "x", local("x", int)))))(global);
  global = insert("Generic.use")(new C.Binding(ann(useType), "use",
    new C.ExprAbs(ann(new C.Func([aa], aa)), "fn", local("fn", aa))))(global);
  const input = insert("Chain.aNested")(singleton("seed")(seedInfo))(initial);
  resetChecks();
  const result = collectBoth(global, input);
  const uses = entries(result).find(({ value0 }) => value0 === "Generic.use").value1;
  const keys = entries(uses).map(({ value0 }) => value0);
  assert.ok(keys.some(key => key.includes("factory__")),
    "the changed static argument must produce the enclosing call's new specialization key");
  assert.ok(cached.cacheChecks.dependencyMisses > 0);
  assert.ok(cached.cacheChecks.dependencyHits > 0);
});
