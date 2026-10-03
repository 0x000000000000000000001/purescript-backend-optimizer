pub fn PureScript_Backend_Optimizer_App_moduleReadConcurrency() -> Value {
    Value::Func1(Func1::Shared(std::rc::Rc::new(|_| {
        let configured = std::env::var("GOPURS_JOBS").unwrap_or_default();
        let jobs = if !configured.is_empty() && configured.bytes().all(|b| b.is_ascii_digit()) {
            configured.parse::<i64>().ok().filter(|n| (1..=64).contains(n)).unwrap_or(8)
        } else { 8 };
        Value::Int(jobs)
    })))
}

// This legacy JSON cache is not used by the Rust backend. A JS object snapshot
// cannot reconstruct native ADTs/closures; miss on reads, reject writes.
pub fn PureScript_Backend_Optimizer_App_parseImpl(
    _just: Func1<Value, std::rc::Rc<Purs_Data_Maybe::Maybe>>,
    nothing: std::rc::Rc<Purs_Data_Maybe::Maybe>, _version: String, _text: String,
) -> std::rc::Rc<Purs_Data_Maybe::Maybe> { nothing }

pub fn PureScript_Backend_Optimizer_App_stringify(_version: String, _input: Value) -> String {
    panic!("The legacy BackendModule JSON cache is unsupported by the native Rust backend")
}
