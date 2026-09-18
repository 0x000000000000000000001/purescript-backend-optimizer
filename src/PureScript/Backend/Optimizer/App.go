package PureScript_Backend_Optimizer_App

import (
	"os"
	"strconv"
	"strings"

	"gopurs/output/gopurs_runtime"
)

func ModuleReadConcurrency() int {
	configured := os.Getenv("GOPURS_JOBS")
	if configured != "" && strings.Trim(configured, "0123456789") == "" {
		if jobs, err := strconv.Atoi(configured); err == nil && jobs >= 1 && jobs <= 64 {
			return jobs
		}
	}
	return 1
}

// The legacy JSON BackendModule cache is not used by gopurs. Native ADTs cannot
// use the JavaScript object encoding without an explicit portable codec.
func Stringify(version string, value gopurs_runtime.Value) string {
	panic("Native PBO does not support the legacy JSON BackendModule cache")
}

func ParseImpl(just gopurs_runtime.Value, nothing gopurs_runtime.Value, expectedVersion string, contents string) gopurs_runtime.Value {
	// Decline incompatible cache entries rather than constructing invalid ADTs.
	return nothing
}
