// Link contract fixtures to the candidate's real generated native optimizer.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [rustArg, outArg] = process.argv.slice(2);
assert(rustArg && outArg, 'specialization-reads-native.mjs GENERATED_RUST NEW_ARCHIVE');
const rust = resolve(rustArg), out = resolve(outArg);
assert(!existsSync(out)); mkdirSync(join(out, 'src'), { recursive: true });
const modules = ['purust_core', 'perceus_ptr', 'Purs_Data_Map_Internal', 'Purs_Data_Maybe', 'Purs_Data_Tuple',
  'Purs_PureScript_Backend_Optimizer_CoreFn', 'Purs_PureScript_Backend_Optimizer_Monomorphize'];
writeFileSync(join(out, 'Cargo.toml'), '[package]\nname = "specialization_reads_test"\nversion = "0.0.0"\nedition = "2021"\n' +
  '[profile.release]\nopt-level = 3\ndebug = false\nlto = false\n[dependencies]\n' +
  modules.map(name => `${name} = { path = ${JSON.stringify(join(rust, name))} }\n`).join(''));
let fixture = readFileSync(new URL('./specialization-reads-native.rs', import.meta.url), 'utf8');
const generated = readFileSync(join(rust, 'Purs_PureScript_Backend_Optimizer_Monomorphize/src/lib.rs'), 'utf8');
const signature = generated.match(/pub fn PureScript_Backend_Optimizer_Monomorphize_specializeTracked\([^\n]+/)[0];
if (signature.includes('-> std::sync::Arc<Purs_Data_Tuple::Tuple>')) {
  fixture = fixture.replace('Tracked { expr: result.get_expr().unwrap_class_shared::<Expr>(), lookups: result.get_lookups().unwrap_class_shared::<Map>() }',
    'let Purs_Data_Tuple::Tuple::Tuple(expr, lookups) = result.as_ref();\n    Tracked { expr: expr.unwrap_class_shared::<Expr>(), lookups: lookups.unwrap_class_shared::<Map>() }');
} else assert(signature.includes('-> crate::UnknownType'));
writeFileSync(join(out, 'src/main.rs'), fixture);
const target = process.env.CARGO_TARGET_DIR ?? join(out, 'target');
const build = spawnSync('cargo', ['build', '--offline', '--release', '--manifest-path', join(out, 'Cargo.toml'), '--target-dir', target],
  { env: { ...process.env, CARGO_BUILD_JOBS: '8', CARGO_INCREMENTAL: '0' }, encoding: 'utf8', timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
writeFileSync(join(out, 'build.stdout'), build.stdout ?? ''); writeFileSync(join(out, 'build.stderr'), build.stderr ?? '');
assert.equal(build.status, 0, build.error?.message ?? build.stderr);
const run = spawnSync(join(target, 'release/specialization_reads_test'), [], { encoding: 'utf8', timeout: 120000 });
writeFileSync(join(out, 'test.stdout'), run.stdout ?? ''); writeFileSync(join(out, 'test.stderr'), run.stderr ?? '');
assert.equal(run.status, 0, run.error?.message ?? run.stderr);
console.log(run.stdout.trim());
