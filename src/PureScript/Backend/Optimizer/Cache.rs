// Immutable implementations belong to one compiler build. Unlike V8's cache,
// this authoritative native store has no disk spill; trim must retain entries.
static PURUST_IMPLEMENTATIONS: std::sync::Mutex<Option<std::collections::HashMap<String, Value>>> = std::sync::Mutex::new(None);

fn purust_cache_effect(f: impl Fn() -> Value + 'static) -> Value {
    Value::Func1(Func1::Shared(std::rc::Rc::new(move |_| f())))
}

pub fn PureScript_Backend_Optimizer_Cache_beginPurmetaBuild() -> Value {
    purust_cache_effect(|| {
        *PURUST_IMPLEMENTATIONS.lock().unwrap() = Some(std::collections::HashMap::new());
        Value::Unit
    })
}

pub fn PureScript_Backend_Optimizer_Cache_writePurmetaSyncImpl(name: String, data: Value) -> Value {
    purust_cache_effect(move || {
        PURUST_IMPLEMENTATIONS.lock().unwrap().get_or_insert_with(Default::default).insert(name.clone(), data.clone());
        Value::Unit
    })
}

pub fn PureScript_Backend_Optimizer_Cache_readPurmetaSyncImpl(
    name: String, just: Func1<Value, std::rc::Rc<Purs_Data_Maybe::Maybe>>, nothing: std::rc::Rc<Purs_Data_Maybe::Maybe>,
) -> Value {
    purust_cache_effect(move || {
        let found = PURUST_IMPLEMENTATIONS.lock().unwrap().as_ref().and_then(|m| m.get(&name).cloned());
        let result = found.map(|data| just(data)).unwrap_or_else(|| nothing.clone());
        Value::Class(std::rc::Rc::new(result))
    })
}

pub fn PureScript_Backend_Optimizer_Cache_clearPurmetaCacheImpl() -> Value { purust_cache_effect(|| Value::Unit) }
pub fn PureScript_Backend_Optimizer_Cache_trimPurmetaCacheImpl() -> Value { purust_cache_effect(|| Value::Unit) }

pub fn PureScript_Backend_Optimizer_Cache_nowMillis() -> Value {
    purust_cache_effect(|| {
        static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
        Value::Number(START.get_or_init(std::time::Instant::now).elapsed().as_secs_f64() * 1000.0)
    })
}

pub fn PureScript_Backend_Optimizer_Cache_logMemoryImpl(label: String) -> Value {
    purust_cache_effect(move || {
        let count = PURUST_IMPLEMENTATIONS.lock().unwrap().as_ref().map_or(0, |m| m.len());
        eprintln!("[Cache - {}] {} native implementation modules", purust_string_to_utf8_lossy(&label), count);
        Value::Unit
    })
}

pub fn PureScript_Backend_Optimizer_Cache_writeAllocProfileImpl(path: String) -> Value {
    purust_cache_effect(move || {
        eprintln!("[Cache] Rust allocation profiling is unavailable: {}", purust_string_to_utf8_lossy(&path));
        Value::Unit
    })
}
