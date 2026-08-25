-- | Parseur JSON CoreFn (Json.purs)
-- | La couche de désérialisation. Convertit les fichiers corefn.json émis par purs compile en structures de données PureScript (définies dans CoreFn.purs) utilisables en mémoire par l'optimiseur.

-- @inline Data.Argonaut.Core.caseJson always
module PureScript.Backend.Optimizer.CoreFn.Json
  ( decodeAnn
  , decodeInt
  , decodeModule
  , decodeModule'
  )
  where

import Prelude hiding (bind)

import Control.Alternative (guard)
import Control.Monad.Error.Class (throwError)
import Control.Monad.ST as ST
import Control.Monad.ST.Ref as STRef
import Data.Argonaut (Json, JsonDecodeError(..), caseJson, decodeJson, isNull)
import Data.Array as Array
import Data.Array.ST as STArray
import Data.Either (Either(..), note)
import Data.Enum (toEnum)
import Data.Foldable (intercalate)
import Data.Int as Int
import Data.Map as Map
import Data.Maybe (Maybe(..), fromMaybe)
import Data.String.CodePoints (CodePoint, fromCodePointArray)
import Data.String.CodeUnits as SCU
import Data.Traversable (traverse, sequence)
import Data.Tuple (Tuple(..))
import Foreign.Object (Object)
import Foreign.Object as Object
import Partial.Unsafe (unsafePartial)
import Prelude as Prelude
import PureScript.Backend.Optimizer.CoreFn.TypeTable (decodeTypeTableST)
import PureScript.Backend.Optimizer.CoreFn (Ann(..), Bind(..), Binder(..), Binding(..), CaseAlternative(..), CaseGuard(..), ClassDecl, Comment(..), ConstructorType(..), DataConstructor, DataDecl, Expr(..), ExprType(..), Guard(..), Ident(..), Import(..), Literal(..), Meta(..), Module(..), ModuleName(..), Prop(..), ProperName(..), Qualified(..), ReExport(..), SourcePos, SourceSpan, emptySpan)
import Safe.Coerce (coerce)
import Unsafe.Coerce (unsafeCoerce)

type JsonDecode = Either JsonDecodeError

infixr 2 alt as <|>

alt :: forall e a. Either e a -> (Unit -> Either e a) -> Either e a
alt a k = case a of
  Left _ -> k unit
  Right _ -> a

-- Either's bind implementation is not ideal from an optimization
-- standpoint and generates awkward code.
bind :: forall e a b. Either e a -> (a -> Either e b) -> Either e b
bind a k = case a of
  Left err ->
    Left err
  Right a' ->
    k a'

decodeSourcePos :: Json -> JsonDecode SourcePos
decodeSourcePos json = do
  Tuple line column <- decodeJson json
  pure { line, column }

decodeSourceSpan :: String -> Json -> JsonDecode SourceSpan
decodeSourceSpan path json = do
  obj <- decodeJObject json
  start <- getField decodeSourcePos obj "start"
  end <- getField decodeSourcePos obj "end"
  pure { path, start, end }

decodeConstructorType :: Json -> JsonDecode ConstructorType
decodeConstructorType json = do
  str <- decodeString json
  case str of
    "ProductType" -> pure ProductType
    "SumType" -> pure SumType
    _ -> throwError $ TypeMismatch "ConstructorType"

decodeIdent :: Json -> JsonDecode Ident
decodeIdent = coerce decodeString

decodeProperName :: Json -> JsonDecode ProperName
decodeProperName = coerce decodeString

decodeModuleName :: Json -> JsonDecode ModuleName
decodeModuleName = map (ModuleName <<< intercalate ".") <<< decodeArray decodeString

decodeQualified :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Qualified a)
decodeQualified k json = do
  obj <- decodeJObject json
  moduleName <- getFieldOptional' decodeModuleName obj "moduleName"
  identifier <- getField k obj "identifier"
  pure $ Qualified moduleName identifier

decodeMeta :: Json -> JsonDecode Meta
decodeMeta json = do
  obj <- decodeJObject json
  typ <- getField decodeString obj "metaType"
  case typ of
    "IsConstructor" -> do
      ct <- getField decodeConstructorType obj "constructorType"
      is <- getField (decodeArray decodeIdent) obj "identifiers"
      pure $ IsConstructor ct is
    "IsNewtype" ->
      pure IsNewtype
    "IsTypeClassConstructor" ->
      pure IsTypeClassConstructor
    "IsForeign" ->
      pure IsForeign
    "IsWhere" ->
      pure IsWhere
    "IsSyntheticApp" ->
      pure IsSyntheticApp
    _ ->
      throwError $ TypeMismatch "Meta"




decodeTypeTable :: Json -> JsonDecode (Array ExprType)
decodeTypeTable json = do
  typeTableJson <- decodeJArray json
  case ST.run (decodeTypeTableST typeTableJson) of
    Left err -> Left err
    Right val -> Right val


type FieldRef = { label :: String, typeId :: Int }

decodeFieldRef :: Json -> JsonDecode FieldRef
decodeFieldRef j = do
  o <- decodeJObject j
  label <- getField decodeString o "label"
  typeId <- getField decodeInt o "type"
  pure { label, typeId }

type ConstraintRef = { fqn :: Array String, args :: Array Int }

decodeConstraintRef :: Json -> JsonDecode ConstraintRef
decodeConstraintRef j = do
  o <- decodeJObject j
  fqn <- getField (decodeArray decodeString) o "fqn"
  args <- getField (decodeArray decodeInt) o "args"
  pure { fqn, args }
decodeField :: Array ExprType -> Json -> JsonDecode (Tuple String ExprType)
decodeField tt j = do
  o <- decodeJObject j
  l <- getField decodeString o "label"
  tId <- getField decodeInt o "type"
  t <- note (TypeMismatch "FieldType") (Array.index tt tId)
  pure (Tuple l t)

decodeMethod :: Array ExprType -> Json -> JsonDecode (Tuple String ExprType)
decodeMethod tt j = do
  o <- decodeJObject j
  name <- getField decodeString o "name"
  tId <- getField decodeInt o "type"
  t <- note (TypeMismatch "MethodType") (Array.index tt tId)
  pure (Tuple name t)

decodeConstraint :: Array ExprType -> Json -> JsonDecode (Tuple (Array String) (Array ExprType))
decodeConstraint tt j = do
  o <- decodeJObject j
  fqn <- getField (decodeArray decodeString) o "fqn"
  argsIds <- getField (decodeArray decodeInt) o "args"
  args <- traverse (\i -> note (TypeMismatch "ConstraintArg") (Array.index tt i)) argsIds
  pure (Tuple fqn args)

decodeAnn :: Array ExprType -> String -> Json -> JsonDecode Ann
decodeAnn typeTable _path json = do
  obj <- decodeJObject json
  -- Currently disabled because spans are not used and are a performance drain.
  -- span <- getField (decodeSourceSpan path) obj "sourceSpan"
  meta <- getFieldOptional' decodeMeta obj "meta"
  
  typeId <- getFieldOptional' decodeInt obj "type"
  let type_ = case typeId of
                Just id -> Array.index typeTable id
                Nothing -> Nothing
                
  pure $ Ann { span: emptySpan, meta, type: type_ }

decodeImport :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Import a)
decodeImport decodeAnn' json = do
  obj <- decodeJObject json
  ann <- getField decodeAnn' obj "annotation"
  mod <- getField decodeModuleName obj "moduleName"
  pure $ Import ann mod

decodeDataConstructor :: Array ExprType -> Json -> JsonDecode DataConstructor
decodeDataConstructor tt json = do
  obj <- decodeJObject json
  name <- getField decodeString obj "name" <|> \_ -> getField decodeString obj "constructorName"
  fieldIds <- getField (decodeArray decodeInt) obj "fields" <|> \_ -> getField (decodeArray decodeInt) obj "fieldTypes"
  fields <- traverse (\i -> note (TypeMismatch "ConstructorField") (Array.index tt i)) fieldIds
  pure { name, fields }

decodeDataDecl :: Array ExprType -> Json -> JsonDecode DataDecl
decodeDataDecl tt json = do
  obj <- decodeJObject json
  name <- getField decodeString obj "name" <|> \_ -> getField decodeString obj "typeName"
  mbTypeVars <- getFieldOptional' (decodeArray decodeString) obj "vars" <|> \_ -> getFieldOptional' (decodeArray decodeString) obj "typeVars"
  let vars = fromMaybe [] mbTypeVars
  constructors <- getField (decodeArray (decodeDataConstructor tt)) obj "constructors"
  pure { name, vars, constructors }

decodeClassDecl :: Array ExprType -> Json -> JsonDecode ClassDecl
decodeClassDecl tt json = do
  obj <- decodeJObject json
  name <- getField decodeString obj "name"
  mbVars <- getFieldOptional' (decodeArray decodeString) obj "vars"
  let vars = fromMaybe [] mbVars
  superclasses <- getField (decodeArray (decodeConstraint tt)) obj "superclasses"
  methods <- getField (decodeArray (decodeMethod tt)) obj "methods"
  pure { name, vars, superclasses, methods }

decodeModule :: Json -> JsonDecode (Module Ann)
decodeModule = decodeModule' decodeAnn

decodeModule' :: forall a. (Array ExprType -> String -> Json -> JsonDecode a) -> Json -> JsonDecode (Module a)
decodeModule' decodeAnn' json = do
  obj <- decodeJObject json
  typeTable <- fromMaybe [] <$> getFieldOptional' decodeTypeTable obj "typeTable"
  name <- getField decodeModuleName obj "moduleName"
  path <- getField decodeString obj "modulePath"
  span <- getField (decodeSourceSpan path) obj "sourceSpan"
  imports <- getField (decodeArray (decodeImport (decodeAnn' typeTable path))) obj "imports"
  exports <- getField (decodeArray decodeIdent) obj "exports"
  reExports <- getField decodeReExports obj "reExports"
  mbDataDecls <- getFieldOptional' (decodeArray (decodeDataDecl typeTable)) obj "dataDecls"
  let dataDecls = fromMaybe [] mbDataDecls
  mbClassDecls <- getFieldOptional' (decodeArray (decodeClassDecl typeTable)) obj "classDecls"
  let classDecls = fromMaybe [] mbClassDecls
  decls <- getField (decodeArray (decodeBind typeTable (decodeAnn' typeTable path))) obj "decls"
  foreign_arr <- getField (decodeArray decodeIdent) obj "foreign"
  foreign_anns <- fromMaybe Object.empty <$> getFieldOptional' decodeJObject obj "foreignAnnotations"
  foreign_list <- traverse (\ident@(Ident identName) ->
    case Object.lookup identName foreign_anns of
      Just annJson -> do
        Ann { type: type_ } <- decodeAnn typeTable path annJson
        pure (Tuple ident type_)
      Nothing ->
        pure (Tuple ident Nothing)
    ) foreign_arr
  let foreignMap = Map.fromFoldable foreign_list
  comments <- getField (decodeArray decodeComment) obj "comments"
  pure $ Module
    { name
    , path
    , span
    , imports
    , exports
    , reExports
    , dataDecls
    , classDecls
    , decls
    , foreign: foreignMap
    , comments
    }

decodeReExports :: Json -> JsonDecode (Array ReExport)
decodeReExports json = do
  obj <- decodeJObject json
  all <- traverse (traverse (decodeArray decodeIdent)) $ Object.toArrayWithKey Tuple obj
  pure $ all >>= \(Tuple mn idents) -> ReExport (ModuleName mn) <$> idents

decodeBind :: forall a. Array ExprType -> (Json -> JsonDecode a) -> Json -> JsonDecode (Bind a)
decodeBind tt decAnn json = do
  obj <- decodeJObject json
  typ <- getField decodeString obj "bindType"
  case typ of
    "NonRec" -> NonRec <$> decodeBinding tt decAnn obj
    "Rec" -> Rec <$> getField (decodeArray (decodeJObject >=> decodeBinding tt decAnn)) obj "binds"
    _ -> throwError $ TypeMismatch "Bind"

decodeBinding :: forall a. Array ExprType -> (Json -> JsonDecode a) -> Object Json -> JsonDecode (Binding a)
decodeBinding tt decAnn obj = do
  ann <- getField decAnn obj "annotation"
  ident <- getField decodeIdent obj "identifier"
  expr <- getField (decodeExpr tt decAnn) obj "expression"
  pure $ Binding ann ident expr

decodeExpr :: forall a. Array ExprType -> (Json -> JsonDecode a) -> Json -> JsonDecode (Expr a)
decodeExpr tt decAnn json = do
  obj <- decodeJObject json
  ann <- getField decAnn obj "annotation"
  typ <- getField decodeString obj "type"
  case typ of
    "Var" ->
      ExprVar ann <$> getField (decodeQualified decodeIdent) obj "value"
    "Literal" ->
      ExprLit ann <$> getField (decodeLiteral (decodeExpr tt decAnn)) obj "value"
    "Constructor" -> do
      tyn <- getField decodeProperName obj "typeName"
      con <- getField decodeIdent obj "name" <|> \_ -> getField decodeIdent obj "constructorName"
      is <- getField (decodeArray decodeStringLiteral) obj "fields" <|> \_ -> getField (decodeArray decodeStringLiteral) obj "fieldNames"
      pure $ ExprConstructor ann tyn con is
    "Accessor" -> do
      e <- getField (decodeExpr tt decAnn) obj "expression"
      f <- getField decodeStringLiteral obj "fieldName"
      pure $ ExprAccessor ann e f
    "ObjectUpdate" -> do
      e <- getField (decodeExpr tt decAnn) obj "expression"
      us <- getField (decodeRecord (decodeExpr tt decAnn)) obj "updates"
      pure $ ExprUpdate ann e us
    "Abs" -> do
      idn <- getField decodeIdent obj "argument"
      e <- getField (decodeExpr tt decAnn) obj "body"
      pure $ ExprAbs ann idn e
    "App" -> do
      e1 <- getField (decodeExpr tt decAnn) obj "abstraction"
      e2 <- getField (decodeExpr tt decAnn) obj "argument"
      pure $ ExprApp ann e1 e2
    "TypeApp" -> do
      e <- getField (decodeExpr tt decAnn) obj "expression"
      tId <- getField decodeInt obj "typeArgument"
      t <- note (TypeMismatch "ExprTypeApp") (Array.index tt tId)
      pure $ ExprTypeApp ann e t
    "Case" -> do
      cs <- getField (decodeArray (decodeExpr tt decAnn)) obj "caseExpressions"
      cas <- getField (decodeArray (decodeCaseAlternative tt decAnn)) obj "caseAlternatives"
      pure $ ExprCase ann cs cas
    "Let" -> do
      bs <- getField (decodeArray (decodeBind tt decAnn)) obj "binds"
      e <- getField (decodeExpr tt decAnn) obj "expression"
      pure $ ExprLet ann bs e
    _ ->
      throwError $ TypeMismatch "Expr"

decodeCaseAlternative :: forall a. Array ExprType -> (Json -> JsonDecode a) -> Json -> JsonDecode (CaseAlternative a)
decodeCaseAlternative tt decAnn json = do
  obj <- decodeJObject json
  binders <- getField (decodeArray (decodeBinder decAnn)) obj "binders"
  isGuarded <- getField decodeBoolean obj "isGuarded"
  if isGuarded then do
    es <- getField (decodeArray (decodeGuard tt decAnn)) obj "expressions"
    pure $ CaseAlternative binders (Guarded es)
  else do
    e <- getField (decodeExpr tt decAnn) obj "expression"
    pure $ CaseAlternative binders (Unconditional e)

decodeGuard :: forall a. Array ExprType -> (Json -> JsonDecode a) -> Json -> JsonDecode (Guard a)
decodeGuard tt decAnn json = do
  obj <- decodeJObject json
  guard <- getField (decodeExpr tt decAnn) obj "guard"
  expr <- getField (decodeExpr tt decAnn) obj "expression"
  pure $ Guard guard expr

decodeBinder :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Binder a)
decodeBinder decAnn json = do
  obj <- decodeJObject json
  ann <- getField decAnn obj "annotation"
  typ <- getField decodeString obj "binderType"
  case typ of
    "NullBinder" ->
      pure $ BinderNull ann
    "VarBinder" ->
      BinderVar ann <$> getField decodeIdent obj "identifier"
    "LiteralBinder" ->
      BinderLit ann <$> getField (decodeLiteral (decodeBinder decAnn)) obj "literal"
    "ConstructorBinder" -> do
      tyn <- getField (decodeQualified decodeProperName) obj "typeName"
      ctn <- getField (decodeQualified decodeIdent) obj "name" <|> \_ -> getField (decodeQualified decodeIdent) obj "constructorName"
      binders <- getField (decodeArray (decodeBinder decAnn)) obj "binders"
      pure $ BinderConstructor ann tyn ctn binders
    "NamedBinder" -> do
      ident <- getField decodeIdent obj "identifier"
      binder <- getField (decodeBinder decAnn) obj "binder"
      pure $ BinderNamed ann ident binder
    _ ->
      throwError $ TypeMismatch "Binder"

decodeLiteral :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Literal a)
decodeLiteral dec json = do
  obj <- decodeJObject json
  typ <- getField decodeString obj "literalType"
  case typ of
    "IntLiteral" ->
      LitInt <$> getField decodeInt obj "value"
    "NumberLiteral" ->
      LitNumber <$> getField decodeNumber obj "value"
    "StringLiteral" ->
      LitString <$> getField decodeStringLiteral obj "value"
    "CharLiteral" -> do
      str <- getField decodeString obj "value"
      LitChar <$> note (TypeMismatch "Char") do
        guard (SCU.length str == 1)
        Array.head $ SCU.toCharArray str
    "BooleanLiteral" ->
      LitBoolean <$> getField decodeBoolean obj "value"
    "ArrayLiteral" ->
      LitArray <$> getField (decodeArray dec) obj "value"
    "ObjectLiteral" ->
      LitRecord <$> getField (decodeRecord dec) obj "value"
    _ ->
      throwError $ TypeMismatch "Literal"

decodeRecord :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Array (Prop a))
decodeRecord = decodeArray <<< decodeProp
  where
  decodeProp decoder json = do
    arr <- decodeJArray json
    case arr of
      [ a, b ] -> do
        prop <- decodeStringLiteral a
        value <- decoder b
        pure $ Prop prop value
      _ ->
        Left $ TypeMismatch "Tuple"

decodeComment :: Json -> JsonDecode Comment
decodeComment json = do
  obj <- decodeJObject json
  LineComment <$> getField decodeString obj "LineComment"
    <|> \_ -> BlockComment <$> getField decodeString obj "BlockComment"

decodeArray :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Array a)
decodeArray decoder json = case decodeJArray json of
  Left err ->
    Left err
  Right arr -> ST.run Prelude.do
    out <- STArray.new
    ix <- STRef.new 0
    con <- STRef.new true
    res <- STRef.new (unsafeCoerce unit)
    let len = Array.length arr
    ST.while (STRef.read con) Prelude.do
      ix' <- STRef.read ix
      if ix' == len then Prelude.do
        out' <- STArray.unsafeFreeze out
        _ <- STRef.write false con
        _ <- STRef.write (Right out') res
        pure unit
      else
        case decoder (unsafePartial (Array.unsafeIndex arr ix')) of
          Left err -> Prelude.do
            _ <- STRef.write false con
            _ <- STRef.write (Left (AtIndex ix' err)) res
            pure unit
          Right val -> Prelude.do
            _ <- STArray.push val out
            _ <- STRef.write (ix' + 1) ix
            pure unit
    STRef.read res

getField :: forall a. (Json -> JsonDecode a) -> Object Json -> String -> JsonDecode a
getField decode obj prop =
  case Object.lookup prop obj of
    Nothing ->
      Left $ AtKey prop MissingValue
    Just json ->
      decode json

getFieldOptional' :: forall a. (Json -> JsonDecode a) -> Object Json -> String -> JsonDecode (Maybe a)
getFieldOptional' decode obj prop = do
  case Object.lookup prop obj of
    Nothing ->
      Right Nothing
    Just json
      | isNull json ->
          Right Nothing
      | otherwise ->
          Just <$> decode json

decodeJObject :: Json -> JsonDecode (Object Json)
decodeJObject = caseJson fail fail fail fail fail Right
  where
  fail :: forall a. a -> JsonDecode (Object Json)
  fail _ = Left $ TypeMismatch "Object"

decodeJArray :: Json -> JsonDecode (Array Json)
decodeJArray = caseJson fail fail fail fail Right fail
  where
  fail :: forall a. a -> JsonDecode (Array Json)
  fail _ = Left $ TypeMismatch "Array"

decodeStringLiteral :: Json -> JsonDecode String
decodeStringLiteral json =
  decodeString json <|> \_ -> map fromCodePointArray (decodeCodePointArray json) <|> \_ -> throwError (TypeMismatch "StringLiteral")

decodeString :: Json -> JsonDecode String
decodeString = caseJson fail fail fail Right fail fail
  where
  fail :: forall a. a -> JsonDecode String
  fail _ = Left $ TypeMismatch "String"

decodeCodePointArray :: Json -> JsonDecode (Array CodePoint)
decodeCodePointArray = decodeArray decodeCodePoint

decodeCodePoint :: Json -> JsonDecode CodePoint
decodeCodePoint = note (TypeMismatch "CodePoint") <<< toEnum <=< decodeInt

decodeNumber :: Json -> JsonDecode Number
decodeNumber = caseJson fail fail Right fail fail fail
  where
  fail :: forall a. a -> JsonDecode Number
  fail _ = Left $ TypeMismatch "Number"

decodeBoolean :: Json -> JsonDecode Boolean
decodeBoolean = caseJson fail Right fail fail fail fail
  where
  fail :: forall a. a -> JsonDecode Boolean
  fail _ = Left $ TypeMismatch "Boolean"

decodeInt :: Json -> JsonDecode Int
decodeInt json = do
  num <- decodeNumber json
  case Int.fromNumber num of
    Nothing ->
      if num == 2147483648.0 then
        Right bottom
      else
        Left $ TypeMismatch "Int"
    Just int ->
      Right int
