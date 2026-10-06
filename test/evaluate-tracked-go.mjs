// Exercise the actual production Go FFI bridge, including replay and failures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [rootArg, sourceArg, outArg] = process.argv.slice(2);
assert(rootArg && sourceArg && outArg);
const root = resolve(rootArg), source = resolve(sourceArg), out = resolve(outArg);
assert(!existsSync(out)); mkdirSync(join(out, 'purescript'), { recursive: true }); mkdirSync(join(out, 'gopurs_runtime'));
const load = name => import(pathToFileURL(join(root, 'output', name, 'index.js')));
const [Maybe, Tuple, Bridge, Support] = await Promise.all(['Data.Maybe', 'Data.Tuple', 'Gopurs.FfiBridge', 'Gopurs.FfiSupport'].map(load));
const moduleName = 'PureScript.Backend.Optimizer.Monomorphize', prefix = moduleName.replaceAll('.', '_');
copyFileSync(source, join(out, 'original-ffi.go.txt'));
// The enclosing test file owns this import, as it is also required by the bridge.
const raw = readFileSync(source, 'utf8').replace('"gopurs/output/gopurs_runtime"', '');
const prepared = Support.prepareFfi({ moduleName, path: source })(prefix + '_')(raw)();
const bridge = Bridge.generateFfiBridge(prefix)([])(prepared.decls)([new Tuple.Tuple('evaluateTracked', Maybe.Nothing.value)]);
assert.match(bridge, /EvaluateTracked/);
writeFileSync(join(out, 'purescript/ffi.go'), 'package purescript\nimport "gopurs/output/gopurs_runtime"\n' + prepared.content + '\n' + bridge);
copyFileSync(join(root, 'runtime/runtime.go'), join(out, 'gopurs_runtime/runtime.go'));
copyFileSync(new URL('./evaluate-tracked-go_test.go', import.meta.url), join(out, 'purescript/ffi_test.go'));
writeFileSync(join(out, 'go.mod'), 'module gopurs/output\n\ngo 1.22\n');
const result = spawnSync('go', ['test', '-race', '-count=1', '-v', './purescript'],
  { cwd: out, env: { ...process.env, GOWORK: 'off' }, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
writeFileSync(join(out, 'test.stdout'), result.stdout ?? ''); writeFileSync(join(out, 'test.stderr'), result.stderr ?? '');
assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
console.log(result.stdout.trim());
