// After building PBO: node test/directives-removal.mjs [compiled-output-directory]
//
// Propriété : les directives effectives calculées par accumulation + retrait
// des contributions « en avance » sont identiques à la reconstruction naïve du
// préfixe, quand chaque module ne publie que ses propres clés (invariant réel :
// Convert filtre les contributions par module).
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [B, C, S, Maybe, Map, Foldable, Ord, Tuple, U] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Semantics", "Data.Maybe", "Data.Map",
  "Data.Foldable", "Data.Ord", "Data.Tuple", "Data.Unfoldable",
].map(load));

const just = value => new Maybe.Just(value);
const inlineRef = S.InlineRef.value;
const inlineDefault = S.InlineDefault.value;
const inlineNever = S.InlineNever.value;
const inlineAlways = S.InlineAlways.value;
const accessorPool = [inlineRef, new S.InlineProp("p0"), new S.InlineProp("p1"), new S.InlineSpineProp("s0")];
const directivePool = [inlineDefault, inlineNever, inlineAlways, new S.InlineArity(3)];
const evalRef = (module, ident) => new S.EvalExtern(new C.Qualified(just(module), ident));
const innerMap = pairs => Map.fromFoldable(S.ordInlineAccessor)(Foldable.foldableArray)(
  pairs.map(([accessor, directive]) => new Tuple.Tuple(accessor, directive)));
const outerMap = pairs => Map.fromFoldable(S.ordEvalRef)(Foldable.foldableArray)(
  pairs.map(([ref, inner]) => new Tuple.Tuple(ref, inner)));
const contribsMap = pairs => Map.fromFoldable(Ord.ordInt)(Foldable.foldableArray)(
  pairs.map(([rank, contrib]) => new Tuple.Tuple(rank, contrib)));
const entries = map => Map.toUnfoldable(U.unfoldableArray)(map);

const refKey = ref => {
  const qualified = ref.value0;
  const module = qualified.value0 instanceof Maybe.Just ? qualified.value0.value0 : "#local";
  return `${module}.${qualified.value1}`;
};
const accessorKey = accessor =>
  accessor instanceof S.InlineProp ? `p:${accessor.value0}`
    : accessor instanceof S.InlineSpineProp ? `s:${accessor.value0}`
    : "ref";
const directiveKey = directive =>
  directive instanceof S.InlineArity ? `arity:${directive.value0}`
    : directive === inlineDefault ? "default"
    : directive === inlineNever ? "never"
    : directive === inlineAlways ? "always"
    : "?";
const serialize = map => entries(map)
  .map(entry => [refKey(entry.value0), entries(entry.value1).map(inner => [accessorKey(inner.value0), directiveKey(inner.value1)]).sort()])
  .sort();

// Préfixe naïf : base puis les contributions de rang strictement inférieur.
const naive = (base, contribs, currentIndex) => {
  let acc = base;
  for (let rank = 0; rank < currentIndex; rank++) {
    const contrib = contribs[rank];
    if (!contrib) continue;
    for (const entry of entries(contrib)) {
      acc = Map.insert(S.ordEvalRef)(entry.value0)(entry.value1)(acc);
    }
  }
  return acc;
};

let seed = 20260926;
const random = bound => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % bound;
};
const randomInner = () => innerMap(
  Array.from({ length: random(4) }, () => [accessorPool[random(accessorPool.length)], directivePool[random(directivePool.length)]]));

const randomCase = () => {
  const moduleCount = 1 + random(6);
  const basePairs = [];
  for (let index = 0; index < random(6); index++) {
    const module = `M${random(moduleCount)}`;
    basePairs.push([evalRef(module, `f${random(4)}`), randomInner()]);
  }
  const base = outerMap(basePairs);
  const contribs = [];
  const pairs = [];
  for (let rank = 0; rank < moduleCount; rank++) {
    const innerPairs = [];
    for (let index = 0; index < random(4); index++) {
      innerPairs.push([evalRef(`M${rank}`, `f${random(4)}`), randomInner()]);
    }
    const contrib = outerMap(innerPairs);
    contribs.push(contrib);
    if (!Map.isEmpty(contrib)) pairs.push([rank, contrib]);
  }
  const contributions = contribsMap(pairs);
  // L'accumulation du builder : base puis toutes les contributions finalisées.
  let accumulated = base;
  for (const contrib of contribs) {
    for (const entry of entries(contrib)) {
      accumulated = Map.insert(S.ordEvalRef)(entry.value0)(entry.value1)(accumulated);
    }
  }
  return { base, accumulated, contributions, contribs, moduleCount };
};

test("accumulation puis retrait des contributions en avance égale le préfixe naïf", () => {
  for (let round = 0; round < 300; round++) {
    const { base, accumulated, contributions, contribs, moduleCount } = randomCase();
    for (let currentIndex = 0; currentIndex <= moduleCount; currentIndex++) {
      const expected = naive(base, contribs, currentIndex);
      const actual = B.effectiveDirectives(base)(accumulated)(contributions)(currentIndex);
      assert.deepEqual(serialize(actual), serialize(expected),
        `round ${round}, index ${currentIndex}`);
    }
  }
});
