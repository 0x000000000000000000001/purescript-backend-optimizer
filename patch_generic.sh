sed -i '' '/genericType = fromMaybe Any varAnn.type/c\
             genericType = case mbMod of\
               Just (ModuleName mn) ->\
                 case Map.lookup (mn <> "." <> name) globalAstMap of\
                   Just (Binding _ _ val) -> getExprAnnType val\
                   Nothing -> fromMaybe Any varAnn.type\
               Nothing -> fromMaybe Any varAnn.type\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
