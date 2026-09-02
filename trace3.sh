cat << 'INNER' > apply_trace3.sh
sed -i '' '/case Map.lookup specKey insts of/i\
                            let _ = unsafePerformEffect (Console.log ("specKey for " <> unwrap id <> " is " <> specKey <> " and insts keys are: " <> String.joinWith ", " (Array.fromFoldable (Map.keys insts)))) in \
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_trace3.sh
