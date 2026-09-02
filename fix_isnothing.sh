sed -i '' 's/isNothing mbMod/(case mbMod of Nothing -> true; _ -> false)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
