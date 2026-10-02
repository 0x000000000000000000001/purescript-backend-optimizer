use std::rc::Rc;
use std::cmp::Ordering as KeyOrdering;
use Purs_Data_Map_Internal::Map;
use Purs_Data_Maybe::Maybe;
use Purs_PureScript_Backend_Optimizer_CoreFn::Qualified;

// Native operations on the existing persistent AVL representation. The node
// layout, balancing and union/combine order match Data.Map.Internal; callers
// can freely mix generated and native operations and retain old versions.
fn purust_key_string(value: &Value) -> &str {
    match value.resolve() {
        Value::String(value) => value,
        _ => panic!("Expected a String map key"),
    }
}
fn purust_compare_string(a: &Value, b: &Value) -> KeyOrdering {
    // The runtime's encoding preserves UTF-16 code-unit order.
    purust_key_string(a).cmp(purust_key_string(b))
}
fn purust_compare_int(a: &Value, b: &Value) -> KeyOrdering {
    a.unwrap_int().cmp(&b.unwrap_int())
}
fn purust_compare_qualified(a: &Value, b: &Value) -> KeyOrdering {
    let Qualified::Qualified(am, ai) = a.unwrap_class::<Rc<Qualified>>().as_ref();
    let Qualified::Qualified(bm, bi) = b.unwrap_class::<Rc<Qualified>>().as_ref();
    let module = match (am.as_ref(), bm.as_ref()) {
        (Maybe::Nothing, Maybe::Nothing) => KeyOrdering::Equal,
        (Maybe::Nothing, _) => KeyOrdering::Less,
        (_, Maybe::Nothing) => KeyOrdering::Greater,
        (Maybe::Just(a), Maybe::Just(b)) => purust_compare_string(a, b),
    };
    module.then_with(|| purust_compare_string(ai, bi))
}
fn purust_compare_callback(compare: &Func2<Value, Value, Purs_Data_Ordering::Ordering>, a: &Value, b: &Value) -> KeyOrdering {
    match compare(a.clone(), b.clone()) {
        Purs_Data_Ordering::Ordering::LT => KeyOrdering::Less,
        Purs_Data_Ordering::Ordering::EQ => KeyOrdering::Equal,
        Purs_Data_Ordering::Ordering::GT => KeyOrdering::Greater,
    }
}

fn purust_map_height(map: &Map) -> i64 {
    match map { Map::Leaf => 0, Map::Node(h, _, _, _, _, _) => *h }
}
fn purust_map_size(map: &Map) -> i64 {
    match map { Map::Leaf => 0, Map::Node(_, s, _, _, _, _) => *s }
}
fn purust_map_node(key: Value, value: Value, left: Rc<Map>, right: Rc<Map>) -> Rc<Map> {
    Rc::new(Map::Node(1 + purust_map_height(&left).max(purust_map_height(&right)),
        1 + purust_map_size(&left) + purust_map_size(&right), key, value, left, right))
}
fn purust_map_balance(key: Value, value: Value, left: Rc<Map>, right: Rc<Map>) -> Rc<Map> {
    let lh = purust_map_height(&left);
    let rh = purust_map_height(&right);
    if rh > lh + 1 {
        let Map::Node(_, _, rk, rv, rl, rr) = right.as_ref() else { unreachable!() };
        if let Map::Node(h, _, lk, lv, ll, lr) = rl.as_ref() {
            if *h > purust_map_height(rr) {
                return purust_map_node(lk.clone(), lv.clone(),
                    purust_map_node(key, value, left, ll.clone()),
                    purust_map_node(rk.clone(), rv.clone(), lr.clone(), rr.clone()));
            }
        }
        return purust_map_node(rk.clone(), rv.clone(),
            purust_map_node(key, value, left, rl.clone()), rr.clone());
    }
    if lh > rh + 1 {
        let Map::Node(_, _, lk, lv, ll, lr) = left.as_ref() else { unreachable!() };
        if let Map::Node(h, _, rk, rv, rl, rr) = lr.as_ref() {
            if purust_map_height(ll) <= *h {
                return purust_map_node(rk.clone(), rv.clone(),
                    purust_map_node(lk.clone(), lv.clone(), ll.clone(), rl.clone()),
                    purust_map_node(key, value, rr.clone(), right));
            }
        }
        return purust_map_node(lk.clone(), lv.clone(), ll.clone(),
            purust_map_node(key, value, lr.clone(), right));
    }
    purust_map_node(key, value, left, right)
}
fn purust_map_find<'a>(compare: &impl Fn(&Value, &Value) -> KeyOrdering, key: &Value, mut map: &'a Map) -> Option<&'a Value> {
    while let Map::Node(_, _, mk, mv, ml, mr) = map {
        map = match compare(key, mk) {
            KeyOrdering::Less => ml,
            KeyOrdering::Greater => mr,
            KeyOrdering::Equal => return Some(mv),
        };
    }
    None
}
fn purust_map_lookup(compare: &impl Fn(&Value, &Value) -> KeyOrdering, key: &Value, map: &Map) -> Rc<Maybe> {
    Rc::new(match purust_map_find(compare, key, map) {
        Some(value) => Maybe::Just(value.clone()),
        None => Maybe::Nothing,
    })
}
fn purust_map_insert(compare: &impl Fn(&Value, &Value) -> KeyOrdering, key: Value, value: Value, map: &Rc<Map>) -> Rc<Map> {
    match map.as_ref() {
        Map::Leaf => purust_map_node(key, value, map.clone(), map.clone()),
        Map::Node(h, s, mk, mv, ml, mr) => match compare(&key, mk) {
            KeyOrdering::Less => purust_map_balance(mk.clone(), mv.clone(), purust_map_insert(compare, key, value, ml), mr.clone()),
            KeyOrdering::Greater => purust_map_balance(mk.clone(), mv.clone(), ml.clone(), purust_map_insert(compare, key, value, mr)),
            KeyOrdering::Equal => Rc::new(Map::Node(*h, *s, key, value, ml.clone(), mr.clone())),
        },
    }
}
fn purust_map_split(compare: &impl Fn(&Value, &Value) -> KeyOrdering, key: &Value, map: &Rc<Map>) -> (Option<Value>, Rc<Map>, Rc<Map>) {
    match map.as_ref() {
        Map::Leaf => (None, map.clone(), map.clone()),
        Map::Node(_, _, mk, mv, ml, mr) => match compare(key, mk) {
            KeyOrdering::Less => {
                let (value, ll, lr) = purust_map_split(compare, key, ml);
                (value, ll, purust_map_balance(mk.clone(), mv.clone(), lr, mr.clone()))
            }
            KeyOrdering::Greater => {
                let (value, rl, rr) = purust_map_split(compare, key, mr);
                (value, purust_map_balance(mk.clone(), mv.clone(), ml.clone(), rl), rr)
            }
            KeyOrdering::Equal => (Some(mv.clone()), ml.clone(), mr.clone()),
        },
    }
}
fn purust_map_union(compare: &impl Fn(&Value, &Value) -> KeyOrdering, combine: &impl Fn(Value, Value) -> Value, left: &Rc<Map>, right: &Rc<Map>) -> Rc<Map> {
    match (left.as_ref(), right.as_ref()) {
        (Map::Leaf, _) => right.clone(),
        (_, Map::Leaf) => left.clone(),
        (_, Map::Node(_, _, rk, rv, rl, rr)) => {
            let (lv, ll, lr) = purust_map_split(compare, rk, left);
            let l = purust_map_union(compare, combine, &ll, rl);
            let r = purust_map_union(compare, combine, &lr, rr);
            let value = match lv { Some(lv) => combine(lv, rv.clone()), None => rv.clone() };
            purust_map_balance(rk.clone(), value, l, r)
        }
    }
}

pub fn PureScript_Backend_Optimizer_NativeMaps_qualifiedIdentCompare() -> Value { Value::Unit }
pub fn PureScript_Backend_Optimizer_NativeMaps_stringCompare() -> Value { Value::Unit }
pub fn PureScript_Backend_Optimizer_NativeMaps_intCompare() -> Value { Value::Unit }
pub fn PureScript_Backend_Optimizer_NativeMaps_evalRefCompare() -> Value { Value::Unit }
pub fn PureScript_Backend_Optimizer_NativeMaps_tcoRefCompare() -> Value { Value::Unit }

pub fn PureScript_Backend_Optimizer_NativeMaps_lookupQualifiedIdentImpl(_: Value, key: Value, map: Rc<Map>) -> Rc<Maybe> {
    purust_map_lookup(&purust_compare_qualified, &key, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_insertQualifiedIdentImpl(_: Value, key: Value, value: Value, map: Rc<Map>) -> Rc<Map> {
    purust_map_insert(&purust_compare_qualified, key, value, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_lookupStringImpl(_: Value, key: Value, map: Rc<Map>) -> Rc<Maybe> {
    purust_map_lookup(&purust_compare_string, &key, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_insertStringImpl(_: Value, key: Value, value: Value, map: Rc<Map>) -> Rc<Map> {
    purust_map_insert(&purust_compare_string, key, value, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_unionStringImpl(_: Value, a: Rc<Map>, b: Rc<Map>) -> Rc<Map> {
    purust_map_union(&purust_compare_string, &|a, _| a, &a, &b)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_unionWithStringImpl(_: Value, combine: Func2<Value, Value, Value>, a: Rc<Map>, b: Rc<Map>) -> Rc<Map> {
    purust_map_union(&purust_compare_string, &|a, b| combine(a, b), &a, &b)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_lookupIntImpl(_: Value, key: Value, map: Rc<Map>) -> Rc<Maybe> {
    purust_map_lookup(&purust_compare_int, &key, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_insertIntImpl(_: Value, key: Value, value: Value, map: Rc<Map>) -> Rc<Map> {
    purust_map_insert(&purust_compare_int, key, value, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_unionWithIntImpl(_: Value, combine: Func2<Value, Value, Value>, a: Rc<Map>, b: Rc<Map>) -> Rc<Map> {
    purust_map_union(&purust_compare_int, &|a, b| combine(a, b), &a, &b)
}
// EvalRef/TcoRef live in modules depending on NativeMaps. Keep their supplied
// comparator to avoid a Rust crate cycle, but eliminate per-operation Ord/Eq
// allocation and generic traversal wrappers.
pub fn PureScript_Backend_Optimizer_NativeMaps_lookupEvalRefImpl(_: Value, compare: Func2<Value, Value, Purs_Data_Ordering::Ordering>, key: Value, map: Rc<Map>) -> Rc<Maybe> {
    purust_map_lookup(&|a, b| purust_compare_callback(&compare, a, b), &key, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_insertEvalRefImpl(_: Value, compare: Func2<Value, Value, Purs_Data_Ordering::Ordering>, key: Value, value: Value, map: Rc<Map>) -> Rc<Map> {
    purust_map_insert(&|a, b| purust_compare_callback(&compare, a, b), key, value, &map)
}
pub fn PureScript_Backend_Optimizer_NativeMaps_memberEvalRefImpl(_: Value, compare: Func2<Value, Value, Purs_Data_Ordering::Ordering>, key: Value, map: Rc<Map>) -> bool {
    purust_map_find(&|a, b| purust_compare_callback(&compare, a, b), &key, &map).is_some()
}
pub fn PureScript_Backend_Optimizer_NativeMaps_unionWithTcoRefImpl(_: Value, compare: Func2<Value, Value, Purs_Data_Ordering::Ordering>, combine: Func2<Value, Value, Value>, a: Rc<Map>, b: Rc<Map>) -> Rc<Map> {
    purust_map_union(&|a, b| purust_compare_callback(&compare, a, b), &|a, b| combine(a, b), &a, &b)
}
