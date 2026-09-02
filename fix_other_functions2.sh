sed -i '' 's/monomorphizeBindLocal modName/monomorphizeBindLocal globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeBindLocal :: String/monomorphizeBindLocal :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

# Fix line 663: it might be inside monomorphize
sed -i '' 's/monomorphizeExpr globalAstMap modName instMap localDicts expr/monomorphizeExpr globalAstMap modName instMap localDicts expr/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
