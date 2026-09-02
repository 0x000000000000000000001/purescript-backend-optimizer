sed -i '' 's/collectExpr :: String -> InstantiationMap -> Expr Ann -> InstantiationMap/collectExpr :: Map String (Binding Ann) -> String -> InstantiationMap -> Expr Ann -> InstantiationMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectExpr modName acc expr = case expr of/collectExpr globalAstMap modName acc expr = case expr of/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectExpr modName acc f_var/collectExpr globalAstMap modName acc f_var/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectExpr modName/collectExpr globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectProp modName/collectProp globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectAlt modName/collectAlt globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectBind modName/collectBind globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectBinding modName/collectBinding globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectInstantiations :: InstantiationMap -> Module Ann -> InstantiationMap/collectInstantiations :: Map String (Binding Ann) -> InstantiationMap -> Module Ann -> InstantiationMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectInstantiations acc (Module m) =/collectInstantiations globalAstMap acc (Module m) =/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectProp :: String/collectProp :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectAlt :: String/collectAlt :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectBind :: String/collectBind :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectBinding :: String/collectBinding :: Map String (Binding Ann) -> String/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
