use serde::{Deserialize, Serialize};

use super::expr::{Expr, Literal};
use super::ident::{Ident, ProperName, Qualified};

// E.g., { "binders": [{ "binderType": "VarBinder", "annotation": null, "identifier": "x" }], "expressions": { "type": "Literal", "literalType": "IntLiteral", "value": 42 } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseAlternative<A> {
    pub binders: Vec<Binder<A>>,
    #[serde(alias = "expression", alias = "expressions")]
    pub expressions: CaseGuard<A>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CaseGuard<A> {
    /// `Unconditional(body)` represents a standard branch `-> body`
    Unconditional(Expr<A>),
    /// `Guarded(vec![Guard { condition: c1, expression: e1 }])` represents `| c1 -> e1`
    Guarded(Vec<Guard<A>>),
}

// E.g., { "condition": { "type": "Var", ... }, "expression": { "type": "Literal", ... } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Guard<A> {
    pub condition: Expr<A>,
    pub expression: Expr<A>,
}

// E.g., { "binderType": "VarBinder", "annotation": null, "identifier": "x" }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "binderType")]
pub enum Binder<A> {
    /// `BinderNull(_)` represents `_ -> ...`
    #[serde(rename = "NullBinder")]
    BinderNull { annotation: A },
    /// `BinderVar(_, "x")` represents `x -> ...`
    #[serde(rename = "VarBinder")]
    BinderVar { annotation: A, identifier: Ident },
    /// `BinderNamed(_, "arr", inner)` represents `arr@[x, y] -> ...`
    #[serde(rename = "NamedBinder")]
    BinderNamed {
        annotation: A,
        identifier: Ident,
        binder: Box<Binder<A>>,
    },
    /// `BinderLit(_, LitInt(42))` represents `42 -> ...`
    #[serde(rename = "LiteralBinder")]
    BinderLit {
        annotation: A,
        literal: Literal<Binder<A>>,
    },
    /// `BinderConstructor(_, "Data.Either", "Left", [BinderVar("e")])` represents `Left e -> ...`
    #[serde(rename = "ConstructorBinder")]
    BinderConstructor {
        annotation: A,
        type_name: Qualified<ProperName>,
        constructor_name: Qualified<Ident>,
        binders: Vec<Binder<A>>,
    },
}
