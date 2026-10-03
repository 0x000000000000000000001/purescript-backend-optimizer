use std::rc::Rc;
use std::collections::{HashMap, VecDeque};

#[derive(Clone, PartialEq, Eq, Hash)]
enum PurustMemoKey { Unit, Null, Int(i64), Number(u64), Bool(bool), String(String), Char(char), Pointer(u8, usize) }

fn purust_memo_key(value: &Value) -> Option<PurustMemoKey> {
    use PurustMemoKey as K;
    Some(match value {
        Value::Unit => K::Unit,
        Value::Null => K::Null,
        Value::Int(v) => K::Int(*v),
        Value::Number(v) => K::Number(if v.is_nan() { f64::NAN.to_bits() } else if *v == 0.0 { 0 } else { v.to_bits() }),
        Value::Bool(v) => K::Bool(*v),
        Value::String(v) => K::String(v.clone()),
        Value::Char(v) => K::Char(*v),
        Value::Class(v) => {
            // Typed compiler trees are boxed again at generic call sites. The
            // outer Any allocation is fresh on each call; cache the shared tree
            // identity, not that transient box. Entries retain both Values, so
            // the inner allocation cannot be reused while its key is cached.
            if let Some(tree) = v.downcast_ref::<Rc<Purs_PureScript_Backend_Optimizer_CoreFn::ExprType>>() {
                K::Pointer(3, Rc::as_ptr(tree) as usize)
            } else if let Some(tree) = v.downcast_ref::<Rc<Purs_PureScript_Backend_Optimizer_Syntax::BackendSyntax>>() {
                K::Pointer(4, Rc::as_ptr(tree) as usize)
            } else {
                K::Pointer(0, Rc::as_ptr(v) as *const () as usize)
            }
        },
        Value::Array(v) => K::Pointer(1, Rc::as_ptr(v) as usize),
        Value::IntArray(v) => K::Pointer(2, Rc::as_ptr(v) as usize),
        _ => return None,
    })
}

#[derive(Default)]
struct PurustMemo {
    // Retain both keys' owners while pointer identities are cached.
    entries: HashMap<(PurustMemoKey, PurustMemoKey), (Value, Value, Value)>,
    fifo: VecDeque<(PurustMemoKey, PurustMemoKey)>,
}

pub fn PureScript_Backend_Optimizer_BoundedMemo_createBoundedMemo(capacity: i64, f: Value) -> Value {
    Value::Func1(Func1::Shared(Rc::new(move |_| {
        let cache = Rc::new(std::sync::Mutex::new(PurustMemo::default()));
        let f = f.clone();
        Value::Func2(Func2::Shared(Rc::new(move |a, b| {
            let key = if capacity > 0 { purust_memo_key(&a).zip(purust_memo_key(&b)) } else { None };
            if let Some(key) = &key {
                if let Some((_, _, result)) = cache.lock().unwrap().entries.get(key) { return result.clone(); }
            }
            // Reentrant callbacks must never run under the cache lock.
            let result = f.unwrap_func2()(a.clone(), b.clone());
            if let Some(key) = key {
                let mut cache = cache.lock().unwrap();
                if let Some((_, _, previous)) = cache.entries.get(&key) { return previous.clone(); }
                if cache.entries.len() >= capacity as usize {
                    let oldest = cache.fifo.pop_front().unwrap();
                    cache.entries.remove(&oldest);
                }
                cache.fifo.push_back(key.clone());
                cache.entries.insert(key, (a, b, result.clone()));
            }
            result
        })))
    })))
}

pub fn PureScript_Backend_Optimizer_BoundedMemo_createStringMemo(capacity: i64, f: Value) -> Value {
    PureScript_Backend_Optimizer_BoundedMemo_createBoundedMemo(capacity, f)
}
