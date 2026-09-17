package PureScript_Backend_Optimizer_App

import "gopurs/output/gopurs_runtime"

// The legacy JSON BackendModule cache is not used by gopurs. Native ADTs cannot
// use the JavaScript object encoding without an explicit portable codec.
func Stringify(version string, value gopurs_runtime.Value) string {
	panic("Native PBO does not support the legacy JSON BackendModule cache")
}

func ParseImpl(just gopurs_runtime.Value, nothing gopurs_runtime.Value, expectedVersion string, contents string) gopurs_runtime.Value {
	// Decline incompatible cache entries rather than constructing invalid ADTs.
	return nothing
}
