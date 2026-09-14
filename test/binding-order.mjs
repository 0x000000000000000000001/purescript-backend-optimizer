// After building PBO: node test/binding-order.mjs [compiled-output-directory]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const output = process.argv[2] ? resolve(process.argv[2])
  : fileURLToPath(new URL('../output/', import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, 'index.js')));
const [C, Groups, M, Maybe, Map, Ord, Tuple] = await Promise.all([
  'PureScript.Backend.Optimizer.CoreFn',
  'PureScript.Backend.Optimizer.CoreFn.BindingGroups',
  'PureScript.Backend.Optimizer.Monomorphize',
  'Data.Maybe', 'Data.Map', 'Data.Ord', 'Data.Tuple',
].map(load));
const ann = type => ({ type: new Maybe.Just(type), meta: Maybe.Nothing.value });
const int = C.Int.value;
const func = (args, result) => new C.Func(args, result);
const variable = (name, module = 'Fixture', type = int) => new C.ExprVar(ann(type),
  new C.Qualified(module === null ? Maybe.Nothing.value : new Maybe.Just(module), name));
const literal = n => new C.ExprLit(ann(int), new C.LitInt(n));
const binding = (name, expr) => new C.Binding(ann(int), name, expr);
const group = (name, expr) => new C.NonRec(binding(name, expr));
const members = d => d instanceof C.NonRec ? [d.value0] : d.value0;
const names = ds => ds.map(d => members(d).map(b => b.value1));
const sort = Groups.sortBindingGroups('Fixture');

test('forward dependencies precede their users and independent groups stay ordered', () => {
  const groups = [group('use', variable('value')), group('value', literal(42)),
    group('independent', literal(9))];
  assert.deepEqual(names(sort(groups)), [['value'], ['use'], ['independent']]);
  assert.deepEqual(sort(sort(groups)), sort(groups));
});

test('new mutual dependencies form one recursive group without swallowing its dependencies', () => {
  const groups = [group('a', variable('b')), group('b', new C.ExprLit(ann(int),
    new C.LitArray([variable('a'), variable('dependency')]))), group('dependency', literal(1))];
  const sorted = sort(groups);
  assert.deepEqual(names(sorted), [['dependency'], ['a', 'b']]);
  assert.ok(sorted[1] instanceof C.Rec);
});

test('existing recursive groups remain intact and self references remain recursive', () => {
  const original = new C.Rec([binding('a', variable('b')), binding('b', variable('value'))]);
  const sorted = sort([original, group('value', literal(1)), group('self', variable('self'))]);
  assert.deepEqual(names(sorted), [['value'], ['a', 'b'], ['self']]);
  assert.ok(sorted[1] instanceof C.Rec);
  assert.ok(sorted[2] instanceof C.Rec);
});

test('local shadowing and other modules do not introduce false dependencies', () => {
  const lambda = new C.ExprAbs(ann(func([int], int)), 'value', variable('value', null));
  const localLet = new C.ExprLet(ann(int), [group('value', literal(3))], variable('value', null));
  const localCase = new C.ExprCase(ann(int), [literal(1)], [
    new C.CaseAlternative([new C.BinderVar(ann(int), 'value')],
      new C.Unconditional(variable('value', null))),
  ]);
  const groups = [group('lambda', lambda), group('let', localLet), group('case', localCase),
    group('external', variable('value', 'Other')), group('value', literal(42))];
  assert.deepEqual(sort(groups), groups);
  const qualified = group('qualified', new C.ExprAbs(ann(func([int], int)),
    'value', variable('value')));
  assert.deepEqual(names(sort([qualified, group('value', literal(42))])), [['value'], ['qualified']]);
});

test('a specialization sees a dictionary originally declared after the generic function', () => {
  const a = new C.TypeVar('a');
  const dictType = type => new C.ADT('Fixture.Choice', ['Fixture', 'Choice'], [type]);
  const constrained = new C.ConstrainedType([new Tuple.Tuple(['Fixture', 'Choice'], [a])], func([a], int));
  const generic = new C.ForAll(['a'], constrained);
  const choose = new C.Binding(ann(generic), 'choose',
    new C.ExprAbs(ann(constrained), 'dict', new C.ExprAbs(ann(func([a], int)), 'x',
      new C.ExprApp(ann(int), new C.ExprAccessor(ann(func([a], int)),
        variable('dict', null, dictType(a)), 'choose'), variable('x', null, a)))));
  const dictionary = new C.Binding(ann(dictType(int)), 'dictionary',
    new C.ExprApp(ann(dictType(int)),
      variable('makeDictionary', 'Factory', func([dictType(int)], dictType(int))),
      new C.ExprLit(ann(dictType(int)), new C.LitRecord([
        new C.Prop('choose', new C.ExprAbs(ann(func([int], int)), 'x', literal(7))),
      ]))));
  const main = binding('main', new C.ExprApp(ann(int), new C.ExprApp(ann(func([int], int)),
    new C.ExprTypeApp(ann(constrained), variable('choose', 'Fixture', generic), int),
    variable('dictionary', 'Fixture', dictType(int))), literal(42)));
  const bindings = [choose, dictionary, main];
  const module = { name: 'Fixture', exports: ['main'], decls: bindings.map(b => new C.NonRec(b)) };
  const ast = bindings.reduce((map, b) => Map.insert(Ord.ordString)(`Fixture.${b.value1}`)(b)(map), Map.empty);
  const instantiations = M.collectInstantiations(ast)(Map.empty)(module);
  const rewritten = M.monomorphize(ast)(instantiations)(module);
  const flattened = rewritten.decls.flatMap(members);
  const dictionaryIndex = flattened.findIndex(b => b.value1 === 'dictionary');
  const specializationIndex = flattened.findIndex(b => b.value1.startsWith('choose__'));
  assert.ok(specializationIndex >= 0, 'the fixture must generate a specialization');
  assert.ok(dictionaryIndex < specializationIndex,
    'the current-build dictionary must be available when optimizing its specialized user');
});
