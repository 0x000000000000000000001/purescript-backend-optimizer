cat << 'INNER' > patch_getexpr2.sh
sed -i '' '/getExprAnnType e = fromMaybe Any (unwrap (getExprAnn e)).type/c\
getExprAnnType e = case getExprAnn e of\
  Ann ann -> fromMaybe Any ann.type\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh patch_getexpr2.sh
