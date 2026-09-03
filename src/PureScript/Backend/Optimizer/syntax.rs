use crate::corefn::{ExprType, Ident, Literal, Qualified};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Level(pub usize);

#[derive(Debug, Clone, PartialEq)]
pub enum BackendSyntax<A> {
    /// `Var("Data.Map.empty")` represents a global reference to `Data.Map.empty`
    Var(Qualified<Ident>),
    /// `Local(Some("x"), Level(0))` represents a local variable `x` at absolute depth 0
    Local(Option<Ident>, Level),
    /// `Lit(LitInt(42))` represents the primitive literal `42`
    Lit(Literal<A>),
    /// `App(Var("foo"), [Var("x"), Var("y")])` represents a function application `foo x y`
    App(A, Vec<A>),
    /// `TypeApp(Var("identity"), Int)` represents a type application like `identity @Int`
    TypeApp(A, ExprType),
    /// `Abs(vec![(Some("x"), Level(0))], body)` represents `\x -> body`
    Abs(Vec<(Option<Ident>, Level)>, A),
    /// `UncurriedApp(Var("f"), vec![x, y])` represents calling `f(x, y)` directly
    UncurriedApp(A, Vec<A>),
    /// `UncurriedAbs(vec![(Some("x"), Level(0)), (Some("y"), Level(1))], body)` represents `function f(x, y) { return body; }`
    UncurriedAbs(Vec<(Option<Ident>, Level)>, A),
    /// `UncurriedEffectApp(Var("consoleLog"), vec!["hello"])` represents `console.log("hello")`
    UncurriedEffectApp(A, Vec<A>),
    /// `UncurriedEffectAbs(vec![(Some("msg"), Level(0))], body)` represents `function log(msg) { body; }`
    UncurriedEffectAbs(Vec<(Option<Ident>, Level)>, A),
    /// `Accessor(record, GetProp("name"))` represents `record.name`
    Accessor(A, BackendAccessor),
    /// `Update(record, [Prop("name", newName)])` represents `{ ...record, name: newName }`
    Update(A, Vec<crate::corefn::Prop<A>>),
    /// `CtorSaturated("Left", SumType, "Either", "Left", [("value0", "error")])` represents `&Left{value0: "error"}`
    CtorSaturated(Qualified<Ident>, crate::corefn::ConstructorType, crate::corefn::ProperName, Ident, Vec<(String, A)>),
    /// `CtorDef(SumType, "Either", "Left", ["value0"])` represents the constructor factory itself
    CtorDef(crate::corefn::ConstructorType, crate::corefn::ProperName, Ident, Vec<String>),
    /// `LetRec(Level(0), [("ping", body1), ("pong", body2)], body)` represents mutually recursive bindings
    LetRec(Level, Vec<(Ident, A)>, A),
    /// `Let(Some("x"), Level(0), 42, body)` represents `let x = 42; return body;`
    Let(Option<Ident>, Level, A, A),
    /// `EffectBind(Some("text"), Level(0), readFile, print(text))` translates to `text = readFile(); return print(text);`
    EffectBind(Option<Ident>, Level, A, A),
    /// `EffectPure(42)` translates to `return 42;`
    EffectPure(A),
    /// `EffectDefer(body)` translates to `function() { body; }`
    EffectDefer(A),
    /// `Branch([(cond1, body1), (cond2, body2)], defaultBody)` translates to `if (cond1) { body1 } else ...`
    Branch(Vec<(A, A)>, A),
    /// `PrimOp(Op2(OpAdd, x, y))` translates to `x + y`
    PrimOp(BackendOperator<A>),
    /// `PrimEffect(EffectRefNew(42))` allocates a mutable reference
    PrimEffect(BackendEffect<A>),
    /// `PrimUndefined` translates to `null` or `panic("unreachable")`
    PrimUndefined,
    /// `Fail("Pattern match failed")` translates to `panic(...)`
    Fail(String),
    /// `Typed(Int, 42)` instructs the generator to treat this node as an `int`
    Typed(ExprType, A),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackendAccessor {
    GetProp(String),
    GetIndex(usize),
    GetCtorField(Qualified<Ident>, crate::corefn::ConstructorType, crate::corefn::ProperName, Ident, String, usize),
}

#[derive(Debug, Clone, PartialEq)]
pub enum BackendOperator<A> {
    Op1(BackendOperator1, A),
    Op2(BackendOperator2, A, A),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackendOperator1 {
    OpBooleanNot,
    OpIntBitNot,
    OpIntNegate,
    OpNumberNegate,
    OpArrayLength,
    OpIsTag(Qualified<Ident>),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackendOperator2 {
    OpArrayIndex,
    OpBooleanAnd,
    OpBooleanOr,
    OpBooleanOrd(BackendOperatorOrd),
    OpCharOrd(BackendOperatorOrd),
    OpIntBitAnd,
    OpIntBitOr,
    OpIntBitShiftLeft,
    OpIntBitShiftRight,
    OpIntBitXor,
    OpIntBitZeroFillShiftRight,
    OpIntNum(BackendOperatorNum),
    OpIntOrd(BackendOperatorOrd),
    OpNumberNum(BackendOperatorNum),
    OpNumberOrd(BackendOperatorOrd),
    OpStringAppend,
    OpStringOrd(BackendOperatorOrd),
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackendOperatorNum {
    OpAdd,
    OpDivide,
    OpMultiply,
    OpSubtract,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum BackendOperatorOrd {
    OpEq,
    OpNotEq,
    OpGt,
    OpGte,
    OpLt,
    OpLte,
}

#[derive(Debug, Clone, PartialEq)]
pub enum BackendEffect<A> {
    EffectRefNew(A),
    EffectRefRead(A),
    EffectRefWrite(A, A),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::corefn::ModuleName;

    #[test]
    fn test_bak_syn_var() {
        let syn: BackendSyntax<()> = BackendSyntax::Var(Qualified::new(
            Some(ModuleName(vec!["Data".to_string(), "Map".to_string()])),
            Ident("empty".to_string()),
        ));

        match syn {
            BackendSyntax::Var(Qualified { identifier, module_name }) => {
                assert_eq!(identifier.0, "empty");
                assert_eq!(module_name.unwrap().0, vec!["Data".to_string(), "Map".to_string()]);
            },
            _ => panic!("Bad Var"),
        }
    }
}
