package PureScript_Backend_Optimizer_NativeMaps

import (
	"strings"

	"gopurs/output/gopurs_runtime"
)

// QualifiedIdentCompare orders `Qualified Ident` keys exactly like
// `ordQualified (ordIdent)`: the optional module first (Nothing < Just), then
// the identifier as native strings. Keys received from the native B-tree are
// boxed values whose payload is either `Qualified[string]` (decoded CoreFn) or
// `Qualified[Value]` (values built by the optimizer); the first word of V1
// tells the two representations apart.
var QualifiedIdentCompare = func(a, b interface{}) int {
	leftModule, leftHasModule, leftIdent := qualifiedIdentStrings(a)
	rightModule, rightHasModule, rightIdent := qualifiedIdentStrings(b)
	switch {
	case !leftHasModule && rightHasModule:
		return -1
	case leftHasModule && !rightHasModule:
		return 1
	case leftHasModule:
		if c := strings.Compare(leftModule, rightModule); c != 0 {
			return c
		}
	}
	return strings.Compare(leftIdent, rightIdent)
}

// qualifiedIdentStringKey mirrors the `Qualified[string]` instantiation of the
// constructor (same header, identifier stored as a native Go string). It lets
// the comparator read decoded CoreFn keys without importing `unsafe`.
type qualifiedIdentStringKey struct {
	Rc         uint32
	V0         *Constructor_Data_Maybe_Just[string]
	Identifier string
}

func qualifiedIdentStrings(v interface{}) (string, bool, string) {
	boxed, ok := v.(gopurs_runtime.Value)
	if !ok {
		panic("Expected a boxed Qualified Ident key")
	}
	valueView := (*Constructor_PureScript_Backend_Optimizer_CoreFn_Qualified[gopurs_runtime.Value])(boxed.UnsafePtr)
	module := ""
	hasModule := false
	if valueView.V0 != nil {
		module = valueView.V0.V0
		hasModule = true
	}
	// Valid Value tags are the small runtime constants; a string header starts
	// with its data pointer (nil when empty). Only the first word of V1 is
	// inspected before choosing how to read the identifier, so both
	// instantiations stay in bounds.
	typeTag := valueView.V1.Type
	if typeTag >= gopurs_runtime.TypeFunc && typeTag <= gopurs_runtime.TypeFunctionData {
		return module, hasModule, valueView.V1.StrVal()
	}
	return module, hasModule, (*qualifiedIdentStringKey)(boxed.UnsafePtr).Identifier
}

// StringCompare orders plain `String` keys (and their newtypes `Ident`,
// `ModuleName`, `ProperName`…) with `strings.Compare` on the unboxed string.
var StringCompare = func(a, b interface{}) int {
	return strings.Compare(unboxStringKey(a), unboxStringKey(b))
}

func unboxStringKey(v interface{}) string {
	if boxed, ok := v.(gopurs_runtime.Value); ok {
		return boxed.StrVal()
	}
	return v.(string)
}

func nativeCompare(compare gopurs_runtime.Value) CompareFn {
	return CompareFn(compare.AnyVal().(func(interface{}, interface{}) int))
}

func nativeLookupValue(compare gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	if val, ok := Data_Map_Internal_LookupNative(nativeCompare(compare), k, m); ok {
		return gopurs_runtime.Apply(Get_Data_Maybe_Just(), val.(gopurs_runtime.Value))
	}
	return Get_Data_Maybe_Nothing()
}

// LookupQualifiedIdentImpl routes a `Map (Qualified Ident)` lookup to the
// native-comparator B-tree entry: no `Ord` dictionary dispatch and no boxing
// per comparison. The `Maybe` lives in the backend, the comparator in Go.
func LookupQualifiedIdentImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeLookupValue(compare, k, m)
}

// InsertQualifiedIdentImpl is the insertion counterpart.
func InsertQualifiedIdentImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, v gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Box(Data_Map_Internal_InsertNative(nativeCompare(compare), k, v, m))
}

// LookupStringImpl/InsertStringImpl are the same for String-keyed maps.
func LookupStringImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeLookupValue(compare, k, m)
}

func InsertStringImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, v gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Box(Data_Map_Internal_InsertNative(nativeCompare(compare), k, v, m))
}
