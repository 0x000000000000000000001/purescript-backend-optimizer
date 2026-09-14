// Run after building PBO: node test/local-specializations.mjs [compiled-output-directory]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../output/', import.meta.url));
const [C, M, Maybe, Map] = await Promise.all([
  'PureScript.Backend.Optimizer.CoreFn', 'PureScript.Backend.Optimizer.Monomorphize',
  'Data.Maybe', 'Data.Map',
].map(name => import(pathToFileURL(resolve(output, name, 'index.js')))));
const ann = type => ({ type: type ? new Maybe.Just(type) : Maybe.Nothing.value,
  meta: Maybe.Nothing.value });
const variable = (name, type) => new C.ExprVar(ann(type), new C.Qualified(Maybe.Nothing.value, name));
const literal = value => new C.ExprLit(ann(C.Int.value), new C.LitInt(value));
const array = values => new C.ExprLit(ann(), new C.LitArray(values));
const apply = (fn, arg, type) => new C.ExprApp(ann(type), fn, arg);
const rewrite = body => M.monomorphize(Map.empty)(Map.empty)({ name: 'Fixture',
  decls: [new C.NonRec(new C.Binding(ann(), 'main', body))],
}).decls[0].value0.value2;

function evaluate(expr, scope = {}) {
  if (expr instanceof C.ExprVar) return scope[expr.value1.value1];
  if (expr instanceof C.ExprAbs) return arg => evaluate(expr.value2, { ...scope, [expr.value1]: arg });
  if (expr instanceof C.ExprApp) return evaluate(expr.value1, scope)(evaluate(expr.value2, scope));
  if (expr instanceof C.ExprTypeApp) return evaluate(expr.value1, scope);
  if (expr instanceof C.ExprLit) return expr.value1 instanceof C.LitArray
    ? expr.value1.value0.map(value => evaluate(value, scope)) : expr.value1.value0;
  if (expr instanceof C.ExprLet) {
    const inner = { ...scope };
    for (const bind of expr.value1) inner[bind.value0.value1] = evaluate(bind.value0.value2, inner);
    return evaluate(expr.value2, inner);
  }
  throw new Error(`Unexpected expression: ${expr.constructor.name}`);
}

function bindingNames(root) {
  const stack = [root], names = [];
  while (stack.length) {
    const value = stack.pop();
    if (value instanceof C.Binding) names.push(value.value1);
    if (value && typeof value === 'object') stack.push(...Object.values(value));
  }
  return names;
}

test('unannotated pattern-match continuations are preserved without duplicate specializations', () => {
  let body = literal(7), expected = 7;
  for (let depth = 0; depth < 4; depth++) {
    const name = `next${depth}`;
    body = new C.ExprLet(ann(), [new C.NonRec(new C.Binding(ann(), name,
      new C.ExprAbs(ann(), 'ignored', body)))],
    array([apply(variable(name), literal(0)), apply(variable(name), literal(0))]));
    expected = [expected, expected];
  }
  const rewritten = rewrite(body);
  assert.deepEqual(bindingNames(rewritten), bindingNames(body));
  assert.deepEqual(evaluate(rewritten), expected);
});

test('repeated calls emit one local specialization for each type', () => {
  const a = new C.TypeVar('a');
  const generic = new C.ForAll(['a'], new C.Func([a], a));
  const binding = new C.Binding(ann(generic), 'identity',
    new C.ExprAbs(ann(generic), 'value', variable('value', a)));
  const values = [3, 5, 8, 13];
  const calls = values.map(value => apply(new C.ExprTypeApp(ann(new C.Func([C.Int.value], C.Int.value)),
    variable('identity', generic), C.Int.value), literal(value), C.Int.value));
  const string = new C.ExprLit(ann(C.String.value), new C.LitString('ok'));
  calls.push(apply(new C.ExprTypeApp(ann(new C.Func([C.String.value], C.String.value)),
    variable('identity', generic), C.String.value), string, C.String.value));
  const rewritten = rewrite(new C.ExprLet(ann(), [new C.NonRec(binding)], array(calls)));
  const names = rewritten.value1.map(bind => bind.value0.value1);
  assert.equal(names.length, 3, 'one generic binding and two distinct specializations');
  assert.equal(new Set(names).size, names.length, 'specialized names must be unique');
  assert.deepEqual(evaluate(rewritten), [...values, 'ok']);
});
