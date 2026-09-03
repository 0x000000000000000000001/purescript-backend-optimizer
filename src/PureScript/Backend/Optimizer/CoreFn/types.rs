use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ExprType {
    Int,
    Number,
    String,
    Char,
    Boolean,
    Unit,
    /// A fallback dynamic type (e.g., `interface{}` in Go, `mixed` in PHP...). 
    /// Used when type info is missing.
    Any,
    /// `TypeLevelString("foo")` represents `"foo"` at the type level (Symbol)
    TypeLevelString { value: String },
    /// `Array(TypeVar("a"))` represents `Array a`
    Array { elem: Box<ExprType> },
    /// `TypeVar("a")` represents a type variable `a`
    TypeVar { name: String },
    /// `Adt("Foo", ["Foo"], [Int])` represents `Foo Int`
    Adt { name: String, fqn: Vec<String>, args: Vec<ExprType> },
    /// `Func([Int], String)` represents `Int -> String`
    Func { args: Vec<ExprType>, ret: Box<ExprType> },
    /// `TypeApp(TypeVar("f"), [TypeVar("a")])` represents `f a`
    /// `TypeApp(TypeApp(TypeVar("g"), [TypeVar("a")]), [TypeVar("b")])` represents `g a b`
    TypeApp { f: Box<ExprType>, args: Vec<ExprType> },
    /// `Row([("foo", Int), ("bar", String)], Some(Box::new(TypeVar("r"))))` represents `( foo :: Int, bar :: String | r )`
    Row { fields: Vec<(String, ExprType)>, rest: Option<Box<ExprType>> },
    /// `Record(Row([("foo", Int)], None))` represents `{ foo :: Int }`
    Record { row: Box<ExprType> },
    /// `ForAll(["a"], TypeVar("a"))` represents `forall a. a`
    ForAll { vars: Vec<String>, ty: Box<ExprType> },
    /// `ConstrainedType([(["Eq"], [TypeVar("a")])], TypeVar("a"))` represents `Eq a => a`
    ConstrainedType { constraints: Vec<(Vec<String>, Vec<ExprType>)>, ty: Box<ExprType> },
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ConstructorType {
    ProductType,
    SumType,
}
