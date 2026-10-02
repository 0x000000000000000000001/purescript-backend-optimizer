// After building PBO: node test/purmeta-build-cache.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [Builder, Cache, EffectClass, List, Map, Maybe, Set] = await Promise.all([
  "PureScript.Backend.Optimizer.Builder", "PureScript.Backend.Optimizer.Cache",
  "Effect.Class", "Data.List.Types", "Data.Map", "Data.Maybe", "Data.Set",
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

test("a fresh process cannot read residual purmeta before its first builder invocation", t => {
  temporaryWorkingDirectory(t);
  Cache.writePurmetaSync("Old")(Map.empty)();
  writeFileSync(".purmeta/Corrupt.purmeta", Buffer.from([0]));
  const moduleURL = name => JSON.stringify(pathToFileURL(resolve(output, name, "index.js")).href);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import * as Cache from ${moduleURL("PureScript.Backend.Optimizer.Cache")};
    import * as Maybe from ${moduleURL("Data.Maybe")};
    import * as Map from ${moduleURL("Data.Map")};
    Cache.setPurmetaStatsEnabled(true)();
    const probes = [];
    const originalExists = fs.existsSync, originalRead = fs.readFileSync;
    fs.existsSync = file => { probes.push(['exists', String(file)]); return originalExists(file); };
    fs.readFileSync = (...args) => { probes.push(['read', String(args[0])]); return originalRead(...args); };
    for (const name of ['Old', 'Corrupt']) {
      assert.ok(Cache.readPurmetaSync(name)() instanceof Maybe.Nothing,
        'old metadata must be blocked before builder initialization');
    }
    Cache.clearPurmetaCache();
    assert.ok(Cache.readPurmetaSync('Old')() instanceof Maybe.Nothing);
    assert.deepEqual(probes, [], 'rejected files must not even be probed');
    fs.existsSync = originalExists;
    fs.readFileSync = originalRead;
    const stats = JSON.parse(Cache.readPurmetaStatsJson());
    assert.equal(stats.reads.blocked, 3);
    assert.equal(stats.reads.ramMisses, 0);
    // Direct callers can publish into the initial empty scope, just as they
    // can after beginPurmetaBuild; only this process's successful writes count.
    Cache.writePurmetaSync('Old')(Map.empty)();
    Cache.clearPurmetaCache();
    assert.ok(Cache.readPurmetaSync('Old')() instanceof Maybe.Just);
    Cache.beginPurmetaBuild();
    assert.ok(Cache.readPurmetaSync('Old')() instanceof Maybe.Nothing);
  `], { cwd: process.cwd(), encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stdout + child.stderr);
});

test("a new build ignores old purmeta until the module is written in that build", t => {
  temporaryWorkingDirectory(t);
  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Just);

  Builder.buildModules(EffectClass.monadEffectEffect)({})(List.Nil.value)();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "a forward lookup must not inline a specialization from a previous build");

  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Just,
    "current-build implementations remain readable after RAM eviction");

  Builder.buildModules(EffectClass.monadEffectEffect)({})(List.Nil.value)();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "starting another build invalidates the previous build's written-module set");

  const reusableBuild = Builder.buildModules(EffectClass.monadEffectEffect)({})(List.Nil.value);
  reusableBuild();
  Cache.writePurmetaSync("Later")(Map.empty)();
  Cache.clearPurmetaCache();
  reusableBuild();
  assert.ok(Cache.readPurmetaSync("Later")() instanceof Maybe.Nothing,
    "each execution of the same build action starts a fresh cache scope");
});

test("a module accepted by onSkipModule publishes its validated implementations", t => {
  temporaryWorkingDirectory(t);
  const module = { name: "Cached", exports: [], decls: [] };
  const cached = { directives: Map.empty, implementations: Map.empty };
  const options = {
    directives: Map.empty,
    onPrepareModule: () => value => () => value,
    onSkipModule: () => () => () => new Maybe.Just(cached),
  };
  Builder.buildModules(EffectClass.monadEffectEffect)(options)(new List.Cons(module, List.Nil.value))();
  Cache.clearPurmetaCache();
  assert.ok(Cache.readPurmetaSync("Cached")() instanceof Maybe.Just);
});

test("fresh modules publish implementations after codegen and before preparing the next module", t => {
  temporaryWorkingDirectory(t);
  const emptyModule = name => ({
    name, path: `${name}.purs`, span: null, imports: [], exports: [], reExports: [],
    dataDecls: [], classDecls: [], decls: [], foreign: Map.empty, comments: [],
  });
  const events = [];
  const options = {
    directives: Map.empty, foreignSemantics: Map.empty, traceIdents: Set.empty, rewriteLimit: 100,
    analyzeCustom: () => () => Maybe.Nothing.value,
    onPrepareModule: () => module => () => {
      if (module.name === "Second") {
        assert.ok(Cache.readPurmetaSync("First")() instanceof Maybe.Just,
          "the next module can inline the preceding module");
      }
      events.push(`prepare:${module.name}`);
      return module;
    },
    onSkipModule: () => () => () => Maybe.Nothing.value,
    onCodegenModule: () => module => () => () => () => {
      assert.ok(Cache.readPurmetaSync(module.name)() instanceof Maybe.Nothing,
        "a module is published only after its codegen callback");
      events.push(`codegen:${module.name}`);
    },
  };
  const modules = new List.Cons(emptyModule("First"), new List.Cons(emptyModule("Second"), List.Nil.value));
  Builder.buildModules(EffectClass.monadEffectEffect)(options)(modules)();
  assert.deepEqual(events, ["prepare:First", "codegen:First", "prepare:Second", "codegen:Second"]);
  assert.ok(Cache.readPurmetaSync("Second")() instanceof Maybe.Just);
});
