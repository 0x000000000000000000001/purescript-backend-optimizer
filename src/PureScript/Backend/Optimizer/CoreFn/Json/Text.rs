// Native CoreFn text decoder: parse a corefn.json document directly into the
// Module TAST on the runtime's validated offset tape, so the ordinary
// Argonaut Value tree is never materialized. The tables, annotations, module
// shell and expression body mirror Json.rs (purust_type_table, purust_ann,
// purust_module) exactly, with cursor input in place of runtime Values.
//
// Strictness contract: any unsupported shape -- an unknown tag, a wrong JSON
// type, a cycle or missing index in the type table, a key spelling that the
// generated decoders would reject -- returns None so the caller replays the
// validated PureScript decoder. Malformed input therefore keeps the exact
// parse error, error value and error precedence of parseModulePS. Cold
// structures (reExports, comments, data and class declarations, source spans)
// are materialized with PurustJsonCursor::materialize and handed to their
// existing validated generated decoders. Validation (usage) runs exactly once
// on the native module, as in Json.rs.

mod purust_text {
    use super::*;
    use std::rc::Rc;
    use purust_core::{mk_array, mk_bool, mk_int, Value};

    pub(super) type TC<'a> = Purs_Data_Argonaut_Core::PurustJsonCursor<'a>;

    fn as_object(input: TC) -> Option<TC> { (input.kind() == b'{').then_some(input) }
    fn as_null(input: TC) -> bool { input.kind() == b'n' }

    // fields(["key"]) is the dynamic form of the same lookup the generated
    // cursor decoders use; a duplicate key resolves to its last spelling, and
    // the ordinary parser's Object::insert_shared keeps the last value too.
    fn get_field<'a>(input: TC<'a>, key: &str) -> Option<TC<'a>> {
        let [value] = input.fields([key])?;
        value
    }

    fn as_text(input: TC) -> Option<String> {
        match input.scalar("String")? {
            Value::String(value) => Some(value),
            _ => None,
        }
    }

    fn as_number(input: TC) -> Option<f64> {
        match input.scalar("Number")? {
            Value::Number(value) => Some(value),
            _ => None,
        }
    }

    // Exactly Data.Int.fromNumber: finite, integral and within the Int range.
    // The +2147483648 -> bottom rule belongs to decodeInt and stays there.
    fn as_integer(input: TC) -> Option<i64> {
        let number = as_number(input)?;
        (number.is_finite() && number.fract() == 0.0
            && (-2147483648.0..=2147483647.0).contains(&number)).then_some(number as i64)
    }

    fn as_index(input: TC) -> Option<usize> { usize::try_from(as_integer(input)?).ok() }

    fn as_bool(input: TC) -> Option<bool> {
        match input.scalar("Boolean")? {
            Value::Bool(value) => Some(value),
            _ => None,
        }
    }

    fn field_text(input: TC, key: &str) -> Option<String> { as_text(get_field(input, key)?) }

    fn text_array(input: TC) -> Option<Vec<String>> { input.array()?.map(as_text).collect() }

    fn mk_strings(values: Vec<String>) -> Value {
        mk_array(values.into_iter().map(Value::String).collect())
    }

    fn strings_value(input: TC) -> Option<Value> { Some(mk_strings(text_array(input)?)) }

    fn index_array(input: TC) -> Option<Vec<usize>> { input.array()?.map(as_index).collect() }

    fn array_of<'a>(input: TC<'a>, decode: &dyn Fn(TC<'a>) -> Option<Value>) -> Option<Value> {
        let items = input.array()?;
        let mut decoded = Vec::with_capacity(items.len());
        for item in items {
            decoded.push(decode(item)?);
        }
        Some(mk_array(decoded))
    }

    fn optional_array<'a>(
        value: Option<TC<'a>>,
        decode: &dyn Fn(TC<'a>) -> Option<Value>,
    ) -> Option<Value> {
        match value {
            None => Some(mk_array(Vec::new())),
            Some(value) if as_null(value) => Some(mk_array(Vec::new())),
            Some(value) => array_of(value, decode),
        }
    }

    fn module_name(input: TC) -> Option<String> { Some(text_array(input)?.join(".")) }

    mod purust_text_table {
        use super::*;
        use Purs_PureScript_Backend_Optimizer_CoreFn::ExprType as Ty;

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

        fn scalar(tag: &str) -> Option<Ty> {
            Some(match tag {
                "Int" => Ty::Int, "Number" => Ty::Number, "String" => Ty::String,
                "Char" => Ty::Char, "Boolean" => Ty::Boolean, "Unit" => Ty::Unit,
                "Any" => Ty::Any, _ => return None,
            })
        }

        fn decode_ref(input: TC) -> Option<Ref> {
            if input.kind() == b'"' {
                return scalar(&as_text(input)?).map(|ty| Ref::Ready(Rc::new(ty)));
            }
            if input.kind() != b'{' { return None; }
            let tag = match get_field(input, "type") {
                Some(value) => match as_text(value) {
                    Some(tag) => tag,
                    None => return Some(Ref::Ready(Rc::new(Ty::TypeVar(field_text(input, "TypeVar")?)))),
                },
                None => return Some(Ref::Ready(Rc::new(Ty::TypeVar(field_text(input, "TypeVar")?)))),
            };
            if let Some(ty) = scalar(&tag) { return Some(Ref::Ready(Rc::new(ty))); }
            Some(match tag.as_str() {
                "Adt" => {
                    let names = text_array(get_field(input, "fqn")?)?;
                    let name = names.join(".");
                    let fqn = mk_strings(names);
                    Ref::Adt(name, fqn, index_array(get_field(input, "args")?)?)
                }
                "TypeApp" => Ref::App(
                    as_index(get_field(input, "constructor")?)?,
                    index_array(get_field(input, "args")?)?,
                ),
                "Func" => Ref::Func(
                    index_array(get_field(input, "args")?)?,
                    as_index(get_field(input, "ret")?)?,
                ),
                "Array" => Ref::Array(as_index(get_field(input, "element")?)?),
                "Record" => Ref::Record(as_index(get_field(input, "row")?)?),
                "TypeVar" => Ref::Ready(Rc::new(Ty::TypeVar(field_text(input, "name")?))),
                "TypeLevelString" => {
                    Ref::Ready(Rc::new(Ty::TypeLevelString(field_text(input, "value")?)))
                }
                "Row" => {
                    let mut fields = Vec::new();
                    for item in get_field(input, "fields")?.array()? {
                        fields.push((field_text(item, "label")?, as_index(get_field(item, "type")?)?));
                    }
                    let tail = match get_field(input, "tail") {
                        None => None,
                        Some(value) if as_null(value) => None,
                        Some(value) => Some(as_index(value)?),
                    };
                    Ref::Row(fields, tail)
                }
                "ForAll" => Ref::ForAll(
                    strings_value(get_field(input, "vars")?)?,
                    as_index(get_field(input, "body")?)?,
                ),
                "ConstrainedType" => {
                    let mut constraints = Vec::new();
                    for item in get_field(input, "constraints")?.array()? {
                        constraints.push((
                            strings_value(get_field(item, "fqn")?)?,
                            index_array(get_field(item, "args")?)?,
                        ));
                    }
                    Ref::Constrained(constraints, as_index(get_field(input, "body")?)?)
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

        // Resolve ordinary, well-formed acyclic tables in ascending settlement
        // order; cycles and missing references decline to the validated
        // PureScript implementation. Returns the boxed table rows.
        pub(super) fn decode(input: TC) -> Option<Value> {
            let refs = input.array()?.map(decode_ref).collect::<Option<Vec<_>>>()?;
            let mut rows = vec![None; refs.len()];
            let mut pending: Vec<usize> = (0..refs.len()).collect();
            while !pending.is_empty() {
                let before = pending.len();
                pending.retain(|i| match resolve(&refs[*i], &rows) {
                    Some(ty) => { rows[*i] = Some(ty); false }
                    None => true,
                });
                if pending.len() == before { return None; }
            }
            Some(mk_array(rows.into_iter().map(|ty| boxed(ty.unwrap())).collect()))
        }
    }

    mod purust_text_ann {
        use super::*;
        use Purs_Data_Maybe::Maybe;
        use Purs_PureScript_Backend_Optimizer_CoreFn::{ConstructorType, Meta};

        fn maybe(value: Option<Value>) -> Value {
            let payload = match value {
                Some(value) => Maybe::Just(value),
                None => Maybe::Nothing,
            };
            Value::Class(Rc::new(Rc::new(payload)))
        }

        fn meta(meta: Meta) -> Value { Value::Class(Rc::new(Rc::new(meta))) }

        fn constructor_type(input: TC) -> Option<ConstructorType> {
            match as_text(input)?.as_str() {
                "ProductType" => Some(ConstructorType::ProductType),
                "SumType" => Some(ConstructorType::SumType),
                _ => None,
            }
        }

        // decodeArray decodeIdent: one decodeString per element, in order.
        fn identifiers(input: TC) -> Option<Value> {
            if input.kind() != b'[' { return None; }
            Some(mk_array(text_array(input)?.into_iter().map(Value::String).collect()))
        }

        fn decode_meta(input: TC) -> Option<Value> {
            let tag = get_field(input, "metaType")?;
            if tag.string_eq("IsConstructor")? {
                let constructor = constructor_type(get_field(input, "constructorType")?)?;
                let identifiers = identifiers(get_field(input, "identifiers")?)?;
                Some(meta(Meta::IsConstructor(constructor, identifiers)))
            } else if tag.string_eq("IsNewtype")? {
                Some(meta(Meta::IsNewtype))
            } else if tag.string_eq("IsTypeClassConstructor")? {
                Some(meta(Meta::IsTypeClassConstructor))
            } else if tag.string_eq("IsForeign")? {
                Some(meta(Meta::IsForeign))
            } else if tag.string_eq("IsWhere")? {
                Some(meta(Meta::IsWhere))
            } else if tag.string_eq("IsSyntheticApp")? {
                Some(meta(Meta::IsSyntheticApp))
            } else {
                None
            }
        }

        // decodeInt + Array.index for Ann.type: +2147483648 is the Int bottom
        // and therefore indexes Nothing, negatives and out-of-range indexes are
        // Nothing too, and every other number that decodeInt rejects declines.
        fn decode_type(table: &Value, input: TC) -> Option<Value> {
            let number = as_number(input)?;
            let index = if let Some(int) = as_integer(input) {
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
        fn decode_binding_id(module: &str, input: TC) -> Option<Value> {
            let binding_id = as_integer(input)?;
            if binding_id < 0 { return None; }
            Some(Value::Record_bindingId_moduleName(perceus_ptr::PerceusPtr::new(
                purust_core::Record_bindingId_moduleName {
                    moduleName: Some(Value::String(module.to_owned())),
                    bindingId: Some(mk_int(binding_id)),
                })))
        }

        // decodeUsageBound: a finite nonnegative integer is Just when it fits in
        // Int, Nothing when it is only known to be larger, and an error otherwise.
        fn decode_max_uses(value: Option<TC>) -> Option<Value> {
            match value {
                None => Some(maybe(None)),
                Some(value) if as_null(value) => Some(maybe(None)),
                Some(value) => {
                    let number = as_number(value)?;
                    if !(number.is_finite() && number >= 0.0 && number.fract() == 0.0) {
                        return None;
                    }
                    Some(maybe(as_integer(value).map(mk_int)))
                }
            }
        }

        fn decode_escaping_use_context(value: Option<TC>) -> Option<Value> {
            match value {
                None => Some(maybe(None)),
                Some(value) if as_null(value) => Some(maybe(None)),
                Some(value) => as_bool(value).map(|flag| maybe(Some(mk_bool(flag)))),
            }
        }

        // decodeLastLocalUse: null is Nothing, true is Just true, false is an error.
        fn decode_last_local_use(value: Option<TC>) -> Option<Value> {
            match value {
                None => Some(maybe(None)),
                Some(value) if as_null(value) => Some(maybe(None)),
                Some(value) => match as_bool(value) {
                    Some(true) => Some(maybe(Some(mk_bool(true)))),
                    _ => None,
                },
            }
        }

        fn decode_binding_usage(module: &str, input: TC) -> Option<Value> {
            let binding = decode_binding_id(module, get_field(input, "bindingId")?)?;
            let max_uses = decode_max_uses(get_field(input, "maxUses"))?;
            let escaping = decode_escaping_use_context(get_field(input, "hasEscapingUseContext"))?;
            Some(Value::Record_binding_hasEscapingUseContext_maxUses(perceus_ptr::PerceusPtr::new(
                purust_core::Record_binding_hasEscapingUseContext_maxUses {
                    binding: Some(binding),
                    maxUses: Some(max_uses),
                    hasEscapingUseContext: Some(escaping),
                })))
        }

        fn decode_variable_use(module: &str, input: TC) -> Option<Value> {
            let binding = decode_binding_id(module, get_field(input, "bindingId")?)?;
            let last_local_use = decode_last_local_use(get_field(input, "lastLocalUse"))?;
            Some(Value::Record_binding_lastLocalUse(perceus_ptr::PerceusPtr::new(
                purust_core::Record_binding_lastLocalUse {
                    binding: Some(binding),
                    lastLocalUse: Some(last_local_use),
                })))
        }

        // getFieldOptional': an absent or null field is Maybe Nothing and is
        // never decoded; anything else must decode or the whole fast path declines.
        fn optional<'a>(value: Option<TC<'a>>, decode: impl Fn(TC<'a>) -> Option<Value>) -> Option<Option<Value>> {
            match value {
                None => Some(None),
                Some(value) if as_null(value) => Some(None),
                Some(value) => decode(value).map(Some),
            }
        }

        fn decode_inner(with_usage: bool, module: &str, table: &Value, input: TC) -> Option<Value> {
            if input.kind() != b'{' { return None; }
            let meta = optional(get_field(input, "meta"), decode_meta)?;
            let type_value = match get_field(input, "type") {
                None => maybe(None),
                Some(value) if as_null(value) => maybe(None),
                Some(value) => decode_type(table, value)?,
            };
            let source_usage = if with_usage {
                let binding_usage = optional(get_field(input, "bindingUsage"), |value| decode_binding_usage(module, value))?;
                let variable_use = optional(get_field(input, "variableUse"), |value| decode_variable_use(module, value))?;
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

        pub(super) fn decode(module: &str, table: &Value, input: TC) -> Option<Value> {
            decode_inner(true, module, table, input)
        }

        // decodeAnn: same meta/type/span as decodeAnnWithUsage, but the
        // bindingUsage and variableUse fields are never read. Foreign
        // annotations use this path and the validated decoder ignores the same
        // fields for them.
        pub(super) fn decode_plain(table: &Value, input: TC) -> Option<Value> {
            decode_inner(false, "", table, input)
        }
    }

    mod purust_text_module {
        use super::*;
        use Purs_Data_Maybe::Maybe;
        use Purs_PureScript_Backend_Optimizer_CoreFn::{
            Bind, Binder, Binding, CaseAlternative, CaseGuard, Expr, ExprType,
            Guard, Import, Literal, Prop, Qualified,
        };

        fn maybe_nothing() -> Value { Value::Class(Rc::new(Rc::new(Maybe::Nothing))) }

        fn box_expr(node: Rc<Expr>) -> Value { Value::Class(Rc::new(node)) }
        fn box_binder(node: Rc<Binder>) -> Value { Value::Class(Rc::new(node)) }
        fn box_bind(node: Rc<Bind>) -> Value { Value::Class(Rc::new(node)) }
        fn box_binding(node: Rc<Binding>) -> Value { Value::Class(Rc::new(node)) }
        fn box_alternative(node: Rc<CaseAlternative>) -> Value { Value::Class(Rc::new(node)) }
        fn box_guard(node: Rc<Guard>) -> Value { Value::Class(Rc::new(node)) }
        fn box_prop(node: Prop) -> Value { Value::Class(Rc::new(Rc::new(node))) }
        fn box_import(node: Import) -> Value { Value::Class(Rc::new(Rc::new(node))) }

        fn table_entry(table: &Value, id: i64) -> Option<Value> {
            if id < 0 { return None; }
            let index = id as usize;
            if index >= table.array_len() { return None; }
            Some(table.array_get(index))
        }

        fn ann(module: &str, table: &Value, input: TC) -> Option<Value> {
            super::purust_text_ann::decode(module, table, get_field(input, "annotation")?)
        }

        fn qualified(input: TC) -> Option<Rc<Qualified>> {
            if input.kind() != b'{' { return None; }
            let module_name = match get_field(input, "moduleName") {
                None => None,
                Some(value) if as_null(value) => None,
                Some(value) => Some(module_name(value)?),
            };
            let identifier = as_text(get_field(input, "identifier")?)?;
            let module_name = match module_name {
                Some(name) => Maybe::Just(Value::String(name)),
                None => Maybe::Nothing,
            };
            Some(Rc::new(Qualified::Qualified(Rc::new(module_name), Value::String(identifier))))
        }

        fn literal<'a>(input: TC<'a>, decode: &dyn Fn(TC<'a>) -> Option<Value>) -> Option<Rc<Literal>> {
            let obj = as_object(input)?;
            let tag = get_field(obj, "literalType")?;
            let node = if tag.string_eq("IntLiteral")? {
                Literal::LitInt(as_integer(get_field(obj, "value")?)?)
            } else if tag.string_eq("NumberLiteral")? {
                Literal::LitNumber(as_number(get_field(obj, "value")?)?)
            } else if tag.string_eq("StringLiteral")? {
                Literal::LitString(as_text(get_field(obj, "value")?)?)
            } else if tag.string_eq("CharLiteral")? {
                let text = as_text(get_field(obj, "value")?)?;
                let mut units = text.chars();
                let character = units.next()?;
                if units.next().is_some() { return None; }
                Literal::LitChar(character)
            } else if tag.string_eq("BooleanLiteral")? {
                Literal::LitBoolean(as_bool(get_field(obj, "value")?)?)
            } else if tag.string_eq("ArrayLiteral")? {
                Literal::LitArray(array_of(get_field(obj, "value")?, decode)?)
            } else if tag.string_eq("ObjectLiteral")? {
                Literal::LitRecord(record(get_field(obj, "value")?, decode)?)
            } else {
                return None;
            };
            Some(Rc::new(node))
        }

        fn record<'a>(input: TC<'a>, decode: &dyn Fn(TC<'a>) -> Option<Value>) -> Option<Value> {
            let items = input.array()?;
            let mut props = Vec::with_capacity(items.len());
            for item in items {
                let mut pair = item.array()?;
                let key = as_text(pair.next()?)?;
                let value = decode(pair.next()?)?;
                if pair.next().is_some() { return None; }
                props.push(box_prop(Prop::Prop(key, value)));
            }
            Some(mk_array(props))
        }

        fn binder<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Rc<Binder>> {
            let obj = as_object(input)?;
            let annotation = ann(module, table, obj)?;
            let tag = get_field(obj, "binderType")?;
            let node = if tag.string_eq("NullBinder")? {
                Binder::BinderNull(annotation)
            } else if tag.string_eq("VarBinder")? {
                Binder::BinderVar(annotation, field_text(obj, "identifier")?)
            } else if tag.string_eq("LiteralBinder")? {
                let literal = literal(get_field(obj, "literal")?, &|inner| boxed_binder(module, table, inner))?;
                Binder::BinderLit(annotation, literal)
            } else if tag.string_eq("ConstructorBinder")? {
                let type_name = qualified(get_field(obj, "typeName")?)?;
                let constructor = match get_field(obj, "name") {
                    Some(name) => match qualified(name) {
                        Some(constructor) => constructor,
                        None => qualified(get_field(obj, "constructorName")?)?,
                    },
                    None => qualified(get_field(obj, "constructorName")?)?,
                };
                let binders = array_of(get_field(obj, "binders")?, &|inner| boxed_binder(module, table, inner))?;
                Binder::BinderConstructor(annotation, type_name, constructor, binders)
            } else if tag.string_eq("NamedBinder")? {
                let identifier = field_text(obj, "identifier")?;
                let binder = binder(module, table, get_field(obj, "binder")?)?;
                Binder::BinderNamed(annotation, identifier, binder)
            } else {
                return None;
            };
            Some(Rc::new(node))
        }

        fn boxed_binder(module: &str, table: &Value, input: TC) -> Option<Value> {
            Some(box_binder(binder(module, table, input)?))
        }

        fn expr<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Rc<Expr>> {
            let obj = as_object(input)?;
            let annotation = ann(module, table, obj)?;
            let tag = get_field(obj, "type")?;
            let node = if tag.string_eq("Var")? {
                Expr::ExprVar(annotation, qualified(get_field(obj, "value")?)?)
            } else if tag.string_eq("Literal")? {
                let literal = literal(get_field(obj, "value")?, &|inner| boxed_expr(module, table, inner))?;
                Expr::ExprLit(annotation, literal)
            } else if tag.string_eq("Constructor")? {
                let type_name = field_text(obj, "typeName")?;
                let constructor = match get_field(obj, "name") {
                    Some(name) => match as_text(name) {
                        Some(constructor) => constructor,
                        None => field_text(obj, "constructorName")?,
                    },
                    None => field_text(obj, "constructorName")?,
                };
                let fields = match get_field(obj, "fields") {
                    Some(fields) => match text_array(fields) {
                        Some(fields) => mk_strings(fields),
                        None => mk_strings(text_array(get_field(obj, "fieldNames")?)?),
                    },
                    None => mk_strings(text_array(get_field(obj, "fieldNames")?)?),
                };
                Expr::ExprConstructor(annotation, type_name, constructor, fields)
            } else if tag.string_eq("Accessor")? {
                let expression = expr(module, table, get_field(obj, "expression")?)?;
                let field = as_text(get_field(obj, "fieldName")?)?;
                Expr::ExprAccessor(annotation, expression, field)
            } else if tag.string_eq("ObjectUpdate")? {
                let expression = expr(module, table, get_field(obj, "expression")?)?;
                let updates = record(get_field(obj, "updates")?, &|inner| boxed_expr(module, table, inner))?;
                Expr::ExprUpdate(annotation, expression, updates)
            } else if tag.string_eq("Abs")? {
                let argument = field_text(obj, "argument")?;
                let body = expr(module, table, get_field(obj, "body")?)?;
                Expr::ExprAbs(annotation, argument, body)
            } else if tag.string_eq("App")? {
                let abstraction = expr(module, table, get_field(obj, "abstraction")?)?;
                let argument = expr(module, table, get_field(obj, "argument")?)?;
                Expr::ExprApp(annotation, abstraction, argument)
            } else if tag.string_eq("TypeApp")? {
                let expression = expr(module, table, get_field(obj, "expression")?)?;
                let type_argument = as_integer(get_field(obj, "typeArgument")?)?;
                let entry = table_entry(table, type_argument)?;
                // Type-table entries are shared owners, erased unsized by the
                // generator and nested by legacy Class boxes; the helper reads
                // both forms.
                let ty = entry.unwrap_class_shared::<ExprType>();
                Expr::ExprTypeApp(annotation, expression, ty)
            } else if tag.string_eq("Case")? {
                let expressions = array_of(get_field(obj, "caseExpressions")?, &|inner| boxed_expr(module, table, inner))?;
                let alternatives = array_of(get_field(obj, "caseAlternatives")?, &|inner| boxed_alternative(module, table, inner))?;
                Expr::ExprCase(annotation, expressions, alternatives)
            } else if tag.string_eq("Let")? {
                let binds = array_of(get_field(obj, "binds")?, &|inner| boxed_bind(module, table, inner))?;
                let body = expr(module, table, get_field(obj, "expression")?)?;
                Expr::ExprLet(annotation, binds, body)
            } else {
                return None;
            };
            Some(Rc::new(node))
        }

        fn boxed_expr(module: &str, table: &Value, input: TC) -> Option<Value> {
            Some(box_expr(expr(module, table, input)?))
        }

        fn alternative<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Rc<CaseAlternative>> {
            let obj = as_object(input)?;
            let binders = array_of(get_field(obj, "binders")?, &|inner| boxed_binder(module, table, inner))?;
            let guarded = as_bool(get_field(obj, "isGuarded")?)?;
            let result = if guarded {
                let expressions = array_of(get_field(obj, "expressions")?, &|inner| boxed_guard(module, table, inner))?;
                CaseGuard::Guarded(expressions)
            } else {
                CaseGuard::Unconditional(expr(module, table, get_field(obj, "expression")?)?)
            };
            Some(Rc::new(CaseAlternative::CaseAlternative(binders, Rc::new(result))))
        }

        fn boxed_alternative(module: &str, table: &Value, input: TC) -> Option<Value> {
            Some(box_alternative(alternative(module, table, input)?))
        }

        fn guard<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Rc<Guard>> {
            let obj = as_object(input)?;
            let condition = expr(module, table, get_field(obj, "guard")?)?;
            let result = expr(module, table, get_field(obj, "expression")?)?;
            Some(Rc::new(Guard::Guard(condition, result)))
        }

        fn boxed_guard(module: &str, table: &Value, input: TC) -> Option<Value> {
            Some(box_guard(guard(module, table, input)?))
        }

        fn bind<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Rc<Bind>> {
            let obj = as_object(input)?;
            let tag = get_field(obj, "bindType")?;
            let node = if tag.string_eq("NonRec")? {
                Bind::NonRec(binding(module, table, obj)?)
            } else if tag.string_eq("Rec")? {
                let items = get_field(obj, "binds")?.array()?;
                let mut binds = Vec::with_capacity(items.len());
                for item in items {
                    binds.push(box_binding(binding(module, table, as_object(item)?)?));
                }
                Bind::Rec(mk_array(binds))
            } else {
                return None;
            };
            Some(Rc::new(node))
        }

        fn boxed_bind(module: &str, table: &Value, input: TC) -> Option<Value> {
            Some(box_bind(bind(module, table, input)?))
        }

        fn binding<'a>(module: &str, table: &Value, obj: TC<'a>) -> Option<Rc<Binding>> {
            let annotation = ann(module, table, obj)?;
            let identifier = field_text(obj, "identifier")?;
            let expression = expr(module, table, get_field(obj, "expression")?)?;
            Some(Rc::new(Binding::Binding(annotation, identifier, expression)))
        }

        fn import<'a>(module: &str, table: &Value, input: TC<'a>) -> Option<Value> {
            let obj = as_object(input)?;
            let annotation = ann(module, table, obj)?;
            let name = module_name(get_field(obj, "moduleName")?)?;
            Some(box_import(Import::Import(annotation, name)))
        }

        // Cold structures (re-exports, comments, data and class declarations)
        // keep their validated generated decoders. Materializing only these
        // subtrees cannot change the success value: materialize rebuilds the
        // same boxed representation the ordinary parser would have built.
        fn cold(value: Rc<Purs_Data_Either::Either>) -> Option<Value> {
            match value.as_ref() {
                Purs_Data_Either::Either::Right(payload) => Some(payload.clone()),
                Purs_Data_Either::Either::Left(_) => None,
            }
        }

        fn re_exports(input: TC) -> Option<Value> {
            let json = input.materialize()?;
            cold(Purs_PureScript_Backend_Optimizer_CoreFn_Json::PureScript_Backend_Optimizer_CoreFn_Json_decodeReExports(json))
        }

        fn comment(input: TC) -> Option<Value> {
            let json = input.materialize()?;
            cold(Purs_PureScript_Backend_Optimizer_CoreFn_Json::PureScript_Backend_Optimizer_CoreFn_Json_decodeComment(json))
        }

        fn data_decl(table: &Value, input: TC) -> Option<Value> {
            let json = input.materialize()?;
            cold(Purs_PureScript_Backend_Optimizer_CoreFn_Json::PureScript_Backend_Optimizer_CoreFn_Json_decodeDataDecl(table.clone(), json))
        }

        fn class_decl(table: &Value, input: TC) -> Option<Value> {
            let json = input.materialize()?;
            cold(Purs_PureScript_Backend_Optimizer_CoreFn_Json::PureScript_Backend_Optimizer_CoreFn_Json_decodeClassDecl(table.clone(), json))
        }

        // Cold coupling: two positions per module, and the Argonaut Tuple Int
        // Int instance has subtle acceptance rules. Keep its generated decoder
        // and decline so the fallback owns every span error.
        fn source_span(path: &str, input: TC) -> Option<Value> {
            let json = input.materialize()?;
            let decoded = Purs_PureScript_Backend_Optimizer_CoreFn_Json::PureScript_Backend_Optimizer_CoreFn_Json_decodeSourceSpan(path.to_owned(), json);
            match decoded.as_ref() {
                Purs_Data_Either::Either::Right(span) => Some(span.clone()),
                Purs_Data_Either::Either::Left(_) => None,
            }
        }

        fn module_prime(name: &str, root: TC) -> Option<Value> {
            let table = match get_field(root, "typeTable") {
                None => mk_array(Vec::new()),
                Some(value) if as_null(value) => mk_array(Vec::new()),
                Some(value) => super::purust_text_table::decode(value)?,
            };
            let path = field_text(root, "modulePath")?;
            let span = source_span(&path, get_field(root, "sourceSpan")?)?;
            let imports = array_of(get_field(root, "imports")?, &|value| import(name, &table, value))?;
            let exports = array_of(get_field(root, "exports")?, &|value| as_text(value).map(Value::String))?;
            let re_exports = re_exports(get_field(root, "reExports")?)?;
            let data_decls = optional_array(get_field(root, "dataDecls"), &|value| data_decl(&table, value))?;
            let class_decls = optional_array(get_field(root, "classDecls"), &|value| class_decl(&table, value))?;
            let decls = array_of(get_field(root, "decls")?, &|value| boxed_bind(name, &table, value))?;
            let foreign_idents = text_array(get_field(root, "foreign")?)?;
            let foreign_annotations = match get_field(root, "foreignAnnotations") {
                None => None,
                Some(value) if as_null(value) => None,
                // decodeModule' reads the field with decodeJObject before any
                // per-ident lookup, so a non-object shape is an error even when
                // the foreign list is empty. Decline to the validated decoder.
                Some(value) => Some(as_object(value)?),
            };
            let mut foreign_list = Vec::with_capacity(foreign_idents.len());
            for ident in foreign_idents {
                let type_value = match foreign_annotations.and_then(|annotations| get_field(annotations, &ident)) {
                    Some(annotation) => super::purust_text_ann::decode_plain(&table, annotation)?.get_type_kw(),
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
            let comments = array_of(get_field(root, "comments")?, &|value| comment(value))?;
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

        pub(super) fn decode(root: TC) -> Option<Value> {
            let root = as_object(root)?;
            let name = module_name(get_field(root, "moduleName")?)?;
            module_prime(&name, root)
        }
    }

    // Success path only: any native decline returns None and the caller calls
    // the PureScript fallback, so syntax errors, decode errors and validation
    // errors keep the exact parseModulePS value and precedence. Validation
    // still runs exactly once on the native module and its Left is reused.
    pub(super) fn parse(
        text: &str,
        validate: &Func1<Value, Rc<Purs_Data_Either::Either>>,
        print_error: &Func1<Rc<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>, String>,
    ) -> Option<Rc<Purs_Data_Either::Either>> {
        let document = Purs_Data_Argonaut_Core::PurustJsonDocument::parse(text)?;
        let module = purust_text_module::decode(document.root())?;
        match validate(module.clone()).as_ref() {
            Purs_Data_Either::Either::Left(error) => {
                let error = error.unwrap_class_shared::<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>();
                Some(Rc::new(Purs_Data_Either::Either::Left(Value::String(print_error(error)))))
            }
            Purs_Data_Either::Either::Right(_) => {
                Some(Rc::new(Purs_Data_Either::Either::Right(module)))
            }
        }
    }
}

pub fn PureScript_Backend_Optimizer_CoreFn_Json_Text_parseModuleTextImpl(
    fallback: Func1<String, std::rc::Rc<Purs_Data_Either::Either>>,
    validate: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>,
    print_error: Func1<std::rc::Rc<Purs_Data_Argonaut_Decode_Error::JsonDecodeError>, String>,
    text: String,
) -> std::rc::Rc<Purs_Data_Either::Either> {
    if let Some(result) = purust_text::parse(&text, &validate, &print_error) {
        return result;
    }
    fallback(text)
}
