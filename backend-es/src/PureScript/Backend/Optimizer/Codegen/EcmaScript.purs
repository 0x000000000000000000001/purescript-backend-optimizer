module PureScript.Backend.Optimizer.Codegen.EcmaScript where

import Prelude

import Data.Array as Array
import Data.Foldable (fold, foldMap, foldl, foldr)
import Data.Map (Map, SemigroupMap(..))
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Monoid as Monoid
import Data.Newtype (unwrap)
import Data.Set as Set
import Data.Tuple (Tuple(..), fst, uncurry)
import Dodo as Dodo
import PureScript.Backend.Optimizer.Codegen.EcmaScript.Common (esComment)
import PureScript.Backend.Optimizer.Codegen.EcmaScript.Convert (CodegenEnv(..), CodegenOptions, InlineSpine, asCtorIdent, codegenCtorForType, codegenTopLevelBindingGroup)
import PureScript.Backend.Optimizer.Codegen.EcmaScript.Inline (esInlineMap)
import PureScript.Backend.Optimizer.Codegen.EcmaScript.Syntax (EsAnalysis(..), EsExpr, EsIdent(..), EsModuleStatement(..), defaultPrintOptions, esAnalysisOf, printModuleStatement, toEsIdent)
import PureScript.Backend.Optimizer.Codegen.Tco (TcoExpr)
import PureScript.Backend.Optimizer.Convert (BackendImplementations, BackendModule)
import PureScript.Backend.Optimizer.CoreFn (Ident, ModuleName(..), ProperName, Qualified)
import PureScript.Backend.Optimizer.Semantics (DataTypeMeta, NeutralExpr(..))
import PureScript.Backend.Optimizer.Syntax (BackendSyntax(..))

stripTyped :: NeutralExpr -> NeutralExpr
stripTyped (NeutralExpr expr) = case expr of
  Typed _ inner -> stripTyped inner
  _ -> NeutralExpr (stripTyped <$> expr)

codegenModule :: forall a. CodegenOptions -> BackendImplementations -> BackendModule -> Dodo.Doc a
codegenModule options implementations modOriginal = do
  let
    mod = modOriginal { bindings = map (\g -> g { bindings = map (map stripTyped) g.bindings }) modOriginal.bindings }
    topLevelBound :: Map Ident Int
    topLevelBound = foldl
      ( \bs { bindings } ->
          foldr (flip Map.insert 1 <<< fst) bs bindings
      )
      (foldr (flip Map.insert 1) Map.empty (Map.keys mod.foreign))
      mod.bindings

    inlineApp :: CodegenEnv -> Qualified Ident -> InlineSpine TcoExpr -> Maybe EsExpr
    inlineApp env qual spine = do
      fn <- Map.lookup qual esInlineMap
      fn env qual spine

    codegenEnv :: CodegenEnv
    codegenEnv = CodegenEnv
      { bound: topLevelBound
      , currentModule: mod.name
      , inlineApp
      , implementations
      , names: Map.empty
      , options
      }

    dataTypes :: Array (Tuple ProperName DataTypeMeta)
    dataTypes = Map.toUnfoldable mod.dataTypes

    bindingExports :: SemigroupMap (Maybe String) (Array EsIdent)
    bindingExports = SemigroupMap $ Map.singleton Nothing $ map (toEsIdent <<< fst) <<< _.bindings =<< mod.bindings

    dataTypeExports :: SemigroupMap (Maybe String) (Array EsIdent)
    dataTypeExports = SemigroupMap $ Map.singleton Nothing $ asCtorIdent <<< fst <$> dataTypes

    exportsByPath :: SemigroupMap (Maybe String) (Array EsIdent)
    exportsByPath = dataTypeExports <> bindingExports

    foreignImports :: Array EsIdent
    foreignImports = toEsIdent <$> Array.fromFoldable (Map.keys mod.foreign)

    modBindings :: Array EsExpr
    modBindings = codegenTopLevelBindingGroup codegenEnv =<< mod.bindings

    modDeps :: Array ModuleName
    modDeps = Set.toUnfoldable (foldMap (_.deps <<< unwrap <<< esAnalysisOf) modBindings)

    EsAnalysis s = foldMap esAnalysisOf modBindings

    modStatements :: Dodo.Doc a
    modStatements = Dodo.lines $ map (printModuleStatement defaultPrintOptions) $ fold
      [ Monoid.guard s.runtime [ EsImportAllAs (Generated "$runtime") "../runtime.js" ]
      , (\mn -> EsImportAllAs (toEsIdent mn) (esModulePath mn)) <$> modDeps
      , Monoid.guard (not (Array.null foreignImports)) [ EsImport foreignImports (esForeignModulePath mod.name) ]
      , EsStatement <<< uncurry (codegenCtorForType options) <$> dataTypes
      , EsStatement <$> modBindings
      , (\(Tuple p es) -> EsExport es p) <$> Map.toUnfoldable (unwrap exportsByPath)
      , Monoid.guard (not (Map.isEmpty mod.foreign)) [ EsExportAllFrom (esForeignModulePath mod.name) ]
      ]

  Monoid.guard (not (Array.null mod.comments))
    ( Dodo.lines (esComment <$> mod.comments)
        <> Dodo.break
    )
    <> modStatements
    <> Dodo.break

esModulePath :: ModuleName -> String
esModulePath (ModuleName mn) = "../" <> mn <> "/index.js"

esForeignModulePath :: ModuleName -> String
esForeignModulePath (ModuleName _) = "./foreign.js"
