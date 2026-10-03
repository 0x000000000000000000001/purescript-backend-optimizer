package PureScript_Backend_Optimizer_Directives

import "gopurs/output/gopurs_runtime"

// The authoritative CST parser stays on the PureScript side.
func ParseDirectiveLineImpl(reference gopurs_runtime.Value, line string) gopurs_runtime.Value {
	return gopurs_runtime.Apply(reference, gopurs_runtime.Str(line))
}
