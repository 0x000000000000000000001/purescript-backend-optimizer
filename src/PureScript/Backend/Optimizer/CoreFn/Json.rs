// Resolve ordinary, well-formed acyclic tables without the generic ST,
// Maybe/Either and dictionary plumbing. Anything requiring error precedence
// or cycle forcing is delegated to the validated PureScript implementation.
mod purust_type_table {
    use super::*;
    use std::rc::Rc;
    use Purs_PureScript_Backend_Optimizer_CoreFn::ExprType as Ty;
    use Purs_Foreign_Object::Object;

    enum Ref {
        Ready(Rc<Ty>),
        Adt(String, Value, Vec<usize>),
        App(usize, Vec<usize>),
        Func(Vec<usize>, usize),
        Array(usize),
        Record(usize),
        Row(Vec<(String, usize)>, Option<usize>),
        ForAll(Value, usize),
        Constrained(Vec<(Value, Vec<usize>)>, usize),
    }

    fn object(value: &Value) -> Option<&Rc<Object>> {
        match value.resolve() {
            Value::Class(native) => native.downcast_ref::<Rc<Object>>(),
            _ => None,
        }
    }

    fn integer(value: &Value) -> Option<i64> {
        let number = match value.resolve() {
            Value::Int(n) => *n as f64,
            Value::Number(n) => *n,
            _ => return None,
        };
        (number.is_finite() && number.fract() == 0.0
            && (-2147483648.0..=2147483647.0).contains(&number)).then_some(number as i64)
    }

    fn index(value: &Value) -> Option<usize> {
        usize::try_from(integer(value)?).ok()
    }

    fn array<T>(value: &Value, decode: impl Fn(&Value) -> Option<T>) -> Option<Vec<T>> {
        if !value.is_array() { return None; }
        value.array_iter().map(|item| decode(&item)).collect()
    }

    fn string(value: &Value) -> Option<String> {
        if let Value::String(text) = value.resolve() { return Some(text.clone()); }
        // PSString uses code-unit arrays for strings containing lone surrogates.
        let units = array(value, |unit| u16::try_from(integer(unit)?).ok())?;
        Some(units.into_iter().map(purust_char_from_code_unit).collect())
    }

    fn strings(value: &Value) -> Option<Value> {
        Some(mk_array(array(value, string)?.into_iter().map(Value::String).collect()))
    }

    fn scalar(tag: &str) -> Option<Ty> {
        Some(match tag {
            "Int" => Ty::Int, "Number" => Ty::Number, "String" => Ty::String,
            "Char" => Ty::Char, "Boolean" => Ty::Boolean, "Unit" => Ty::Unit,
            "Any" => Ty::Any, _ => return None,
        })
    }

    fn decode_ref(value: &Value) -> Option<Ref> {
        if let Some(tag) = string(value) { return scalar(&tag).map(|t| Ref::Ready(Rc::new(t))); }
        let obj = object(value)?;
        let tag = match obj.get("type").and_then(|v| string(&v)) {
            Some(tag) => tag,
            None => return Some(Ref::Ready(Rc::new(Ty::TypeVar(string(&obj.get("TypeVar")?)?)))),
        };
        if let Some(ty) = scalar(&tag) { return Some(Ref::Ready(Rc::new(ty))); }
        Some(match tag.as_str() {
            "Adt" => {
                let names = array(&obj.get("fqn")?, string)?;
                let name = names.join(".");
                let fqn = mk_array(names.into_iter().map(Value::String).collect());
                Ref::Adt(name, fqn, array(&obj.get("args")?, index)?)
            }
            "TypeApp" => Ref::App(index(&obj.get("constructor")?)?, array(&obj.get("args")?, index)?),
            "Func" => Ref::Func(array(&obj.get("args")?, index)?, index(&obj.get("ret")?)?),
            "Array" => Ref::Array(index(&obj.get("element")?)?),
            "Record" => Ref::Record(index(&obj.get("row")?)?),
            "TypeVar" => Ref::Ready(Rc::new(Ty::TypeVar(string(&obj.get("name")?)?))),
            "TypeLevelString" => Ref::Ready(Rc::new(Ty::TypeLevelString(string(&obj.get("value")?)?))),
            "Row" => {
                let fields = array(&obj.get("fields")?, |field| {
                    let field = object(field)?;
                    Some((string(&field.get("label")?)?, index(&field.get("type")?)?))
                })?;
                let tail = match obj.get("tail") {
                    None => None,
                    Some(value) if matches!(value.resolve(), Value::Null) => None,
                    Some(value) => Some(index(&value)?),
                };
                Ref::Row(fields, tail)
            }
            "ForAll" => Ref::ForAll(strings(&obj.get("vars")?)?, index(&obj.get("body")?)?),
            "ConstrainedType" => {
                let constraints = array(&obj.get("constraints")?, |constraint| {
                    let constraint = object(constraint)?;
                    Some((strings(&constraint.get("fqn")?)?, array(&constraint.get("args")?, index)?))
                })?;
                Ref::Constrained(constraints, index(&obj.get("body")?)?)
            }
            _ => return None,
        })
    }

    fn boxed(ty: Rc<Ty>) -> Value { Value::Class(Rc::new(ty)) }
    fn tuple(first: Value, second: Value) -> Value {
        Value::Class(Rc::new(Rc::new(Purs_Data_Tuple::Tuple::Tuple(first, second))))
    }
    fn get(rows: &[Option<Rc<Ty>>], index: usize) -> Option<Rc<Ty>> { rows.get(index)?.clone() }
    fn args(rows: &[Option<Rc<Ty>>], indices: &[usize]) -> Option<Value> {
        Some(mk_array(indices.iter().map(|i| get(rows, *i).map(boxed)).collect::<Option<Vec<_>>>()?))
    }

    fn resolve(reference: &Ref, rows: &[Option<Rc<Ty>>]) -> Option<Rc<Ty>> {
        Some(Rc::new(match reference {
            Ref::Ready(ty) => return Some(ty.clone()),
            Ref::Adt(name, fqn, indices) => {
                let args = args(rows, indices)?;
                Ty::ADT(name.clone(), fqn.clone(), args)
            }
            Ref::App(constructor, indices) => Ty::TypeApp(get(rows, *constructor)?, args(rows, indices)?),
            Ref::Func(indices, ret) => Ty::Func(args(rows, indices)?, get(rows, *ret)?),
            Ref::Array(element) => Ty::Array(get(rows, *element)?),
            Ref::Record(row) => Ty::Record(get(rows, *row)?),
            Ref::Row(fields, tail) => {
                let fields = fields.iter().map(|(name, i)| Some(tuple(Value::String(name.clone()), boxed(get(rows, *i)?))))
                    .collect::<Option<Vec<_>>>()?;
                let tail = match tail {
                    None => Purs_Data_Maybe::Maybe::Nothing,
                    Some(i) => Purs_Data_Maybe::Maybe::Just(boxed(get(rows, *i)?)),
                };
                Ty::Row(mk_array(fields), Rc::new(tail))
            }
            Ref::ForAll(vars, body) => Ty::ForAll(vars.clone(), get(rows, *body)?),
            Ref::Constrained(constraints, body) => {
                let constraints = constraints.iter().map(|(fqn, indices)| Some(tuple(fqn.clone(), args(rows, indices)?)))
                    .collect::<Option<Vec<_>>>()?;
                Ty::ConstrainedType(mk_array(constraints), get(rows, *body)?)
            }
        }))
    }

    pub(super) fn decode(input: &Value) -> Option<Rc<Purs_Data_Either::Either>> {
        let refs = array(input, decode_ref)?;
        let mut rows = vec![None; refs.len()];
        let mut pending: Vec<usize> = (0..refs.len()).collect();
        while !pending.is_empty() {
            let before = pending.len();
            // Match the reference's ascending settlement order; future IDs may
            // settle on a later pass. Cycles and missing references fall back.
            pending.retain(|i| match resolve(&refs[*i], &rows) {
                Some(ty) => { rows[*i] = Some(ty); false }
                None => true,
            });
            if pending.len() == before { return None; }
        }
        Some(Rc::new(Purs_Data_Either::Either::Right(mk_array(rows.into_iter().map(|ty| boxed(ty.unwrap())).collect()))))
    }
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeTypeTableImpl(input: Value) -> std::rc::Rc<Purs_Data_Either::Either> {
    purust_type_table::decode(&input).unwrap_or_else(||
        Purs_PureScript_Backend_Optimizer_CoreFn_TypeTable::PureScript_Backend_Optimizer_CoreFn_TypeTable_decodeTypeTablePS(input))
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_isNonNegativeInteger(input: f64) -> bool {
    input.is_finite() && input >= 0.0 && input.fract() == 0.0
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeArrayImpl(
    fallback: Func2<Func1<Value, Value>, Value, Value>, decoder: Func1<Value, Value>, input: Value,
) -> Value { fallback(decoder, input) }

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeAnnWithUsageImpl(
    fallback: Func4<String, Value, String, Value, Value>, module: String, table: Value, path: String, input: Value,
) -> Value { fallback(module, table, path, input) }

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeModuleImpl(
    fallback: Func1<Value, Value>, _validate: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>, input: Value,
) -> Value { fallback(input) }
