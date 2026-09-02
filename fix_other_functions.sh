sed -i '' 's/monomorphizeBindingLocal modName/monomorphizeBindingLocal globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeBindingLocal :: String/monomorphizeBindingLocal :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeCaseGuard modName/monomorphizeCaseGuard globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeCaseGuard :: String/monomorphizeCaseGuard :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeGuard modName/monomorphizeGuard globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeGuard :: String/monomorphizeGuard :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeProp modName/monomorphizeProp globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeProp :: String/monomorphizeProp :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeAlt modName/monomorphizeAlt globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeAlt :: String/monomorphizeAlt :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

