pub fn PureScript_Backend_Optimizer_Monomorphize_sameIdentity(a: Value, b: Value) -> bool {
    match (&a, &b) {
        (Value::Unit, Value::Unit) | (Value::Null, Value::Null) => true,
        (Value::Int(a), Value::Int(b)) => a == b,
        (Value::Number(a), Value::Number(b)) => a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan(),
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Char(a), Value::Char(b)) => a == b,
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Class(a), Value::Class(b)) => std::rc::Rc::ptr_eq(a, b),
        // Shared owners are stored unsized: the data address is the identity.
        (Value::ClassShared(a), Value::ClassShared(b)) =>
            a.as_ref() as *const _ as *const u8 == b.as_ref() as *const _ as *const u8,
        (Value::Array(a), Value::Array(b)) => std::rc::Rc::ptr_eq(a, b),
        (Value::IntArray(a), Value::IntArray(b)) => std::rc::Rc::ptr_eq(a, b),
        _ => false,
    }
}
