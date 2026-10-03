// Native source-usage validator: the PureScript traversal, lexical scopes,
// global binding ledger and exact first error are reproduced directly on the
// decoder's runtime representation. Unsupported or malformed internal shapes
// delegate to the PureScript implementation passed as `fallback`, and counts,
// proofs and other metadata are never read or recomputed.

use std::collections::HashSet;
use std::rc::Rc;
use Purs_Data_Argonaut_Decode_Error::JsonDecodeError;
use Purs_Data_Either::Either;
use Purs_Data_Maybe::Maybe;
use Purs_PureScript_Backend_Optimizer_CoreFn::{
    Bind, Binder, Binding, CaseAlternative, CaseGuard, Expr, Guard, Import, Literal, Prop,
    Qualified,
};

enum PurustUsageError {
    Malformed,
    Usage(&'static str),
}

// A SourceBindingId is the module-local identity inside its annotation. The
// ledger retains every identity registered anywhere in the module, exactly
// like the `Set SourceBindingId` threaded through `StateT`.
#[derive(Clone, PartialEq, Eq, Hash)]
struct PurustSourceBinding {
    module_name: String,
    binding_id: i64,
}

// Scopes are a mutable stack with explicit truncation on exit: a frame keeps
// its ident even when it carries no identity, so unannotated locals still hide
// outer annotated variables.
struct PurustUsageLocal {
    ident: String,
    binding: Option<PurustSourceBinding>,
}

struct PurustUsageChecker {
    module_name: String,
    seen: HashSet<PurustSourceBinding>,
    scopes: Vec<PurustUsageLocal>,
}

fn purust_usage_class<T: std::any::Any + 'static>(value: &Value) -> Option<&T> {
    match value.resolve() {
        Value::Class(payload) => payload.downcast_ref::<T>(),
        _ => None,
    }
}

fn purust_usage_node<T: std::any::Any + 'static>(value: &Value) -> Result<&T, PurustUsageError> {
    purust_usage_class::<T>(value).ok_or(PurustUsageError::Malformed)
}

// `Maybe` values are boxed as `Value::Class(Rc<Maybe>)` in every generated and
// decoded position.
fn purust_usage_maybe(value: &Value) -> Option<Option<&Value>> {
    let maybe = purust_usage_class::<Rc<Maybe>>(value)?;
    Some(match maybe.as_ref() {
        Maybe::Nothing => None,
        Maybe::Just(item) => Some(item),
    })
}

fn purust_usage_array(value: &Value) -> Result<Rc<Vec<Value>>, PurustUsageError> {
    match value.resolve() {
        Value::Array(items) => Ok(items.clone()),
        _ => Err(PurustUsageError::Malformed),
    }
}

// SourceBindingId is a newtype over a record and stays an erased record value.
fn purust_usage_binding_id(value: &Value) -> Result<PurustSourceBinding, PurustUsageError> {
    let Value::Record_bindingId_moduleName(record) = value.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let (Some(module_name), Some(binding_id)) =
        (record.moduleName.as_ref(), record.bindingId.as_ref())
    else {
        return Err(PurustUsageError::Malformed);
    };
    let Value::String(module_name) = module_name.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let Value::Int(binding_id) = binding_id.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    Ok(PurustSourceBinding { module_name: module_name.clone(), binding_id: *binding_id })
}

fn purust_usage_binding_usage_identity(value: &Value) -> Result<PurustSourceBinding, PurustUsageError> {
    let Value::Record_binding_hasEscapingUseContext_maxUses(record) = value.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let Some(binding) = record.binding.as_ref() else {
        return Err(PurustUsageError::Malformed);
    };
    purust_usage_binding_id(binding)
}

fn purust_usage_variable_use_identity(value: &Value) -> Result<PurustSourceBinding, PurustUsageError> {
    let Value::Record_binding_lastLocalUse(record) = value.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let Some(binding) = record.binding.as_ref() else {
        return Err(PurustUsageError::Malformed);
    };
    purust_usage_binding_id(binding)
}

// The facts the traversal reads: only the presence of bindingUsage and
// variableUse plus the referenced SourceBindingId matter. maxUses,
// hasEscapingUseContext and lastLocalUse are intentionally ignored.
struct PurustUsageFacts<'a> {
    binding_usage: Option<&'a Value>,
    variable_use: Option<&'a Value>,
}

fn purust_usage_facts(ann: &Value) -> Result<PurustUsageFacts<'_>, PurustUsageError> {
    let Value::Record_meta_sourceUsage_span_type_kw(record) = ann.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let Some(source_usage) = record.sourceUsage.as_ref() else {
        return Err(PurustUsageError::Malformed);
    };
    let usage = match purust_usage_maybe(source_usage) {
        None => return Err(PurustUsageError::Malformed),
        Some(None) => {
            return Ok(PurustUsageFacts { binding_usage: None, variable_use: None });
        }
        Some(Some(usage)) => usage,
    };
    let Value::Record_bindingUsage_variableUse(fields) = usage.resolve() else {
        return Err(PurustUsageError::Malformed);
    };
    let binding_usage = match fields.bindingUsage.as_ref() {
        None => return Err(PurustUsageError::Malformed),
        Some(value) => match purust_usage_maybe(value) {
            None => return Err(PurustUsageError::Malformed),
            Some(field) => field,
        },
    };
    let variable_use = match fields.variableUse.as_ref() {
        None => return Err(PurustUsageError::Malformed),
        Some(value) => match purust_usage_maybe(value) {
            None => return Err(PurustUsageError::Malformed),
            Some(field) => field,
        },
    };
    Ok(PurustUsageFacts { binding_usage, variable_use })
}

fn purust_usage_for_each_literal_value(
    literal: &Literal,
    mut visit: impl FnMut(&Value) -> Result<(), PurustUsageError>,
) -> Result<(), PurustUsageError> {
    match literal {
        Literal::LitArray(values) => {
            for value in purust_usage_array(values)?.iter() {
                visit(value)?;
            }
        }
        Literal::LitRecord(entries) => {
            for entry in purust_usage_array(entries)?.iter() {
                let prop = purust_usage_node::<Rc<Prop>>(entry)?;
                match prop.as_ref() {
                    Prop::Prop(_, value) => visit(value)?,
                }
            }
        }
        _ => {}
    }
    Ok(())
}

impl PurustUsageChecker {
    fn lookup(&self, ident: &str) -> Option<&Option<PurustSourceBinding>> {
        self.scopes.iter().rev().find(|local| local.ident == ident).map(|local| &local.binding)
    }

    fn plain(&mut self, ann: &Value) -> Result<(), PurustUsageError> {
        let facts = purust_usage_facts(ann)?;
        if facts.binding_usage.is_none() && facts.variable_use.is_none() {
            Ok(())
        } else {
            Err(PurustUsageError::Usage("source usage facts on a nonlocal annotation"))
        }
    }

    fn register(&mut self, ann: &Value, ident: &str) -> Result<(), PurustUsageError> {
        let facts = purust_usage_facts(ann)?;
        if facts.variable_use.is_some() {
            return Err(PurustUsageError::Usage("variableUse on a binding annotation"));
        }
        let binding = match facts.binding_usage {
            None => None,
            Some(value) => {
                let identity = purust_usage_binding_usage_identity(value)?;
                if identity.module_name != self.module_name {
                    return Err(PurustUsageError::Usage("source binding from another module"));
                }
                if self.seen.contains(&identity) {
                    return Err(PurustUsageError::Usage("duplicate source bindingId"));
                }
                self.seen.insert(identity.clone());
                Some(identity)
            }
        };
        self.scopes.push(PurustUsageLocal { ident: ident.to_owned(), binding });
        Ok(())
    }

    fn expression_value(&mut self, value: &Value) -> Result<(), PurustUsageError> {
        let node = purust_usage_node::<Rc<Expr>>(value)?;
        self.expression(node)
    }

    fn expression(&mut self, expr: &Expr) -> Result<(), PurustUsageError> {
        match expr {
            Expr::ExprVar(ann, qualified) => {
                let facts = purust_usage_facts(ann)?;
                if facts.binding_usage.is_some() {
                    return Err(PurustUsageError::Usage(
                        "bindingUsage on a variable occurrence",
                    ));
                }
                let Some(used) = facts.variable_use else { return Ok(()) };
                let used = purust_usage_variable_use_identity(used)?;
                // A qualified name is never a local, even when its module is
                // the current module.
                let target = match qualified.as_ref() {
                    Qualified::Qualified(module, ident) => match module.as_ref() {
                        Maybe::Just(_) => None,
                        Maybe::Nothing => {
                            let Value::String(ident) = ident.resolve() else {
                                return Err(PurustUsageError::Malformed);
                            };
                            self.lookup(ident).and_then(|binding| binding.as_ref())
                        }
                    },
                };
                if target != Some(&used) {
                    return Err(PurustUsageError::Usage(
                        "variableUse outside its lexical binding",
                    ));
                }
                Ok(())
            }
            Expr::ExprLit(ann, literal) => {
                self.plain(ann)?;
                purust_usage_for_each_literal_value(literal, |value| {
                    self.expression_value(value)
                })
            }
            Expr::ExprConstructor(ann, _, _, _) => self.plain(ann),
            Expr::ExprAccessor(ann, expression, _) => {
                self.plain(ann)?;
                self.expression(expression)
            }
            Expr::ExprUpdate(ann, expression, fields) => {
                self.plain(ann)?;
                self.expression(expression)?;
                for field in purust_usage_array(fields)?.iter() {
                    let prop = purust_usage_node::<Rc<Prop>>(field)?;
                    match prop.as_ref() {
                        Prop::Prop(_, value) => self.expression_value(value)?,
                    }
                }
                Ok(())
            }
            Expr::ExprAbs(ann, ident, body) => {
                let mark = self.scopes.len();
                self.register(ann, ident)?;
                self.expression(body)?;
                self.scopes.truncate(mark);
                Ok(())
            }
            Expr::ExprApp(ann, abstraction, argument) => {
                self.plain(ann)?;
                self.expression(abstraction)?;
                self.expression(argument)
            }
            Expr::ExprCase(ann, values, alternatives) => {
                self.plain(ann)?;
                for value in purust_usage_array(values)?.iter() {
                    self.expression_value(value)?;
                }
                // Every alternative starts from the same outer scope and can
                // never leak a binder into its siblings.
                for alternative in purust_usage_array(alternatives)?.iter() {
                    let mark = self.scopes.len();
                    self.alternative(alternative)?;
                    self.scopes.truncate(mark);
                }
                Ok(())
            }
            Expr::ExprLet(ann, group, body) => {
                self.plain(ann)?;
                let mark = self.scopes.len();
                self.bindings(group)?;
                self.expression(body)?;
                self.scopes.truncate(mark);
                Ok(())
            }
            Expr::ExprTypeApp(ann, expression, _) => {
                self.plain(ann)?;
                self.expression(expression)
            }
        }
    }

    fn bindings(&mut self, group: &Value) -> Result<(), PurustUsageError> {
        for item in purust_usage_array(group)?.iter() {
            let node = purust_usage_node::<Rc<Bind>>(item)?;
            match node.as_ref() {
                Bind::NonRec(binding) => {
                    let (ann, ident, expression) = match binding.as_ref() {
                        Binding::Binding(ann, ident, expression) => (ann, ident, expression),
                    };
                    // NonRec: the expression runs before the binding is
                    // registered, so it cannot refer to itself.
                    self.expression(expression)?;
                    self.register(ann, ident)?;
                }
                Bind::Rec(recursive) => {
                    let items = purust_usage_array(recursive)?;
                    // Rec: every annotation registers first, then every
                    // expression sees the complete group.
                    for binding in items.iter() {
                        let node = purust_usage_node::<Rc<Binding>>(binding)?;
                        let (ann, ident) = match node.as_ref() {
                            Binding::Binding(ann, ident, _) => (ann, ident),
                        };
                        self.register(ann, ident)?;
                    }
                    for binding in items.iter() {
                        let node = purust_usage_node::<Rc<Binding>>(binding)?;
                        let expression = match node.as_ref() {
                            Binding::Binding(_, _, expression) => expression,
                        };
                        self.expression(expression)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn alternative(&mut self, alternative: &Value) -> Result<(), PurustUsageError> {
        let node = purust_usage_node::<Rc<CaseAlternative>>(alternative)?;
        let (patterns, result) = match node.as_ref() {
            CaseAlternative::CaseAlternative(patterns, result) => (patterns, result),
        };
        for pattern in purust_usage_array(patterns)?.iter() {
            self.binder_value(pattern)?;
        }
        match result.as_ref() {
            CaseGuard::Unconditional(expression) => self.expression(expression),
            CaseGuard::Guarded(guards) => {
                for guard in purust_usage_array(guards)?.iter() {
                    let node = purust_usage_node::<Rc<Guard>>(guard)?;
                    let (condition, expression) = match node.as_ref() {
                        Guard::Guard(condition, expression) => (condition, expression),
                    };
                    self.expression(condition)?;
                    self.expression(expression)?;
                }
                Ok(())
            }
        }
    }

    fn binder_value(&mut self, value: &Value) -> Result<(), PurustUsageError> {
        let node = purust_usage_node::<Rc<Binder>>(value)?;
        self.binder(node)
    }

    fn binder(&mut self, binder: &Binder) -> Result<(), PurustUsageError> {
        match binder {
            Binder::BinderNull(ann) => self.plain(ann),
            Binder::BinderVar(ann, ident) => self.register(ann, ident),
            Binder::BinderNamed(ann, ident, inner) => {
                // The named binder and everything registered inside it stay
                // visible for the remaining patterns and the alternative body.
                self.register(ann, ident)?;
                self.binder(inner)
            }
            Binder::BinderConstructor(ann, _, _, patterns) => {
                self.plain(ann)?;
                for pattern in purust_usage_array(patterns)?.iter() {
                    self.binder_value(pattern)?;
                }
                Ok(())
            }
            Binder::BinderLit(ann, literal) => {
                self.plain(ann)?;
                purust_usage_for_each_literal_value(literal, |value| self.binder_value(value))
            }
        }
    }

    fn top(&mut self, bind: &Bind) -> Result<(), PurustUsageError> {
        match bind {
            Bind::NonRec(binding) => self.top_binding(binding),
            Bind::Rec(group) => {
                for binding in purust_usage_array(group)?.iter() {
                    let node = purust_usage_node::<Rc<Binding>>(binding)?;
                    self.top_binding(node)?;
                }
                Ok(())
            }
        }
    }

    fn top_binding(&mut self, binding: &Binding) -> Result<(), PurustUsageError> {
        let (ann, expression) = match binding {
            Binding::Binding(ann, _, expression) => (ann, expression),
        };
        self.plain(ann)?;
        // Top-level declarations never register their own names and every
        // expression starts from the empty module scope.
        let mark = self.scopes.len();
        self.expression(expression)?;
        self.scopes.truncate(mark);
        Ok(())
    }

    fn module(&mut self, module: &Value) -> Result<(), PurustUsageError> {
        let Value::Record_classDecls_comments_dataDecls_decls_exports_foreign_imports_name_path_reExports_span(record) =
            module.resolve()
        else {
            return Err(PurustUsageError::Malformed);
        };
        let (Some(name), Some(imports), Some(decls)) =
            (record.name.as_ref(), record.imports.as_ref(), record.decls.as_ref())
        else {
            return Err(PurustUsageError::Malformed);
        };
        let Value::String(name) = name.resolve() else {
            return Err(PurustUsageError::Malformed);
        };
        self.module_name = name.clone();
        // Imports cannot carry facts: only `plain` runs for each of them.
        for import in purust_usage_array(imports)?.iter() {
            let node = purust_usage_node::<Rc<Import>>(import)?;
            match node.as_ref() {
                Import::Import(ann, _) => self.plain(ann)?,
            }
        }
        for bind in purust_usage_array(decls)?.iter() {
            let node = purust_usage_node::<Rc<Bind>>(bind)?;
            self.top(node)?;
        }
        Ok(())
    }
}

pub fn PureScript_Backend_Optimizer_CoreFn_Usage_validateSourceUsageModuleImpl(
    fallback: Func1<Value, std::rc::Rc<Purs_Data_Either::Either>>,
    module: Value,
) -> std::rc::Rc<Purs_Data_Either::Either> {
    let mut checker = PurustUsageChecker {
        module_name: String::new(),
        seen: HashSet::new(),
        scopes: Vec::new(),
    };
    match checker.module(&module) {
        Ok(()) => Rc::new(Either::Right(mk_unit(()))),
        Err(PurustUsageError::Usage(message)) => {
            Rc::new(Either::Left(Value::Class(Rc::new(Rc::new(
                JsonDecodeError::TypeMismatch(message.to_owned()),
            )))))
        }
        Err(PurustUsageError::Malformed) => fallback(module),
    }
}
