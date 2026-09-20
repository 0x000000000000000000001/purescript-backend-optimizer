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
const temporary = await mkdtemp(resolve(tmpdir(), "pbo-monomorphize-cache-"));
after(() => rm(temporary, { recursive: true, force: true }));

async function variant(name, forceMiss) {
  // Only the guard is replaced. All constructors and dependency modules remain
  // shared with the fixtures, so instanceof and prototype comparisons are real.
  const bundled = await build({
    stdin: {
      contents: source + `
        const cacheChecks = { checks: 0, hits: 0 };
        const originalInputsGuard = sameInstantiationInputs;
        sameInstantiationInputs = a => b => {
          const same = originalInputsGuard(a)(b);
          cacheChecks.checks++;
          if (same) cacheChecks.hits++;
          return same;
        };
        export { sameInstantiationInputs as inputsGuard, cacheChecks };
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
  // Cache hit/miss must not change the traversal or even the persistent Map's
  // shape here; deep comparison includes every instantiation field and caller.
  assert.deepStrictEqual(actual, expected);
  return actual;
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
  cached.cacheChecks.checks = cached.cacheChecks.hits = 0;
  const actual = collectBoth(chain(8));
  const names = entries(actual).map(entry => entry.value0);
  for (const name of [...Array.from({ length: 8 }, (_, i) => `Chain.f${i}`), "Chain.leaf"]) {
    assert.ok(names.includes(name), `must discover ${name}`);
  }
  assert.ok(cached.cacheChecks.hits > 0, "exercise cache reuse, not only cache misses");
  assert.equal(reference.cacheChecks.hits, 0, "reference always recomputes the prefix");
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
