// After building the backend: node test/parallel-load.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(join(output, name, "index.js")));
const [App, Aff, Either, List, Ffi] = await Promise.all([
  ...["PureScript.Backend.Optimizer.App", "Effect.Aff", "Data.Either", "Data.List.Types"].map(load),
  import(pathToFileURL(join(output, "PureScript.Backend.Optimizer.App", "foreign.js"))),
]);
const runAff = aff => new Promise((resolve, reject) => {
  Aff.runAff(result => () => result instanceof Either.Left
    ? reject(result.value0) : resolve(result.value0))(aff)();
});
const toArray = list => {
  const result = [];
  for (; list instanceof List.Cons; list = list.value1) result.push(list.value0);
  assert.ok(list instanceof List.Nil);
  return result;
};
async function withJobs(jobs, action) {
  const previous = process.env.GOPURS_JOBS;
  if (jobs === undefined) delete process.env.GOPURS_JOBS;
  else process.env.GOPURS_JOBS = jobs;
  try { return await action(); }
  finally {
    if (previous === undefined) delete process.env.GOPURS_JOBS;
    else process.env.GOPURS_JOBS = previous;
  }
}
const sourceSpan = { start: [1, 1], end: [1, 2] };
const fixture = index => ({
  moduleName: [`M${index}`], modulePath: `M${index}.purs`, sourceSpan,
  imports: index === 0 ? [] : [{ moduleName: [`M${index - 1}`],
    annotation: { sourceSpan, type: null, meta: null } }],
  exports: [], reExports: {}, decls: [], foreign: [], comments: [], typeTable: [],
});

test("sequential and parallel loading preserve decoded modules and dependency order", async t => {
  const root = await mkdtemp(join(tmpdir(), "gopurs-parallel-load-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // Reverse directory order exercises dependency sorting, across batch boundaries.
  for (let index = 0; index < 7; index++) {
    const dir = join(root, `0${6 - index}-M${index}`);
    await mkdir(dir);
    await writeFile(join(dir, "corefn.json"), JSON.stringify(fixture(index)));
  }
  await writeFile(join(root, "07-file"), "ignored");
  await mkdir(join(root, "08-empty"));
  const invalidDir = join(root, "09-invalid");
  await mkdir(invalidDir);
  const invalidPath = join(invalidDir, "corefn.json");
  await writeFile(invalidPath, "{invalid JSON");

  const loadWithDiagnostics = jobs => withJobs(jobs, async () => {
    const errors = [];
    const previousError = console.error;
    console.error = message => errors.push(String(message));
    let modules;
    try { modules = toArray(await runAff(App.coreFnModulesFromOutput(root))); }
    finally { console.error = previousError; }
    assert.equal(errors.length, 1);
    assert.ok(errors[0].startsWith(`Failed to decode ${invalidPath}: `));
    return modules;
  });
  const sequential = await loadWithDiagnostics("1");
  // Ten entries leave a final two-entry batch at concurrency four.
  const parallel = await loadWithDiagnostics("4");
  assert.deepEqual(parallel, sequential);
  assert.deepEqual(parallel.map(module => module.name), Array.from({ length: 7 }, (_, i) => `M${i}`));
});

test("missing output directory rejects the Aff", async t => {
  const root = await mkdtemp(join(tmpdir(), "gopurs-parallel-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await withJobs("4", () => assert.rejects(
    runAff(App.coreFnModulesFromOutput(join(root, "missing"))), /ENOENT/));
});

test("concurrency accepts bounds and falls back for invalid settings", async () => {
  for (const jobs of ["1", "4", "64"]) {
    await withJobs(jobs, () => assert.equal(Ffi.moduleReadConcurrency(), Number(jobs)));
  }
  const fallback = 1;
  for (const jobs of [undefined, "", "0", "-1", "65", "1.5", "4x", " 4", "1e1"]) {
    await withJobs(jobs, () => assert.equal(Ffi.moduleReadConcurrency(), fallback));
  }
});
