use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use perceus_ptr::PerceusPtr;
use purust_core::*;
use Purs_Data_Map_Internal::Map;
use Purs_Data_Maybe::Maybe;
use Purs_PureScript_Backend_Optimizer_CoreFn::*;
use Purs_PureScript_Backend_Optimizer_Monomorphize::*;

fn boxed<T: Send + Sync + 'static>(value: Arc<T>) -> Value { Value::ClassShared(value) }
fn array(items: Vec<Value>) -> Value { Value::Array(Arc::new(items)) }
fn empty() -> Arc<Map> { Arc::new(Map::Leaf) }
fn singleton(name: &str, value: Value) -> Arc<Map> {
    Arc::new(Map::Node(1, 1, Value::String(name.into()), value, empty(), empty()))
}
fn table(types: Arc<Map>) -> Arc<Map> { singleton("Fixture.choose", boxed(types)) }
fn ann(ty: Arc<ExprType>) -> Value {
    let mut fields = RecordFields::new();
    fields.push("type", boxed(Arc::new(Maybe::Just(boxed(ty)))));
    fields.push("meta", boxed(Arc::new(Maybe::Nothing)));
    fields.push("sourceUsage", boxed(Arc::new(Maybe::Nothing)));
    fields.push("span", PureScript_Backend_Optimizer_CoreFn_emptySpan());
    Value::DynamicRecord(PerceusPtr::new(fields))
}
fn function(ty: Arc<ExprType>) -> Arc<ExprType> {
    Arc::new(ExprType::Func(array(vec![boxed(ty.clone())]), ty))
}
fn fixture(ty: Arc<ExprType>, literal: Literal) -> (Arc<Expr>, String) {
    let variable = Arc::new(ExprType::TypeVar("a".into()));
    let generic = Arc::new(ExprType::ForAll(array(vec![Value::String("a".into())]), function(variable)));
    let global = Arc::new(Expr::ExprVar(ann(generic), Arc::new(Qualified::Qualified(
        Arc::new(Maybe::Just(Value::String("Fixture".into()))), Value::String("choose".into())))));
    let literal = Arc::new(Expr::ExprLit(ann(ty.clone()), Arc::new(literal)));
    let key = PureScript_Backend_Optimizer_Monomorphize_specializationKey(
        function(ty.clone()), array(vec![]), array(vec![boxed(literal.clone())]));
    let call = Arc::new(Expr::ExprApp(ann(ty.clone()),
        Arc::new(Expr::ExprTypeApp(ann(function(ty.clone())), global, ty)), literal));
    (call, key)
}
struct Tracked { expr: Arc<Expr>, lookups: Arc<Map> }
fn tracked(map: Arc<Map>, expr: Arc<Expr>) -> Tracked {
    let result = PureScript_Backend_Optimizer_Monomorphize_specializeTracked("Caller".into(), map, expr);
    Tracked { expr: result.get_expr().unwrap_class_shared::<Expr>(), lookups: result.get_lookups().unwrap_class_shared::<Map>() }
}
fn unchanged(map: Arc<Map>, result: &Tracked) -> bool {
    PureScript_Backend_Optimizer_Monomorphize_sameLookupResults(map, result.lookups.clone())
}
fn head_name(expr: &Expr) -> String {
    match expr {
        Expr::ExprApp(_, head, _) | Expr::ExprTypeApp(_, head, _) => head_name(head),
        Expr::ExprVar(_, name) => match name.as_ref() { Qualified::Qualified(_, ident) => ident.unwrap_string() },
        _ => panic!("expected application head"),
    }
}
fn check() {
    for (ty, lit) in [(Arc::new(ExprType::Int), Literal::LitInt(7)),
        (Arc::new(ExprType::String), Literal::LitString("seven".into()))] {
        let (call, key) = fixture(ty, lit);
        let absent = tracked(empty(), call.clone());
        assert!(unchanged(empty(), &absent));
        assert!(unchanged(singleton("Other.name", boxed(empty())), &absent));
        assert!(!unchanged(table(empty()), &absent));
        let missed = tracked(table(empty()), call.clone());
        assert!(unchanged(table(singleton("unrelated", Value::Unit)), &missed));
        assert!(!unchanged(table(singleton(&key, Value::Unit)), &missed));
        let found = tracked(table(singleton(&key, Value::Unit)), call.clone());
        assert!(matches!(found.lookups.as_ref(), Map::Leaf));
        assert!(head_name(&found.expr).starts_with("choose__"));
        assert_eq!(head_name(&call), "choose", "input AST was mutated");
        let deferred = Arc::new(Expr::ExprAbs(ann(Arc::new(ExprType::Any)), "deferred".into(), call));
        let body = tracked(table(empty()), deferred);
        assert!(!unchanged(table(singleton(&key, Value::Unit)), &body));
    }
}
fn main() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let action = PureScript_Backend_Optimizer_Monomorphize_evaluateTracked(Func1::Shared(Arc::new(move |_| {
        Value::Int(counter.fetch_add(1, Ordering::SeqCst) as i64 + 1)
    })));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(action.unwrap_func1()(Value::Unit).unwrap_int(), 1);
    assert_eq!(action.unwrap_func1()(Value::Unit).unwrap_int(), 2);
    let threads: Vec<_> = (0..8).map(|_| std::thread::spawn(|| { for _ in 0..20 { check(); } })).collect();
    for thread in threads { thread.join().unwrap(); }
    println!("Native specialization reads: 320 isolated typed fixtures; missing-global/key invalidation, stable successes, deferred bodies and replayable Effect passed");
}
