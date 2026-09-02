cat << 'INNER' >> src/PureScript/Backend/Optimizer/Monomorphize.purs

getExprAnnType :: Expr Ann -> ExprType
getExprAnnType e = fromMaybe Any (getExprAnn e).type
INNER
