sed -i '' 's/inferSubst genericType args'\'' else buildSubst/inferSubst genericType args else buildSubst/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' 's/args = getSpineArgs spine'\''/args'\'' = getSpineArgs spine'\''/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
