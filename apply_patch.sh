sed -i '' '/buildSubst :: ExprType -> Array ExprType -> Map String ExprType/i\
inferSubst :: ExprType -> Array (Expr Ann) -> Map String ExprType\
inferSubst t args = \
  let \
    argTypes = map getExprAnnType args\
    goType typ actuals acc = case typ of\
      ForAll _ body -> goType body actuals acc\
      ConstrainedType _ body -> goType body actuals acc\
      Func expectedArgs _ -> foldl (\\a (Tuple expected actual) -> unify expected actual a) acc (Array.zip expectedArgs actuals)\
      _ -> acc\
  in goType t argTypes Map.empty\
\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
