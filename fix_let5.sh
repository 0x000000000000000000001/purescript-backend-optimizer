sed -i '' 's/specializedExpr = monomorphizeExpr caller currentMap Map.empty substitutedExpr/specializedExpr = monomorphizeExpr globalAstMap caller currentMap Map.empty substitutedExpr/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectExpr caller acc3 specializedExpr/collectExpr globalAstMap caller acc3 specializedExpr/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
