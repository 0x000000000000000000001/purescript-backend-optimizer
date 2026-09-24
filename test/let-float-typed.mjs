// After building PBO, run: node test/let-float-typed.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const output = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../output/", import.meta.url));
const load = (name) => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, S, Sem, Maybe] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn",
  "PureScript.Backend.Optimizer.Syntax",
  "PureScript.Backend.Optimizer.Semantics",
  "Data.Maybe",
].map(load));

const ident = (name) => new Maybe.Just(new C.Ident(name));
const identX = ident("x");
const identY = ident("y");
const qualified = (module, name) => new C.Qualified(new Maybe.Just(module), new C.Ident(name));
// A neutral application is not inlinable, so makeLet must keep a let binding.
const call = () => new Sem.NeutApp(new Sem.NeutVar(qualified("Fixture", "f")), [new Sem.NeutLit(new C.LitInt(0))]);
const g = (x) => new Sem.NeutApp(new Sem.NeutVar(qualified("Fixture", "g")), [x, x]);
const h = (y) => new Sem.NeutApp(new Sem.NeutVar(qualified("Fixture", "h")), [y, y]);

test("a bare inner let is floated before its consumer", () => {
  const result = Sem.makeLet(identY)(new Sem.SemLet(identX, call(), g))(h);
  assert.ok(result instanceof Sem.SemLet, "the inner binding must become the outer let");
  assert.deepStrictEqual(result.value0, identX);
  const body = result.value2(result.value1);
  assert.ok(body instanceof Sem.SemLet, "the consumer still binds its own value");
  assert.deepStrictEqual(body.value0, identY);
  assert.ok(!(body.value1 instanceof Sem.SemLet), "the inner let must not remain nested");
});

test("a typed inner let is floated and keeps its annotation on the body", () => {
  const typed = new Sem.SemTyped(C.Int.value, new Sem.SemLet(identX, call(), g));
  const result = Sem.makeLet(identY)(typed)(h);
  assert.ok(result instanceof Sem.SemLet, "the typed inner binding must become the outer let");
  assert.deepStrictEqual(result.value0, identX);
  const body = result.value2(result.value1);
  assert.ok(body instanceof Sem.SemLet, "the consumer still binds its own value");
  assert.deepStrictEqual(body.value0, identY);
  assert.ok(body.value1 instanceof Sem.SemTyped, "the annotation must describe the producing body");
  assert.ok(!(body.value1.value1 instanceof Sem.SemLet), "the typed wrapper must no longer hide a nested let");
});

test("a typed binding without an inner let keeps its own let", () => {
  const result = Sem.makeLet(identY)(new Sem.SemTyped(C.Int.value, call()))(h);
  assert.ok(result instanceof Sem.SemLet);
  assert.deepStrictEqual(result.value0, identY);
  assert.ok(result.value1 instanceof Sem.SemTyped, "an opaque typed binding is not flattened");
});
