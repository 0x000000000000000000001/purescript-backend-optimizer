cat << 'INNER' > apply_fix_imports.sh
sed -i '' '40i\
import Effect.Console as Console\
import Effect.Unsafe (unsafePerformEffect)\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
INNER
sh apply_fix_imports.sh
