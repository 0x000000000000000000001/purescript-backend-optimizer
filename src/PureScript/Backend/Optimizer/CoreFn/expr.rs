use serde::{Deserialize, Serialize};

use super::ident::{Ident, ProperName, Qualified};
use super::pattern::CaseAlternative;
use super::types::ExprType;

// E.g., ["foo", 42]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Prop<A>(pub String, pub A);

// E.g., { "literalType": "IntLiteral", "value": 42 }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "literalType", content = "value")]
pub enum Literal<A> {
    #[serde(rename = "IntLiteral")]
    LitInt(i32),
    #[serde(rename = "NumberLiteral")]
    LitNumber(f64),
    #[serde(rename = "StringLiteral")]
    LitString(String),
    #[serde(rename = "CharLiteral")]
    LitChar(char),
    #[serde(rename = "BooleanLiteral")]
    LitBoolean(bool),
    #[serde(rename = "ArrayLiteral")]
    LitArray(Vec<A>),
    #[serde(rename = "ObjectLiteral")]
    LitRecord(Vec<Prop<A>>),
}

// E.g., { "bindType": "NonRec", "annotation": null, "identifier": "x", "expression": { ... } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "bindType")]
pub enum Bind<A> {
    /// `NonRec` represents a simple non-recursive let-binding, where the defined variable cannot refer to itself.
    /// E.g., `let x = 10`
    #[serde(rename = "NonRec")]
    NonRec(Binding<A>),
    /// `Rec` represents a group of one or more mutually recursive let-bindings, where the variables can refer to each other or themselves.
    /// E.g., `let ping n = pong (n - 1); pong n = ping (n - 1)`
    #[serde(rename = "Rec")]
    Rec { binds: Vec<Binding<A>> },
}

// E.g., { "annotation": null, "identifier": "x", "expression": { "type": "Literal", ... } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding<A> {
    pub annotation: A,
    pub identifier: Ident,
    pub expression: Expr<A>,
}

// E.g., { "type": "Var", "annotation": null, "value": { "moduleName": null, "identifier": "add" } }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Expr<A> {
    /// `ExprVar(_, "add")` represents a variable `add`
    #[serde(rename = "Var")]
    ExprVar { annotation: A, value: Qualified<Ident> },
    /// `ExprLit(_, LitInt(42))` represents a literal `42`
    #[serde(rename = "Literal")]
    ExprLit { annotation: A, value: Literal<Expr<A>> },
    /// `ExprConstructor(_, "Data.Either", "Left", ["a"])` represents `Left`
    #[serde(rename = "Constructor")]
    ExprConstructor { annotation: A, type_name: ProperName, constructor_name: Ident, field_names: Vec<String> },
    /// `ExprAccessor(_, obj, "foo")` represents `obj.foo`
    #[serde(rename = "Accessor")]
    ExprAccessor { annotation: A, expression: Box<Expr<A>>, field_name: String },
    /// `ExprUpdate(_, obj, [Prop("foo", val)])` represents `obj { foo = val }`
    #[serde(rename = "ObjectUpdate")]
    ExprUpdate { annotation: A, expression: Box<Expr<A>>, updates: Vec<Prop<Expr<A>>> },
    /// `ExprAbs(_, "x", body)` represents `\x -> body`
    #[serde(rename = "Abs")]
    ExprAbs { annotation: A, argument: Ident, body: Box<Expr<A>> },
    /// `ExprApp(_, f, x)` represents `f x`
    #[serde(rename = "App")]
    ExprApp { annotation: A, abstraction: Box<Expr<A>>, argument: Box<Expr<A>> },
    /// `ExprCase(_, [x], [alt])` represents `case x of alt`
    #[serde(rename = "Case")]
    ExprCase { annotation: A, case_expressions: Vec<Expr<A>>, case_alternatives: Vec<CaseAlternative<A>> },
    /// `ExprLet(_, [bind], body)` represents `let bind in body`
    #[serde(rename = "Let")]
    ExprLet { annotation: A, binds: Vec<Bind<A>>, expression: Box<Expr<A>> },
    /// `ExprTypeApp(_, f, Int)` represents `f @Int`
    #[serde(rename = "TypeApp")]
    ExprTypeApp { annotation: A, expression: Box<Expr<A>>, type_argument: ExprType },
}
