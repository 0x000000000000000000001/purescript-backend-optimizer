sed -i '' '40i\
import Effect.Console as Console\
import Effect.Unsafe (unsafePerformEffect)\
' src/PureScript/Backend/Optimizer/Monomorphize.purs
