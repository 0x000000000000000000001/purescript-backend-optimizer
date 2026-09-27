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

// UnionStringImpl/UnionWithStringImpl rebuild a String-keyed map with the
// native comparator; only the combine callback (overlapping keys) stays PS.
func UnionStringImpl(compare gopurs_runtime.Value, m1 gopurs_runtime.Value, m2 gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Box(Data_Map_Internal_UnionWithNative(nativeCompare(compare), keepLeftValue, m1, m2))
}

func UnionWithStringImpl(compare gopurs_runtime.Value, f func(interface{}) func(interface{}) interface{}, m1 gopurs_runtime.Value, m2 gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeUnionValue(compare, f, m1, m2)
}

// IntCompare orders `Int` keys (and newtypes such as `Level`) numerically.
var IntCompare = func(a, b interface{}) int {
	left := unboxIntKey(a)
	right := unboxIntKey(b)
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	default:
		return 0
	}
}

func unboxIntKey(v interface{}) int64 {
	if boxed, ok := v.(gopurs_runtime.Value); ok {
		return boxed.IntVal
	}
	switch n := v.(type) {
	case int64:
		return n
	case int:
		return int64(n)
	}
	panic("Expected a boxed Int key")
}

func LookupIntImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeLookupValue(compare, k, m)
}

func InsertIntImpl(compare gopurs_runtime.Value, k gopurs_runtime.Value, v gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Box(Data_Map_Internal_InsertNative(nativeCompare(compare), k, v, m))
}

func UnionWithIntImpl(compare gopurs_runtime.Value, f func(interface{}) func(interface{}) interface{}, m1 gopurs_runtime.Value, m2 gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeUnionValue(compare, f, m1, m2)
}

// Generated constructor tags (hashString) for the reference-like key types
// below. They are compiled into the same binary as these comparators; any
// drift breaks parity, which the corpus comparison checks exhaustively.
const (
	evalExternTag  = int64(4213482863)
	evalLocalTag   = int64(3190081234)
	tcoTopLevelTag = int64(2834237787)
	tcoLocalTag    = int64(3812431755)
)

type refLikeKey struct {
	externOrTop bool
	module      string
	hasModule   bool
	ident       string
	hasIdent    bool
	level       int64
}

// EvalRefCompare orders `EvalRef` keys like `ordEvalRef`: `EvalExtern` first,
// then `EvalLocal` (Maybe Ident then Level). The boxed payloads are
// `Qualified[string]` / `Maybe[string]` + native level.
var EvalRefCompare = func(a, b interface{}) int {
	return compareRefLikeKeys(evalRefKeyOf(a), evalRefKeyOf(b))
}

func evalRefKeyOf(v interface{}) refLikeKey {
	boxed := v.(gopurs_runtime.Value)
	switch boxed.IntVal {
	case evalExternTag:
		e := (*Constructor_PureScript_Backend_Optimizer_Semantics_EvalExtern)(boxed.UnsafePtr)
		key := refLikeKey{externOrTop: true}
		if e.V0 != nil {
			key.ident, key.hasIdent = e.V0.V1, true
			if e.V0.V0 != nil {
				key.module, key.hasModule = e.V0.V0.V0, true
			}
		}
		return key
	case evalLocalTag:
		e := (*Constructor_PureScript_Backend_Optimizer_Semantics_EvalLocal)(boxed.UnsafePtr)
		key := refLikeKey{level: e.V1}
		if e.V0 != nil {
			key.ident, key.hasIdent = e.V0.V0, true
		}
		return key
	}
	panic("Expected a boxed EvalRef key")
}

// TcoRefCompare is the same ordering for `TcoRef` (`TcoTopLevel` first).
var TcoRefCompare = func(a, b interface{}) int {
	return compareRefLikeKeys(tcoRefKeyOf(a), tcoRefKeyOf(b))
}

func tcoRefKeyOf(v interface{}) refLikeKey {
	boxed := v.(gopurs_runtime.Value)
	switch boxed.IntVal {
	case tcoTopLevelTag:
		e := (*Constructor_PureScript_Backend_Optimizer_Codegen_Tco_TcoTopLevel)(boxed.UnsafePtr)
		key := refLikeKey{externOrTop: true}
		if e.V0 != nil {
			key.ident, key.hasIdent = e.V0.V1, true
			if e.V0.V0 != nil {
				key.module, key.hasModule = e.V0.V0.V0, true
			}
		}
		return key
	case tcoLocalTag:
		e := (*Constructor_PureScript_Backend_Optimizer_Codegen_Tco_TcoLocal)(boxed.UnsafePtr)
		key := refLikeKey{level: e.V1}
		if e.V0 != nil {
			key.ident, key.hasIdent = e.V0.V0, true
		}
		return key
	}
	panic("Expected a boxed TcoRef key")
}

func compareRefLikeKeys(a, b refLikeKey) int {
	switch {
	case a.externOrTop && !b.externOrTop:
		return -1
	case !a.externOrTop && b.externOrTop:
		return 1
	case a.externOrTop:
		switch {
		case !a.hasModule && b.hasModule:
			return -1
		case a.hasModule && !b.hasModule:
			return 1
		case a.hasModule:
			if c := strings.Compare(a.module, b.module); c != 0 {
				return c
			}
		}
		return strings.Compare(a.ident, b.ident)
	default:
		switch {
		case !a.hasIdent && b.hasIdent:
			return -1
		case a.hasIdent && !b.hasIdent:
			return 1
		case a.hasIdent:
			if c := strings.Compare(a.ident, b.ident); c != 0 {
				return c
			}
		}
		switch {
		case a.level < b.level:
			return -1
		case a.level > b.level:
			return 1
		default:
			return 0
		}
	}
}

func LookupEvalRefImpl(compare gopurs_runtime.Value, _ gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeLookupValue(compare, k, m)
}

func InsertEvalRefImpl(compare gopurs_runtime.Value, _ gopurs_runtime.Value, k gopurs_runtime.Value, v gopurs_runtime.Value, m gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Box(Data_Map_Internal_InsertNative(nativeCompare(compare), k, v, m))
}

func MemberEvalRefImpl(compare gopurs_runtime.Value, _ gopurs_runtime.Value, k gopurs_runtime.Value, m gopurs_runtime.Value) bool {
	_, ok := Data_Map_Internal_LookupNative(nativeCompare(compare), k, m)
	return ok
}

func UnionWithTcoRefImpl(compare gopurs_runtime.Value, _ gopurs_runtime.Value, f func(interface{}) func(interface{}) interface{}, m1 gopurs_runtime.Value, m2 gopurs_runtime.Value) gopurs_runtime.Value {
	return nativeUnionValue(compare, f, m1, m2)
}

func nativeUnionValue(compare gopurs_runtime.Value, f func(interface{}) func(interface{}) interface{}, m1 gopurs_runtime.Value, m2 gopurs_runtime.Value) gopurs_runtime.Value {
	combine := func(v1, v2 interface{}) interface{} { return f(v1)(v2) }
	return gopurs_runtime.Box(Data_Map_Internal_UnionWithNative(nativeCompare(compare), combine, m1, m2))
}

func keepLeftValue(v1 interface{}, _ interface{}) interface{} {
	return v1
}
