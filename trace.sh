cat << 'INNER' > apply_trace.sh
sed -i '' '/if not (hasTypeVariables genericType) || hasTypeVariables instType then/,/Map.insertWith (<>) id \[finalSubst\] acc/c\
                let \
                   cond = not (hasTypeVariables genericType) || hasTypeVariables instType\
                   _ = unsafePerformEffect (Console.log ("collectLocalExpr go: " <> unwrap id <> " generic: " <> show (hasTypeVariables genericType) <> " inst: " <> show (hasTypeVariables instType)))\
                in if cond then\
                  acc\
                else\
                  let _ = unsafePerformEffect (Console.log ("ADDING SUBST FOR: " <> unwrap id)) \
                  in Map.insertWith (<>) id [finalSubst] acc\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_trace.sh
