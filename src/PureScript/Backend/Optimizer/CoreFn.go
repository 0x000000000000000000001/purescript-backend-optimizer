package PureScript_Backend_Optimizer_CoreFn

import "gopurs/output/gopurs_runtime"

// The PureScript oracle stays authoritative on the Go host: this adapter only
// applies it to the two arguments, with the exact direct-call ABI.
func CompareQualifiedIdentImpl(reference gopurs_runtime.Value, a gopurs_runtime.Value, b gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Apply2(reference, a, b)
}

// EqQualifiedIdentImpl is the Boolean counterpart; the runtime stores booleans
// in IntVal, so BoolVal preserves the oracle result exactly.
func EqQualifiedIdentImpl(reference gopurs_runtime.Value, a gopurs_runtime.Value, b gopurs_runtime.Value) bool {
	return gopurs_runtime.Apply2(reference, a, b).BoolVal()
}
