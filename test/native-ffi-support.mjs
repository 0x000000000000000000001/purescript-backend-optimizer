// node test/native-ffi-support.mjs [gopurs-checkout] [ffi-source]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const compiler = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "../gopurs/gopurs");
const source = process.argv[3] ? resolve(process.argv[3]) : join(root, "src/PureScript/Backend/Optimizer/FfiSupport.go");
const { runtimeGoCode } = await import(pathToFileURL(join(compiler, "output/Gopurs.Runtime/index.js")));
const workspace = mkdtempSync(join(tmpdir(), "gopurs-native-ffi-contract-"));
try {
  for (const directory of ["gopurs_runtime", "foreign", "ffi"]) mkdirSync(join(workspace, directory));
  writeFileSync(join(workspace, "go.mod"), "module gopurs/output\n\ngo 1.22\n");
  writeFileSync(join(workspace, "gopurs_runtime/runtime.go"), runtimeGoCode);
  copyFileSync(join(dirname(compiler), "gopurs-foreign/src/Foreign.go"), join(workspace, "foreign/foreign.go"));
  copyFileSync(source, join(workspace, "ffi/ffi.go"));
  copyFileSync(new URL("./native-ffi-support_test.go", import.meta.url), join(workspace, "ffi/ffi_test.go"));
  const result = spawnSync("go", ["test", "-count=1", "./ffi"], {
    cwd: workspace, stdio: "inherit", timeout: 30_000,
    env: { ...process.env, GOWORK: "off" },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, "native FFI Nullable contract");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
