module PureScript.Backend.Optimizer.CoreFn
  ( Ann(..)
  , Bind(..)
  , Binder(..)
  , Binding(..)
  , CaseAlternative(..)
  , CaseGuard(..)
  , ClassDecl
  , Comment(..)
  , ConstructorType(..)
  , DataConstructor
  , DataDecl
  , Expr(..)
  , ExprType(..)
  , Guard(..)
  , Ident(..)
  , Import(..)
  , Literal(..)
  , Meta(..)
  , Module(..)
  , ModuleName(..)
  , Prop(..)
  , ProperName(..)
  , Qualified(..)
  , ReExport(..)
  , SourcePos
  , SourceSpan
  , emptySpan
  , importName
  , isPrimModule
  , moduleName
  , findProp
  , propKey
  , propValue
  , binderAnn
  , exprAnn
  , qualifiedModuleName
  , unQualified
  ) where

import Prelude

import Data.Array as Array
import Data.Foldable (class Foldable, foldMap, foldlDefault, foldrDefault)
import Data.Map (Map)
import Data.Maybe (Maybe(..))
import Data.Newtype (class Newtype)
import Data.String.CodeUnits as SCU
import Data.Traversable (class Traversable, sequenceDefault, traverse)
import Data.Tuple (Tuple)

newtype Ident = Ident String

derive newtype instance eqIdent :: Eq Ident
derive newtype instance ordIdent :: Ord Ident
derive instance Newtype Ident _

newtype ModuleName = ModuleName String

derive newtype instance eqModuleName :: Eq ModuleName
derive newtype instance ordModuleName :: Ord ModuleName
derive instance Newtype ModuleName _

newtype ProperName = ProperName String

derive newtype instance eqProperName :: Eq ProperName
derive newtype instance ordProperName :: Ord ProperName

-- | Represents a value of type `a` (typically an identifier, operator, or type name) 
-- | that can be prefixed by its module name.
-- | The module is optional (`Maybe ModuleName`). 
-- | Ex: `Data.Map.empty` will be qualified by `Just "Data.Map"`, while a bare `empty` will just have `Nothing`.
data Qualified a = Qualified (Maybe ModuleName) a

derive instance eqQualified :: Eq a => Eq (Qualified a)
derive instance ordQualified :: Ord a => Ord (Qualified a)
derive instance Functor Qualified

unQualified :: forall a. Qualified a -> a
unQualified (Qualified _ a) = a

qualifiedModuleName :: forall a. Qualified a -> Maybe ModuleName
qualifiedModuleName (Qualified mn _) = mn

type SourcePos =
  { line :: Int
  , column :: Int
  }

type SourceSpan =
  { path :: String
  , start :: SourcePos
  , end :: SourcePos
  }

newtype Ann = Ann
  { span :: SourceSpan
  , meta :: Maybe Meta
  , type :: Maybe ExprType
  }

-- | Represents the structural PureScript type of an expression.
-- | Preserved in the TAST (Typed Abstract Syntax Tree) to allow AOT backends 
-- | to generate strictly typed native code without falling back to dynamic types.
data ExprType
  -- | A native 32-bit integer.
  = Int
  -- | A native double-precision float.
  | Number
  -- | A native string.
  | String
  -- | A native character.
  | Char
  -- | A native boolean.
  | Boolean
  -- | The Unit type (often maps to `void` or a singleton `struct{}` in backends).
  | Unit
  -- | A fallback dynamic type (equivalent to `interface{}` in Go or `mixed` in PHP).
  -- | Used when type information is missing or inherently dynamic.
  | Any
  -- | A type-level string literal (e.g., `"foo"` used in row labels or symbols).
  | TypeLevelString String
  -- | A native array containing elements of a specific type.
  | Array ExprType
  -- | A type variable (e.g., the `a` in `forall a. a -> a`).
  | TypeVar String
  -- | An Algebraic Data Type (ADT) reference.
  -- | This represents a concrete named type like `Maybe` or `Either`.
  -- | 
  -- | 1. The fully qualified name of the ADT as a flat string (e.g., `"Data.Either.Either"`). 
  -- |    (Note: This is a string rather than `Qualified ProperName` to directly match the JSON format emitted by the compiler).
  -- | 2. The exact same fully qualified name, but split into an array of its path components (e.g., `["Data", "Either", "Either"]`).
  -- | 3. The actual type arguments applied to this ADT to instantiate it (e.g., `[String, Int]` for `Either String Int`).
  | ADT String (Array String) (Array ExprType)

  -- | Type application. Applies a base type to one or more type arguments.
  -- | While `ADT` is used for known named types, `TypeApp` is often used for higher-kinded types,
  -- | type aliases, or applying types to type variables (e.g., `f a` where `f` is a `TypeVar`).
  -- | 
  -- | Ex: `TypeApp (TypeVar "f") [Int]` translates to `f Int`.
  | TypeApp ExprType (Array ExprType)

  -- | A function type.
  -- | Note: The standard PureScript compiler treats all functions as curried (`a -> b -> c` is `a -> (b -> c)`).
  -- | However, the TAST (Typed AST) flattens this representation to match how native functions work in Go/PHP/JS.
  -- | 
  -- | 1. `Array ExprType`: The array of argument types the function takes simultaneously.
  -- | 2. `ExprType`: The final return type.
  -- | 
  -- | Ex: `Func [Int, String] Boolean` represents a native function taking an Int and a String, and returning a Boolean.
  | Func (Array ExprType) ExprType

  -- | A Row type (used as the backing structure for Records or Effects).
  -- | A Row represents an unordered collection of labeled types.
  -- | 
  -- | 1. `Array (Tuple String ExprType)`: The explicit fields in the row (e.g., `[("name", String), ("age", Int)]`).
  -- | 2. `Maybe ExprType`: An optional "tail". If `Just (TypeVar "r")`, this is an "open row" (`(name :: String | r)`),
  -- |    meaning it can be extended. If `Nothing`, it is a "closed row" representing a strictly defined set of fields.
  | Row (Array (Tuple String ExprType)) (Maybe ExprType)

  -- | A Record type. 
  -- | While a `Row` defines an abstract collection of labeled types, a `Record` turns it into a concrete value type.
  -- | 
  -- | 1. `ExprType`: This inner type is generally expected to be a `Row` containing the specific fields.
  -- | 
  -- | Ex: `Record (Row [("name", String)] Nothing)` represents the PureScript type `{ name :: String }`.
  | Record ExprType

  -- | A universally quantified type (`forall`).
  -- | Defines polymorphism by declaring generic type variables that are in scope for the underlying type.
  -- | 
  -- | 1. `Array String`: The names of the bound type variables (e.g., `["a", "b"]`).
  -- | 2. `ExprType`: The underlying type that uses these variables.
  -- | 
  -- | Ex: `ForAll ["a"] (Func [TypeVar "a"] (TypeVar "a"))` represents `forall a. a -> a`.
  | ForAll (Array String) ExprType

  -- | A constrained type (e.g., `Eq a => a -> a`).
  -- | Represents a type that requires one or more type class instances (dictionaries) to be passed at runtime.
  -- | 
  -- | 1. `Array (Tuple (Array String) (Array ExprType))`: The list of class constraints.
  -- |    - `Array String`: The fully qualified name of the Type Class split into parts (e.g., `["Data", "Eq", "Eq"]`).
  -- |    - `Array ExprType`: The type arguments applied to the class (e.g., `[TypeVar "a"]`).
  -- | 2. `ExprType`: The underlying type protected by these constraints.
  -- | 
  -- | Ex: `ConstrainedType [ (["Data","Eq","Eq"], [TypeVar "a"]) ] (Func [TypeVar "a", TypeVar "a"] Boolean)` 
  -- |     represents `Eq a => a -> a -> Boolean`.
  | ConstrainedType (Array (Tuple (Array String) (Array ExprType))) ExprType

derive instance eqExprType :: Eq ExprType
derive instance ordExprType :: Ord ExprType

-- | Metadata attached to CoreFn bindings (Let/Abs) or variables.
-- | Provides crucial hints to the optimizer and codegen about the origin or purpose of a value,
-- | allowing them to emit highly specialized native code instead of generic function calls.
data Meta
  -- | Indicates that this binding is a data constructor for an Algebraic Data Type (ADT).
  -- | 1. `ConstructorType`: Whether it's a `ProductType` (single constructor ADT, e.g., `Tuple`) 
  -- |    or a `SumType` (multi-constructor ADT, e.g., `Either`).
  -- | 2. `Array Ident`: The field names of the constructor.
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | data Either a b = Left a | Right b
  -- | -- The compiler generates underlying bindings:
  -- | Left = \value0 -> { constructor: "Left", value0: value0 }   -- Tagged: IsConstructor SumType ["value0"]
  -- | Right = \value0 -> { constructor: "Right", value0: value0 } -- Tagged: IsConstructor SumType ["value0"]
  -- | ```
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | data Tuple a b = Tuple a b
  -- | -- The compiler generates:
  -- | Tuple = \value0 value1 -> { value0: value0, value1: value1 } -- Tagged: IsConstructor ProductType ["value0", "value1"]
  -- | ```
  -- | 
  -- | Optimization: Backends use this to generate fast native allocations (e.g., `&Data_Either_Left{value0: x}`) 
  -- | instead of treating the constructor as an opaque curried function.
  = IsConstructor ConstructorType (Array Ident)

  -- | Indicates that this binding is a `newtype` constructor.
  -- | In PureScript, newtypes are guaranteed to have zero runtime overhead. 
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | newtype Age = Age Int
  -- | -- The compiler generates an identity function:
  -- | Age = \x -> x  -- Tagged: IsNewtype
  -- | ```
  -- | 
  -- | Optimization: Backends use this to completely erase the constructor call, replacing it 
  -- | with a direct cast or an identity function.
  | IsNewtype

  -- | Indicates that this binding is a constructor for a Type Class dictionary.
  -- | In PureScript, Type Classes do not exist at runtime. They are compiled using "Dictionary Passing".
  -- | A class is compiled into a Record (a dictionary) containing its methods, and the compiler 
  -- | generates an internal top-level function to construct this Record.
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | class Eq a where eq :: a -> a -> Boolean
  -- | -- The compiler generates a dictionary constructor factory:
  -- | dictEq = \eq_impl -> { eq: eq_impl }  -- Tagged: IsTypeClassConstructor
  -- | ```
  -- | Whenever an instance is declared (e.g. `instance eqInt`), the compiler calls `dictEq` 
  -- | to package the methods into the dictionary record.
  -- | 
  -- | Optimization: Backends can treat these as strict struct instantiations rather than 
  -- | generic function applications.
  | IsTypeClassConstructor

  -- | Indicates that this binding represents a Foreign Function Interface (FFI) import.
  -- | It has no PureScript body and must be provided natively by the backend (e.g., in a `.go` or `.php` file).
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | foreign import log :: String -> Effect Unit
  -- | -- The compiler creates an empty binding hook:
  -- | log = <foreign>  -- Tagged: IsForeign
  -- | ```
  -- | 
  -- | Optimization: The backend knows it must link this binding to a native implementation.
  | IsForeign

  -- | Indicates that this binding originated from a `where` clause in the PureScript source.
  -- | Mainly used for tracking source origin.
  -- | 
  -- | Ex:
  -- | ```purescript
  -- | foo x = bar x
  -- |   where bar y = y + 1
  -- | ```
  -- | -> The local binding for `bar` gets `IsWhere`.
  | IsWhere

  -- | Indicates that this application was synthetically generated by the compiler 
  -- | (e.g., during the desugaring of type classes or partial type applications) 
  -- | rather than explicitly written by the user.
  -- | 
  -- | Ex: Calling `show 42`. The compiler transforms this into `show (dictShowInt) 42`.
  -- | -> The hidden application of `dictShowInt` gets `IsSyntheticApp`.
  | IsSyntheticApp

derive instance eqMeta :: Eq Meta
derive instance ordMeta :: Ord Meta

data ConstructorType
  = ProductType
  | SumType

derive instance eqConstructorType :: Eq ConstructorType
derive instance ordConstructorType :: Ord ConstructorType

data Comment
  = LineComment String
  | BlockComment String

type DataConstructor =
  { name :: String
  , fields :: Array ExprType
  }

type DataDecl =
  { name :: String
  , vars :: Array String
  , constructors :: Array DataConstructor
  }

type ClassDecl =
  { name :: String
  , vars :: Array String
  , superclasses :: Array (Tuple (Array String) (Array ExprType))
  , methods :: Array (Tuple String ExprType)
  }

newtype Module a = Module
  { name :: ModuleName
  , path :: String
  , span :: SourceSpan
  , imports :: Array (Import a)
  , exports :: Array Ident
  , reExports :: Array ReExport
  , dataDecls :: Array DataDecl
  , classDecls :: Array ClassDecl
  , decls :: Array (Bind a)
  , foreign :: Map Ident (Maybe ExprType)
  , comments :: Array Comment
  }

-- | Extracts the `ModuleName` from a `Module`.
moduleName :: forall a. Module a -> ModuleName
moduleName (Module mod) = mod.name

-- | Represents an import statement in the CoreFn AST.
-- | The `a` type variable holds the annotations (like `SourceSpan`).
-- | Note: PureScript's CoreFn simplifies all imports to just the module name, 
-- | completely discarding the specific imported identifiers (since everything is fully qualified in the AST).
data Import a = Import a ModuleName

derive instance functorImport :: Functor Import

-- | Extracts the `ModuleName` from an `Import` declaration.
importName :: forall a. Import a -> ModuleName
importName (Import _ name) = name

-- | Represents a re-exported identifier from another module.
-- | Useful for backends that need to know if a module acts as a facade/proxy for other modules.
-- | Contains the original `ModuleName` and the `Ident` of the exported value.
data ReExport = ReExport ModuleName Ident

derive instance eqReExport :: Eq ReExport
derive instance ordReExport :: Ord ReExport

-- | Represents a group of variable bindings (definitions) in the CoreFn AST.
-- | The compiler explicitly separates non-recursive and mutually recursive bindings 
-- | to make backend code generation much simpler, as recursive functions require 
-- | special closure allocations or loop handling.
data Bind a
  -- | A single, non-recursive variable definition.
  -- | The variable cannot reference itself in its own expression body.
  -- | Ex: `let x = 10 in x + 1`
  = NonRec (Binding a)

  -- | A group of one or more mutually recursive variable definitions.
  -- | All variables defined in this array are in scope within each other's bodies.
  -- | Ex: `let ping n = pong (n-1); pong n = ping (n-1) in ping 10`
  | Rec (Array (Binding a))

derive instance functorBind :: Functor Bind

-- | Represents a single variable definition associating an identifier (`Ident`) 
-- | with its value (`Expr a`). The `a` holds the annotations (like `Meta` or SourceSpans).
data Binding a = Binding a Ident (Expr a)

derive instance functorBinding :: Functor Binding

data Expr a
  = ExprVar a (Qualified Ident)
  | ExprLit a (Literal (Expr a))
  | ExprConstructor a ProperName Ident (Array String)
  | ExprAccessor a (Expr a) String
  | ExprUpdate a (Expr a) (Array (Prop (Expr a)))
  | ExprAbs a Ident (Expr a)
  | ExprApp a (Expr a) (Expr a)
  | ExprCase a (Array (Expr a)) (Array (CaseAlternative a))
  | ExprLet a (Array (Bind a)) (Expr a)
  | ExprTypeApp a (Expr a) ExprType

derive instance functorExpr :: Functor Expr

-- | Represents a single branch (`case ... of`) in a pattern matching expression.
-- | 1. `Array (Binder a)`: The patterns to match against. It's an array because 
-- |    a single `case` can match on multiple values simultaneously (e.g., `case x, y of`).
-- | 2. `CaseGuard a`: The body of the branch, which might be protected by boolean guard clauses.
data CaseAlternative a = CaseAlternative (Array (Binder a)) (CaseGuard a)

derive instance functorCaseAlternative :: Functor CaseAlternative

-- | Represents the right-hand side of a case alternative.
data CaseGuard a
  -- | A standard pattern match branch with no guards. If the pattern matches, this expression is evaluated.
  -- | Ex: `Just x -> x + 1`
  = Unconditional (Expr a)
  -- | A branch protected by one or more boolean guards.
  -- | Ex: 
  -- | ```purescript
  -- | Just x | x > 0 -> x
  -- |        | otherwise -> 0
  -- | ```
  | Guarded (Array (Guard a))

derive instance functorCaseGuard :: Functor CaseGuard

-- | Represents a single guarded expression within a `Guarded` branch.
-- | 1. `Expr a`: The boolean condition (the guard itself, e.g., `x > 0`).
-- | 2. `Expr a`: The expression to evaluate if the condition is true.
data Guard a = Guard (Expr a) (Expr a)

derive instance functorGuard :: Functor Guard

data Prop a = Prop String a

derive instance Eq a => Eq (Prop a)
derive instance functorProp :: Functor Prop

instance foldableProp :: Foldable Prop where
  foldl k a (Prop _ b) = k a b
  foldr k b (Prop _ a) = k a b
  foldMap k (Prop _ a) = k a

instance traversableProp :: Traversable Prop where
  traverse k (Prop str a) = Prop str <$> k a
  sequence (Prop str a) = Prop str <$> a

propKey :: forall a. Prop a -> String
propKey (Prop k _) = k

propValue :: forall a. Prop a -> a
propValue (Prop _ a) = a

findProp :: forall a. String -> Array (Prop a) -> Maybe a
findProp prop = Array.findMap (\(Prop k v) -> if prop == k then Just v else Nothing)

data Literal a
  = LitInt Int
  | LitNumber Number
  | LitString String
  | LitChar Char
  | LitBoolean Boolean
  | LitArray (Array a)
  | LitRecord (Array (Prop a))

derive instance Eq a => Eq (Literal a)
derive instance Functor Literal

instance foldableLiteral :: Foldable Literal where
  foldl k = foldlDefault k
  foldr k = foldrDefault k
  foldMap k = case _ of
    LitArray as -> foldMap k as
    LitRecord ps -> foldMap (foldMap k) ps
    _ -> mempty

instance traversableLiteral :: Traversable Literal where
  traverse k = case _ of
    LitArray as -> LitArray <$> traverse k as
    LitRecord ps -> LitRecord <$> traverse (traverse k) ps
    LitInt a -> pure (LitInt a)
    LitNumber a -> pure (LitNumber a)
    LitString a -> pure (LitString a)
    LitChar a -> pure (LitChar a)
    LitBoolean a -> pure (LitBoolean a)
  sequence a = sequenceDefault a

-- | Represents a pattern in a pattern matching expression (`case ... of` or `\pattern -> ...`).
-- | The `a` type variable holds annotations (like `SourceSpan` or `Meta`).
data Binder a
  -- | A wildcard pattern that matches anything and discards it.
  -- | Ex: `_ -> ...`
  = BinderNull a

  -- | A variable pattern that binds the matched value to an identifier.
  -- | Ex: `x -> x + 1`
  | BinderVar a Ident

  -- | A named pattern (also known as an "as-pattern" or "alias pattern").
  -- | It binds the entire matched value to an identifier, while still matching the inner sub-pattern.
  -- | Ex: `arr@[x, y] -> ...` (Here `arr` is the `Ident`, and `[x, y]` is the inner `Binder a`)
  | BinderNamed a Ident (Binder a)

  -- | A literal pattern (e.g., matching on a specific string, number, array, or record shape).
  -- | Ex: `42 -> ...` or `{ name: "John" } -> ...`
  | BinderLit a (Literal (Binder a))

  -- | A constructor pattern (matching on an Algebraic Data Type).
  -- | 1. `Qualified ProperName`: The fully qualified name of the Type being matched (e.g., `Data.Either.Either`).
  -- | 2. `Qualified Ident`: The fully qualified name of the Constructor being matched (e.g., `Data.Either.Left`).
  -- | 3. `Array (Binder a)`: The nested patterns to extract the constructor's arguments.
  -- | 
  -- | Ex: For the pattern `Left e -> ...`
  -- | - `ProperName` = `Data.Either.Either`
  -- | - `Ident`      = `Data.Either.Left`
  -- | - `Array`      = `[ BinderVar "e" ]`
  -- | 
  -- | Ex: For the pattern `Tuple x 42 -> ...`
  -- | - `ProperName` = `Data.Tuple.Tuple`
  -- | - `Ident`      = `Data.Tuple.Tuple`
  -- | - `Array`      = `[ BinderVar "x", BinderLit (LitInt 42) ]`
  | BinderConstructor a (Qualified ProperName) (Qualified Ident) (Array (Binder a))

derive instance functorBinder :: Functor Binder

emptySpan :: SourceSpan
emptySpan = { path: "<internal>", start: zero, end: zero }

exprAnn :: forall a. Expr a -> a
exprAnn = case _ of
  ExprVar a _ -> a
  ExprLit a _ -> a
  ExprConstructor a _ _ _ -> a
  ExprAccessor a _ _ -> a
  ExprUpdate a _ _ -> a
  ExprAbs a _ _ -> a
  ExprApp a _ _ -> a
  ExprCase a _ _ -> a
  ExprLet a _ _ -> a
  ExprTypeApp a _ _ -> a

isPrimModule :: ModuleName -> Boolean
isPrimModule (ModuleName name) = name == "Prim" || SCU.take 5 name == "Prim."

binderAnn :: forall a. Binder a -> a
binderAnn = case _ of
  BinderNull a -> a
  BinderVar a _ -> a
  BinderNamed a _ _ -> a
  BinderLit a _ -> a
  BinderConstructor a _ _ _ -> a
