sed -i '' 's/(monomorphizeExpr caller currentMap Map.empty substitutedExpr)/(monomorphizeExpr globalAstMap caller currentMap Map.empty substitutedExpr)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/transitiveCollect :: InstantiationMap/transitiveCollect :: Map String (Binding Ann) -> InstantiationMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/transitiveCollect initialMap/transitiveCollect globalAstMap initialMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
