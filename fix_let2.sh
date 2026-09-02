sed -i '' 's/(monomorphizeExpr modName instMap newLocalDicts rewrittenE)/(monomorphizeExpr globalAstMap modName instMap newLocalDicts rewrittenE)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
