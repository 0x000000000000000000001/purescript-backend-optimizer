sed -i '' 's/inferSubst genericType args else buildSubst/inferSubst genericType args'\'' else buildSubst/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
sed -i '' '200,300s/inferSubst genericType args'\'' else buildSubst/inferSubst genericType args else buildSubst/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
