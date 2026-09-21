// After building PBO: node test/transitive-parallel.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, Mono, M, Maybe, Ord, Set, U, Aff, Either] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Map.Internal", "Data.Maybe", "Data.Ord", "Data.Set", "Data.Unfoldable",
  "Effect.Aff", "Data.Either",
].map(load));
const nothing = Maybe.Nothing.value, just = value => new Maybe.Just(value);
const int = C.Int.value, ii = new C.Func([int], int);
const ann = type => ({ span: C.emptySpan, meta: nothing, sourceUsage: nothing, type: just(type) });
const variable = name => new C.ExprVar(ann(ii), new C.Qualified(just("Chain"), name));
const literal = value => new C.ExprLit(ann(int), new C.LitInt(value));
const insert = M.insert(Ord.ordString), entries = M.toUnfoldable(U.unfoldableArray);
const singleton = M.singleton, setValues = Set.toUnfoldable(U.unfoldableArray);
const seedInfo = { instType: ii, subst: M.empty, dictArgs: [], normalArgs: [], callers: Set.singleton("Caller") };
const initial = singleton("Chain.f0")(singleton("seed")(seedInfo));
const runAff = aff => new Promise((resolve, reject) => {
  Aff.runAff(result => () => result instanceof Either.Left
    ? reject(result.value0) : resolve(result.value0))(aff)();
});

function chain(length, end = "leaf") {
  let globals = M.empty;
  for (let i = 0; i < length; i++) {
    const name = `f${i}`;
    globals = insert(`Chain.${name}`)(new C.Binding(ann(ii), name,
      variable(i + 1 < length ? `f${i + 1}` : end)))(globals);
  }
  const identity = new C.ExprAbs(ann(ii), "x", new C.ExprVar(ann(int), new C.Qualified(nothing, "x")));
  return insert(`Chain.${end}`)(new C.Binding(ann(ii), end, identity))(globals);
}

function normalize(map) {
  return entries(map).map(({ value0: name, value1: instantiations }) => [name,
    entries(instantiations).map(({ value0: key, value1: info }) => [key, {
      ...info,
      subst: entries(info.subst).map(({ value0, value1 }) => [value0, value1]),
      callers: setValues(info.callers),
    }]),
  ]);
}

// Finish jobs in reverse order, while satisfying the dispatcher's contract of
// returning results in input order. Separate event-loop callbacks exercise the
// Aff barrier between rounds; this does not claim native CPU parallelism.
function reversedDispatcher(rounds) {
  return jobs => Aff.makeAff(done => () => {
    const round = { count: jobs.length, completed: [], reused: 0 };
    rounds.push(round);
    const results = new Array(jobs.length);
    let remaining = jobs.length, failed = false;
    if (remaining === 0) {
      setImmediate(() => done(new Either.Right(results))());
    } else {
      for (let index = jobs.length - 1; index >= 0; index--) {
        setImmediate(() => {
          if (failed) return;
          try {
            const result = jobs[index](undefined);
            results[index] = result;
            if (result instanceof Maybe.Just && result.value0.reused) round.reused++;
            round.completed.push(index);
            if (--remaining === 0) done(new Either.Right(results))();
          } catch (error) {
            failed = true;
            done(new Either.Left(error))();
          }
        });
      }
    }
    return Aff.nonCanceler;
  });
}

async function collect(globals, input = initial) {
  const rounds = [];
  const before = normalize(input);
  const actual = await runAff(Mono.transitiveCollectWith(Aff.monadRecAff)(reversedDispatcher(rounds))(globals)(input));
  assert.deepEqual(normalize(actual), normalize(Mono.transitiveCollect(globals)(input)));
  assert.deepEqual(normalize(input), before, "jobs must not mutate the input snapshot");
  for (const round of rounds) {
    assert.deepEqual(round.completed, Array.from({ length: round.count }, (_, index) => round.count - 1 - index));
  }
  return { actual, rounds };
}

test("empty input terminates and returns the original fixed-point map", async () => {
  const { actual, rounds } = await collect(M.empty, M.empty);
  assert.equal(actual, M.empty);
  assert.deepEqual(rounds, [{ count: 0, completed: [], reused: 0 }]);
});

test("out-of-order jobs discover the same transitive fixed point and reuse stable cached contributions", async () => {
  const { actual, rounds } = await collect(chain(8));
  const names = entries(actual).map(({ value0 }) => value0);
  for (const name of [...Array.from({ length: 8 }, (_, index) => `Chain.f${index}`), "Chain.leaf"]) {
    assert.ok(names.includes(name), `must discover ${name}`);
  }
  assert.ok(rounds.length > 2, "exercise a genuine multi-round fixed point");
  assert.ok(rounds.some(round => round.count > 1), "exercise changed completion order");
  assert.ok(rounds.some(round => round.reused > 0), "exercise contribution-cache reuse across rounds");
});

const typeVariable = new C.TypeVar("a");
const identityType = new C.ForAll(["a"], new C.Func([typeVariable], typeVariable));
const foreignIdentityCall = value => new C.ExprApp(ann(int),
  new C.ExprTypeApp(ann(ii), new C.ExprVar(ann(identityType),
    new C.Qualified(just("Foreign"), "identity")), int), literal(value));
const foreignCall = result => {
  const entry = entries(result).find(({ value0 }) => value0 === "Foreign.identity");
  assert.ok(entry);
  const calls = entries(entry.value1).map(({ value1 }) => value1).filter(info => info.normalArgs.length === 1);
  assert.equal(calls.length, 1);
  return calls[0];
};

test("ordered merging preserves the first payload and all callers despite reversed completion", async () => {
  let globals = chain(5);
  globals = insert("Chain.aSource")(new C.Binding(ann(ii), "aSource", foreignIdentityCall(1)))(globals);
  globals = insert("Chain.zSource")(new C.Binding(ann(ii), "zSource", foreignIdentityCall(2)))(globals);
  const seedSources = input => insert("Chain.zSource")(singleton("seed")(seedInfo))(
    insert("Chain.aSource")(singleton("seed")(seedInfo))(input));
  const first = foreignCall((await collect(globals, seedSources(initial))).actual);
  assert.deepEqual(first.normalArgs, [literal(1)], "input order, not completion order, chooses a new payload");
  const prior = Mono.collectInstantiations(globals)(M.empty)({
    name: "ExistingCaller", decls: [new C.NonRec(new C.Binding(ann(int), "prior", foreignIdentityCall(99)))],
  });
  const withPrior = seedSources(insert("Chain.f0")(singleton("seed")(seedInfo))(prior));
  const preserved = foreignCall((await collect(globals, withPrior)).actual);
  assert.deepEqual(preserved.normalArgs, [literal(99)], "the existing accumulator payload remains authoritative");
  assert.deepEqual(setValues(preserved.callers), ["Chain", "ExistingCaller"]);
});

test("overlapping collections keep prepared caches private even with identical specialization inputs", async () => {
  const [first, second] = await Promise.all([collect(chain(1, "firstLeaf")), collect(chain(1, "secondLeaf"))]);
  const names = result => entries(result.actual).map(({ value0 }) => value0);
  assert.ok(names(first).includes("Chain.firstLeaf"));
  assert.ok(!names(first).includes("Chain.secondLeaf"));
  assert.ok(names(second).includes("Chain.secondLeaf"));
  assert.ok(!names(second).includes("Chain.firstLeaf"));
});

test("dispatcher failure aborts collection instead of publishing a partial round", async () => {
  const failure = new Error("dispatcher failed");
  let rounds = 0;
  const runJobs = _jobs => Aff.makeAff(done => () => {
    rounds++;
    done(new Either.Left(failure))();
    return Aff.nonCanceler;
  });
  await assert.rejects(runAff(Mono.transitiveCollectWith(Aff.monadRecAff)(runJobs)(chain(2))(initial)),
    error => error === failure);
  assert.equal(rounds, 1);
});
