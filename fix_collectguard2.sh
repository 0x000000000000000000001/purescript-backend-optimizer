sed -i '' 's/collectGuard modName/collectGuard globalAstMap modName/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/collectGuard globalAstMap globalAstMap/collectGuard globalAstMap/g' src/PureScript/Backend/Optimizer/Monomorphize.purs

