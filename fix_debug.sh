sed -i '' '/staticNormalArgs = Array.filter isStatic normalArgs/a\
             _ = unsafePerformEffect (if name == "filter" then Console.log ("collectExpr filter specKey: " <> specKey) else pure unit)\
' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' '/specializedName = Ident (name <> "__" <> hashString specKey)/a\
                   _ = unsafePerformEffect (if name == "filter" then Console.log ("monomorphizeExpr filter specKey: " <> specKey) else pure unit)\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
