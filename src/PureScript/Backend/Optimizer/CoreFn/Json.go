package PureScript_Backend_Optimizer_CoreFn_Json

import "math"

func IsNonNegativeInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && math.Trunc(value) == value
}
