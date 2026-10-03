// Native borrowed comparison of `Qualified Ident` keys. The module name is
// read from the shared `Maybe`, the identifier from `Value::String`, and both
// are compared as `&str`: no string is cloned and no `Value` is boxed. The
// runtime stores UTF-16 code units as order-preserving Rust scalars, so
// `str::cmp` is exactly the order the PureScript oracle computes. The oracle
// passed by the wrapper stays authoritative on the JS/Go hosts and is
// deliberately ignored here; the differential fixture checks both paths
// against it.
fn purust_qualified_module_name(module: &Purs_Data_Maybe::Maybe) -> Option<&str> {
    match module {
        Purs_Data_Maybe::Maybe::Nothing => None,
        Purs_Data_Maybe::Maybe::Just(value) => match value.resolve() {
            Value::String(name) => Some(name.as_str()),
            _ => panic!("Expected a String module name in Qualified"),
        },
    }
}

fn purust_qualified_ident(value: &Value) -> &str {
    match value.resolve() {
        Value::String(name) => name.as_str(),
        _ => panic!("Expected a String identifier in Qualified"),
    }
}

fn purust_compare_qualified(a: &crate::Qualified, b: &crate::Qualified) -> std::cmp::Ordering {
    let crate::Qualified::Qualified(module_a, ident_a) = a;
    let crate::Qualified::Qualified(module_b, ident_b) = b;
    let module = match (purust_qualified_module_name(module_a.as_ref()), purust_qualified_module_name(module_b.as_ref())) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Less,
        (Some(_), None) => std::cmp::Ordering::Greater,
        (Some(a), Some(b)) => a.cmp(b),
    };
    module.then_with(|| purust_qualified_ident(ident_a).cmp(purust_qualified_ident(ident_b)))
}

pub fn PureScript_Backend_Optimizer_CoreFn_compareQualifiedIdentImpl(
    _fallback: Func2<std::rc::Rc<crate::Qualified>, std::rc::Rc<crate::Qualified>, Purs_Data_Ordering::Ordering>,
    a: std::rc::Rc<crate::Qualified>,
    b: std::rc::Rc<crate::Qualified>,
) -> Purs_Data_Ordering::Ordering {
    match purust_compare_qualified(a.as_ref(), b.as_ref()) {
        std::cmp::Ordering::Less => Purs_Data_Ordering::Ordering::LT,
        std::cmp::Ordering::Equal => Purs_Data_Ordering::Ordering::EQ,
        std::cmp::Ordering::Greater => Purs_Data_Ordering::Ordering::GT,
    }
}

pub fn PureScript_Backend_Optimizer_CoreFn_eqQualifiedIdentImpl(
    _fallback: Func2<std::rc::Rc<crate::Qualified>, std::rc::Rc<crate::Qualified>, bool>,
    a: std::rc::Rc<crate::Qualified>,
    b: std::rc::Rc<crate::Qualified>,
) -> bool {
    purust_compare_qualified(a.as_ref(), b.as_ref()) == std::cmp::Ordering::Equal
}
