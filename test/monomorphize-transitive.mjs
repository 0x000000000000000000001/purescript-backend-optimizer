// After building PBO: node test/monomorphize-transitive.mjs [compiled-output-directory]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../output/", import.meta.url));
const load = name => import(pathToFileURL(resolve(output, name, "index.js")));
const [C, Mono, M, Maybe, Ord, U, T, Usage] = await Promise.all([
  "PureScript.Backend.Optimizer.CoreFn", "PureScript.Backend.Optimizer.Monomorphize",
  "Data.Map.Internal", "Data.Maybe", "Data.Ord", "Data.Unfoldable", "Data.Tuple",
  "PureScript.Backend.Optimizer.CoreFn.Usage",
].map(load));
const nothing=Maybe.Nothing.value, just=x=>new Maybe.Just(x), tuple=(a,b)=>new T.Tuple(a,b);
const int=C.Int.value, str=C.String.value, tv=new C.TypeVar('a');
const func=(args,ret)=>new C.Func(args,ret), forall=t=>new C.ForAll(['a'],t);
const ann=t=>({span:C.emptySpan,meta:nothing,sourceUsage:nothing,type:t===null?nothing:just(t)});
const v=(mod,name,t)=>new C.ExprVar(ann(t),new C.Qualified(mod===null?nothing:just(mod),name));
const local=(name,t)=>v(null,name,t);
const abs=(name,t,body)=>new C.ExprAbs(ann(t),name,body);
const app=(fn,arg,t)=>new C.ExprApp(ann(t),fn,arg);
const lit=n=>new C.ExprLit(ann(int),new C.LitInt(n));
const bind=(name,t,body)=>new C.Binding(ann(t),name,body);
const nonrec=b=>new C.NonRec(b);
const module=(name,bindings)=>({name,path:name+'.purs',span:C.emptySpan,imports:[],exports:bindings.flatMap(b=>b instanceof C.NonRec?[b.value0.value1]:b.value0.map(x=>x.value1)),reExports:M.empty,dataDecls:[],classDecls:[],foreign:M.empty,comments:[],decls:bindings});
const arr=M.toUnfoldable(U.unfoldableArray), insert=M.insert(Ord.ordString), lookup=M.lookup(Ord.ordString);
const idTy=forall(func([tv],tv)), ii=func([int],int);
const identity=nonrec(bind('id',idTy,abs('x',func([tv],tv),local('x',tv))));
const gId=(arg,t=int)=>app(v('Generic','id',idTy),arg,t);
const bindings = modules => modules.flatMap(mod => mod.decls.flatMap(group =>
  (group instanceof C.NonRec ? [group.value0] : group.value0).map(binding => ({ module: mod.name, binding }))));
const declarations = (modules, mod, prefix) => bindings(modules)
  .filter(entry => entry.module === mod && entry.binding.value1.startsWith(prefix)).map(entry => entry.binding);
function pipeline(original) {
  const modules = original.map(Usage.invalidateSourceUsageModule);
  let global = M.empty, raw = M.empty;
  const polymorphic = new Set();
  for (const { module: mod, binding: b } of bindings(modules)) {
    const name = mod + '.' + b.value1;
    global = insert(name)(b)(global);
    // These fixtures declare their polymorphic globals explicitly with ForAll.
    if (b.value0.type instanceof Maybe.Just && b.value0.type.value0 instanceof C.ForAll) polymorphic.add(name);
  }
  for (const mod of modules) raw = Mono.collectInstantiations(global)(raw)(mod);
  const transitive = Mono.transitiveCollect(global)(raw);
  // Like the Go backend, keep all definitions during collection and filter only before emission.
  const eligible = M.filterKeys(Ord.ordString)(name => polymorphic.has(name))(transitive);
  return modules.map(Mono.monomorphize(global)(eligible));
}
function run(name, modules, verify = () => {}) {
  test(name, () => {
    const ast = pipeline(modules);
    const emitted = new Set(bindings(ast).map(({ module, binding }) => module + '.' + binding.value1));
    const visit = value => {
      if (value instanceof C.ExprVar && value.value1.value0 instanceof Maybe.Just && value.value1.value1.includes('__')) {
        const name = value.value1.value0.value0 + '.' + value.value1.value1;
        assert.ok(emitted.has(name), 'specialized reference must have a definition: ' + name);
      }
      if (value && typeof value === 'object') for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit); else visit(child);
      }
    };
    ast.forEach(visit);
    if (name !== 'qualified-static-name-collision' && !name.startsWith('local-name-shadows-global')) {
      assert.equal(declarations(ast, 'Generic', 'id__').length, 1,
        'discover id@Int exactly once, including calls exposed by dictionary resolution');
    }
    // Recursive fixtures intentionally have no terminating entry point.
    if (name !== 'mono-chain-recursion') for (const { module: mod, binding } of bindings(modules)) {
      if (binding.value1 === 'answer') {
        assert.equal(evaluateModules(ast, mod + '.answer'), evaluateModules(modules, mod + '.answer'));
      }
    }
    verify(ast);
  });
}
const wrapper=nonrec(bind('wrap',ii,abs('x',ii,gId(local('x',int)))));
run('mono-wrapper-generic',[
 module('Generic',[identity]),module('Wrapper',[wrapper]),
 module('Caller',[nonrec(bind('answer',int,app(v('Wrapper','wrap',ii),lit(42),int)))])]);
// Mono wrapper passed as a static normal argument to a polymorphic higher-order function.
const applyTy=forall(func([func([tv],tv),tv],tv));
const applyDef=nonrec(bind('apply',applyTy,abs('f',func([func([tv],tv),tv],tv),abs('x',func([tv],tv),app(local('f',func([tv],tv)),local('x',tv),tv)))));
run('mono-wrapper-static-generic-arg',[
 module('Generic',[identity,applyDef]),module('Wrapper',[wrapper]),
 module('Caller',[nonrec(bind('answer',int,app(app(v('Generic','apply',applyTy),v('Wrapper','wrap',ii),ii),lit(42),int)))])]);
// A monomorphic dictionary's field refers to a polymorphic method instantiated at Int.
const dictTy=new C.Record(new C.Row([tuple('method',ii)],nothing));
const dict=nonrec(bind('dictInt',dictTy,new C.ExprLit(ann(dictTy),new C.LitRecord([new C.Prop('method',v('Generic','id',ii))]))));
const dictATy=new C.Record(new C.Row([tuple('method',func([tv],tv))],nothing));
const useTy=forall(new C.ConstrainedType([tuple(['Example','Method'],[tv])],func([tv],tv)));
const useDef=nonrec(bind('use',useTy,abs('dict',func([dictATy],func([tv],tv)),abs('x',func([tv],tv),app(new C.ExprAccessor(ann(func([tv],tv)),local('dict',dictATy),'method'),local('x',tv),tv)))));
run('mono-dict-generic',[
 module('Generic',[identity,useDef]),module('Dictionary',[dict]),
 module('Caller',[nonrec(bind('answer',int,app(app(v('Generic','use',useTy),v('Dictionary','dictInt',dictTy),ii),lit(42),int)))])],ast=>{
 const text=JSON.stringify(ast);
 assert.ok(text.includes('id__'),'dictionary specialization must expose its generic method');
});
// A monomorphic wrapper hides a generic call behind a dictionary accessor.
run('mono-wrapper-dict-accessor',[
 module('Generic',[identity]),module('Dictionary',[dict]),
 module('Wrapper',[nonrec(bind('wrap',ii,abs('x',ii,app(new C.ExprAccessor(ann(ii),v('Dictionary','dictInt',dictTy),'method'),local('x',int),int))))]),
 module('Caller',[nonrec(bind('answer',int,app(v('Wrapper','wrap',ii),lit(42),int)))])]);
// Monomorphic chain with multiple caller modules; a recursive group includes a generic call.
const fBody=abs('x',ii,app(v('Recursive','g',ii),gId(local('x',int)),int));
const gBody=abs('x',ii,app(v('Recursive','f',ii),local('x',int),int));
run('mono-chain-recursion',[
 module('Generic',[identity]),module('Recursive',[new C.Rec([bind('f',ii,fBody),bind('g',ii,gBody)])]),
 module('Middle',[nonrec(bind('chain',ii,abs('x',ii,app(v('Recursive','f',ii),local('x',int),int))))]),
 module('Caller',[nonrec(bind('answer',int,app(v('Middle','chain',ii),lit(42),int)))]),
 module('OtherCaller',[nonrec(bind('answer',int,app(v('Middle','chain',ii),lit(17),int)))])]);
// Preserve caller-qualified static arguments when Caller and Generic export the same name.
const genericMethod=nonrec(bind('method',idTy,abs('x',func([tv],tv),local('x',tv))));
const callerMethod=nonrec(bind('method',ii,abs('x',ii,lit(99))));
run('qualified-static-name-collision',[
 module('Generic',[identity,applyDef,genericMethod]),
 module('Caller',[callerMethod,nonrec(bind('answer',int,app(app(v('Generic','apply',applyTy),v('Caller','method',ii),ii),lit(42),int)))])],ast=>{
 const generic=ast.find(m=>m.name==='Generic');
 const emitted=generic.decls.flatMap(g=>g instanceof C.NonRec?[g.value0]:g.value0).filter(b=>b.value1.startsWith('apply__'));
 assert.ok(emitted.length>0);
 const refs=[];
 const visit=x=>{if(x instanceof C.ExprVar)refs.push([x.value1.value0 instanceof Maybe.Just?x.value1.value0.value0:null,x.value1.value1]);if(x&&typeof x==='object')for(const value of Object.values(x))if(Array.isArray(value))value.forEach(visit);else visit(value);};
 emitted.forEach(visit);
 assert.ok(refs.some(([m,n])=>m==='Caller'&&n==='method'),'static argument must retain caller qualification');
 assert.ok(!refs.some(([m,n])=>m==='Generic'&&n==='method'),'static argument must not retarget definer namesake');
});
const evaluateModules = (modules, qualName, ...args) => {
 const globals = Object.fromEntries(modules.flatMap(m=>m.decls.flatMap(g=>(g instanceof C.NonRec?[g.value0]:g.value0).map(b=>[m.name+'.'+b.value1,b.value2]))));
 const evaluate = (e,locals={}) => {
  if(e instanceof C.ExprVar)return e.value1.value0 instanceof Maybe.Nothing?locals[e.value1.value1]:evaluate(globals[e.value1.value0.value0+'.'+e.value1.value1]);
  if(e instanceof C.ExprAbs)return x=>evaluate(e.value2,{...locals,[e.value1]:x});
  if(e instanceof C.ExprApp)return evaluate(e.value1,locals)(evaluate(e.value2,locals));
  if(e instanceof C.ExprTypeApp)return evaluate(e.value1,locals);
  if (e instanceof C.ExprLet) {
   const scope = { ...locals };
   for (const group of e.value1) {
    for (const binding of group instanceof C.NonRec ? [group.value0] : group.value0) {
     scope[binding.value1] = evaluate(binding.value2, scope);
    }
   }
   return evaluate(e.value2, scope);
  }

  if(e instanceof C.ExprAccessor)return evaluate(e.value1,locals)[e.value2];
  if(e instanceof C.ExprLit && e.value1 instanceof C.LitInt)return e.value1.value0;
  if(e instanceof C.ExprLit && e.value1 instanceof C.LitRecord)return Object.fromEntries(e.value1.value0.map(p=>[p.value0,evaluate(p.value1,locals)]));
  throw new Error('unsupported '+e?.constructor.name);
 };
 return args.reduce((fn,x)=>fn(x),evaluate(globals[qualName]));
};
// An explicitly instantiated helper must keep its local f, even if Generic.f is polymorphic.
const otherVar = new C.TypeVar("b");
const unrelatedFTy = new C.ForAll(["b"], func([otherVar], int));
const unrelatedF = nonrec(bind("f", unrelatedFTy,
  abs("value", func([otherVar], int), lit(99))));
const higher = nonrec(bind("higher", applyTy,
  abs("f", func([func([tv], tv), tv], tv),
    abs("x", func([tv], tv), app(local("f", func([tv], tv)), local("x", tv), tv)))));
const dynCallerTy = func([ii], int);
const higherInt = new C.ExprTypeApp(ann(func([ii, int], int)), v("Generic", "higher", applyTy), int);
run("local-name-shadows-global", [
  module("Generic", [unrelatedF, higher]),
  module("Caller", [nonrec(bind("dynamic", dynCallerTy,
    abs("actual", dynCallerTy, app(app(higherInt, local("actual", ii), ii), lit(42), int))))]),
], ast => {
  assert.equal(declarations(ast, "Generic", "higher__").length, 1);
  assert.equal(evaluateModules(ast, "Caller.dynamic", x => x + 1), 43,
    "specialization must call the supplied function, not the unrelated global Generic.f");
});

run("local-name-shadows-global-in-definer-module", [
  module("Generic", [unrelatedF, higher, nonrec(bind("dynamic", dynCallerTy,
    abs("actual", dynCallerTy, app(app(higherInt, local("actual", ii), ii), lit(42), int))))]),
], ast => {
  assert.equal(evaluateModules(ast, "Generic.dynamic", x => x + 1), 43,
    "a local parameter must stay local even when the caller is the defining module");
});

const globalFInt = new C.ExprTypeApp(ann(ii), v("Generic", "f", unrelatedFTy), int);
run("local-name-shadows-global-with-existing-specialization", [
  module("Generic", [unrelatedF, higher, nonrec(bind("seed", int, app(globalFInt, lit(0), int)))]),
  module("Caller", [nonrec(bind("dynamic", dynCallerTy,
    abs("actual", dynCallerTy, app(app(higherInt, local("actual", ii), ii), lit(42), int))))]),
], ast => {
  assert.equal(declarations(ast, "Generic", "f__").length, 1);
  assert.equal(evaluateModules(ast, "Generic.seed"), 99);
  assert.equal(evaluateModules(ast, "Caller.dynamic", x => x + 1), 43,
    "an existing global specialization must not rewrite a same-named local application");
});

run("unqualified-top-level-global", [
  module("Generic", [identity, nonrec(bind("result", int,
    app(new C.ExprTypeApp(ann(ii), local("id", idTy), int), lit(42), int)))]),
], ast => {
  assert.equal(evaluateModules(ast, "Generic.result"), 42,
    "top-level unqualified globals must be qualified before ignoring unqualified locals");
  const result = declarations(ast, "Generic", "result")[0];
  assert.ok(result.value2 instanceof C.ExprApp);
  assert.ok(result.value2.value1 instanceof C.ExprVar);
  assert.equal(result.value2.value1.value1.value0.value0, "Generic");
  assert.match(result.value2.value1.value1.value1, /^id__/);
});

test("dictionary-resolve-injects-own-module-global", () => {
 const dictionaryLocal = nonrec(bind("dictInt", dictTy,
   new C.ExprLit(ann(dictTy), new C.LitRecord([new C.Prop("method", local("id", ii))]))));
 const modules = [module("Generic", [useDef]),module("Dictionary", [identity,dictionaryLocal]),
   module("Caller", [nonrec(bind("answer", int, app(app(new C.ExprTypeApp(ann(func([dictTy,int],int)),v("Generic","use",useTy),int),v("Dictionary","dictInt",dictTy),ii),lit(42),int)))])];
 const ast = pipeline(modules);
 const specialized = declarations(ast, "Generic", "use__");
 assert.equal(specialized.length, 1);
 assert.equal(evaluateModules(ast,"Caller.answer"),42);
});

test("local-let-function-keeps-outer-parameter", () => {
 const localRelay = nonrec(bind("relay", func([tv],tv),
   abs("y",func([tv],tv),app(local("f",func([tv],tv)),local("y",tv),tv))));
 const nestedHigher = nonrec(bind("nestedHigher",applyTy,
   abs("f",func([func([tv],tv),tv],tv),abs("x",func([tv],tv),
     new C.ExprLet(ann(tv),[localRelay],app(local("relay",func([tv],tv)),local("x",tv),tv))))));
 const nestedInt = new C.ExprTypeApp(ann(func([ii,int],int)),v("Generic","nestedHigher",applyTy),int);
 const modules = [module("Generic",[unrelatedF,nestedHigher,nonrec(bind("seed",int,app(globalFInt,lit(0),int)))]),
   module("Caller",[nonrec(bind("dynamic",dynCallerTy,
     abs("actual",dynCallerTy,app(app(nestedInt,local("actual",ii),ii),lit(42),int))))])];
 const ast=pipeline(modules);
 assert.equal(evaluateModules(ast,"Caller.dynamic",x=>x+1),43);
});
