use std::sync::{Arc, Mutex};
use purust_core::*;
use Purs_Data_Map_Internal::Map;
use Purs_PureScript_Backend_Optimizer_NativeMaps::*;

fn entries(map: &Map, output: &mut Vec<(i64, i64)>) {
    if let Map::Node(_, _, key, value, left, right) = map {
        entries(left, output); output.push((key.unwrap_int(), value.unwrap_int())); entries(right, output);
    }
}
fn main() {
    let fallback = Func1::Static(|_: Arc<Map>| -> Value { panic!("native suffix used fallback") });
    let mut checks = 0;
    for count in [0_i64, 1, 2, 17, 255, 4096] {
        let mut tree = Arc::new(Map::Leaf);
        for i in 0..count {
            let key = (i * 37) % count - count / 2;
            tree = PureScript_Backend_Optimizer_NativeMaps_insertIntImpl(Value::Unit, Value::Int(key), Value::Int(key * 3), tree);
        }
        let mut original = Vec::new(); entries(&tree, &mut original);
        for lower in [i64::MIN, -count, -count / 2, -1, 0, 1, count / 2, count, i64::MAX] {
            let seen = Arc::new(Mutex::new(Vec::new()));
            let events = seen.clone();
            let operation = Func2::Shared(Arc::new(move |value: Value, acc: Value| {
                let value = value.unwrap_int(); events.lock().unwrap().push(value);
                Value::Int(acc.unwrap_int().wrapping_mul(31).wrapping_add(value))
            }));
            let result = PureScript_Backend_Optimizer_NativeMaps_foldrIntSuffixImpl(
                fallback.clone(), lower, operation, Value::Int(17), tree.clone());
            let expected: Vec<_> = original.iter().rev().filter(|(key, _)| *key >= lower).map(|(_, value)| *value).collect();
            assert_eq!(*seen.lock().unwrap(), expected, "wrong callback order or multiplicity");
            assert_eq!(result.unwrap_int(), expected.iter().fold(17_i64, |acc, value| acc.wrapping_mul(31).wrapping_add(*value)));
            let mut after = Vec::new(); entries(&tree, &mut after); assert_eq!(after, original);
            checks += 1;
        }
    }
    println!("Native integer suffix: {checks} boundary/shape cases; exact fold order, multiplicity, seed and persistent input passed");
}
