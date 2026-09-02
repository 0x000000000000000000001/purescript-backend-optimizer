sed -i '' 's/monomorphizeBind modName/monomorphizeBind globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeBind :: String/monomorphizeBind :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' 's/monomorphizeBinding modName/monomorphizeBinding globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/monomorphizeBinding :: String/monomorphizeBinding :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

