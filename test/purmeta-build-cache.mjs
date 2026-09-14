// After building PBO: node test/purmeta-build-cache.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [Builder, Cache, Effect, List, Map, Maybe] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.Cache",
  "Effect", "Data.List.Types", "Data.Map", "Data.Maybe",
].map(load));

const temporaryWorkingDirectory = t => {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "pbo-purmeta-build-"));
  process.chdir(directory);
  t.after(() => {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  });
};

test("a new build ignores old purmeta until the module is written in that build", t => {
  temporaryWorkingDirectory(t);
  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Just);

  Builder.buildModules(Effect.monadEffect)({})(List.Nil.value)();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "a forward lookup must not inline a specialization from a previous build");

  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Just,
    "current-build implementations remain readable after RAM eviction");

  Builder.buildModules(Effect.monadEffect)({})(List.Nil.value)();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "starting another build invalidates the previous build's written-module set");

  const reusableBuild = Builder.buildModules(Effect.monadEffect)({})(List.Nil.value);
  reusableBuild();
  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  reusableBuild();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "each execution of the same build action starts a fresh cache scope");
});

test("a module accepted by onSkipModule publishes its validated implementations", t => {
  temporaryWorkingDirectory(t);
  const module = { name: "Cached", exports: [] };
  const cached = { directives: Map.empty, implementations: Map.empty };
  const options = {
    directives: Map.empty,
    onPrepareModule: () => value => () => value,
    onSkipModule: () => () => () => new Maybe.Just(cached),
  };
  Builder.buildModules(Effect.monadEffect)(options)(new List.Cons(module, List.Nil.value))();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Cached")() instanceof Maybe.Just);
});
