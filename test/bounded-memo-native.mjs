// node test/bounded-memo-native.mjs [gopurs-checkout]
// Exercises the real generic FFI bridge without compiling a native compiler.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../../gopurs/gopurs/", import.meta.url));
const load = name => import(pathToFileURL(join(root, "output", name, "index.js")));
const [Maybe, Tuple, Bridge, Support] = await Promise.all([
  "Data.Maybe", "Data.Tuple", "Gopurs.FfiBridge", "Gopurs.FfiSupport",
].map(load));
const source = fileURLToPath(new URL("../src/PureScript/Backend/Optimizer/BoundedMemo.go", import.meta.url));
const moduleName = "PureScript.Backend.Optimizer.BoundedMemo";
const prefix = moduleName.replaceAll(".", "_");
const prepared = Support.prepareFfi({ moduleName, path: source })(prefix + "_")(readFileSync(source, "utf8"))();
const bridge = Bridge.generateFfiBridge(prefix)([])(prepared.decls)([
  new Tuple.Tuple("createBoundedMemo", Maybe.Nothing.value),
  new Tuple.Tuple("createStringMemo", Maybe.Nothing.value),
]);
assert.match(bridge, /CreateBoundedMemo\[gopurs_runtime\.Value, gopurs_runtime\.Value, gopurs_runtime\.Value\]/);
assert.match(bridge, /CreateStringMemo\[gopurs_runtime\.Value\]/);
assert.doesNotMatch(bridge, /Unbox\[(?:A|B|R)\]/);
const workspace = mkdtempSync(join(tmpdir(), "gopurs-bounded-memo-"));
try {
  mkdirSync(join(workspace, "gopurs_runtime"));
  mkdirSync(join(workspace, "purescript"));
  writeFileSync(join(workspace, "go.mod"), "module gopurs/output\n\ngo 1.22\n");
  copyFileSync(join(root, "runtime/runtime.go"), join(workspace, "gopurs_runtime/runtime.go"));
  writeFileSync(join(workspace, "purescript/memo.go"),
    'package purescript\nimport "gopurs/output/gopurs_runtime"\n' + prepared.content + "\n" + bridge);
  copyFileSync(new URL("./bounded-memo-native_test.go", import.meta.url), join(workspace, "purescript/memo_test.go"));
  const result = spawnSync("go", ["test", "-race", "-count=1", "-v", "./purescript"], {
    cwd: workspace, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, GOWORK: "off" }, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  assert.equal(result.status, 0, "bounded memoization native FFI contract");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
