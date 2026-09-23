module PureScript.Backend.Optimizer.CoreFn.TypeTable where

import Prelude
import Control.Monad.ST as ST
import Control.Monad.ST.Ref as STRef
import Data.Argonaut (Json, JsonDecodeError(..), caseJson, isNull)
import Data.Array as Array
import Data.Array.ST as STArray
import Data.Either (Either(..), note)
import Data.Int as Int
import Data.Maybe (Maybe(..), fromMaybe)
import Data.Traversable (traverse, sequence)
import Data.Tuple (Tuple(..))
import Foreign.Object as Object
import Foreign.Object (Object)
import Partial.Unsafe (unsafePartial)

import PureScript.Backend.Optimizer.CoreFn (ExprType(..))

type JsonDecode = Either JsonDecodeError

fail :: forall a b. a -> JsonDecode b
fail _ = Left (TypeMismatch "Failed decode")

decodeString :: Json -> JsonDecode String
decodeString = caseJson fail fail fail Right fail fail

decodeNumber :: Json -> JsonDecode Number
decodeNumber = caseJson fail fail Right fail fail fail

decodeInt :: Json -> JsonDecode Int
decodeInt json = do
  num <- decodeNumber json
  note (TypeMismatch "Int") (Int.fromNumber num)

decodeJObject :: Json -> JsonDecode (Object Json)
decodeJObject = caseJson fail fail fail fail fail Right

decodeJArray :: Json -> JsonDecode (Array Json)
decodeJArray = caseJson fail fail fail fail Right fail

getField :: forall a. (Json -> JsonDecode a) -> Object Json -> String -> JsonDecode a
getField decode obj prop =
  case Object.lookup prop obj of
    Nothing -> Left $ AtKey prop MissingValue
    Just json -> case decode json of
      Right a -> Right a
      Left e -> Left (AtKey prop e)

getFieldOptional' :: forall a. (Json -> JsonDecode a) -> Object Json -> String -> JsonDecode (Maybe a)
getFieldOptional' decode obj prop = do
  case Object.lookup prop obj of
    Nothing -> Right Nothing
    Just json -> if isNull json then Right Nothing else Just <$> decode json

decodeArray :: forall a. (Json -> JsonDecode a) -> Json -> JsonDecode (Array a)
decodeArray decoder json = case decodeJArray json of
  Left err -> Left err
  Right arr -> traverse decoder arr

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

-- JSON fields are decoded once; resolving references may need several rounds.
-- Keep errors in later fields deferred where the original decoder first waited
-- for an earlier reference (TypeApp constructor, Row fields, constraints).
data TypeRef
  = StaticRef ExprType
  | AdtRef String (Array String) (Array Int)
  | TypeAppRef Int (JsonDecode (Array Int))
  | FuncRef (Array Int) Int
  | ArrayRef Int
  | RecordRef Int
  | RowRef (Array FieldRef) (JsonDecode (Maybe Int))
  | ForAllRef (Array String) Int
  | ConstrainedRef (Array ConstraintRef) (JsonDecode Int)

decodeTypeRef :: Json -> JsonDecode TypeRef
decodeTypeRef j = case decodeString j of
  Right "Int" -> Right (StaticRef Int)
  Right "Number" -> Right (StaticRef Number)
  Right "String" -> Right (StaticRef String)
  Right "Char" -> Right (StaticRef Char)
  Right "Boolean" -> Right (StaticRef Boolean)
  Right "Unit" -> Right (StaticRef Unit)
  Right "Any" -> Right (StaticRef Any)
  Right _ -> Left (TypeMismatch "ExprType")
  Left _ -> case decodeJObject j of
    Left _ -> Left (TypeMismatch "ExprType")
    Right o -> case getField decodeString o "type" of
      Left err -> case Object.lookup "TypeVar" o of
        Just tvJson -> StaticRef <<< TypeVar <$> decodeString tvJson
        Nothing -> Left err
      Right "Adt" -> do
        fqn <- getField (decodeArray decodeString) o "fqn"
        args <- getField (decodeArray decodeInt) o "args"
        pure (AdtRef (Array.intercalate "." fqn) fqn args)
      Right "TypeApp" -> do
        constructor <- getField decodeInt o "constructor"
        pure (TypeAppRef constructor (getField (decodeArray decodeInt) o "args"))
      Right "Func" -> do
        args <- getField (decodeArray decodeInt) o "args"
        ret <- getField decodeInt o "ret"
        pure (FuncRef args ret)
      Right "Array" -> ArrayRef <$> getField decodeInt o "element"
      Right "TypeVar" -> StaticRef <<< TypeVar <$> getField decodeString o "name"
      Right "Record" -> RecordRef <$> getField decodeInt o "row"
      Right "Row" -> do
        fields <- getField (decodeArray decodeFieldRef) o "fields"
        pure (RowRef fields (getFieldOptional' decodeInt o "tail"))
      Right "ForAll" -> do
        vars <- getField (decodeArray decodeString) o "vars"
        body <- getField decodeInt o "body"
        pure (ForAllRef vars body)
      Right "ConstrainedType" -> do
        constraints <- getField (decodeArray decodeConstraintRef) o "constraints"
        pure (ConstrainedRef constraints (getField decodeInt o "body"))
      Right "TypeLevelString" -> StaticRef <<< TypeLevelString <$> getField decodeString o "value"
      Right "Int" -> Right (StaticRef Int)
      Right "Number" -> Right (StaticRef Number)
      Right "String" -> Right (StaticRef String)
      Right "Char" -> Right (StaticRef Char)
      Right "Boolean" -> Right (StaticRef Boolean)
      Right "Unit" -> Right (StaticRef Unit)
      Right "Any" -> Right (StaticRef Any)
      _ -> Left (TypeMismatch "ExprType")

-- JavaScript entry point for the native decoder boundary: the Go backend
-- resolves the table directly, while the JS bundle keeps this validated
-- algorithm.
decodeTypeTablePS :: Array Json -> Either JsonDecodeError (Array ExprType)
decodeTypeTablePS typeTableJson =
  case ST.run (decodeTypeTableST typeTableJson) of
    Left err -> Left err
    Right val -> Right val

decodeTypeTableST :: forall r. Array Json -> ST.ST r (Either JsonDecodeError (Array ExprType))
decodeTypeTableST typeTableJson = do
  resArray <- STArray.thaw (Array.replicate (Array.length typeTableJson) Nothing)
  
  let
    resolveId force id = do
      resolved <- STArray.peek id resArray
      case resolved of
        Just (Just val) -> pure (Just val)
        _ -> if force then pure (Just (Right Any)) else pure Nothing

    resolveArgs force args = do
      values <- STArray.new
      waiting <- STRef.new false
      firstError <- STRef.new Nothing
      unsafePartial $ ST.for 0 (Array.length args) \ix -> do
        resolved <- resolveId force (Array.unsafeIndex args ix)
        case resolved of
          Nothing -> do
            _ <- STRef.write true waiting
            pure unit
          Just (Left err) -> do
            previous <- STRef.read firstError
            case previous of
              Nothing -> do
                _ <- STRef.write (Just err) firstError
                pure unit
              Just _ -> pure unit
          Just (Right value) -> do
            _ <- STArray.push value values
            pure unit
      -- sequence Maybe used to precede sequence Either: any pending reference
      -- delays the result, even when an earlier argument already has an error.
      pendingArgs <- STRef.read waiting
      if pendingArgs then pure Nothing
      else do
        error <- STRef.read firstError
        case error of
          Just err -> pure $ Just (Left err)
          Nothing -> do
            result <- STArray.unsafeFreeze values
            pure $ Just (Right result)

    resolveType force ref = case ref of
      Left err -> pure $ Just (Left err)
      Right (StaticRef typ) -> pure $ Just (Right typ)
      Right (AdtRef name fqn args) -> do
        mbArgs <- resolveArgs force args
        pure $ map (map (ADT name fqn)) mbArgs
      Right (TypeAppRef cId argsResult) -> do
        mbC <- resolveId force cId
        case mbC of
          Nothing -> pure Nothing
          Just (Left err) -> pure $ Just (Left err)
          Just (Right c) -> case argsResult of
            Left err -> pure $ Just (Left err)
            Right args -> do
              mbArgs <- resolveArgs force args
              pure $ map (map (TypeApp c)) mbArgs
      Right (FuncRef args retId) -> do
        mbArgs <- resolveArgs force args
        mbRet <- resolveId force retId
        case mbArgs, mbRet of
          Just (Left err), _ -> pure $ Just (Left err)
          _, Just (Left err) -> pure $ Just (Left err)
          Just (Right a), Just (Right r) -> pure $ Just (Right (Func a r))
          _, _ -> pure Nothing
      Right (ArrayRef elId) -> do
        mbEl <- resolveId force elId
        pure $ map (map Array) mbEl
      Right (RecordRef rowId) -> do
        mbRow <- resolveId force rowId
        pure $ map (map Record) mbRow
      Right (RowRef fieldRefs tailResult) -> do
        mbFields <- sequence <$> traverse (\{label, typeId} -> do
          mbT <- resolveId force typeId
          case mbT of
            Nothing -> pure Nothing
            Just (Left err) -> pure $ Just (Left err)
            Just (Right t) -> pure $ Just (Right (Tuple label t))
          ) fieldRefs
        case mbFields of
          Nothing -> pure Nothing
          Just vals -> case sequence vals of
            Left err -> pure $ Just (Left err)
            Right fields -> case tailResult of
              Left err -> pure $ Just (Left err)
              Right Nothing -> pure $ Just (Right (Row fields Nothing))
              Right (Just tailId) -> do
                mbTail <- resolveId force tailId
                case mbTail of
                  Nothing -> pure Nothing
                  Just (Left err) -> pure $ Just (Left err)
                  Just (Right tailT) -> pure $ Just (Right (Row fields (Just tailT)))
      Right (ForAllRef vars bodyId) -> do
        mbBody <- resolveId force bodyId
        pure $ map (map (ForAll vars)) mbBody
      Right (ConstrainedRef constraintRefs bodyResult) -> do
        mbConsts <- sequence <$> traverse (\{fqn, args} -> do
          mbArgs <- resolveArgs force args
          case mbArgs of
            Nothing -> pure Nothing
            Just (Left err) -> pure $ Just (Left err)
            Just (Right a) -> pure $ Just (Right (Tuple fqn a))
          ) constraintRefs
        case mbConsts of
          Nothing -> pure Nothing
          Just vals -> case sequence vals of
            Left err -> pure $ Just (Left err)
            Right consts -> case bodyResult of
              Left err -> pure $ Just (Left err)
              Right bodyId -> do
                mbBody <- resolveId force bodyId
                pure $ map (map (ConstrainedType consts)) mbBody

  let typeRefs = map decodeTypeRef typeTableJson

  -- Keep unresolved indices in the same ascending order as the full scans.
  -- A resolved entry never becomes pending again, including a decode error.
  pending <- STRef.new (Array.mapWithIndex (\ix _ -> ix) typeTableJson)
  let
    settle = do
      changed <- STRef.new true
      ST.while (STRef.read changed) do
        indices <- STRef.read pending
        next <- STArray.new
        ST.for 0 (Array.length indices) \pos -> do
          let
            ix = unsafePartial (Array.unsafeIndex indices pos)
            ref = unsafePartial (Array.unsafeIndex typeRefs ix)
          mbVal <- resolveType false ref
          case mbVal of
            Just val -> do
              _ <- STArray.poke ix (Just val) resArray
              pure unit
            Nothing -> do
              _ <- STArray.push ix next
              pure unit
        remaining <- STArray.unsafeFreeze next
        _ <- STRef.write remaining pending
        _ <- STRef.write (Array.length remaining < Array.length indices) changed
        pure unit

  settle
  ST.while (not <<< Array.null <$> STRef.read pending) do
    indices <- STRef.read pending
    case Array.uncons indices of
      Nothing -> pure unit
      Just { head: ix, tail } -> do
        -- Only force the first unresolved index after reaching the fixed point.
        let ref = unsafePartial (Array.unsafeIndex typeRefs ix)
        val <- resolveType true ref
        _ <- STArray.poke ix (Just (fromMaybe (Left (TypeMismatch "Cycle")) val)) resArray
        _ <- STRef.write tail pending
        settle

  finalRes <- STArray.freeze resArray
  let
    extract = case _ of
      Just result -> result
      Nothing -> Left (TypeMismatch "Unresolved Type (Cycle Deadlock)")
  pure (traverse extract finalRes)
