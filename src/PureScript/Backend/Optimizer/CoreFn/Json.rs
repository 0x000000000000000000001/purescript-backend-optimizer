use std::rc::Rc;

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

    pub(super) fn object(value: &Value) -> Option<&Rc<Object>> {
        match value.resolve() {
            Value::Class(native) => native.downcast_ref::<Rc<Object>>(),
            _ => None,
        }
    }

    // Exactly Data.Int.fromNumber: finite, integral and within the Int range.
    // `decodeInt`'s +2147483648 -> bottom rule is deliberately not part of it.
    pub(super) fn integer(value: &Value) -> Option<i64> {
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

// Decode an annotation and its source usage directly from the JSON object.
// Every unsupported or malformed shape returns None so the caller delegates to
// the validated PureScript decoder, which keeps the exact error values and the
// meta/type/source-usage precedence. Nothing is cached between inputs: each
// call builds fresh Meta, Maybe and record values, while type-table entries are
// cloned handles so they keep sharing the decoded table's ExprType arcs.
mod purust_ann {
    use super::*;
    use super::purust_type_table::{integer, object};
    use std::rc::Rc;
    use Purs_Data_Maybe::Maybe;
    use Purs_PureScript_Backend_Optimizer_CoreFn::{ConstructorType, Meta};

    fn string(value: &Value) -> Option<String> {
        // Data.Argonaut caseJson's on_string accepts String and Char exactly.
        match value.resolve() {
            Value::String(text) => Some(text.clone()),
            Value::Char(character) => Some(character.to_string()),
            _ => None,
        }
    }

    fn number(value: &Value) -> Option<f64> {
        match value.resolve() {
            Value::Int(value) => Some(*value as f64),
            Value::Number(value) => Some(*value),
            _ => None,
        }
    }

    fn is_null(value: &Value) -> bool { matches!(value.resolve(), Value::Null) }

    // getFieldOptional': an absent or null field is Maybe Nothing and is never
    // decoded; anything else must decode or the whole fast path declines.
    fn optional(value: &Option<Value>, decode: impl Fn(&Value) -> Option<Value>) -> Option<Option<Value>> {
        match value {
            None => Some(None),
            Some(value) if is_null(value) => Some(None),
            Some(value) => decode(value).map(Some),
        }
    }

    fn maybe(value: Option<Value>) -> Value {
        let payload = match value {
            Some(value) => Maybe::Just(value),
            None => Maybe::Nothing,
        };
        Value::Class(Rc::new(Rc::new(payload)))
    }

    fn meta(meta: Meta) -> Value { Value::Class(Rc::new(Rc::new(meta))) }

    fn constructor_type(value: &Value) -> Option<ConstructorType> {
        match string(value)?.as_str() {
            "ProductType" => Some(ConstructorType::ProductType),
            "SumType" => Some(ConstructorType::SumType),
            _ => None,
        }
    }

    // decodeArray decodeIdent: one decodeString per element, in order.
    fn identifiers(value: &Value) -> Option<Value> {
        if !value.is_array() { return None; }
        let mut result = Vec::with_capacity(value.array_len());
        for item in value.array_iter() {
            result.push(Value::String(string(&item)?));
        }
        Some(mk_array(result))
    }

    fn decode_meta(value: &Value) -> Option<Value> {
        let fields = object(value)?;
        let [meta_type] = fields.get_many(["metaType"]);
        let tag = string(&meta_type?)?;
        Some(match tag.as_str() {
            "IsConstructor" => {
                let [constructor, identifier_list] = fields.get_many(["constructorType", "identifiers"]);
                meta(Meta::IsConstructor(constructor_type(&constructor?)?, identifiers(&identifier_list?)?))
            }
            "IsNewtype" => meta(Meta::IsNewtype),
            "IsTypeClassConstructor" => meta(Meta::IsTypeClassConstructor),
            "IsForeign" => meta(Meta::IsForeign),
            "IsWhere" => meta(Meta::IsWhere),
            "IsSyntheticApp" => meta(Meta::IsSyntheticApp),
            _ => return None,
        })
    }

    // decodeInt + Array.index for Ann.type: +2147483648 is the Int bottom and
    // therefore indexes Nothing, negatives and out-of-range indexes are
    // Nothing too, and every other number that decodeInt rejects declines.
    fn decode_type(table: &Value, value: &Value) -> Option<Value> {
        let number = number(value)?;
        let index = if let Some(int) = integer(value) {
            if int < 0 { return Some(maybe(None)); }
            int as usize
        } else if number == 2147483648.0 {
            return Some(maybe(None));
        } else {
            return None;
        };
        if !table.is_array() { return None; }
        if index < table.array_len() {
            Some(maybe(Some(table.array_get(index))))
        } else {
            Some(maybe(None))
        }
    }

    // decodeSourceBindingId: a nonnegative identifier produced by fromNumber.
    fn decode_binding_id(module: &str, value: &Value) -> Option<Value> {
        let binding_id = integer(value)?;
        if binding_id < 0 { return None; }
        Some(Value::Record_bindingId_moduleName(perceus_ptr::PerceusPtr::new(
            purust_core::Record_bindingId_moduleName {
                moduleName: Some(Value::String(module.to_owned())),
                bindingId: Some(mk_int(binding_id)),
            })))
    }

    // decodeUsageBound: a finite nonnegative integer is Just when it fits in
    // Int, Nothing when it is only known to be larger, and an error otherwise.
    fn decode_max_uses(value: &Option<Value>) -> Option<Value> {
        match value {
            None => Some(maybe(None)),
            Some(value) if is_null(value) => Some(maybe(None)),
            Some(value) => {
                let number = number(value)?;
                if !super::PureScript_Backend_Optimizer_CoreFn_Json_isNonNegativeInteger(number) {
                    return None;
                }
                Some(maybe(integer(value).map(mk_int)))
            }
        }
    }

    fn decode_escaping_use_context(value: &Option<Value>) -> Option<Value> {
        match value {
            None => Some(maybe(None)),
            Some(value) if is_null(value) => Some(maybe(None)),
            Some(value) => match value.resolve() {
                Value::Bool(flag) => Some(maybe(Some(mk_bool(*flag)))),
                _ => None,
            },
        }
    }

    // decodeLastLocalUse: null is Nothing, true is Just true, false is an error.
    fn decode_last_local_use(value: &Option<Value>) -> Option<Value> {
        match value {
            None => Some(maybe(None)),
            Some(value) if is_null(value) => Some(maybe(None)),
            Some(value) => match value.resolve() {
                Value::Bool(true) => Some(maybe(Some(mk_bool(true)))),
                _ => None,
            },
        }
    }

    fn decode_binding_usage(module: &str, value: &Value) -> Option<Value> {
        let fields = object(value)?;
        let [binding, max_uses, escaping] = fields.get_many(["bindingId", "maxUses", "hasEscapingUseContext"]);
        Some(Value::Record_binding_hasEscapingUseContext_maxUses(perceus_ptr::PerceusPtr::new(
            purust_core::Record_binding_hasEscapingUseContext_maxUses {
                binding: Some(decode_binding_id(module, &binding?)?),
                maxUses: Some(decode_max_uses(&max_uses)?),
                hasEscapingUseContext: Some(decode_escaping_use_context(&escaping)?),
            })))
    }

    fn decode_variable_use(module: &str, value: &Value) -> Option<Value> {
        let fields = object(value)?;
        let [binding, last_local_use] = fields.get_many(["bindingId", "lastLocalUse"]);
        Some(Value::Record_binding_lastLocalUse(perceus_ptr::PerceusPtr::new(
            purust_core::Record_binding_lastLocalUse {
                binding: Some(decode_binding_id(module, &binding?)?),
                lastLocalUse: Some(decode_last_local_use(&last_local_use)?),
            })))
    }

    pub(super) fn decode(module: &str, table: &Value, input: &Value) -> Option<Value> {
        let fields = object(input)?;
        let [meta_field, type_field, binding_usage, variable_use] =
            fields.get_many(["meta", "type", "bindingUsage", "variableUse"]);
        let meta = optional(&meta_field, decode_meta)?;
        let type_value = match &type_field {
            None => maybe(None),
            Some(value) if is_null(value) => maybe(None),
            Some(value) => decode_type(table, value)?,
        };
        let binding_usage = optional(&binding_usage, |value| decode_binding_usage(module, value))?;
        let variable_use = optional(&variable_use, |value| decode_variable_use(module, value))?;
        let source_usage = match (binding_usage, variable_use) {
            (None, None) => maybe(None),
            (binding_usage, variable_use) => maybe(Some(Value::Record_bindingUsage_variableUse(
                perceus_ptr::PerceusPtr::new(purust_core::Record_bindingUsage_variableUse {
                    bindingUsage: Some(maybe(binding_usage)),
                    variableUse: Some(maybe(variable_use)),
                })))),
        };
        Some(Value::Record_meta_sourceUsage_span_type_kw(perceus_ptr::PerceusPtr::new(
            purust_core::Record_meta_sourceUsage_span_type_kw {
                span: Some(Purs_PureScript_Backend_Optimizer_CoreFn::PureScript_Backend_Optimizer_CoreFn_emptySpan()),
                meta: Some(maybe(meta)),
                type_kw: Some(type_value),
                sourceUsage: Some(source_usage),
            })))
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
) -> Value {
    // decodeArray only calls this after decodeJArray succeeded. Anything else
    // is delegated before the first callback so a non-array never runs one.
    if !input.is_array() { return fallback(decoder, input); }
    let items = input.array_iter();
    let mut result = Vec::with_capacity(items.len());
    for (index, item) in items.enumerate() {
        // Exactly one callback per element, in order.
        let decoded = decoder(item);
        let Value::Class(payload) = decoded.resolve() else { panic!("Expected Either") };
        let either = payload.downcast_ref::<Rc<Purs_Data_Either::Either>>().expect("Expected Either");
        match either.as_ref() {
            // Stop at the first Left and wrap it exactly like decodeArrayPS.
            // The fallback is never re-run here: the callback may be expensive
            // or effectful and every element is decoded at most once.
            Purs_Data_Either::Either::Left(error) => {
                let error = error.unwrap_class::<Rc<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>>().clone();
                let at_index = Value::Class(Rc::new(Rc::new(
                    Purs_Data_Argonaut_Decode_Error::JsonDecodeError::AtIndex(index as i64, error))));
                return Value::Class(Rc::new(Rc::new(Purs_Data_Either::Either::Left(at_index))));
            }
            Purs_Data_Either::Either::Right(value) => result.push(value.clone()),
        }
    }
    Value::Class(Rc::new(Rc::new(Purs_Data_Either::Either::Right(mk_array(result)))))
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeAnnWithUsageImpl(
    fallback: Func4<String, Value, String, Value, Value>, module: String, table: Value, path: String, input: Value,
) -> Value {
    if let Some(ann) = purust_ann::decode(&module, &table, &input) {
        return Value::Class(Rc::new(Rc::new(Purs_Data_Either::Either::Right(ann))));
    }
    fallback(module, table, path, input)
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_decodeModuleImpl(
    fallback: Func1<Value, Value>, _validate: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>, input: Value,
) -> Value { fallback(input) }
