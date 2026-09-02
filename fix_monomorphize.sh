sed -i '' 's/collectGuard modName acc/collectGuard globalAstMap modName acc/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectGuard :: String/collectGuard :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeExpr modName instMap localDicts expr/monomorphizeExpr globalAstMap modName instMap localDicts expr/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeExpr :: String/monomorphizeExpr :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeExpr modName instMap localDicts/monomorphizeExpr globalAstMap modName instMap localDicts/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphize instMap (Module m)/monomorphize globalAstMap instMap (Module m)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphize :: InstantiationMap/monomorphize :: Map String (Binding Ann) -> InstantiationMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

