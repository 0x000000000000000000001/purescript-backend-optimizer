module PureScript.Backend.Optimizer.Syntax where

import Prelude

import Data.Array.NonEmpty (NonEmptyArray)
import Data.Maybe (Maybe)
import Data.Newtype (class Newtype)
import Data.Traversable (class Foldable, class Traversable, foldMap, foldlDefault, foldrDefault, sequenceDefault, traverse)
import Data.Tuple (Tuple)
import PureScript.Backend.Optimizer.CoreFn (ConstructorType, ExprType, Ident, Literal(..), Prop, ProperName, Qualified)

data BackendSyntax a
  -- | Reference to a global value or function (defined at the module level or imported).
  -- | In PureScript, top-level declarations are immutable and globally accessible.
  -- | 
  -- | Ex: `Data.Map.empty` or `myTopLevelFunction`
  = Var (Qualified Ident)

  -- | Reference to a local variable (function parameter, `let` variable).
  -- | The `Level` indicates its absolute lexical depth from the root of the expression (De Bruijn level).
  -- | Unlike De Bruijn indices which are relative to the current binder, a De Bruijn level is absolute.
  -- | This makes it easier to test variable equality (two variables are the same if they have the same Level)
  -- | and prevents accidental capture without needing to constantly shift indices.
  -- | 
  -- | Ex: `\x -> \y -> x + y` 
  -- | `x` is introduced first (Level 0), `y` is introduced next (Level 1).
  -- | In the body `x + y`, we refer to `x` via `Local (Just "x") 0` and `y` via `Local (Just "y") 1`.
  -- | `Nothing` is for _ in `\_ -> ...`
  | Local (Maybe Ident) Level

  -- | A primitive literal value.
  -- | Represents basic data types that are typically built-in to the target backend language.
  -- | 
  -- | Ex: `Lit (LitInt 42)` translates to `42` in JS/Go.
  -- | Ex: `Lit (LitString "hello")` translates to `"hello"`.
  -- | Ex: `Lit (LitArray [a, b])` translates to an array allocation like `[a, b]`.
  | Lit (Literal a)

  -- | Standard curried function application.
  -- | In PureScript, every function technically takes exactly one argument. Calling `f x y` 
  -- | is parsed as `(f x) y`. This constructor represents applying one or more arguments 
  -- | to a function that expects them one by one.
  -- | 
  -- | Ex: `App (Var "f") [x, y]` represents calling `f(x)(y)` in a curried model.
  | App a (NonEmptyArray a)

  -- | Definition of a standard curried function (closure or lambda).
  -- | Binds one or more arguments (each with their own `Level`) and evaluates the body.
  -- | Since PureScript is curried, `\x y -> x + y` is represented as an `Abs` binding `x` and `y`.
  -- | 
  -- | Ex: `Abs [(Just "x", 0), (Just "y", 1)] (body)` translates to `function(x) { return function(y) { return body; } }` if not optimized.
  | Abs (NonEmptyArray (Tuple (Maybe Ident) Level)) a

  -- | Optimized "uncurried" function call.
  -- | All required arguments are passed at once, which is much more efficient on native backends.
  -- | 
  -- | Ex: `UncurriedApp (Var "f") [x, y]` directly invokes `f(x, y)` in Go/PHP/JS, avoiding intermediate closures.
  | UncurriedApp a (Array a)

  -- | Definition of an optimized "uncurried" function.
  -- | Represents a backend function with a strict arity. When called, it expects all its arguments at once.
  -- | 
  -- | Ex: `UncurriedAbs [(Just "x", 0), (Just "y", 1)] (body)` translates to `function f(x, y) { return body; }`.
  | UncurriedAbs (Array (Tuple (Maybe Ident) Level)) a

  -- | Optimized call of an uncurried function that executes effects (e.g., FFI functions).
  -- | It directly applies the arguments and runs the effect, rather than returning a thunk `\() -> ...`.
  -- | 
  -- | Ex: `UncurriedEffectApp (Var "consoleLog") ["hello"]` translates to `console.log("hello")`.
  | UncurriedEffectApp a (Array a)

  -- | Optimized definition of an uncurried function that contains side effects.
  -- | Typically generates a function that directly executes imperative statements when called.
  -- | 
  -- | Ex: `UncurriedEffectAbs [(Just "msg", 0)] (body)` translates to `function log(msg) { body; }`.
  | UncurriedEffectAbs (Array (Tuple (Maybe Ident) Level)) a

  -- | Property or field access.
  -- | Reads a value from a structured type (Record, Array, or ADT constructor).
  -- | 
  -- | Ex: `Accessor record (GetProp "name")` translates to `record.name`.
  -- | Ex: `Accessor array (GetIndex 0)` translates to `array[0]`.
  -- | Ex: `Accessor adt (GetCtorField ... "value0")` translates to reading a specific field of a native struct/class.
  | Accessor a BackendAccessor

  -- | Pure record update.
  -- | Creates a new record by copying the existing one and replacing specific fields.
  -- | 
  -- | Ex: `Update record [(Prop "name" newName)]` translates to `{ ...record, name: newName }` in JS.
  | Update a (Array (Prop a))

  -- | Complete (saturated) instantiation of an Algebraic Data Type (ADT) constructor.
  -- | Provides all values expected by the memory layout (`dataDecls`) with their exact names.
  -- | Since all arguments are known, the backend can directly allocate the native struct or object.
  -- | 
  -- | Ex: `CtorSaturated (Qualified "Left") ... [("value0", "error")]` translates to `&Left{value0: "error"}` in Go.
  | CtorSaturated (Qualified Ident) ConstructorType ProperName Ident (Array (Tuple String a))

  -- | Represents the formal definition (the "factory") of an ADT constructor.
  -- | Used when manipulating the constructor as a first-class value itself (e.g., passing `Just` to a function).
  -- | 
  -- | Ex: `map Just [1, 2]` will pass the `CtorDef` of `Just` to `map`.
  | CtorDef ConstructorType ProperName Ident (Array String)

  -- | Block of mutually recursive local declarations.
  -- | Unlike a standard `Let` where the bound variable is only visible in the continuation (the body), 
  -- | in a `LetRec`, all bound variables are visible within their own definitions AND within each other's definitions.
  -- | This is strictly required to define local recursive functions (like a `go` loop) or multiple functions that call each other.
  -- | 
  -- | The `Level` represents the base lexical depth for the first variable in the block. 
  -- | The `NonEmptyArray` contains the identifiers and their expressions.
  -- | 
  -- | Ex: 
  -- | ```purescript
  -- | let ping n = pong (n - 1)
  -- |     pong n = ping (n - 1)
  -- | in ping 10
  -- | ```
  -- | Here `ping` and `pong` need to know about each other before they are fully evaluated. `LetRec` makes this possible.
  | LetRec Level (NonEmptyArray (Tuple Ident a)) a

  -- | Simple local declaration (variable assignment).
  -- | Evaluates the first expression and binds it to a name/level, then evaluates the body.
  -- | 
  -- | Ex: `Let (Just "x") 0 (LitInt 42) (body)` translates to `let x = 42; return body;`.
  | Let (Maybe Ident) Level a a

  -- | Sequential monadic bind (`<-`) specialized for native effects.
  -- | Imperative sequential execution: evaluates the first expression (the effect), binds its result, then evaluates the continuation.
  -- | 
  -- | Ex: `EffectBind (Just "text") 0 (readFile) (print text)` translates to `text = readFile(); return print(text);`.
  | EffectBind (Maybe Ident) Level a a

  -- | Wraps a pure value in an effectful context (equivalent to `pure x` in `Effect`).
  -- | 
  -- | Ex: `EffectPure (LitInt 42)` translates to `return 42;` in an imperative function body.
  | EffectPure a

  -- | Defers the execution of an expression.
  -- | In PureScript, `Effect a` is represented internally by a thunk `\() -> a`.
  -- | This constructor encapsulates the expression to prevent immediate execution until the effect is explicitly run.
  -- | 
  -- | Ex: `EffectDefer (consoleLog "hello")` translates to `function() { consoleLog("hello"); }`.
  | EffectDefer a

  -- | Multi-branch conditional structure.
  -- | Translates a pattern match or chained conditions into an `if / else if / else` block.
  -- | The pairs represent `(condition, body)`, and the last `a` is the default `else` fallback.
  -- | 
  -- | Ex: `Branch [(cond1, body1), (cond2, body2)] defaultBody` 
  -- | translates to: `if (cond1) { body1 } else if (cond2) { body2 } else { defaultBody }`.
  | Branch (NonEmptyArray (Pair a)) a

  -- | Primitive operator (unary or binary).
  -- | Reserved for native operations that have direct equivalents in the target CPU/Language.
  -- | 
  -- | Ex: `PrimOp (Op2 OpAdd x y)` translates to `x + y`.
  -- | Ex: `PrimOp (Op1 OpBooleanNot x)` translates to `!x`.
  | PrimOp (BackendOperator a)

  -- | Effect operation related to primitive mutable variables (`Ref` or `STRef`).
  -- | Directly maps to mutable memory allocation and modification in the backend.
  -- | 
  -- | Ex: `PrimEffect (EffectRefNew 42)` allocates a mutable pointer/variable initialized to 42.
  -- | Ex: `PrimEffect (EffectRefWrite ref 43)` updates the pointer/variable.
  | PrimEffect (BackendEffect a)

  -- | Represents the absence of a value or an undefined state.
  -- | Used to optimize unreachable branches or as a global placeholder to satisfy type systems without allocating memory.
  -- | 
  -- | Ex: Can translate to `null`, `undefined`, or a `panic("unreachable")` depending on the backend.
  | PrimUndefined

  -- | Throwing a fatal error at runtime.
  -- | Often induced by an incomplete pattern matching (e.g., `Failed pattern match...`).
  -- | 
  -- | Ex: `Fail "Pattern match failed"` translates to `throw new Error(...)` or `panic(...)`.
  | Fail String

  -- | Ours
  -- | (TAST v2 specificity) Associates a full PureScript type (`ExprType`) with an expression.
  -- | Essential for strongly typed AOT backends (Go, PHP 8+, Java) to generate strict types, 
  -- | emit casts, or instantiate the correct native `struct` without falling back to dynamic typing (`interface{}`).
  -- | 
  -- | Ex: `Typed Int (LitInt 42)` tells the Go generator to treat this node strictly as an `int`.
  | Typed ExprType a

derive instance Eq a => Eq (BackendSyntax a)

newtype Level = Level Int

derive newtype instance Eq Level
derive newtype instance Ord Level
derive instance Newtype Level _

data Pair a = Pair a a

derive instance Eq a => Eq (Pair a)

fstPair :: forall a. Pair a -> a
fstPair (Pair a _) = a

sndPair :: forall a. Pair a -> a
sndPair (Pair _ a) = a

data BackendAccessor
  -- | Accesses a property by its string name.
  -- | Typically used to read fields from a PureScript Record.
  -- | 
  -- | Ex: `Accessor record (GetProp "foo")` translates to `record.foo` or `record["foo"]`.
  = GetProp String

  -- | Accesses an element at a specific index in an array.
  -- | 
  -- | Ex: `Accessor array (GetIndex 0)` translates to `array[0]`.
  | GetIndex Int

  -- | Accesses a specific field of an Algebraic Data Type (ADT) constructor.
  -- | In standard PureScript, this requires pattern matching, but the optimizer flattens it 
  -- | into direct memory access since it knows the exact memory layout (`dataDecls`).
  -- | 
  -- | The parameters represent:
  -- | 1. `Qualified Ident`: The ADT type identifier (e.g., `Data.Either.Left`)
  -- | 2. `ConstructorType`: Whether it's a Product or Sum type.
  -- | 3. `ProperName`: The type name.
  -- | 4. `Ident`: The constructor name.
  -- | 5. `String`: The explicit name of the field (e.g., `"value0"`).
  -- | 6. `Int`: The positional index of the field (useful for tuple-like arrays).
  -- | 
  -- | Ex: Given the PureScript ADT: `data Maybe a = Nothing | Just a`
  -- | When accessing the value inside `Just` (e.g. during pattern matching `case x of Just val -> val`),
  -- | the optimizer can flatten the match into an explicit accessor:
  -- | 
  -- | `Accessor x (GetCtorField (Qualified (Just "Data.Maybe") "Just") ConstructorTypeSum (ProperName "Maybe") (Ident "Just") "value0" 0)`
  -- | 
  -- | This gives the Codegen all the metadata it needs to emit a highly optimized, strictly typed native access:
  -- | - In Go: `x.(*Maybe_Just).value0` (Type assertion followed by struct field access)
  -- | - In PHP: `$x->value0` (Direct object property access)
  -- | - In JS: `x.value0` or `x[0]` (Depending on how the constructor was lowered)
  | GetCtorField (Qualified Ident) ConstructorType ProperName Ident String Int

derive instance Eq BackendAccessor
derive instance Ord BackendAccessor

data BackendOperator a
  = Op1 BackendOperator1 a
  | Op2 BackendOperator2 a a

derive instance Eq a => Eq (BackendOperator a)

data BackendOperator1
  = OpBooleanNot
  | OpIntBitNot
  | OpIntNegate
  | OpNumberNegate
  | OpArrayLength
  | OpIsTag (Qualified Ident)

derive instance Eq BackendOperator1
derive instance Ord BackendOperator1

data BackendOperator2
  = OpArrayIndex
  | OpBooleanAnd
  | OpBooleanOr
  | OpBooleanOrd BackendOperatorOrd
  | OpCharOrd BackendOperatorOrd
  | OpIntBitAnd
  | OpIntBitOr
  | OpIntBitShiftLeft
  | OpIntBitShiftRight
  | OpIntBitXor
  | OpIntBitZeroFillShiftRight
  | OpIntNum BackendOperatorNum
  | OpIntOrd BackendOperatorOrd
  | OpNumberNum BackendOperatorNum
  | OpNumberOrd BackendOperatorOrd
  | OpStringAppend
  | OpStringOrd BackendOperatorOrd

derive instance Eq BackendOperator2
derive instance Ord BackendOperator2

data BackendOperatorNum
  = OpAdd
  | OpDivide
  | OpMultiply
  | OpSubtract

derive instance Eq BackendOperatorNum
derive instance Ord BackendOperatorNum

data BackendOperatorOrd
  = OpEq
  | OpNotEq
  | OpGt
  | OpGte
  | OpLt
  | OpLte

derive instance Eq BackendOperatorOrd
derive instance Ord BackendOperatorOrd

data BackendEffect a
  = EffectRefNew a
  | EffectRefRead a
  | EffectRefWrite a a

derive instance Eq a => Eq (BackendEffect a)
derive instance Functor BackendSyntax

instance Foldable BackendSyntax where
  foldr a = foldrDefault a
  foldl a = foldlDefault a
  foldMap f = case _ of
    Var _ -> mempty
    Local _ _ -> mempty
    Lit lit ->
      case lit of
        LitArray as -> foldMap f as
        LitRecord as -> foldMap (foldMap f) as
        _ -> mempty
    App a bs -> f a <> foldMap f bs
    Abs _ b -> f b
    UncurriedApp a bs -> f a <> foldMap f bs
    UncurriedAbs _ b -> f b
    UncurriedEffectApp a bs -> f a <> foldMap f bs
    UncurriedEffectAbs _ b -> f b
    Accessor a _ -> f a
    Update a bs -> f a <> foldMap (foldMap f) bs
    LetRec _ as b -> foldMap (foldMap f) as <> f b
    Let _ _ b c -> f b <> f c
    EffectBind _ _ b c -> f b <> f c
    EffectPure a -> f a
    EffectDefer a -> f a
    Branch as b -> foldMap (foldMap f) as <> f b
    PrimOp a -> foldMap f a
    PrimEffect a -> foldMap f a
    PrimUndefined -> mempty
    CtorSaturated _ _ _ _ es -> foldMap (foldMap f) es
    CtorDef _ _ _ _ -> mempty
    Fail _ -> mempty
    Typed _ a -> f a

instance Traversable BackendSyntax where
  sequence a = sequenceDefault a
  traverse f = case _ of
    Var a ->
      pure (Var a)
    Local a b ->
      pure (Local a b)
    Lit lit ->
      case lit of
        LitInt a -> pure (Lit (LitInt a))
        LitNumber a -> pure (Lit (LitNumber a))
        LitString a -> pure (Lit (LitString a))
        LitChar a -> pure (Lit (LitChar a))
        LitBoolean a -> pure (Lit (LitBoolean a))
        LitArray as -> Lit <<< LitArray <$> traverse f as
        LitRecord as -> Lit <<< LitRecord <$> traverse (traverse f) as
    App a bs ->
      App <$> f a <*> traverse f bs
    Abs as b ->
      Abs as <$> f b
    UncurriedApp a bs ->
      UncurriedApp <$> f a <*> traverse f bs
    UncurriedAbs as b ->
      UncurriedAbs as <$> f b
    UncurriedEffectApp a bs ->
      UncurriedEffectApp <$> f a <*> traverse f bs
    UncurriedEffectAbs as b ->
      UncurriedEffectAbs as <$> f b
    Accessor a b ->
      flip Accessor b <$> f a
    Update a bs ->
      Update <$> f a <*> traverse (traverse f) bs
    CtorDef a b c ds ->
      pure (CtorDef a b c ds)
    CtorSaturated a b c d es ->
      CtorSaturated a b c d <$> traverse (traverse f) es
    LetRec lvl as b ->
      LetRec lvl <$> traverse (traverse f) as <*> f b
    Let ident lvl b c ->
      Let ident lvl <$> f b <*> f c
    EffectBind ident lvl b c ->
      EffectBind ident lvl <$> f b <*> f c
    EffectPure a ->
      EffectPure <$> f a
    EffectDefer a ->
      EffectDefer <$> f a
    Branch as b ->
      Branch <$> traverse (traverse f) as <*> f b
    PrimOp a ->
      PrimOp <$> traverse f a
    PrimEffect a ->
      PrimEffect <$> traverse f a
    PrimUndefined ->
      pure PrimUndefined
    Fail a ->
      pure (Fail a)
    Typed t a ->
      Typed t <$> f a

derive instance Functor Pair

instance Foldable Pair where
  foldl f acc (Pair a b) = f (f acc a) b
  foldr f acc (Pair a b) = f a (f b acc)
  foldMap f (Pair a b) = f a <> f b

instance Traversable Pair where
  sequence a = sequenceDefault a
  traverse f (Pair a b) = Pair <$> f a <*> f b

derive instance Functor BackendOperator

instance Foldable BackendOperator where
  foldr a = foldrDefault a
  foldl a = foldlDefault a
  foldMap f = case _ of
    Op1 _ a -> f a
    Op2 _ a b -> f a <> f b

instance Traversable BackendOperator where
  sequence a = sequenceDefault a
  traverse f = case _ of
    Op1 a b -> Op1 a <$> f b
    Op2 a b c -> Op2 a <$> f b <*> f c

derive instance Functor BackendEffect

instance Foldable BackendEffect where
  foldr a = foldrDefault a
  foldl a = foldlDefault a
  foldMap f = case _ of
    EffectRefNew a -> f a
    EffectRefRead a -> f a
    EffectRefWrite a b -> f a <> f b

instance Traversable BackendEffect where
  sequence a = sequenceDefault a
  traverse f = case _ of
    EffectRefNew a -> EffectRefNew <$> f a
    EffectRefRead a -> EffectRefRead <$> f a
    EffectRefWrite a b -> EffectRefWrite <$> f a <*> f b

-- | A type class serving as an abstraction bridge to extract the raw syntax from a wrapped AST node.
-- | In the optimizer, the AST is often wrapped in a container to store metadata 
-- | (e.g., `BackendExpr` in Semantics.purs which attaches analysis data to each node). 
-- | `HasSyntax` allows generic algorithms to extract and inspect the underlying `BackendSyntax a` 
-- | without needing to know exactly how the node `a` is wrapped.
class HasSyntax a where
  syntaxOf :: a -> Maybe (BackendSyntax a)
