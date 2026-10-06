use std::sync::Arc as Rc;
use purust_core::*;
use Purs_Data_Map_Internal::Map;
use Purs_Data_Ordering::Ordering;
use Purs_PureScript_Backend_Optimizer_NativeMaps::*;

fn validate(map: &Map, entries: &mut Vec<(i64, i64)>) -> (i64, i64) {
    match map {
        Map::Leaf => (0, 0),
        Map::Node(height, size, key, value, left, right) => {
            let (lh, ls) = validate(left, entries);
            entries.push((key.unwrap_int(), value.unwrap_int()));
            let (rh, rs) = validate(right, entries);
            assert!((lh - rh).abs() <= 1, "AVL height imbalance");
            assert_eq!(*height, 1 + lh.max(rh));
            assert_eq!(*size, 1 + ls + rs);
            (*height, *size)
        }
    }
}

fn main() {
    let fallback = Func1::Static(|_: Rc<Map>| -> Rc<Map> { panic!("native range used fallback") });
    let mut checks = 0;
    for count in [0, 1, 2, 3, 17, 255, 4096] {
        let mut map = Rc::new(Map::Leaf);
        // Non-sorted insertions exercise varying source AVL shapes.
        for i in 0..count {
            let key = (i * 37) % count;
            map = PureScript_Backend_Optimizer_NativeMaps_insertIntImpl(Value::Unit, Value::Int(key), Value::Int(key * 3), map);
        }
        let mut original = Vec::new(); validate(&map, &mut original);
        let mut ranges = vec![(-1, count), (0, 0), (count / 2, count / 2), (count - 1, count - 1),
            (count / 3, count * 2 / 3), (-20, -1), (count + 1, count + 20), (2, 1)];
        let mut seed = 0x9e3779b9_u64;
        for _ in 0..128 {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let a = ((seed >> 32) % (count as u64 + 10)) as i64 - 5;
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            let b = ((seed >> 32) % (count as u64 + 10)) as i64 - 5;
            ranges.push((a.min(b), a.max(b)));
        }
        for (low, high) in ranges {
            let classify = Func1::Shared(Rc::new(move |key: Value| {
                let key = key.unwrap_int();
                if key < low { Ordering::LT } else if key > high { Ordering::GT } else { Ordering::EQ }
            }));
            let selected = PureScript_Backend_Optimizer_NativeMaps_filterRangeImpl(fallback.clone(), classify, map.clone());
            let mut actual = Vec::new(); validate(&selected, &mut actual);
            assert_eq!(actual, original.iter().copied().filter(|(key, _)| *key >= low && *key <= high).collect::<Vec<_>>());
            let mut after = Vec::new(); validate(&map, &mut after); assert_eq!(after, original);
            // Mixing the selected tree back into ordinary generated operations
            // must preserve its ordering, metadata and persistent old version.
            let inserted = PureScript_Backend_Optimizer_NativeMaps_insertIntImpl(Value::Unit, Value::Int(-100), Value::Int(7), selected.clone());
            let mut values = Vec::new(); validate(&inserted, &mut values);
            assert_eq!(values.len(), actual.len() + 1);
            let mut unchanged = Vec::new(); validate(&selected, &mut unchanged); assert_eq!(unchanged, actual);
            checks += 1;
        }
    }
    println!("Native range: {checks} differential membership, AVL validity and persistence cases passed");
}
