pub fn PureScript_Backend_Optimizer_FfiSupport_hashString(input: String) -> String {
    let mut hash: u32 = 5381;
    for unit in input.chars().rev().map(purust_char_to_code_unit) {
        hash = hash.wrapping_mul(33) ^ unit as u32;
    }
    hash.to_string()
}

pub fn PureScript_Backend_Optimizer_FfiSupport_compareStringImpl(lt: Value, eq: Value, gt: Value, x: String, y: String) -> Value {
    if x < y { lt } else if x > y { gt } else { eq }
}

pub fn PureScript_Backend_Optimizer_FfiSupport_compareIntImpl(lt: Value, eq: Value, gt: Value, x: i64, y: i64) -> Value {
    if x < y { lt } else if x > y { gt } else { eq }
}

fn purust_nullable_path(input: &Purs_Data_Nullable::Nullable) -> Option<std::path::PathBuf> {
    input.value().map(|v| std::path::PathBuf::from(purust_string_to_utf8_lossy(&v.unwrap_string())))
}

fn purust_ffi_dirs(root: &std::path::Path, extra: &Value, directory: &Purs_Data_Nullable::Nullable) -> Vec<std::path::PathBuf> {
    let mut spago = vec![root.join(".spago"), root.join("spago.d")];
    spago.extend(extra.unwrap_array().iter().map(|v| root.join(purust_string_to_utf8_lossy(&v.unwrap_string()))));
    let mut result = Vec::new();
    for directory in spago {
        let mut packages = match std::fs::read_dir(directory) {
            Ok(entries) => entries.filter_map(Result::ok).map(|e| e.path()).collect::<Vec<_>>(),
            Err(_) => continue,
        };
        packages.sort();
        for package in packages.into_iter().filter(|p| p.is_dir()) {
            let mut versions = std::fs::read_dir(&package).unwrap().filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with('v') && e.path().is_dir())
                .map(|e| e.path()).collect::<Vec<_>>();
            versions.sort();
            if versions.is_empty() { result.push(package); } else { result.extend(versions); }
        }
    }
    if let Some(path) = purust_nullable_path(directory) { result.push(root.join(path)); }
    result.push(root.to_owned());
    result
}

pub fn PureScript_Backend_Optimizer_FfiSupport_findFfiFileImpl(
    extension: String, extra: Value, directory: std::rc::Rc<Purs_Data_Nullable::Nullable>,
    module: String, source: std::rc::Rc<Purs_Data_Nullable::Nullable>,
) -> Value {
    Value::Func1(Func1::Shared(std::rc::Rc::new(move |_| {
        let find = || {
            if let Some(source) = purust_nullable_path(&source) {
                let text = source.to_string_lossy();
                let file = std::path::PathBuf::from(format!("{}{}", text.strip_suffix(".purs").unwrap_or(&text), extension));
                if file.exists() { return Some(file); }
            }
            let root = std::env::current_dir().expect("compiler working directory");
            for directory in purust_ffi_dirs(&root, &extra, &directory) {
                for file in [directory.join("src").join(module.replace('.', "/") + &extension),
                    directory.join("src").join(module.clone() + &extension), directory.join(module.clone() + &extension)] {
                    if file.exists() { return Some(file); }
                }
            }
            None
        };
        let result = match find() {
            Some(path) => Purs_Data_Nullable::Data_Nullable_notNull(Value::String(purust_string_from_utf8(&path.to_string_lossy()))),
            None => Purs_Data_Nullable::Data_Nullable_null(),
        };
        Value::Class(std::rc::Rc::new(result))
    })))
}
