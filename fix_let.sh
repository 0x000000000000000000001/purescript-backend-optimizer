sed -i '' 's/(monomorphizeExpr modName instMap newLocalDicts e)/(monomorphizeExpr globalAstMap modName instMap newLocalDicts e)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
