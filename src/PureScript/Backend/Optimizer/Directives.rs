// A deliberately small subset of the CST directive grammar. In particular,
// tabs, newlines, Unicode identifiers, quoted labels, block comments, spine
// accessors and non-decimal numerals retain the original lexer and its errors.
// No regex is compiled and no result is cached.
fn purust_directive_ident(name: &str, upper: bool) -> bool {
    let bytes = name.as_bytes();
    let Some(first) = bytes.first() else { return false; };
    (if upper { first.is_ascii_uppercase() } else { first.is_ascii_lowercase() || *first == b'_' })
        && bytes[1..].iter().all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'\'')
}

fn purust_directive_box<T: std::any::Any + 'static>(value: T) -> Value {
    Value::Class(std::rc::Rc::new(std::rc::Rc::new(value)))
}

fn purust_directive_ascii(line: &str) -> Option<std::rc::Rc<Purs_Data_Either::Either>> {
    use Purs_Data_Either::Either;
    use Purs_Data_Maybe::Maybe;
    use Purs_Data_Tuple::Tuple;
    use Purs_PureScript_Backend_Optimizer_CoreFn::Qualified;
    use Purs_PureScript_Backend_Optimizer_Semantics::{EvalRef, InlineAccessor, InlineDirective};
    use std::rc::Rc;

    if !line.is_ascii() || line.bytes().any(|b| b < b' ' || b == 127) { return None; }
    let text = line.split_once("--").map(|(before, _)| before).unwrap_or(line).trim_matches(' ');
    if text.is_empty() {
        return Some(Rc::new(Either::Right(purust_directive_box(Maybe::Nothing))));
    }
    let (reference, instruction) = text.split_once(' ')?;
    let instruction = instruction.trim_matches(' ');
    let segments: Vec<&str> = reference.split('.').collect();
    let modules = segments.iter().take_while(|segment| purust_directive_ident(segment, true)).count();
    if modules == 0 || modules >= segments.len() || segments.len() > modules + 2 { return None; }
    let ident = segments[modules];
    if !purust_directive_ident(ident, false) { return None; }
    let accessor = if let Some(label) = segments.get(modules + 1) {
        // These two unqualified spellings have special CST token constructors.
        if !purust_directive_ident(label, false) || matches!(*label, "_" | "forall") { return None; }
        InlineAccessor::InlineProp((*label).to_owned())
    } else { InlineAccessor::InlineRef };
    let directive = match instruction {
        "always" => InlineDirective::InlineAlways,
        "never" => InlineDirective::InlineNever,
        "default" => InlineDirective::InlineDefault,
        _ => {
            let tail = instruction.strip_prefix("arity")?;
            let number = tail.trim_start_matches(' ').strip_prefix('=')?.trim_matches(' ');
            if number.is_empty() || number.starts_with('0') || !number.bytes().all(|b| b.is_ascii_digit()) { return None; }
            let arity = number.parse::<i32>().ok()?;
            if arity <= 0 { return None; }
            InlineDirective::InlineArity(arity as i64)
        }
    };
    let module = segments[..modules].join(".");
    let qualified = Rc::new(Qualified::Qualified(Rc::new(Maybe::Just(Value::String(module))), Value::String(ident.to_owned())));
    let pair = purust_directive_box(Tuple::Tuple(
        purust_directive_box(EvalRef::EvalExtern(qualified)),
        purust_directive_box(Tuple::Tuple(purust_directive_box(accessor), purust_directive_box(directive))),
    ));
    Some(Rc::new(Either::Right(purust_directive_box(Maybe::Just(pair)))))
}

pub fn PureScript_Backend_Optimizer_Directives_parseDirectiveLineImpl(
    reference: Func1<String, std::rc::Rc<Purs_Data_Either::Either>>,
    line: String,
) -> std::rc::Rc<Purs_Data_Either::Either> {
    purust_directive_ascii(&line).unwrap_or_else(|| reference(line))
}
