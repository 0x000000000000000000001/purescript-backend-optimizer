// node test/corefn-qualified-native.mjs [gopurs-checkout]
// Exercises the real Go and JS fallback adapters without compiling a native
// compiler. The Go file is tested as written; the JS import checks that the
// oracle stays authoritative and receives its arguments in order.
//
// The fixture workspace is never removed: it stays under PBO_QUALIFIED_WORKSPACE
// when set, otherwise under PBO_NATIVE_TMPDIR, TMPDIR or the OS temp directory,
// and its path (with the captured go test log) is printed for the campaign.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../../gopurs/gopurs/", import.meta.url));
const source = fileURLToPath(new URL("../src/PureScript/Backend/Optimizer/CoreFn.go", import.meta.url));
const workspace = process.env.PBO_QUALIFIED_WORKSPACE
  ? resolve(process.env.PBO_QUALIFIED_WORKSPACE)
  : mkdtempSync(join(process.env.PBO_NATIVE_TMPDIR ?? process.env.TMPDIR ?? tmpdir(),
    "gopurs-corefn-qualified-"));
mkdirSync(join(workspace, "gopurs_runtime"), { recursive: true });
mkdirSync(join(workspace, "corefn"), { recursive: true });
writeFileSync(join(workspace, "go.mod"), "module gopurs/output\n\ngo 1.22\n");
copyFileSync(join(root, "runtime/runtime.go"), join(workspace, "gopurs_runtime/runtime.go"));
copyFileSync(source, join(workspace, "corefn/corefn.go"));
copyFileSync(new URL("./corefn-qualified-native_test.go", import.meta.url),
  join(workspace, "corefn/corefn_test.go"));

const log = join(workspace, "go-test.log");
const result = spawnSync("go", ["test", "-count=1", "-v", "./corefn"], {
  cwd: workspace, encoding: "utf8", timeout: 60_000,
  env: { ...process.env, GOWORK: "off" }, maxBuffer: 1024 * 1024,
});
writeFileSync(log, `$ go test -count=1 -v ./corefn\n\n${result.stdout ?? ""}${result.stderr ?? ""}`);
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
console.log(`workspace retained: ${workspace}\nlog: ${log}`);
assert.ifError(result.error);
assert.equal(result.status, 0, `qualified comparison Go fallback contract; see ${log}`);

const js = await import(pathToFileURL(
  fileURLToPath(new URL("../src/PureScript/Backend/Optimizer/CoreFn.js", import.meta.url))).href);
let seen;
const reference = a => b => { seen = [a, b]; return "ordering"; };
assert.equal(js.compareQualifiedIdentImpl(reference)("M")("i"), "ordering");
assert.deepEqual(seen, ["M", "i"]);
assert.equal(js.eqQualifiedIdentImpl(reference)("M2")("i2"), "ordering");
assert.deepEqual(seen, ["M2", "i2"]);
console.log("Qualified comparison adapters: Go delegation and JS argument order passed");
