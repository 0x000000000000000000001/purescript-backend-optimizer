sed -i '' 's/(case mbMod of Nothing -> true; _ -> false)/(maybe true (const false) mbMod)/g' src/PureScript/Backend/Optimizer/Monomorphize.purs
