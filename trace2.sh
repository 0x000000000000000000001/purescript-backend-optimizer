cat << 'INNER' > apply_trace2.sh
sed -i '' '/instType = stripTypeVariables (substituteExprType substType genericType)/a\
                             _ = unsafePerformEffect (Console.log ("processBinds specKey for " <> unwrap id <> ": " <> mangleType (defaultToAny instType)))
' src/PureScript/Backend/Optimizer/Monomorphize.purs

sed -i '' '/instType = stripTypeVariables (substituteExprType finalSubst (stripForAlls genericType))/a\
                _ = unsafePerformEffect (Console.log ("collectLocalExpr specKey for " <> unwrap id <> ": " <> mangleType (defaultToAny instType)))
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_trace2.sh
