module PureScript.Backend.Optimizer.CoreFn.TypeTable where

import Prelude
import Control.Monad.ST as ST
import Control.Monad.ST.Ref as STRef
import Data.Argonaut (Json, JsonDecodeError(..), caseJson, decodeJson, isNull)
import Data.Array as Array
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

unsafeUpdateAt :: forall a. Int -> a -> Array a -> Array a
unsafeUpdateAt i x arr = fromMaybe arr (Array.updateAt i x arr)

decodeTypeTableST :: forall r. Array Json -> ST.ST r (Either JsonDecodeError (Array ExprType))
decodeTypeTableST typeTableJson = do
  resArray <- STRef.new (Array.replicate (Array.length typeTableJson) Nothing)
  
  let
    resolveId force id = do
      resE <- STRef.read resArray
      case Array.index resE id of
        Just (Just val) -> pure (Just val)
        _ -> if force then pure (Just (Right Any)) else pure Nothing

    resolveArgs force args = do
      mbVals <- sequence <$> traverse (resolveId force) args
      case mbVals of
        Nothing -> pure Nothing
        Just vals -> pure $ Just (sequence vals)

    decodeObj' force j = do
      let decStr = decodeString j
      case decStr of
        Right "Int" -> pure $ Just (Right Int)
        Right "Number" -> pure $ Just (Right Number)
        Right "String" -> pure $ Just (Right String)
        Right "Char" -> pure $ Just (Right Char)
        Right "Boolean" -> pure $ Just (Right Boolean)
        Right "Unit" -> pure $ Just (Right Unit)
        Right "Any" -> pure $ Just (Right Any)
        Right _ -> pure $ Just (Left (TypeMismatch "ExprType"))
        Left _ -> do
          case decodeJObject j of
            Left err -> pure $ Just (Left (TypeMismatch "ExprType"))
            Right o -> do
              let typRes = getField decodeString o "type"
              case typRes of
                Left err -> case Object.lookup "TypeVar" o of
                              Just tvJson -> do
                                case decodeString tvJson of
                                  Left e -> pure $ Just (Left e)
                                  Right tv -> pure $ Just (Right (TypeVar tv))
                              Nothing -> pure $ Just (Left err)
                Right "Adt" -> do
                  case getField (decodeArray decodeString) o "fqn" of
                    Left err -> pure $ Just (Left err)
                    Right fqn -> do
                      case getField (decodeArray decodeInt) o "args" of
                        Left err -> pure $ Just (Left err)
                        Right argsJson -> do
                          mbArgs <- resolveArgs force argsJson
                          pure $ map (map (\a -> ADT (Array.intercalate "." fqn) fqn a)) mbArgs
                Right "TypeApp" -> do
                  case getField decodeInt o "constructor" of
                    Left err -> pure $ Just (Left err)
                    Right cId -> do
                      mbC <- resolveId force cId
                      case mbC of
                        Nothing -> pure Nothing
                        Just (Left err) -> pure $ Just (Left err)
                        Just (Right c) -> do
                          case getField (decodeArray decodeInt) o "args" of
                            Left err -> pure $ Just (Left err)
                            Right argsJson -> do
                              mbArgs <- resolveArgs force argsJson
                              pure $ map (map (\a -> TypeApp c a)) mbArgs
                Right "Func" -> do
                  case getField (decodeArray decodeInt) o "args" of
                    Left err -> pure $ Just (Left err)
                    Right argsJson -> do
                      case getField decodeInt o "ret" of
                        Left err -> pure $ Just (Left err)
                        Right retId -> do
                          mbArgs <- resolveArgs force argsJson
                          mbRet <- resolveId force retId
                          case mbArgs, mbRet of
                            Just (Left err), _ -> pure $ Just (Left err)
                            _, Just (Left err) -> pure $ Just (Left err)
                            Just (Right a), Just (Right r) -> pure $ Just (Right (Func a r))
                            _, _ -> pure Nothing
                Right "Array" -> do
                  case getField decodeInt o "element" of
                    Left err -> pure $ Just (Left err)
                    Right elId -> do
                      mbEl <- resolveId force elId
                      pure $ map (map Array) mbEl
                Right "TypeVar" -> do
                  case getField decodeString o "name" of
                    Left err -> pure $ Just (Left err)
                    Right name -> pure $ Just (Right (TypeVar name))
                Right "Record" -> do
                  case getField decodeInt o "row" of
                    Left err -> pure $ Just (Left err)
                    Right rowId -> do
                      mbRow <- resolveId force rowId
                      pure $ map (map Record) mbRow
                Right "Row" -> do
                  case getField (decodeArray decodeFieldRef) o "fields" of
                    Left err -> pure $ Just (Left err)
                    Right fieldsJson -> do
                      let 
                        mbFields = sequence <$> traverse (\{label, typeId} -> do
                          mbT <- resolveId force typeId
                          case mbT of
                            Nothing -> pure Nothing
                            Just (Left err) -> pure $ Just (Left err)
                            Just (Right t) -> pure $ Just (Right (Tuple label t))
                          ) fieldsJson
                      mbFieldsSt <- mbFields
                      case mbFieldsSt of
                        Nothing -> pure Nothing
                        Just vals -> case sequence vals of
                          Left err -> pure $ Just (Left err)
                          Right fields -> do
                            case getFieldOptional' decodeInt o "tail" of
                              Left err -> pure $ Just (Left err)
                              Right Nothing -> pure $ Just (Right (Row fields Nothing))
                              Right (Just tailId) -> do
                                mbTail <- resolveId force tailId
                                case mbTail of
                                  Nothing -> pure Nothing
                                  Just (Left err) -> pure $ Just (Left err)
                                  Just (Right tailT) -> pure $ Just (Right (Row fields (Just tailT)))
                Right "ForAll" -> do
                  case getField (decodeArray decodeString) o "vars" of
                    Left err -> pure $ Just (Left err)
                    Right vars -> do
                      case getField decodeInt o "body" of
                        Left err -> pure $ Just (Left err)
                        Right bodyId -> do
                          mbBody <- resolveId force bodyId
                          pure $ map (map (ForAll vars)) mbBody
                Right "ConstrainedType" -> do
                  case getField (decodeArray decodeConstraintRef) o "constraints" of
                    Left err -> pure $ Just (Left err)
                    Right constsJson -> do
                      let
                        mbConsts = sequence <$> traverse (\{fqn, args} -> do
                          mbArgs <- resolveArgs force args
                          case mbArgs of
                            Nothing -> pure Nothing
                            Just (Left err) -> pure $ Just (Left err)
                            Just (Right a) -> pure $ Just (Right (Tuple fqn a))
                          ) constsJson
                      mbConstsSt <- mbConsts
                      case mbConstsSt of
                        Nothing -> pure Nothing
                        Just vals -> case sequence vals of
                          Left err -> pure $ Just (Left err)
                          Right consts -> do
                            case getField decodeInt o "body" of
                              Left err -> pure $ Just (Left err)
                              Right bodyId -> do
                                mbBody <- resolveId force bodyId
                                pure $ map (map (ConstrainedType consts)) mbBody
                Right "TypeLevelString" -> do
                  case getField decodeString o "value" of
                    Left err -> pure $ Just (Left err)
                    Right s -> pure $ Just (Right (TypeLevelString s))
                Right "Int" -> pure $ Just (Right Int)
                Right "Number" -> pure $ Just (Right Number)
                Right "String" -> pure $ Just (Right String)
                Right "Char" -> pure $ Just (Right Char)
                Right "Boolean" -> pure $ Just (Right Boolean)
                Right "Unit" -> pure $ Just (Right Unit)
                Right "Any" -> pure $ Just (Right Any)
                _ -> pure $ Just (Left (TypeMismatch "ExprType"))

  changed <- STRef.new true
  ST.while (STRef.read changed) do
    _ <- STRef.write false changed
    ST.for 0 (Array.length typeTableJson) \ix -> do
      resE <- STRef.read resArray
      case Array.index resE ix of
        Just Nothing -> do
          let j = unsafePartial (Array.unsafeIndex typeTableJson ix)
          mbVal <- decodeObj' false j
          case mbVal of
            Just val -> do
              _ <- STRef.modify (unsafeUpdateAt ix (Just val)) resArray
              _ <- STRef.write true changed
              pure unit
            Nothing -> pure unit
        _ -> pure unit

  hasCycles <- STRef.new true
  ST.while (STRef.read hasCycles) do
    _ <- STRef.write false hasCycles
    firstUnresolved <- STRef.new Nothing
    ST.for 0 (Array.length typeTableJson) \ix -> do
      resE <- STRef.read resArray
      case Array.index resE ix of
        Just Nothing -> do
          mbFirst <- STRef.read firstUnresolved
          case mbFirst of
            Nothing -> do
              _ <- STRef.write (Just ix) firstUnresolved
              pure unit
            _ -> pure unit
        _ -> pure unit
    
    mbFirst <- STRef.read firstUnresolved
    case mbFirst of
      Nothing -> pure unit
      Just ix -> do
        let j = unsafePartial (Array.unsafeIndex typeTableJson ix)
        val <- decodeObj' true j
        _ <- STRef.modify (unsafeUpdateAt ix (Just (fromMaybe (Left (TypeMismatch "Cycle")) val))) resArray
        _ <- STRef.write true hasCycles
        _ <- STRef.write true changed
        ST.while (STRef.read changed) do
          _ <- STRef.write false changed
          ST.for 0 (Array.length typeTableJson) \i -> do
            resE <- STRef.read resArray
            case Array.index resE i of
              Just Nothing -> do
                let j2 = unsafePartial (Array.unsafeIndex typeTableJson i)
                mbVal <- decodeObj' false j2
                case mbVal of
                  Just v -> do
                    _ <- STRef.modify (unsafeUpdateAt i (Just v)) resArray
                    _ <- STRef.write true changed
                    pure unit
                  Nothing -> pure unit
              _ -> pure unit
        pure unit

  finalRes <- STRef.read resArray
  let 
    extract :: Int -> Either JsonDecodeError ExprType
    extract ix = case Array.index finalRes ix of
      Just (Just (Right val)) -> Right val
      Just (Just (Left err)) -> Left err
      _ -> Left (TypeMismatch "Unresolved Type (Cycle Deadlock)")
  
  let
    l = Array.length typeTableJson
    arr = if l == 0 then [] else map extract (Array.range 0 (l - 1))
  pure (sequence arr)
