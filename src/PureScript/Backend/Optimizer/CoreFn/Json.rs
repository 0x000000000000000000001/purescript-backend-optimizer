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

    fn decode_inner(with_usage: bool, module: &str, table: &Value, input: &Value) -> Option<Value> {
        let fields = object(input)?;
        let [meta_field, type_field, binding_usage, variable_use] =
            fields.get_many(["meta", "type", "bindingUsage", "variableUse"]);
        let meta = optional(&meta_field, decode_meta)?;
        let type_value = match &type_field {
            None => maybe(None),
            Some(value) if is_null(value) => maybe(None),
            Some(value) => decode_type(table, value)?,
        };
        let source_usage = if with_usage {
            let binding_usage = optional(&binding_usage, |value| decode_binding_usage(module, value))?;
            let variable_use = optional(&variable_use, |value| decode_variable_use(module, value))?;
            match (binding_usage, variable_use) {
                (None, None) => maybe(None),
                (binding_usage, variable_use) => maybe(Some(Value::Record_bindingUsage_variableUse(
                    perceus_ptr::PerceusPtr::new(purust_core::Record_bindingUsage_variableUse {
                        bindingUsage: Some(maybe(binding_usage)),
                        variableUse: Some(maybe(variable_use)),
                    })))),
            }
        } else {
            maybe(None)
        };
        Some(Value::Record_meta_sourceUsage_span_type_kw(perceus_ptr::PerceusPtr::new(
            purust_core::Record_meta_sourceUsage_span_type_kw {
                span: Some(Purs_PureScript_Backend_Optimizer_CoreFn::PureScript_Backend_Optimizer_CoreFn_emptySpan()),
                meta: Some(maybe(meta)),
                type_kw: Some(type_value),
                sourceUsage: Some(source_usage),
            })))
    }

    pub(super) fn decode(module: &str, table: &Value, input: &Value) -> Option<Value> {
        decode_inner(true, module, table, input)
    }

    // decodeAnn: same meta/type/span as decodeAnnWithUsage, but the bindingUsage
    // and variableUse fields are never read. Foreign annotations use this path
    // and the validated decoder ignores the same fields for them.
    pub(super) fn decode_plain(table: &Value, input: &Value) -> Option<Value> {
        decode_inner(false, "", table, input)
    }
}

// Native decodeModule fast path. The module shell, imports, declarations,
// expressions, binders and literals are decoded directly in the exact runtime
// representations. Any unsupported or malformed shape returns None so the whole
// call delegates to the validated PureScript decoder, which keeps the exact
// error tree and precedence. Source spans and the foreign Map stay on their
// generated helpers: both are cold (one or two calls per module) and their
// instances and hashing rules are subtle, so the coupling is deliberate.
mod purust_module {
    use super::*;
    use super::purust_ann;
    use super::purust_type_table::{decode as decode_table, object};
    use std::rc::Rc;
    use purust_core::{mk_array, Value};
    use Purs_Data_Maybe::Maybe;
    use Purs_Foreign_Object::Object;
    use Purs_PureScript_Backend_Optimizer_CoreFn::{
        Bind, Binder, Binding, CaseAlternative, CaseGuard, Expr, ExprType, Guard, Import,
        Literal, Prop, Qualified,
    };

    fn is_null(value: &Value) -> bool { matches!(value.resolve(), Value::Null) }

    // decodeString: caseJson routes both String and Char to on_string. The code
    // point array form of decodeStringLiteral is left to the fallback.
    fn string(value: &Value) -> Option<String> {
        match value.resolve() {
            Value::String(text) => Some(text.clone()),
            Value::Char(character) => Some(character.to_string()),
            _ => None,
        }
    }

    fn number(value: &Value) -> Option<f64> {
        match value.resolve() {
            Value::Number(value) => Some(*value),
            Value::Int(value) => Some(*value as f64),
            _ => None,
        }
    }

    // Exactly decodeInt: Data.Int.fromNumber, +2147483648 becomes Int.bottom and
    // every other rejected Number declines.
    fn int(value: &Value) -> Option<i64> {
        let number = number(value)?;
        if number.is_finite() && number.fract() == 0.0
            && (-2147483648.0..=2147483647.0).contains(&number) {
            Some(number as i64)
        } else if number == 2147483648.0 {
            Some(-2147483648)
        } else {
            None
        }
    }

    fn boolean(value: &Value) -> Option<bool> {
        match value.resolve() {
            Value::Bool(value) => Some(*value),
            _ => None,
        }
    }

    fn array_values(value: &Value) -> Option<Vec<Value>> {
        if !value.is_array() { return None; }
        Some(value.array_iter().collect())
    }

    fn string_array(value: &Value) -> Option<Vec<String>> {
        array_values(value)?.iter().map(string).collect()
    }

    fn string_literal(value: &Value) -> Option<String> { string(value) }

    fn mk_strings(values: Vec<String>) -> Value {
        mk_array(values.into_iter().map(Value::String).collect())
    }

    fn module_name(value: &Value) -> Option<String> {
        Some(string_array(value)?.join("."))
    }

    fn required_string(obj: &Rc<Object>, key: &str) -> Option<String> {
        string(&obj.get(key)?)
    }

    fn array_of(value: &Value, decode: &dyn Fn(&Value) -> Option<Value>) -> Option<Value> {
        let items = array_values(value)?;
        let mut decoded = Vec::with_capacity(items.len());
        for item in items {
            decoded.push(decode(&item)?);
        }
        Some(mk_array(decoded))
    }

    fn optional_array(obj: &Rc<Object>, key: &str, decode: &dyn Fn(&Value) -> Option<Value>) -> Option<Value> {
        match obj.get(key) {
            None => Some(mk_array(Vec::new())),
            Some(value) if is_null(&value) => Some(mk_array(Vec::new())),
            Some(value) => array_of(&value, decode),
        }
    }

    fn box_expr(node: Rc<Expr>) -> Value { Value::Class(Rc::new(node)) }
    fn box_binder(node: Rc<Binder>) -> Value { Value::Class(Rc::new(node)) }
    fn box_bind(node: Rc<Bind>) -> Value { Value::Class(Rc::new(node)) }
    fn box_binding(node: Rc<Binding>) -> Value { Value::Class(Rc::new(node)) }
    fn box_alternative(node: Rc<CaseAlternative>) -> Value { Value::Class(Rc::new(node)) }
    fn box_guard(node: Rc<Guard>) -> Value { Value::Class(Rc::new(node)) }
    fn box_prop(node: Prop) -> Value { Value::Class(Rc::new(Rc::new(node))) }
    fn box_import(node: Import) -> Value { Value::Class(Rc::new(Rc::new(node))) }

    fn maybe_nothing() -> Value { Value::Class(Rc::new(Rc::new(Maybe::Nothing))) }

    fn table_entry(table: &Value, id: i64) -> Option<Value> {
        if id < 0 { return None; }
        let index = id as usize;
        if index >= table.array_len() { return None; }
        Some(table.array_get(index))
    }

    fn ann(module: &str, table: &Value, obj: &Rc<Object>) -> Option<Value> {
        purust_ann::decode(module, table, &obj.get("annotation")?)
    }

    fn qualified(value: &Value) -> Option<Rc<Qualified>> {
        let obj = object(value)?;
        let module_name = match obj.get("moduleName") {
            None => None,
            Some(field) if is_null(&field) => None,
            Some(field) => Some(module_name(&field)?),
        };
        let identifier = string(&obj.get("identifier")?)?;
        let module_name = match module_name {
            Some(name) => Maybe::Just(Value::String(name)),
            None => Maybe::Nothing,
        };
        Some(Rc::new(Qualified::Qualified(Rc::new(module_name), Value::String(identifier))))
    }

    fn literal(value: &Value, decode: &dyn Fn(&Value) -> Option<Value>) -> Option<Rc<Literal>> {
        let obj = object(value)?;
        let kind = required_string(obj, "literalType")?;
        let node = match kind.as_str() {
            "IntLiteral" => Literal::LitInt(int(&obj.get("value")?)?),
            "NumberLiteral" => Literal::LitNumber(number(&obj.get("value")?)?),
            "StringLiteral" => Literal::LitString(string_literal(&obj.get("value")?)?),
            "CharLiteral" => {
                let text = string(&obj.get("value")?)?;
                let mut units = text.chars();
                let character = units.next()?;
                if units.next().is_some() { return None; }
                Literal::LitChar(character)
            }
            "BooleanLiteral" => Literal::LitBoolean(boolean(&obj.get("value")?)?),
            "ArrayLiteral" => Literal::LitArray(array_of(&obj.get("value")?, decode)?),
            "ObjectLiteral" => Literal::LitRecord(record(&obj.get("value")?, decode)?),
            _ => return None,
        };
        Some(Rc::new(node))
    }

    fn record(value: &Value, decode: &dyn Fn(&Value) -> Option<Value>) -> Option<Value> {
        let items = array_values(value)?;
        let mut props = Vec::with_capacity(items.len());
        for item in items {
            let pair = array_values(&item)?;
            if pair.len() != 2 { return None; }
            let key = string_literal(&pair[0])?;
            let value = decode(&pair[1])?;
            props.push(box_prop(Prop::Prop(key, value)));
        }
        Some(mk_array(props))
    }

    fn binder(module: &str, table: &Value, value: &Value) -> Option<Rc<Binder>> {
        let obj = object(value)?;
        let annotation = ann(module, table, obj)?;
        let kind = required_string(obj, "binderType")?;
        let node = match kind.as_str() {
            "NullBinder" => Binder::BinderNull(annotation),
            "VarBinder" => Binder::BinderVar(annotation, required_string(obj, "identifier")?),
            "LiteralBinder" => {
                let literal = literal(&obj.get("literal")?, &|inner| boxed_binder(module, table, inner))?;
                Binder::BinderLit(annotation, literal)
            }
            "ConstructorBinder" => {
                let type_name = qualified(&obj.get("typeName")?)?;
                let constructor = match obj.get("name") {
                    Some(name) => match qualified(&name) {
                        Some(constructor) => constructor,
                        None => qualified(&obj.get("constructorName")?)?,
                    },
                    None => qualified(&obj.get("constructorName")?)?,
                };
                let binders = array_of(&obj.get("binders")?, &|inner| boxed_binder(module, table, inner))?;
                Binder::BinderConstructor(annotation, type_name, constructor, binders)
            }
            "NamedBinder" => {
                let identifier = required_string(obj, "identifier")?;
                let binder = binder(module, table, &obj.get("binder")?)?;
                Binder::BinderNamed(annotation, identifier, binder)
            }
            _ => return None,
        };
        Some(Rc::new(node))
    }

    fn boxed_binder(module: &str, table: &Value, value: &Value) -> Option<Value> {
        Some(box_binder(binder(module, table, value)?))
    }

    fn expr(module: &str, table: &Value, value: &Value) -> Option<Rc<Expr>> {
        let obj = object(value)?;
        let annotation = ann(module, table, obj)?;
        let kind = required_string(obj, "type")?;
        let node = match kind.as_str() {
            "Var" => {
                let qualified = qualified(&obj.get("value")?)?;
                Expr::ExprVar(annotation, qualified)
            }
            "Literal" => {
                let literal = literal(&obj.get("value")?, &|inner| boxed_expr(module, table, inner))?;
                Expr::ExprLit(annotation, literal)
            }
            "Constructor" => {
                let type_name = required_string(obj, "typeName")?;
                let constructor = match obj.get("name") {
                    Some(name) => match string(&name) {
                        Some(constructor) => constructor,
                        None => required_string(obj, "constructorName")?,
                    },
                    None => required_string(obj, "constructorName")?,
                };
                let fields = match obj.get("fields") {
                    Some(fields) => match string_array(&fields) {
                        Some(fields) => mk_strings(fields),
                        None => mk_strings(string_array(&obj.get("fieldNames")?)?),
                    },
                    None => mk_strings(string_array(&obj.get("fieldNames")?)?),
                };
                Expr::ExprConstructor(annotation, type_name, constructor, fields)
            }
            "Accessor" => {
                let expression = expr(module, table, &obj.get("expression")?)?;
                let field = string_literal(&obj.get("fieldName")?)?;
                Expr::ExprAccessor(annotation, expression, field)
            }
            "ObjectUpdate" => {
                let expression = expr(module, table, &obj.get("expression")?)?;
                let updates = record(&obj.get("updates")?, &|inner| boxed_expr(module, table, inner))?;
                Expr::ExprUpdate(annotation, expression, updates)
            }
            "Abs" => {
                let argument = required_string(obj, "argument")?;
                let body = expr(module, table, &obj.get("body")?)?;
                Expr::ExprAbs(annotation, argument, body)
            }
            "App" => {
                let abstraction = expr(module, table, &obj.get("abstraction")?)?;
                let argument = expr(module, table, &obj.get("argument")?)?;
                Expr::ExprApp(annotation, abstraction, argument)
            }
            "TypeApp" => {
                let expression = expr(module, table, &obj.get("expression")?)?;
                let type_argument = int(&obj.get("typeArgument")?)?;
                let entry = table_entry(table, type_argument)?;
                // Type-table entries are shared owners, erased unsized by the
                // generator and nested by legacy Class boxes; the helper reads
                // both forms.
                let ty = entry.unwrap_class_shared::<ExprType>();
                Expr::ExprTypeApp(annotation, expression, ty)
            }
            "Case" => {
                let expressions = array_of(&obj.get("caseExpressions")?, &|inner| boxed_expr(module, table, inner))?;
                let alternatives = array_of(&obj.get("caseAlternatives")?, &|inner| boxed_alternative(module, table, inner))?;
                Expr::ExprCase(annotation, expressions, alternatives)
            }
            "Let" => {
                let binds = array_of(&obj.get("binds")?, &|inner| boxed_bind(module, table, inner))?;
                let body = expr(module, table, &obj.get("expression")?)?;
                Expr::ExprLet(annotation, binds, body)
            }
            _ => return None,
        };
        Some(Rc::new(node))
    }

    fn boxed_expr(module: &str, table: &Value, value: &Value) -> Option<Value> {
        Some(box_expr(expr(module, table, value)?))
    }

    fn alternative(module: &str, table: &Value, value: &Value) -> Option<Rc<CaseAlternative>> {
        let obj = object(value)?;
        let binders = array_of(&obj.get("binders")?, &|inner| boxed_binder(module, table, inner))?;
        let guarded = boolean(&obj.get("isGuarded")?)?;
        let result = if guarded {
            let expressions = array_of(&obj.get("expressions")?, &|inner| boxed_guard(module, table, inner))?;
            CaseGuard::Guarded(expressions)
        } else {
            CaseGuard::Unconditional(expr(module, table, &obj.get("expression")?)?)
        };
        Some(Rc::new(CaseAlternative::CaseAlternative(binders, Rc::new(result))))
    }

    fn boxed_alternative(module: &str, table: &Value, value: &Value) -> Option<Value> {
        Some(box_alternative(alternative(module, table, value)?))
    }

    fn guard(module: &str, table: &Value, value: &Value) -> Option<Rc<Guard>> {
        let obj = object(value)?;
        let condition = expr(module, table, &obj.get("guard")?)?;
        let result = expr(module, table, &obj.get("expression")?)?;
        Some(Rc::new(Guard::Guard(condition, result)))
    }

    fn boxed_guard(module: &str, table: &Value, value: &Value) -> Option<Value> {
        Some(box_guard(guard(module, table, value)?))
    }

    fn bind(module: &str, table: &Value, value: &Value) -> Option<Rc<Bind>> {
        let obj = object(value)?;
        let kind = required_string(obj, "bindType")?;
        let node = match kind.as_str() {
            "NonRec" => Bind::NonRec(binding(module, table, obj)?),
            "Rec" => {
                let items = array_values(&obj.get("binds")?)?;
                let mut binds = Vec::with_capacity(items.len());
                for item in items {
                    binds.push(box_binding(binding(module, table, object(&item)?)?));
                }
                Bind::Rec(mk_array(binds))
            }
            _ => return None,
        };
        Some(Rc::new(node))
    }

    fn boxed_bind(module: &str, table: &Value, value: &Value) -> Option<Value> {
        Some(box_bind(bind(module, table, value)?))
    }

    fn binding(module: &str, table: &Value, obj: &Rc<Object>) -> Option<Rc<Binding>> {
        let annotation = ann(module, table, obj)?;
        let identifier = required_string(obj, "identifier")?;
        let expression = expr(module, table, &obj.get("expression")?)?;
        Some(Rc::new(Binding::Binding(annotation, identifier, expression)))
    }

    fn import(module: &str, table: &Value, value: &Value) -> Option<Value> {
        let obj = object(value)?;
        let annotation = ann(module, table, obj)?;
        let name = module_name(&obj.get("moduleName")?)?;
        Some(box_import(Import::Import(annotation, name)))
    }

    // Cold structures (re-exports, comments, data and class declarations) have
    // their validated generated decoders reused: they occur a few times per
    // module, while the expression body stays native. A Left declines the whole
    // native module so the fallback owns the exact error.
    fn cold(value: Rc<Purs_Data_Either::Either>) -> Option<Value> {
        match value.as_ref() {
            Purs_Data_Either::Either::Right(payload) => Some(payload.clone()),
            Purs_Data_Either::Either::Left(_) => None,
        }
    }

    fn re_exports(value: &Value) -> Option<Value> {
        cold(PureScript_Backend_Optimizer_CoreFn_Json_decodeReExports(value.clone()))
    }

    fn comment(value: &Value) -> Option<Value> {
        cold(PureScript_Backend_Optimizer_CoreFn_Json_decodeComment(value.clone()))
    }

    fn data_decl(table: &Value, value: &Value) -> Option<Value> {
        cold(PureScript_Backend_Optimizer_CoreFn_Json_decodeDataDecl(table.clone(), value.clone()))
    }

    fn class_decl(table: &Value, value: &Value) -> Option<Value> {
        cold(PureScript_Backend_Optimizer_CoreFn_Json_decodeClassDecl(table.clone(), value.clone()))
    }

    fn source_span(path: &str, value: &Value) -> Option<Value> {
        // Cold coupling: two positions per module, and the Argonaut Tuple Int Int
        // instance has subtle acceptance rules. Keep its generated decoder and
        // decline so the fallback owns every span error.
        let decoded = PureScript_Backend_Optimizer_CoreFn_Json_decodeSourceSpan(path.to_owned(), value.clone());
        match decoded.as_ref() {
            Purs_Data_Either::Either::Right(span) => Some(span.clone()),
            Purs_Data_Either::Either::Left(_) => None,
        }
    }

    fn module_prime(name: &str, root: &Rc<Object>) -> Option<Value> {
        let table = match root.get("typeTable") {
            None => mk_array(Vec::new()),
            Some(value) if is_null(&value) => mk_array(Vec::new()),
            Some(value) => match decode_table(&value) {
                Some(decoded) => match decoded.as_ref() {
                    Purs_Data_Either::Either::Left(_) => return None,
                    Purs_Data_Either::Either::Right(rows) => rows.clone(),
                },
                None => return None,
            },
        };
        let path = required_string(root, "modulePath")?;
        let span = source_span(&path, &root.get("sourceSpan")?)?;
        let imports = array_of(&root.get("imports")?, &|value| import(name, &table, value))?;
        let exports = array_of(&root.get("exports")?, &|value| string(value).map(Value::String))?;
        let re_exports = re_exports(&root.get("reExports")?)?;
        let data_decls = optional_array(root, "dataDecls", &|value| data_decl(&table, value))?;
        let class_decls = optional_array(root, "classDecls", &|value| class_decl(&table, value))?;
        let decls = array_of(&root.get("decls")?, &|value| boxed_bind(name, &table, value))?;
        let foreign_idents = string_array(&root.get("foreign")?)?;
        let foreign_annotations = match root.get("foreignAnnotations") {
            None => None,
            Some(value) if is_null(&value) => None,
            Some(value) => Some(object(&value)?.clone()),
        };
        let mut foreign_list = Vec::with_capacity(foreign_idents.len());
        for ident in foreign_idents {
            let type_value = match foreign_annotations.as_ref().and_then(|annotations| annotations.get(&ident)) {
                Some(annotation) => purust_ann::decode_plain(&table, &annotation)?.get_type_kw(),
                None => maybe_nothing(),
            };
            foreign_list.push(Value::Class(Rc::new(Rc::new(Purs_Data_Tuple::Tuple::Tuple(
                Value::String(ident), type_value)))));
        }
        let foreign = Purs_Data_Map_Internal::Data_Map_Internal_fromFoldable(
            Purs_Data_Ord::Data_Ord_ordString(),
            Purs_Data_Foldable::Data_Foldable_foldableArray(),
            mk_array(foreign_list),
        );
        let comments = array_of(&root.get("comments")?, &|value| comment(value))?;
        Some(Value::Record_classDecls_comments_dataDecls_decls_exports_foreign_imports_name_path_reExports_span(
            perceus_ptr::PerceusPtr::new(
                purust_core::Record_classDecls_comments_dataDecls_decls_exports_foreign_imports_name_path_reExports_span {
                    name: Some(Value::String(name.to_owned())),
                    path: Some(Value::String(path)),
                    span: Some(span),
                    imports: Some(imports),
                    exports: Some(exports),
                    reExports: Some(re_exports),
                    dataDecls: Some(data_decls),
                    classDecls: Some(class_decls),
                    decls: Some(decls),
                    foreign: Some(Value::Class(Rc::new(foreign))),
                    comments: Some(comments),
                    ..Default::default()
                })))
    }

    pub(super) fn decode(input: &Value) -> Option<Value> {
        let root = object(input)?;
        let name = module_name(&root.get("moduleName")?)?;
        module_prime(&name, root)
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
        // Decoder callbacks may return either carrier: nested Class (legacy)
        // or the unsized shared owner emitted by the generator.
        let either = decoded.unwrap_class_shared::<Purs_Data_Either::Either>();
        match either.as_ref() {
            // Stop at the first Left and wrap it exactly like decodeArrayPS.
            // The fallback is never re-run here: the callback may be expensive
            // or effectful and every element is decoded at most once.
            Purs_Data_Either::Either::Left(error) => {
                let error = error.unwrap_class_shared::<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>();
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
    fallback: Func1<Value, Value>, validate: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>, input: Value,
) -> Value {
    if let Some(module) = purust_module::decode(&input) {
        // decodeModulePS validates after a complete module and before Right.
        // The native path calls the same validate function exactly once and
        // returns its Left unchanged, so success and failure stay identical.
        return match validate(module.clone()).as_ref() {
            Purs_Data_Either::Either::Left(error) => Value::Class(Rc::new(Rc::new(
                Purs_Data_Either::Either::Left(error.clone())))),
            Purs_Data_Either::Either::Right(_) => Value::Class(Rc::new(Rc::new(
                Purs_Data_Either::Either::Right(module)))),
        };
    }
    fallback(input)
}
