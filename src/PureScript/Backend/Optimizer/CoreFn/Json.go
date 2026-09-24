package PureScript_Backend_Optimizer_CoreFn_Json

// Native Go implementation of the CoreFn type-table decode + resolve path. Same algorithm and same output representation as
// PureScript.Backend.Optimizer.CoreFn.TypeTable.decodeTypeTableST, but with
// direct control flow and native intermediate values instead of ST monad
// plumbing, Maybe/Either layers and per-step closures.
//
// Json.purs calls DecodeTypeTableImpl from the Go backend; the JavaScript
// backend keeps the validated PureScript implementation in TypeTable.purs.

import (
	"math"
	"sort"
	"strings"
	"unicode/utf16"
	"unsafe"

	"gopurs/output/gopurs_runtime"
)

// Value tags used by the constructors below. They mirror the generated
// accessors byte for byte.
const (
	ntTagLeft  = 3711209382
	ntTagRight = 2465973597
	ntTagJust  = 930809136
	ntTagAny   = 1114223517

	ntTagTypeMismatch = 2887704423
	ntTagAtKey        = 1896025177
	ntTagMissingValue = 3199441748
)

// ExprType constructor tags.
const (
	ntTagInt             = 2329251128
	ntTagNumber          = 3913280584
	ntTagString          = 3888012862
	ntTagChar            = 988402323
	ntTagBoolean         = 1622340175
	ntTagUnit            = 1184101581
	ntTagTypeLevelString = 1716839120
	ntTagArrayType       = 3898516306
	ntTagTypeVar         = 2740186550
	ntTagADT             = 2722479098
	ntTagTypeApp         = 463633618
	ntTagFunc            = 4071879509
	ntTagRow             = 2829620449
	ntTagRecord          = 286668774
	ntTagForAll          = 1096143921
	ntTagConstrainedType = 3148489123
)

func ntStaticValue(tag int64) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: tag}
}

func ntJust(value gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagJust, UnsafePtr: unsafe.Pointer(&Constructor_Data_Maybe_Just[gopurs_runtime.Value]{1, value})}
}

func ntLeft(err gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagLeft, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Left[gopurs_runtime.Value, gopurs_runtime.Value]{1, err})}
}

func ntRight(value gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagRight, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Right[gopurs_runtime.Value, gopurs_runtime.Value]{1, value})}
}

func ntTypeMismatch(msg string) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagTypeMismatch, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_TypeMismatch{1, msg})}
}

func ntMissingValue() gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagMissingValue}
}

func ntAtKey(key string, err gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagAtKey, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_AtKey{1, key, err})}
}

func ntTypeVar(name string) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagTypeVar, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_TypeVar{1, name})}
}

func ntTypeLevelString(value string) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagTypeLevelString, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_TypeLevelString{1, value})}
}

func ntADT(name string, fqn []string, args []gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagADT, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ADT{1, name, fqn, args})}
}

func ntTypeApp(base gopurs_runtime.Value, args []gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagTypeApp, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_TypeApp{1, base, args})}
}

func ntFunc(args []gopurs_runtime.Value, ret gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagFunc, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Func{1, args, ret})}
}

func ntArrayType(element gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagArrayType, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Array{1, element})}
}

func ntRecordType(row gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagRecord, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Record{1, row})}
}

func ntRowType(fields []*Constructor_Data_Tuple_Tuple[string, gopurs_runtime.Value], tail *Constructor_Data_Maybe_Just[gopurs_runtime.Value]) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagRow, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Row{1, fields, tail})}
}

func ntForAll(vars []string, body gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagForAll, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ForAll{1, vars, body})}
}

func ntConstrainedType(constraints []*Constructor_Data_Tuple_Tuple[[]string, []gopurs_runtime.Value], body gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagConstrainedType, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ConstrainedType{1, constraints, body})}
}

// ntNative converts a parsed-JSON value into its native Go form. Parsed JSON
// lives as plain Go values behind TypeAny boxes, so the object and array cases
// usually return the existing map/slice without copying.
func ntNative(input any) any {
	switch v := input.(type) {
	case gopurs_runtime.Value:
		switch v.Type {
		case gopurs_runtime.TypeAny:
			if v.UnsafePtr == nil {
				return nil
			}
			return ntNative(*(*any)(v.UnsafePtr))
		case gopurs_runtime.TypeString:
			return v.StrVal()
		case gopurs_runtime.TypeFloat:
			return v.FloatVal()
		case gopurs_runtime.TypeInt:
			return float64(v.IntVal)
		case gopurs_runtime.TypeBool:
			return v.IntVal != 0
		case gopurs_runtime.TypeArray:
			if v.UnsafePtr == nil {
				return []any{}
			}
			arr := *(*[]gopurs_runtime.Value)(v.UnsafePtr)
			out := make([]any, len(arr))
			for i := range arr {
				out[i] = ntNative(arr[i])
			}
			return out
		default:
			return nil
		}
	default:
		return input
	}
}

func ntIsNull(input any) (bool, bool) {
	switch ntNative(input).(type) {
	case nil:
		return true, true
	case bool:
		return false, true
	case string:
		return false, true
	case float64:
		return false, true
	case []any:
		return false, true
	case map[string]any, gopurs_runtime.JSONObject:
		return false, true
	}
	return false, false
}

// Int.fromNumber: (n | 0) === n, i.e. an exact integer within Int range.
func ntInt(input any) (int64, gopurs_runtime.Value, bool) {
	f, ok := ntNative(input).(float64)
	if !ok {
		return 0, ntTypeMismatch("Failed decode"), false
	}
	if f != float64(int64(f)) {
		return 0, ntTypeMismatch("Int"), false
	}
	n := int64(f)
	if n < -2147483648 || n > 2147483647 {
		return 0, ntTypeMismatch("Int"), false
	}
	return n, gopurs_runtime.Value{}, true
}

// Borrow compact parsed objects and ordinary Foreign.Object maps uniformly.
type ntObject = gopurs_runtime.JSONObjectView

func ntObjectOf(raw any) (ntObject, bool) { return gopurs_runtime.ReadJSONObject(raw) }

func ntStringField(obj ntObject, key string) (string, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup(key)
	if !ok {
		return "", ntAtKey(key, ntMissingValue()), false
	}
	value, ok := ntNative(raw).(string)
	if !ok {
		return "", ntAtKey(key, ntTypeMismatch("Failed decode")), false
	}
	return value, gopurs_runtime.Value{}, true
}

func ntIntField(obj ntObject, key string) (int64, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup(key)
	if !ok {
		return 0, ntAtKey(key, ntMissingValue()), false
	}
	value, err, ok := ntInt(raw)
	if !ok {
		return 0, ntAtKey(key, err), false
	}
	return value, gopurs_runtime.Value{}, true
}

func ntStringArrayField(obj ntObject, key string) ([]string, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup(key)
	if !ok {
		return nil, ntAtKey(key, ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey(key, ntTypeMismatch("Failed decode")), false
	}
	out := make([]string, len(arr))
	for i, element := range arr {
		value, ok := ntNative(element).(string)
		if !ok {
			return nil, ntAtKey(key, ntTypeMismatch("Failed decode")), false
		}
		out[i] = value
	}
	return out, gopurs_runtime.Value{}, true
}

func ntIntArrayField(obj ntObject, key string) ([]int64, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup(key)
	if !ok {
		return nil, ntAtKey(key, ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey(key, ntTypeMismatch("Failed decode")), false
	}
	out := make([]int64, len(arr))
	for i, element := range arr {
		value, err, ok := ntInt(element)
		if !ok {
			return nil, ntAtKey(key, err), false
		}
		out[i] = value
	}
	return out, gopurs_runtime.Value{}, true
}

type ntFieldRef struct {
	label  string
	typeId int64
}

type ntConstraintRef struct {
	fqn  []string
	args []int64
}

const (
	ntRefStatic uint8 = iota
	ntRefADT
	ntRefTypeApp
	ntRefFunc
	ntRefArray
	ntRefRecord
	ntRefRow
	ntRefForAll
	ntRefConstrained
)

const (
	ntTailNone uint8 = iota
	ntTailJust
	ntTailError
)

const (
	ntBodyOK uint8 = iota
	ntBodyError
)

type ntRef struct {
	kind     uint8
	ok       bool
	tailKind uint8
	bodyKind uint8
	argsOK   bool

	// Variant-exclusive payloads share storage. value holds a static type,
	// a decode failure (!ok), or the deferred args/tail/body failure selected
	// by the flags above. Their resolution/error precedence remains distinct.
	value gopurs_runtime.Value
	name  string
	names []string // ADT qualified name or ForAll variables
	args  []int64  // ADT, TypeApp or Func arguments
	link  int64    // constructor, return, element, row, tail or body reference

	fields      []ntFieldRef
	constraints []ntConstraintRef
}

func (t *ntTable) decodeRef(raw any) ntRef {
	if s, ok := raw.(string); ok {
		switch s {
		case "Int":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagInt)}
		case "Number":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagNumber)}
		case "String":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagString)}
		case "Char":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagChar)}
		case "Boolean":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagBoolean)}
		case "Unit":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagUnit)}
		case "Any":
			return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagAny)}
		default:
			return ntRef{value: ntTypeMismatch("ExprType")}
		}
	}
	obj, ok := ntObjectOf(raw)
	if !ok {
		return ntRef{value: ntTypeMismatch("ExprType")}
	}
	typRaw, hasType := obj.Lookup("type")
	typ, typOK := ntNative(typRaw).(string)
	if !hasType || !typOK {
		if tvRaw, ok := obj.Lookup("TypeVar"); ok {
			if name, ok := ntNative(tvRaw).(string); ok {
				return ntRef{ok: true, kind: ntRefStatic, value: ntTypeVar(name)}
			}
		}
		return ntRef{value: ntAtKey("type", ntMissingValue())}
	}
	switch typ {
	case "Adt":
		fqn, err, ok := ntStringArrayField(obj, "fqn")
		if !ok {
			return ntRef{value: err}
		}
		args, err, ok := ntIntArrayField(obj, "args")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefADT, name: strings.Join(fqn, "."), names: fqn, args: args}
	case "TypeApp":
		ctor, err, ok := ntIntField(obj, "constructor")
		if !ok {
			return ntRef{value: err}
		}
		args, argsErr, argsOK := ntIntArrayField(obj, "args")
		return ntRef{ok: true, kind: ntRefTypeApp, link: ctor, args: args, argsOK: argsOK, value: argsErr}
	case "Func":
		args, err, ok := ntIntArrayField(obj, "args")
		if !ok {
			return ntRef{value: err}
		}
		ret, err, ok := ntIntField(obj, "ret")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefFunc, args: args, link: ret}
	case "Array":
		el, err, ok := ntIntField(obj, "element")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefArray, link: el}
	case "TypeVar":
		name, err, ok := ntStringField(obj, "name")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefStatic, value: ntTypeVar(name)}
	case "Record":
		row, err, ok := ntIntField(obj, "row")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefRecord, link: row}
	case "Row":
		fields, err, ok := ntDecodeFields(obj)
		if !ok {
			return ntRef{value: err}
		}
		ref := ntRef{ok: true, kind: ntRefRow, fields: fields, tailKind: ntTailNone}
		if tailRaw, present := obj.Lookup("tail"); present {
			if isNull, known := ntIsNull(tailRaw); !known {
				return ntRef{value: ntAtKey("tail", ntTypeMismatch("Failed decode"))}
			} else if !isNull {
				tail, tailErr, ok := ntInt(tailRaw)
				if !ok {
					ref.tailKind = ntTailError
					ref.value = tailErr
				} else {
					ref.tailKind = ntTailJust
					ref.link = tail
				}
			}
		}
		return ref
	case "ForAll":
		vars, err, ok := ntStringArrayField(obj, "vars")
		if !ok {
			return ntRef{value: err}
		}
		body, err, ok := ntIntField(obj, "body")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefForAll, names: vars, link: body}
	case "ConstrainedType":
		constraints, err, ok := ntDecodeConstraints(obj)
		if !ok {
			return ntRef{value: err}
		}
		ref := ntRef{ok: true, kind: ntRefConstrained, constraints: constraints}
		bodyRaw, present := obj.Lookup("body")
		if !present {
			ref.bodyKind = ntBodyError
			ref.value = ntAtKey("body", ntMissingValue())
			return ref
		}
		body, bodyErr, ok := ntInt(bodyRaw)
		if !ok {
			ref.bodyKind = ntBodyError
			ref.value = ntAtKey("body", bodyErr)
			return ref
		}
		ref.link = body
		return ref
	case "TypeLevelString":
		value, err, ok := ntStringField(obj, "value")
		if !ok {
			return ntRef{value: err}
		}
		return ntRef{ok: true, kind: ntRefStatic, value: ntTypeLevelString(value)}
	case "Int":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagInt)}
	case "Number":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagNumber)}
	case "String":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagString)}
	case "Char":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagChar)}
	case "Boolean":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagBoolean)}
	case "Unit":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagUnit)}
	case "Any":
		return ntRef{ok: true, kind: ntRefStatic, value: ntStaticValue(ntTagAny)}
	default:
		return ntRef{value: ntTypeMismatch("ExprType")}
	}
}

func ntDecodeFields(obj ntObject) ([]ntFieldRef, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup("fields")
	if !ok {
		return nil, ntAtKey("fields", ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey("fields", ntTypeMismatch("Failed decode")), false
	}
	out := make([]ntFieldRef, len(arr))
	for i, element := range arr {
		field, ok := ntObjectOf(ntNative(element))
		if !ok {
			return nil, ntAtKey("fields", ntTypeMismatch("Failed decode")), false
		}
		label, err, ok := ntStringField(field, "label")
		if !ok {
			return nil, ntAtKey("fields", err), false
		}
		typeId, err, ok := ntIntField(field, "type")
		if !ok {
			return nil, ntAtKey("fields", err), false
		}
		out[i] = ntFieldRef{label: label, typeId: typeId}
	}
	return out, gopurs_runtime.Value{}, true
}

func ntDecodeConstraints(obj ntObject) ([]ntConstraintRef, gopurs_runtime.Value, bool) {
	raw, ok := obj.Lookup("constraints")
	if !ok {
		return nil, ntAtKey("constraints", ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey("constraints", ntTypeMismatch("Failed decode")), false
	}
	out := make([]ntConstraintRef, len(arr))
	for i, element := range arr {
		constraint, ok := ntObjectOf(ntNative(element))
		if !ok {
			return nil, ntAtKey("constraints", ntTypeMismatch("Failed decode")), false
		}
		fqn, err, ok := ntStringArrayField(constraint, "fqn")
		if !ok {
			return nil, ntAtKey("constraints", err), false
		}
		args, err, ok := ntIntArrayField(constraint, "args")
		if !ok {
			return nil, ntAtKey("constraints", err), false
		}
		out[i] = ntConstraintRef{fqn: fqn, args: args}
	}
	return out, gopurs_runtime.Value{}, true
}

// ntResult is the native shape of Maybe (Either err a). ok=false is Nothing.
type ntResult struct {
	ok    bool
	right bool
	value gopurs_runtime.Value
	slice []gopurs_runtime.Value
}

type ntTable struct {
	refs    []ntRef
	pending []int64
	state   []uint8
	// state distinguishes a stored error (1) from a resolved type (2).
	values []gopurs_runtime.Value
}

func (t *ntTable) set(id int64, result ntResult) {
	t.values[id] = result.value
	if result.right {
		t.state[id] = 2
	} else {
		t.state[id] = 1
	}
}

func (t *ntTable) resolveId(id int64, force bool) ntResult {
	// Peek semantics: an out-of-range index reads as an unresolved entry.
	if id < 0 || id >= int64(len(t.state)) {
		if force {
			return ntResult{ok: true, right: true, value: ntStaticValue(ntTagAny)}
		}
		return ntResult{}
	}
	switch t.state[id] {
	case 2:
		return ntResult{ok: true, right: true, value: t.values[id]}
	case 1:
		return ntResult{ok: true, right: false, value: t.values[id]}
	}
	if force {
		return ntResult{ok: true, right: true, value: ntStaticValue(ntTagAny)}
	}
	return ntResult{}
}

// Resolution only reads settled states. An unresolved argument dominates every
// argument error; otherwise the first error in argument order wins.
func (t *ntTable) checkArgs(args []int64, force bool) ntResult {
	firstErr := gopurs_runtime.Value{}
	hasErr := false
	for _, id := range args {
		resolved := t.resolveId(id, force)
		if !resolved.ok {
			return ntResult{}
		}
		if !resolved.right {
			if !hasErr {
				firstErr = resolved.value
				hasErr = true
			}
			continue
		}
	}
	if hasErr {
		return ntResult{ok: true, right: false, value: firstErr}
	}
	return ntResult{ok: true, right: true}
}

// Materialize only after all dependencies needed by the constructor are ready.
func (t *ntTable) argumentValues(args []int64, force bool) []gopurs_runtime.Value {
	values := make([]gopurs_runtime.Value, len(args))
	for i, id := range args {
		values[i] = t.resolveId(id, force).value
	}
	return values
}

func (t *ntTable) resolveArgs(args []int64, force bool) ntResult {
	result := t.checkArgs(args, force)
	if result.ok && result.right {
		result.slice = t.argumentValues(args, force)
	}
	return result
}

func (t *ntTable) resolveType(ref *ntRef, force bool) ntResult {
	if !ref.ok {
		return ntResult{ok: true, right: false, value: ref.value}
	}
	switch ref.kind {
	case ntRefStatic:
		return ntResult{ok: true, right: true, value: ref.value}
	case ntRefADT:
		args := t.resolveArgs(ref.args, force)
		if !args.ok {
			return ntResult{}
		}
		if !args.right {
			return args
		}
		return ntResult{ok: true, right: true, value: ntADT(ref.name, ref.names, args.slice)}
	case ntRefTypeApp:
		ctor := t.resolveId(ref.link, force)
		if !ctor.ok {
			return ntResult{}
		}
		if !ctor.right {
			return ctor
		}
		if !ref.argsOK {
			return ntResult{ok: true, right: false, value: ref.value}
		}
		args := t.resolveArgs(ref.args, force)
		if !args.ok {
			return ntResult{}
		}
		if !args.right {
			return args
		}
		return ntResult{ok: true, right: true, value: ntTypeApp(ctor.value, args.slice)}
	case ntRefFunc:
		args := t.checkArgs(ref.args, force)
		ret := t.resolveId(ref.link, force)
		if args.ok && !args.right {
			return args
		}
		if ret.ok && !ret.right {
			return ret
		}
		if args.ok && ret.ok {
			return ntResult{ok: true, right: true, value: ntFunc(t.argumentValues(ref.args, force), ret.value)}
		}
		return ntResult{}
	case ntRefArray:
		element := t.resolveId(ref.link, force)
		if !element.ok {
			return ntResult{}
		}
		if !element.right {
			return element
		}
		return ntResult{ok: true, right: true, value: ntArrayType(element.value)}
	case ntRefRecord:
		row := t.resolveId(ref.link, force)
		if !row.ok {
			return ntResult{}
		}
		if !row.right {
			return row
		}
		return ntResult{ok: true, right: true, value: ntRecordType(row.value)}
	case ntRefRow:
		firstErr := ntResult{ok: true, right: true}
		for _, refField := range ref.fields {
			field := t.resolveId(refField.typeId, force)
			if !field.ok {
				return ntResult{}
			}
			if !field.right && firstErr.right {
				firstErr = field
			}
		}
		if !firstErr.right {
			return firstErr
		}
		var tailValue *Constructor_Data_Maybe_Just[gopurs_runtime.Value]
		switch ref.tailKind {
		case ntTailError:
			return ntResult{ok: true, right: false, value: ref.value}
		case ntTailNone:
		default:
			tail := t.resolveId(ref.link, force)
			if !tail.ok {
				return ntResult{}
			}
			if !tail.right {
				return tail
			}
			tailValue = &Constructor_Data_Maybe_Just[gopurs_runtime.Value]{1, tail.value}
		}
		fields := make([]*Constructor_Data_Tuple_Tuple[string, gopurs_runtime.Value], len(ref.fields))
		for i, field := range ref.fields {
			fields[i] = &Constructor_Data_Tuple_Tuple[string, gopurs_runtime.Value]{1, field.label, t.resolveId(field.typeId, force).value}
		}
		return ntResult{ok: true, right: true, value: ntRowType(fields, tailValue)}
	case ntRefForAll:
		body := t.resolveId(ref.link, force)
		if !body.ok {
			return ntResult{}
		}
		if !body.right {
			return body
		}
		return ntResult{ok: true, right: true, value: ntForAll(ref.names, body.value)}
	case ntRefConstrained:
		firstErr := ntResult{ok: true, right: true}
		for _, refConstraint := range ref.constraints {
			constraint := t.checkArgs(refConstraint.args, force)
			if !constraint.ok {
				return ntResult{}
			}
			if !constraint.right && firstErr.right {
				firstErr = constraint
			}
		}
		if !firstErr.right {
			return firstErr
		}
		if ref.bodyKind == ntBodyError {
			return ntResult{ok: true, right: false, value: ref.value}
		}
		body := t.resolveId(ref.link, force)
		if !body.ok {
			return ntResult{}
		}
		if !body.right {
			return body
		}
		constraints := make([]*Constructor_Data_Tuple_Tuple[[]string, []gopurs_runtime.Value], len(ref.constraints))
		for i, constraint := range ref.constraints {
			constraints[i] = &Constructor_Data_Tuple_Tuple[[]string, []gopurs_runtime.Value]{1, constraint.fqn, t.argumentValues(constraint.args, force)}
		}
		return ntResult{ok: true, right: true, value: ntConstrainedType(constraints, body.value)}
	}
	return ntResult{}
}

func (t *ntTable) settle() {
	for {
		indices := t.pending
		if len(indices) == 0 {
			return
		}
		// Stable in-place compaction only overwrites indices already visited.
		next := indices[:0]
		for _, id := range indices {
			resolved := t.resolveType(&t.refs[id], false)
			if resolved.ok {
				t.set(id, resolved)
			} else {
				next = append(next, id)
			}
		}
		t.pending = next
		if len(next) >= len(indices) {
			return
		}
	}
}

// DecodeTypeTableImpl has the same observable behaviour as the generated
// CoreFn.Json.decodeTypeTable: a JsonDecode (Array ExprType) Either value.
func DecodeTypeTableImpl(json gopurs_runtime.Value) gopurs_runtime.Value {
	if json.Type == gopurs_runtime.TypeAny && json.UnsafePtr != nil {
		if arr, ok := (*(*any)(json.UnsafePtr)).([]any); ok {
			return decodeTypeTableNative(arr)
		}
	}
	if json.Type != gopurs_runtime.TypeArray || json.UnsafePtr == nil {
		return ntLeft(ntTypeMismatch("Array"))
	}
	values := *(*[]gopurs_runtime.Value)(json.UnsafePtr)
	entries := make([]any, len(values))
	for i := range values {
		entries[i] = ntNative(values[i])
	}
	return decodeTypeTableNative(entries)
}

// decodeTypeTableNative resolves an already-unwrapped table: native JSON
// entries from the module decoder are used directly, without boxing them.
func decodeTypeTableNative(raw any) gopurs_runtime.Value {
	entries, ok := raw.([]any)
	if !ok {
		return ntLeft(ntTypeMismatch("Array"))
	}
	count := len(entries)
	table := &ntTable{
		refs:    make([]ntRef, count),
		pending: make([]int64, count),
		state:   make([]uint8, count),
		values:  make([]gopurs_runtime.Value, count),
	}
	for i := range entries {
		table.refs[i] = table.decodeRef(entries[i])
		table.pending[i] = int64(i)
	}
	table.settle()
	for len(table.pending) > 0 {
		id := table.pending[0]
		table.pending = table.pending[1:]
		resolved := table.resolveType(&table.refs[id], true)
		if !resolved.ok {
			resolved = ntResult{ok: true, right: false, value: ntTypeMismatch("Cycle")}
		}
		table.set(id, resolved)
		table.settle()
	}
	out := table.values
	for i := range out {
		switch table.state[i] {
		case 2:
		case 1:
			return ntLeft(out[i])
		default:
			return ntLeft(ntTypeMismatch("Unresolved Type (Cycle Deadlock)"))
		}
	}
	return ntRight(gopurs_runtime.Array(out))
}

func IsNonNegativeInteger(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && math.Trunc(value) == value
}

// DecodeArrayImpl runs the element loop of decodeArray directly and builds the
// result array natively, preserving the first-error AtIndex behaviour. The
// PureScript fallback argument is only used by the JavaScript backend.
func DecodeArrayImpl(fallback gopurs_runtime.Value, decoder gopurs_runtime.Value, arrValue gopurs_runtime.Value) gopurs_runtime.Value {
	_ = fallback
	var src []gopurs_runtime.Value
	if arrValue.Type == gopurs_runtime.TypeArray && arrValue.UnsafePtr != nil {
		src = *(*[]gopurs_runtime.Value)(arrValue.UnsafePtr)
	}
	out := make([]gopurs_runtime.Value, 0, len(src))
	for ix := range src {
		resolved := gopurs_runtime.Apply(decoder, src[ix])
		if resolved.Type == 9 && resolved.IntVal == ntTagLeft && resolved.UnsafePtr != nil {
			return ntLeft(ntAtIndex(int64(ix), (*Constructor_Data_Either_Left[gopurs_runtime.Value, gopurs_runtime.Value])(resolved.UnsafePtr).V0))
		}
		out = append(out, (*Constructor_Data_Either_Right[gopurs_runtime.Value, gopurs_runtime.Value])(resolved.UnsafePtr).V0)
	}
	return ntRight(gopurs_runtime.Array(out))
}

func ntAtIndex(ix int64, inner gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: 1044667600, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_AtIndex{1, ix, inner})}
}

// ---------------------------------------------------------------------------
// Native annotation path (decodeAnnWithUsage and its helpers).
// ---------------------------------------------------------------------------

const (
	ndTagMetaIsConstructor  = 1236880537
	ndTagMetaIsNewtype      = 3161528437
	ndTagMetaIsTypeClass    = 1540863599
	ndTagMetaIsForeign      = 1924226543
	ndTagMetaIsWhere        = 1433852540
	ndTagMetaIsSyntheticApp = 1233478451
	ndTagProductType        = 331491576
	ndTagSumType            = 3677658296
)

type ndFailure struct {
	err gopurs_runtime.Value
}

func ndPublic(message string) *ndFailure {
	return &ndFailure{err: ntTypeMismatch(message)}
}

func ndAtKey(key string, failure *ndFailure) *ndFailure {
	return &ndFailure{err: ntAtKey(key, failure.err)}
}

func ndNothing() gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: ntTagJust}
}

func ndNullable(raw any) bool {
	return raw == nil
}

// ndNumber mirrors decodeNumber.
func ndNumber(raw any) (float64, *ndFailure) {
	switch value := raw.(type) {
	case float64:
		return value, nil
	case int64:
		return float64(value), nil
	}
	return 0, ndPublic("Number")
}

// ndInt mirrors decodeInt: decodeNumber followed by Int.fromNumber.
func ndInt(raw any) (int64, *ndFailure) {
	number, failure := ndNumber(raw)
	if failure != nil {
		return 0, failure
	}
	value := int64(number)
	if float64(value) != number || value < -2147483648 || value > 2147483647 {
		return 0, ndPublic("Int")
	}
	return value, nil
}

// ndNonNegativeBound mirrors isNonNegativeInteger.
func ndNonNegativeBound(number float64) bool {
	return number == number && !math.IsInf(number, 0) && number >= 0 && math.Trunc(number) == number
}

func ndString(raw any) (string, *ndFailure) {
	if value, ok := raw.(string); ok {
		return value, nil
	}
	return "", ndPublic("String")
}

func ndBoolean(raw any) (bool, *ndFailure) {
	if value, ok := raw.(bool); ok {
		return value, nil
	}
	return false, ndPublic("Boolean")
}

func ndObject(raw any) (ntObject, *ndFailure) {
	if value, ok := ntObjectOf(raw); ok {
		return value, nil
	}
	return ntObject{}, ndPublic("Object")
}

func ndReify(value any) any {
	return ntNative(value)
}

// ndElementDecoder decodes one JSON value.
type ndElementDecoder func(raw any) (gopurs_runtime.Value, *ndFailure)

// ndArray mirrors decodeArray: first error wins and is wrapped in AtIndex.
func ndArray(raw any) ([]any, *ndFailure) {
	switch value := ndReify(raw).(type) {
	case []any:
		return value, nil
	case []gopurs_runtime.Value:
		out := make([]any, len(value))
		for i := range value {
			out[i] = ntNative(value[i])
		}
		return out, nil
	}
	return nil, ndPublic("Array")
}

func ndArrayOf(raw any, decode ndElementDecoder) ([]gopurs_runtime.Value, *ndFailure) {
	elements, failure := ndArray(raw)
	if failure != nil {
		return nil, failure
	}
	out := make([]gopurs_runtime.Value, 0, len(elements))
	for index, element := range elements {
		value, failure := decode(element)
		if failure != nil {
			return nil, &ndFailure{err: ntAtIndex(int64(index), failure.err)}
		}
		out = append(out, value)
	}
	return out, nil
}

// ndField mirrors getField: an absent key is MissingValue, a failure is wrapped
// in AtKey.
func ndField(obj ntObject, key string, decode ndElementDecoder) (gopurs_runtime.Value, *ndFailure) {
	raw, present := obj.Lookup(key)
	if !present {
		return gopurs_runtime.Value{}, &ndFailure{err: ntAtKey(key, ntMissingValue())}
	}
	value, failure := decode(raw)
	if failure != nil {
		return gopurs_runtime.Value{}, ndAtKey(key, failure)
	}
	return value, nil
}

// ndOptionalField mirrors getFieldOptional': absent or null is Nothing and
// decoding failures are not wrapped.
func ndOptionalField(obj ntObject, key string, decode ndElementDecoder) (gopurs_runtime.Value, *ndFailure) {
	raw, present := obj.Lookup(key)
	if !present || ndNullable(ndReify(raw)) {
		return ndNothing(), nil
	}
	value, failure := decode(raw)
	if failure != nil {
		return gopurs_runtime.Value{}, ndAtKey(key, failure)
	}
	return ntJust(value), nil
}

// ndConstructorType mirrors decodeConstructorType.
func ndConstructorType(raw any) (gopurs_runtime.Value, *ndFailure) {
	name, failure := ndString(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	switch name {
	case "ProductType":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagProductType}, nil
	case "SumType":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagSumType}, nil
	}
	return gopurs_runtime.Value{}, ndPublic("ConstructorType")
}

// ndMeta mirrors decodeMeta.
func ndMeta(raw any) (gopurs_runtime.Value, *ndFailure) {
	obj, failure := ndObject(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	kind, failure := ndField(obj, "metaType", func(value any) (gopurs_runtime.Value, *ndFailure) {
		name, failure := ndString(ndReify(value))
		if failure != nil {
			return gopurs_runtime.Value{}, failure
		}
		return gopurs_runtime.Str(name), nil
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	switch kind.StrVal() {
	case "IsConstructor":
		constructorType, failure := ndField(obj, "constructorType", ndConstructorType)
		if failure != nil {
			return gopurs_runtime.Value{}, failure
		}
		rawIdentifiers, present := obj.Lookup("identifiers")
		if !present {
			return gopurs_runtime.Value{}, &ndFailure{err: ntAtKey("identifiers", ntMissingValue())}
		}
		names, failure := ndArrayOf(rawIdentifiers, func(element any) (gopurs_runtime.Value, *ndFailure) {
			name, failure := ndString(ndReify(element))
			if failure != nil {
				return gopurs_runtime.Value{}, failure
			}
			return gopurs_runtime.Str(name), nil
		})
		if failure != nil {
			return gopurs_runtime.Value{}, ndAtKey("identifiers", failure)
		}
		identifiers := make([]string, len(names))
		for i, name := range names {
			identifiers[i] = name.StrVal()
		}
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsConstructor, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_IsConstructor{1, uint32(constructorType.IntVal), identifiers})}, nil
	case "IsNewtype":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsNewtype}, nil
	case "IsTypeClassConstructor":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsTypeClass}, nil
	case "IsForeign":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsForeign}, nil
	case "IsWhere":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsWhere}, nil
	case "IsSyntheticApp":
		return gopurs_runtime.Value{Type: 9, IntVal: ndTagMetaIsSyntheticApp}, nil
	}
	return gopurs_runtime.Value{}, ndPublic("Meta")
}

// ndSourceBindingId mirrors decodeSourceBindingId.
func ndSourceBindingId(moduleName string, raw any) (gopurs_runtime.Value, *ndFailure) {
	number, failure := ndNumber(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	bindingID := int64(number)
	if float64(bindingID) != number || bindingID < -2147483648 || bindingID > 2147483647 || bindingID < 0 {
		return gopurs_runtime.Value{}, ndPublic("nonnegative source bindingId within Int range")
	}
	return gopurs_runtime.RecordDict2("bindingId", "moduleName", gopurs_runtime.Int(bindingID), gopurs_runtime.Str(moduleName)), nil
}

// ndUsageBound mirrors decodeUsageBound: a non-negative integral number is
// accepted, Int.fromNumber may still yield Nothing.
func ndUsageBound(raw any) (gopurs_runtime.Value, *ndFailure) {
	number, failure := ndNumber(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	if !ndNonNegativeBound(number) {
		return gopurs_runtime.Value{}, ndPublic("nonnegative integral maxUses")
	}
	value := int64(number)
	if float64(value) != number || value > 2147483647 {
		return ndNothing(), nil
	}
	return ntJust(gopurs_runtime.Int(value)), nil
}

// ndBindingUsage mirrors decodeBindingUsage.
func ndBindingUsage(moduleName string, raw any) (gopurs_runtime.Value, *ndFailure) {
	obj, failure := ndObject(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	binding, failure := ndField(obj, "bindingId", func(value any) (gopurs_runtime.Value, *ndFailure) {
		return ndSourceBindingId(moduleName, value)
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	nested, failure := ndOptionalField(obj, "maxUses", ndUsageBound)
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	// join: Maybe (Maybe Int) -> Maybe Int
	maxUses := nested
	if nested.Type == 9 && nested.IntVal == ntTagJust && nested.UnsafePtr != nil {
		maxUses = (*Constructor_Data_Maybe_Just[gopurs_runtime.Value])(nested.UnsafePtr).V0
	} else {
		maxUses = ndNothing()
	}
	escaping, failure := ndOptionalField(obj, "hasEscapingUseContext", func(value any) (gopurs_runtime.Value, *ndFailure) {
		flag, failure := ndBoolean(ndReify(value))
		if failure != nil {
			return gopurs_runtime.Value{}, failure
		}
		return gopurs_runtime.Bool(flag), nil
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	return gopurs_runtime.RecordDict3("binding", "hasEscapingUseContext", "maxUses", binding, escaping, maxUses), nil
}

// ndVariableUse mirrors decodeVariableUse.
func ndVariableUse(moduleName string, raw any) (gopurs_runtime.Value, *ndFailure) {
	obj, failure := ndObject(ndReify(raw))
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	binding, failure := ndField(obj, "bindingId", func(value any) (gopurs_runtime.Value, *ndFailure) {
		return ndSourceBindingId(moduleName, value)
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	lastLocalUse, failure := ndOptionalField(obj, "lastLocalUse", func(value any) (gopurs_runtime.Value, *ndFailure) {
		flag, failure := ndBoolean(ndReify(value))
		if failure != nil {
			return gopurs_runtime.Value{}, failure
		}
		if !flag {
			return gopurs_runtime.Value{}, ndPublic("lastLocalUse true or null")
		}
		return gopurs_runtime.Bool(true), nil
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	return gopurs_runtime.RecordDict2("binding", "lastLocalUse", binding, lastLocalUse), nil
}

// ndSourceUsage mirrors decodeSourceUsage.
func ndSourceUsage(moduleName string, obj ntObject) (gopurs_runtime.Value, *ndFailure) {
	bindingUsage, failure := ndOptionalField(obj, "bindingUsage", func(value any) (gopurs_runtime.Value, *ndFailure) {
		return ndBindingUsage(moduleName, value)
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	variableUse, failure := ndOptionalField(obj, "variableUse", func(value any) (gopurs_runtime.Value, *ndFailure) {
		return ndVariableUse(moduleName, value)
	})
	if failure != nil {
		return gopurs_runtime.Value{}, failure
	}
	if bindingUsage.UnsafePtr == nil && variableUse.UnsafePtr == nil {
		return ndNothing(), nil
	}
	return ntJust(gopurs_runtime.RecordDict2("bindingUsage", "variableUse", bindingUsage, variableUse)), nil
}

// DecodeAnnWithUsageImpl mirrors decodeAnnWithUsage. The PureScript fallback
// argument is only used by the JavaScript backend.
func DecodeAnnWithUsageImpl(fallback gopurs_runtime.Value, moduleName gopurs_runtime.Value, typeTable gopurs_runtime.Value, path gopurs_runtime.Value, json gopurs_runtime.Value) gopurs_runtime.Value {
	_ = fallback
	_ = path
	obj, failure := ndObject(ntNative(json))
	if failure != nil {
		return ntLeft(failure.err)
	}
	name := moduleName.StrVal()
	meta, failure := ndOptionalField(obj, "meta", ndMeta)
	if failure != nil {
		return ntLeft(failure.err)
	}
	typeValue := ndNothing()
	rawType, present := obj.Lookup("type")
	if present && !ndNullable(ndReify(rawType)) {
		typeID, failure := ndInt(ndReify(rawType))
		if failure != nil {
			return ntLeft(failure.err)
		}
		if typeTable.Type == gopurs_runtime.TypeArray && typeTable.UnsafePtr != nil {
			types := *(*[]gopurs_runtime.Value)(typeTable.UnsafePtr)
			if typeID >= 0 && typeID < int64(len(types)) {
				typeValue = ntJust(types[typeID])
			}
		}
	}
	sourceUsage, failure := ndSourceUsage(name, obj)
	if failure != nil {
		return ntLeft(failure.err)
	}
	ann := gopurs_runtime.RecordDict4("meta", "sourceUsage", "span", "type",
		meta, sourceUsage, Get_PureScript_Backend_Optimizer_CoreFn_emptySpan(), typeValue)
	return ntRight(ann)
}

// ---------------------------------------------------------------------------
// Native CoreFn module decoder (decodeModule and all its helpers).
//
// The PureScript decoder stays the JavaScript implementation (through the
// fallback argument) and the reference for the canonical representation. Cold
// helpers whose generated specialisation is intricate (source spans, the
// foreign Map) are called through their generated functions.
// ---------------------------------------------------------------------------

const (
	cndTagJust              = 930809136
	cndTagLeft              = 3711209382
	cndTagRight             = 2465973597
	cndTagTuple             = 2339352186
	cndTagQualified         = 2183844549
	cndTagReExport          = 243426072
	cndTagNonRec            = 776125136
	cndTagRec               = 2111926015
	cndTagBinding           = 74370570
	cndTagExprVar           = 2055675025
	cndTagExprLit           = 232770309
	cndTagExprConstructor   = 697214492
	cndTagExprAccessor      = 3638357773
	cndTagExprUpdate        = 2514985317
	cndTagExprAbs           = 2721098116
	cndTagExprApp           = 519619125
	cndTagExprCase          = 2509734720
	cndTagExprLet           = 2588226569
	cndTagExprTypeApp       = 3654600589
	cndTagCaseAlternative   = 4007425008
	cndTagUnconditional     = 2417754510
	cndTagGuarded           = 1315856655
	cndTagGuard             = 1255105998
	cndTagBinderNull        = 3395565766
	cndTagBinderVar         = 1586641112
	cndTagBinderNamed       = 1365461886
	cndTagBinderConstructor = 1517657301
	cndTagBinderLit         = 1587391820
	cndTagLitInt            = 2360006889
	cndTagLitNumber         = 2070212633
	cndTagLitString         = 4269186735
	cndTagLitChar           = 4076406626
	cndTagLitBoolean        = 3580262718
	cndTagLitArray          = 2075623491
	cndTagLitRecord         = 3197411319
	cndTagProp              = 1651896758
	cndTagLineComment       = 3900658198
	cndTagBlockComment      = 4163130993
	cndTagTypeMismatch      = 2887704423
	cndTagAtIndex           = 1044667600
)

type cndFailure struct {
	err gopurs_runtime.Value
}

func cndFail(message string) {
	panic(cndFailure{err: ntTypeMismatch(message)})
}

func cndFailValue(err gopurs_runtime.Value) {
	panic(cndFailure{err: err})
}

func cndTry(run func() gopurs_runtime.Value) (result gopurs_runtime.Value, failure *cndFailure) {
	defer func() {
		if recovered := recover(); recovered != nil {
			if captured, ok := recovered.(cndFailure); ok {
				failure = &captured
				return
			}
			panic(recovered)
		}
	}()
	return run(), nil
}

func cndTryString(run func() string) (result string, failure *cndFailure) {
	if value, captured := cndTry(func() gopurs_runtime.Value { return gopurs_runtime.Str(run()) }); captured != nil {
		return "", captured
	} else {
		return value.StrVal(), nil
	}
}

func cndNothing() gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagJust}
}

func cndJust(value gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagJust, UnsafePtr: unsafe.Pointer(&Constructor_Data_Maybe_Just[gopurs_runtime.Value]{1, value})}
}

func cndIsJust(value gopurs_runtime.Value) bool {
	return value.Type == 9 && value.IntVal == cndTagJust && value.UnsafePtr != nil
}

func cndFromJust(value gopurs_runtime.Value) gopurs_runtime.Value {
	return (*Constructor_Data_Maybe_Just[gopurs_runtime.Value])(value.UnsafePtr).V0
}

func cndLeftPayload(value gopurs_runtime.Value) gopurs_runtime.Value {
	return (*Constructor_Data_Either_Left[gopurs_runtime.Value, gopurs_runtime.Value])(value.UnsafePtr).V0
}

func cndIsLeft(value gopurs_runtime.Value) bool {
	return value.Type == 9 && value.IntVal == cndTagLeft && value.UnsafePtr != nil
}

func cndLeft(err gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagLeft, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Left[gopurs_runtime.Value, gopurs_runtime.Value]{1, err})}
}

func cndRight(value gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagRight, UnsafePtr: unsafe.Pointer(&Constructor_Data_Either_Right[gopurs_runtime.Value, gopurs_runtime.Value]{1, value})}
}

func cndArray(values []gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Array(values)
}

func cndValues(value gopurs_runtime.Value) []gopurs_runtime.Value {
	if value.Type == gopurs_runtime.TypeArray && value.UnsafePtr != nil {
		return *(*[]gopurs_runtime.Value)(value.UnsafePtr)
	}
	return nil
}

func cndTuple(first, second gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagTuple, UnsafePtr: unsafe.Pointer(&Constructor_Data_Tuple_Tuple[gopurs_runtime.Value, gopurs_runtime.Value]{1, first, second})}
}

func cndStringArray(values []string) gopurs_runtime.Value {
	out := make([]gopurs_runtime.Value, len(values))
	for i, value := range values {
		out[i] = gopurs_runtime.Str(value)
	}
	return gopurs_runtime.Array(out)
}

func cndStrings(value gopurs_runtime.Value) []string {
	items := cndValues(value)
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item.StrVal()
	}
	return out
}

// ---- JSON accessors with the PureScript error messages ----

func cndString(raw any) string {
	if value, ok := ntNative(raw).(string); ok {
		return value
	}
	cndFail("String")
	return ""
}

func cndNumber(raw any) float64 {
	switch value := ntNative(raw).(type) {
	case float64:
		return value
	case int64:
		return float64(value)
	}
	cndFail("Number")
	return 0
}

func cndBoolean(raw any) bool {
	if value, ok := ntNative(raw).(bool); ok {
		return value
	}
	cndFail("Boolean")
	return false
}

func cndInt(raw any) int64 {
	number := cndNumber(raw)
	value := int64(number)
	if float64(value) != number || value < -2147483648 || value > 2147483647 {
		cndFail("Int")
	}
	return value
}

func cndObject(raw any) ntObject {
	if value, ok := ntObjectOf(ntNative(raw)); ok {
		return value
	}
	cndFail("Object")
	return ntObject{}
}

func cndElements(raw any) []any {
	switch value := ntNative(raw).(type) {
	case []any:
		return value
	case []gopurs_runtime.Value:
		out := make([]any, len(value))
		for i := range value {
			out[i] = ntNative(value[i])
		}
		return out
	}
	cndFail("Array")
	return nil
}

func cndIsNull(raw any) bool {
	return ntNative(raw) == nil
}

// ---- getField / getFieldOptional' / decodeArray ----

func cndFieldOf(obj ntObject, key string, decode func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	raw, present := obj.Lookup(key)
	if !present {
		cndFailValue(ntAtKey(key, ntMissingValue()))
	}
	value, failure := cndTry(func() gopurs_runtime.Value { return decode(raw) })
	if failure != nil {
		cndFailValue(ntAtKey(key, failure.err))
	}
	return value
}

func cndOptionalFieldOf(obj ntObject, key string, decode func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	raw, present := obj.Lookup(key)
	if !present || cndIsNull(raw) {
		return cndNothing()
	}
	value, failure := cndTry(func() gopurs_runtime.Value { return decode(raw) })
	if failure != nil {
		cndFailValue(ntAtKey(key, failure.err))
	}
	return cndJust(value)
}

func cndArrayOfField(obj ntObject, key string, decode func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	return cndFieldOf(obj, key, func(raw any) gopurs_runtime.Value {
		return cndArrayDecode(raw, decode)
	})
}

// cndArrayDecode mirrors decodeArray: first error wins, wrapped in AtIndex.
func cndArrayDecode(raw any, decode func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	elements := cndElements(raw)
	out := make([]gopurs_runtime.Value, 0, len(elements))
	for index, element := range elements {
		value, failure := cndTry(func() gopurs_runtime.Value { return decode(element) })
		if failure != nil {
			cndFailValue(gopurs_runtime.Value{Type: 9, IntVal: cndTagAtIndex, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_AtIndex{1, int64(index), failure.err})})
		}
		out = append(out, value)
	}
	return gopurs_runtime.Array(out)
}

// cndAlt mirrors alt: try the first decoder, otherwise the second.
func cndAlt(first func() gopurs_runtime.Value, second func() gopurs_runtime.Value) gopurs_runtime.Value {
	if value, failure := cndTry(first); failure == nil {
		return value
	}
	return second()
}

// ---- leaf decoders ----

func cndModuleName(raw any) string {
	values := cndValues(cndArrayDecode(raw, cndStringValue))
	parts := make([]string, len(values))
	for i, value := range values {
		parts[i] = value.StrVal()
	}
	return strings.Join(parts, ".")
}

func cndModuleNameValue(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Str(cndModuleName(raw))
}

func cndIdent(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Str(cndString(raw))
}

func cndQualified(raw any, nameDecode func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	obj := cndObject(raw)
	var maybe *Constructor_Data_Maybe_Just[string]
	if rawModule, present := obj.Lookup("moduleName"); present && !cndIsNull(rawModule) {
		name, failure := cndTryString(func() string { return cndModuleName(rawModule) })
		if failure != nil {
			cndFailValue(failure.err)
		}
		maybe = &Constructor_Data_Maybe_Just[string]{1, name}
	}
	rawIdentifier, present := obj.Lookup("identifier")
	if !present {
		cndFailValue(ntAtKey("identifier", ntMissingValue()))
	}
	identifier, failure := cndTryString(func() string { return nameDecode(rawIdentifier).StrVal() })
	if failure != nil {
		cndFailValue(ntAtKey("identifier", failure.err))
	}
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagQualified, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Qualified[string]{1, maybe, identifier})}
}

func cndStringLiteralValue(raw any) gopurs_runtime.Value {
	if value, ok := ntNative(raw).(string); ok {
		return gopurs_runtime.Str(value)
	}
	// map fromCodePointArray (decodeCodePointArray json), otherwise StringLiteral.
	if value, failure := cndTry(func() gopurs_runtime.Value {
		var builder strings.Builder
		for index, element := range cndElements(raw) {
			if _, failure := cndTry(func() gopurs_runtime.Value {
				codePoint := cndInt(element)
				if codePoint < 0 || codePoint > 0x10FFFF {
					cndFail("CodePoint")
				}
				builder.WriteRune(rune(codePoint))
				return gopurs_runtime.Value{}
			}); failure != nil {
				cndFailValue(gopurs_runtime.Value{Type: 9, IntVal: cndTagAtIndex, UnsafePtr: unsafe.Pointer(&Constructor_Data_Argonaut_Decode_Error_AtIndex{1, int64(index), failure.err})})
			}
		}
		return gopurs_runtime.Str(builder.String())
	}); failure == nil {
		return value
	}
	cndFail("StringLiteral")
	return gopurs_runtime.Value{}
}

func cndStringValue(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Str(cndString(raw))
}

func cndCharValue(raw any) gopurs_runtime.Value {
	text := cndString(raw)
	codeUnits := utf16.Encode([]rune(text))
	if len(codeUnits) != 1 {
		cndFail("Char")
	}
	return gopurs_runtime.Str(text)
}

func cndBooleanValue(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Bool(cndBoolean(raw))
}

func cndNumberValue(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Float(cndNumber(raw))
}

func cndIntValue(raw any) gopurs_runtime.Value {
	return gopurs_runtime.Int(cndInt(raw))
}

// ---- annotations ----

func cndEmptySpan() gopurs_runtime.Value {
	return Get_PureScript_Backend_Optimizer_CoreFn_emptySpan()
}

func cndMetaValue(raw any) gopurs_runtime.Value {
	value, failure := ndMeta(raw)
	if failure != nil {
		cndFailValue(failure.err)
	}
	return value
}

func cndTypeField(typeTable []gopurs_runtime.Value, obj ntObject) gopurs_runtime.Value {
	rawType, present := obj.Lookup("type")
	if !present || cndIsNull(rawType) {
		return cndNothing()
	}
	typeID := cndInt(rawType)
	if typeID >= 0 && typeID < int64(len(typeTable)) {
		return cndJust(typeTable[typeID])
	}
	return cndNothing()
}

func cndAnn(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	meta := cndOptionalFieldOf(obj, "meta", cndMetaValue)
	typeValue := cndTypeField(typeTable, obj)
	return gopurs_runtime.RecordDict4("meta", "sourceUsage", "span", "type",
		meta, cndNothing(), cndEmptySpan(), typeValue)
}

func cndAnnWithUsage(moduleName string, typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	meta := cndOptionalFieldOf(obj, "meta", cndMetaValue)
	typeValue := cndTypeField(typeTable, obj)
	usage, failure := ndSourceUsage(moduleName, obj)
	if failure != nil {
		cndFailValue(failure.err)
	}
	return gopurs_runtime.RecordDict4("meta", "sourceUsage", "span", "type",
		meta, usage, cndEmptySpan(), typeValue)
}

// Coupling: this calls the generated PureScript decodeSourceSpan and converts
// its specialised result into the canonical records. The source position JSON
// is decoded through the Argonaut DecodeJson (Tuple Int Int) instance, and
// reproducing that instance natively is possible but not worth the risk for a
// cold path (two positions per module). The generated name is stable for a
// given PBO version; a rename fails the build loudly, never silently.
func cndSourceSpan(path string, raw any) gopurs_runtime.Value {
	jsonValue := gopurs_runtime.Box(ntNative(raw))
	result := Call_PureScript_Backend_Optimizer_CoreFn_Json_decodeSourceSpan(path, jsonValue)
	if !result.V2 {
		cndFailValue(result.V0)
	}
	position := func(column, line int64) gopurs_runtime.Value {
		return gopurs_runtime.RecordDict2("column", "line", gopurs_runtime.Int(column), gopurs_runtime.Int(line))
	}
	return gopurs_runtime.RecordDict3("end", "path", "start",
		position(result.V1.end.column, result.V1.end.line),
		gopurs_runtime.Str(result.V1.path),
		position(result.V1.start.column, result.V1.start.line))
}

// ---- expressions ----

type cndAnnDecoder func(any) gopurs_runtime.Value

func cndExpr(typeTable []gopurs_runtime.Value, decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	ann := cndFieldOf(obj, "annotation", decAnn)
	kind := cndString(cndFieldOf(obj, "type", cndStringValue))
	expr := func() gopurs_runtime.Value {
		switch kind {
		case "Var":
			qualified := cndFieldOf(obj, "value", func(value any) gopurs_runtime.Value {
				return cndQualified(value, cndIdent)
			})
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprVar, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprVar[gopurs_runtime.Value]{1, ann, (*Constructor_PureScript_Backend_Optimizer_CoreFn_Qualified[string])(qualified.UnsafePtr)})}
		case "Literal":
			literal := cndFieldOf(obj, "value", func(value any) gopurs_runtime.Value {
				return cndLiteral(func(inner any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, inner) }, value)
			})
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprLit, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprLit[gopurs_runtime.Value]{1, ann, literal})}
		case "Constructor":
			tyn := cndFieldOf(obj, "typeName", cndStringValue)
			con := cndAlt(func() gopurs_runtime.Value { return cndFieldOf(obj, "name", cndIdent) },
				func() gopurs_runtime.Value { return cndFieldOf(obj, "constructorName", cndIdent) })
			fields := cndAlt(
				func() gopurs_runtime.Value { return cndArrayOfField(obj, "fields", cndStringLiteralValue) },
				func() gopurs_runtime.Value { return cndArrayOfField(obj, "fieldNames", cndStringLiteralValue) })
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprConstructor, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprConstructor[gopurs_runtime.Value]{1, ann, tyn.StrVal(), con.StrVal(), cndStrings(fields)})}
		case "Accessor":
			inner := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			field := cndFieldOf(obj, "fieldName", cndStringLiteralValue)
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprAccessor, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprAccessor[gopurs_runtime.Value]{1, ann, inner, field.StrVal()})}
		case "ObjectUpdate":
			inner := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			updates := cndFieldOf(obj, "updates", func(value any) gopurs_runtime.Value {
				return cndRecord(value, func(inner any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, inner) })
			})
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprUpdate, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprUpdate[gopurs_runtime.Value]{1, ann, inner, cndProps(updates)})}
		case "Abs":
			argument := cndFieldOf(obj, "argument", cndIdent)
			body := cndFieldOf(obj, "body", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprAbs, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprAbs[gopurs_runtime.Value]{1, ann, argument.StrVal(), body})}
		case "App":
			fn := cndFieldOf(obj, "abstraction", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			arg := cndFieldOf(obj, "argument", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprApp, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprApp[gopurs_runtime.Value]{1, ann, fn, arg})}
		case "TypeApp":
			inner := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			argument := cndFieldOf(obj, "typeArgument", cndIntValue)
			id := argument.IntVal
			if id < 0 || id >= int64(len(typeTable)) {
				cndFail("ExprTypeApp")
			}
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprTypeApp, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprTypeApp[gopurs_runtime.Value]{1, ann, inner, typeTable[id]})}
		case "Case":
			values := cndArrayOfField(obj, "caseExpressions", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			alternatives := cndArrayOfField(obj, "caseAlternatives", func(value any) gopurs_runtime.Value { return cndCaseAlternative(typeTable, decAnn, value) })
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprCase, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprCase[gopurs_runtime.Value]{1, ann, cndValues(values), cndAlternatives(alternatives)})}
		case "Let":
			binds := cndArrayOfField(obj, "binds", func(value any) gopurs_runtime.Value { return cndBind(typeTable, decAnn, value) })
			body := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
			return gopurs_runtime.Value{Type: 9, IntVal: cndTagExprLet, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ExprLet[gopurs_runtime.Value]{1, ann, cndValues(binds), body})}
		}
		cndFail("Expr")
		return gopurs_runtime.Value{}
	}()
	return expr
}

func cndAlternatives(value gopurs_runtime.Value) []*Constructor_PureScript_Backend_Optimizer_CoreFn_CaseAlternative[gopurs_runtime.Value] {
	items := cndValues(value)
	out := make([]*Constructor_PureScript_Backend_Optimizer_CoreFn_CaseAlternative[gopurs_runtime.Value], len(items))
	for i, item := range items {
		out[i] = (*Constructor_PureScript_Backend_Optimizer_CoreFn_CaseAlternative[gopurs_runtime.Value])(item.UnsafePtr)
	}
	return out
}

func cndProps(value gopurs_runtime.Value) []*Constructor_PureScript_Backend_Optimizer_CoreFn_Prop[gopurs_runtime.Value] {
	items := cndValues(value)
	out := make([]*Constructor_PureScript_Backend_Optimizer_CoreFn_Prop[gopurs_runtime.Value], len(items))
	for i, item := range items {
		out[i] = (*Constructor_PureScript_Backend_Optimizer_CoreFn_Prop[gopurs_runtime.Value])(item.UnsafePtr)
	}
	return out
}

func cndCaseAlternative(typeTable []gopurs_runtime.Value, decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	binders := cndArrayOfField(obj, "binders", func(value any) gopurs_runtime.Value { return cndBinder(decAnn, value) })
	guarded := cndFieldOf(obj, "isGuarded", func(value any) gopurs_runtime.Value { return cndBooleanValue(value) })
	var result gopurs_runtime.Value
	if guarded.BoolVal() {
		expressions := cndArrayOfField(obj, "expressions", func(value any) gopurs_runtime.Value { return cndGuard(typeTable, decAnn, value) })
		guards := cndValues(expressions)
		pointers := make([]*Constructor_PureScript_Backend_Optimizer_CoreFn_Guard[gopurs_runtime.Value], len(guards))
		for i, guard := range guards {
			pointers[i] = (*Constructor_PureScript_Backend_Optimizer_CoreFn_Guard[gopurs_runtime.Value])(guard.UnsafePtr)
		}
		result = gopurs_runtime.Value{Type: 9, IntVal: cndTagGuarded, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Guarded[gopurs_runtime.Value]{1, pointers})}
	} else {
		expression := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
		result = gopurs_runtime.Value{Type: 9, IntVal: cndTagUnconditional, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Unconditional[gopurs_runtime.Value]{1, expression})}
	}
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagCaseAlternative, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_CaseAlternative[gopurs_runtime.Value]{1, cndValues(binders), result})}
}

func cndGuard(typeTable []gopurs_runtime.Value, decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	guard := cndFieldOf(obj, "guard", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
	expression := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagGuard, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Guard[gopurs_runtime.Value]{1, guard, expression})}
}

// ---- binders and literals ----

func cndBinder(decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	ann := cndFieldOf(obj, "annotation", decAnn)
	kind := cndString(cndFieldOf(obj, "binderType", cndStringValue))
	switch kind {
	case "NullBinder":
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinderNull, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BinderNull[gopurs_runtime.Value]{1, ann})}
	case "VarBinder":
		identifier := cndFieldOf(obj, "identifier", cndIdent)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinderVar, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BinderVar[gopurs_runtime.Value]{1, ann, identifier.StrVal()})}
	case "LiteralBinder":
		literal := cndFieldOf(obj, "literal", func(value any) gopurs_runtime.Value {
			return cndLiteral(func(inner any) gopurs_runtime.Value { return cndBinder(decAnn, inner) }, value)
		})
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinderLit, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BinderLit[gopurs_runtime.Value]{1, ann, literal})}
	case "ConstructorBinder":
		tyn := cndFieldOf(obj, "typeName", func(value any) gopurs_runtime.Value {
			return cndQualified(value, func(inner any) gopurs_runtime.Value { return gopurs_runtime.Str(cndString(inner)) })
		})
		con := cndAlt(
			func() gopurs_runtime.Value {
				return cndFieldOf(obj, "name", func(value any) gopurs_runtime.Value {
					return cndQualified(value, cndIdent)
				})
			},
			func() gopurs_runtime.Value {
				return cndFieldOf(obj, "constructorName", func(value any) gopurs_runtime.Value {
					return cndQualified(value, cndIdent)
				})
			})
		binders := cndArrayOfField(obj, "binders", func(value any) gopurs_runtime.Value { return cndBinder(decAnn, value) })
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinderConstructor, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BinderConstructor[gopurs_runtime.Value]{1, ann, (*Constructor_PureScript_Backend_Optimizer_CoreFn_Qualified[string])(tyn.UnsafePtr), (*Constructor_PureScript_Backend_Optimizer_CoreFn_Qualified[string])(con.UnsafePtr), cndValues(binders)})}
	case "NamedBinder":
		identifier := cndFieldOf(obj, "identifier", cndIdent)
		binder := cndFieldOf(obj, "binder", func(value any) gopurs_runtime.Value { return cndBinder(decAnn, value) })
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinderNamed, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BinderNamed[gopurs_runtime.Value]{1, ann, identifier.StrVal(), binder})}
	}
	cndFail("Binder")
	return gopurs_runtime.Value{}
}

func cndLiteral(dec func(any) gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	kind := cndString(cndFieldOf(obj, "literalType", cndStringValue))
	switch kind {
	case "IntLiteral":
		value := cndFieldOf(obj, "value", cndIntValue)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitInt, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitInt[gopurs_runtime.Value]{1, value.IntVal})}
	case "NumberLiteral":
		value := cndFieldOf(obj, "value", cndNumberValue)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitNumber, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitNumber[gopurs_runtime.Value]{1, float64(value.FloatVal())})}
	case "StringLiteral":
		value := cndFieldOf(obj, "value", cndStringLiteralValue)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitString, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitString[gopurs_runtime.Value]{1, value.StrVal()})}
	case "CharLiteral":
		value := cndFieldOf(obj, "value", cndCharValue)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitChar, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitChar[gopurs_runtime.Value]{1, value.StrVal()})}
	case "BooleanLiteral":
		value := cndFieldOf(obj, "value", cndBooleanValue)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitBoolean, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitBoolean[gopurs_runtime.Value]{1, value.BoolVal()})}
	case "ArrayLiteral":
		value := cndFieldOf(obj, "value", func(inner any) gopurs_runtime.Value { return cndArrayDecode(inner, dec) })
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitArray, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitArray[gopurs_runtime.Value]{1, cndValues(value)})}
	case "ObjectLiteral":
		value := cndFieldOf(obj, "value", func(inner any) gopurs_runtime.Value { return cndRecord(inner, dec) })
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLitRecord, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LitRecord[gopurs_runtime.Value]{1, cndProps(value)})}
	}
	cndFail("Literal")
	return gopurs_runtime.Value{}
}

// cndRecord mirrors decodeRecord = decodeArray <<< decodeProp.
func cndRecord(raw any, dec func(any) gopurs_runtime.Value) gopurs_runtime.Value {
	return cndArrayDecode(raw, func(element any) gopurs_runtime.Value {
		elements := cndElements(element)
		if len(elements) != 2 {
			cndFail("Tuple")
		}
		key := cndStringLiteralValue(elements[0])
		value := dec(elements[1])
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagProp, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Prop[gopurs_runtime.Value]{1, key.StrVal(), value})}
	})
}

func cndComment(raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	if value, failure := cndTry(func() gopurs_runtime.Value { return cndFieldOf(obj, "LineComment", cndStringValue) }); failure == nil {
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagLineComment, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_LineComment{1, value.StrVal()})}
	}
	value := cndFieldOf(obj, "BlockComment", cndStringValue)
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagBlockComment, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_BlockComment{1, value.StrVal()})}
}

// ---- binds and module parts ----

func cndBind(typeTable []gopurs_runtime.Value, decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	kind := cndString(cndFieldOf(obj, "bindType", cndStringValue))
	switch kind {
	case "NonRec":
		binding := cndBinding(typeTable, decAnn, obj)
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagNonRec, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_NonRec[gopurs_runtime.Value]{1, cndBindingPointer(binding)})}
	case "Rec":
		binds := cndArrayOfField(obj, "binds", func(value any) gopurs_runtime.Value {
			return cndBinding(typeTable, decAnn, cndObject(value))
		})
		bindings := make([]*Constructor_PureScript_Backend_Optimizer_CoreFn_Binding[gopurs_runtime.Value], 0, len(cndValues(binds)))
		for _, binding := range cndValues(binds) {
			bindings = append(bindings, cndBindingPointer(binding))
		}
		return gopurs_runtime.Value{Type: 9, IntVal: cndTagRec, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Rec[gopurs_runtime.Value]{1, bindings})}
	}
	cndFail("Bind")
	return gopurs_runtime.Value{}
}

func cndBindingPointer(value gopurs_runtime.Value) *Constructor_PureScript_Backend_Optimizer_CoreFn_Binding[gopurs_runtime.Value] {
	return (*Constructor_PureScript_Backend_Optimizer_CoreFn_Binding[gopurs_runtime.Value])(value.UnsafePtr)
}

func cndBinding(typeTable []gopurs_runtime.Value, decAnn cndAnnDecoder, obj ntObject) gopurs_runtime.Value {
	ann := cndFieldOf(obj, "annotation", decAnn)
	identifier := cndFieldOf(obj, "identifier", cndIdent)
	expression := cndFieldOf(obj, "expression", func(value any) gopurs_runtime.Value { return cndExpr(typeTable, decAnn, value) })
	return gopurs_runtime.Value{Type: 9, IntVal: cndTagBinding, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Binding[gopurs_runtime.Value]{1, ann, identifier.StrVal(), expression})}
}

func cndImport(decAnn cndAnnDecoder, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	ann := cndFieldOf(obj, "annotation", decAnn)
	name := cndFieldOf(obj, "moduleName", cndModuleNameValue)
	return gopurs_runtime.Value{Type: 9, IntVal: 2024897590, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_Import[gopurs_runtime.Value]{1, ann, name.StrVal()})}
}

func cndReExports(raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	keys := obj.Keys()
	sort.Strings(keys)
	out := make([]gopurs_runtime.Value, 0)
	for _, moduleName := range keys {
		// decodeReExports decodes each value directly with decodeArray; there is
		// no getField wrapper, so failures are not tagged with the key.
		rawIdents, _ := obj.Lookup(moduleName)
		idents := cndArrayDecode(ntNative(rawIdents), cndIdent)
		for _, ident := range cndValues(idents) {
			out = append(out, gopurs_runtime.Value{Type: 9, IntVal: cndTagReExport, UnsafePtr: unsafe.Pointer(&Constructor_PureScript_Backend_Optimizer_CoreFn_ReExport{1, moduleName, ident.StrVal()})})
		}
	}
	return gopurs_runtime.Array(out)
}

func cndDataConstructor(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	name := cndAlt(
		func() gopurs_runtime.Value { return cndFieldOf(obj, "name", cndStringValue) },
		func() gopurs_runtime.Value { return cndFieldOf(obj, "constructorName", cndStringValue) })
	fieldIDs := cndAlt(
		func() gopurs_runtime.Value { return cndArrayOfField(obj, "fields", cndIntValue) },
		func() gopurs_runtime.Value { return cndArrayOfField(obj, "fieldTypes", cndIntValue) })
	fields := make([]gopurs_runtime.Value, 0, len(cndValues(fieldIDs)))
	for _, fieldID := range cndValues(fieldIDs) {
		id := fieldID.IntVal
		if id < 0 || id >= int64(len(typeTable)) {
			cndFail("ConstructorField")
		}
		fields = append(fields, typeTable[id])
	}
	return gopurs_runtime.RecordDict2("fields", "name", gopurs_runtime.Array(fields), gopurs_runtime.Str(name.StrVal()))
}

func cndDataDecl(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	name := cndAlt(
		func() gopurs_runtime.Value { return cndFieldOf(obj, "name", cndStringValue) },
		func() gopurs_runtime.Value { return cndFieldOf(obj, "typeName", cndStringValue) })
	mbVars := cndAlt(
		func() gopurs_runtime.Value {
			return cndOptionalFieldOf(obj, "vars", func(value any) gopurs_runtime.Value { return cndArrayDecode(value, cndStringValue) })
		},
		func() gopurs_runtime.Value {
			return cndOptionalFieldOf(obj, "typeVars", func(value any) gopurs_runtime.Value { return cndArrayDecode(value, cndStringValue) })
		})
	constructors := cndArrayOfField(obj, "constructors", func(value any) gopurs_runtime.Value { return cndDataConstructor(typeTable, value) })
	vars := gopurs_runtime.Array(nil)
	if cndIsJust(mbVars) {
		vars = cndFromJust(mbVars)
	}
	return gopurs_runtime.RecordDict3("constructors", "name", "vars",
		constructors, gopurs_runtime.Str(name.StrVal()), vars)
}

func cndClassDecl(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	name := cndFieldOf(obj, "name", cndStringValue)
	mbVars := cndOptionalFieldOf(obj, "vars", func(value any) gopurs_runtime.Value { return cndArrayDecode(value, cndStringValue) })
	var vars gopurs_runtime.Value
	if cndIsJust(mbVars) {
		vars = cndFromJust(mbVars)
	} else {
		vars = gopurs_runtime.Array(nil)
	}
	superclasses := cndArrayOfField(obj, "superclasses", func(value any) gopurs_runtime.Value { return cndConstraint(typeTable, value) })
	methods := cndArrayOfField(obj, "methods", func(value any) gopurs_runtime.Value { return cndMethod(typeTable, value) })
	return gopurs_runtime.RecordDict4("methods", "name", "superclasses", "vars",
		methods, gopurs_runtime.Str(name.StrVal()), superclasses, vars)
}

func cndMethod(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	name := cndFieldOf(obj, "name", cndStringValue)
	typeID := cndFieldOf(obj, "type", cndIntValue)
	id := typeID.IntVal
	if id < 0 || id >= int64(len(typeTable)) {
		cndFail("MethodType")
	}
	return cndTuple(name, typeTable[id])
}

func cndConstraint(typeTable []gopurs_runtime.Value, raw any) gopurs_runtime.Value {
	obj := cndObject(raw)
	fqn := cndArrayOfField(obj, "fqn", cndStringValue)
	argIDs := cndArrayOfField(obj, "args", cndIntValue)
	args := make([]gopurs_runtime.Value, 0, len(cndValues(argIDs)))
	for _, argID := range cndValues(argIDs) {
		id := argID.IntVal
		if id < 0 || id >= int64(len(typeTable)) {
			cndFail("ConstraintArg")
		}
		args = append(args, typeTable[id])
	}
	return cndTuple(fqn, gopurs_runtime.Array(args))
}

// ---- module ----

func cndModulePrime(moduleName string, obj ntObject, path string) gopurs_runtime.Value {
	typeTable := []gopurs_runtime.Value{}
	if rawTypeTable, present := obj.Lookup("typeTable"); present && !cndIsNull(rawTypeTable) {
		decoded := decodeTypeTableNative(ntNative(rawTypeTable))
		if cndIsLeft(decoded) {
			cndFailValue(ntAtKey("typeTable", cndLeftPayload(decoded)))
		}
		typeTable = cndValues((*Constructor_Data_Either_Right[gopurs_runtime.Value, gopurs_runtime.Value])(decoded.UnsafePtr).V0)
	}
	decAnn := func(raw any) gopurs_runtime.Value { return cndAnnWithUsage(moduleName, typeTable, raw) }
	span := cndFieldOf(obj, "sourceSpan", func(value any) gopurs_runtime.Value { return cndSourceSpan(path, value) })
	imports := cndArrayOfField(obj, "imports", func(value any) gopurs_runtime.Value { return cndImport(decAnn, value) })
	exports := cndArrayOfField(obj, "exports", cndIdent)
	reExports := cndFieldOf(obj, "reExports", cndReExports)
	mbDataDecls := cndOptionalFieldOf(obj, "dataDecls", func(value any) gopurs_runtime.Value {
		return cndArrayDecode(value, func(inner any) gopurs_runtime.Value { return cndDataDecl(typeTable, inner) })
	})
	var dataDecls []gopurs_runtime.Value
	if cndIsJust(mbDataDecls) {
		dataDecls = cndValues(cndFromJust(mbDataDecls))
	}
	mbClassDecls := cndOptionalFieldOf(obj, "classDecls", func(value any) gopurs_runtime.Value {
		return cndArrayDecode(value, func(inner any) gopurs_runtime.Value { return cndClassDecl(typeTable, inner) })
	})
	var classDecls []gopurs_runtime.Value
	if cndIsJust(mbClassDecls) {
		classDecls = cndValues(cndFromJust(mbClassDecls))
	}
	decls := cndArrayOfField(obj, "decls", func(value any) gopurs_runtime.Value { return cndBind(typeTable, decAnn, value) })
	foreignArr := cndArrayOfField(obj, "foreign", cndIdent)
	var foreignAnnotations ntObject
	if rawAnnotations, present := obj.Lookup("foreignAnnotations"); present && !cndIsNull(rawAnnotations) {
		if _, failure := cndTry(func() gopurs_runtime.Value {
			foreignAnnotations = cndObject(rawAnnotations)
			return gopurs_runtime.Value{}
		}); failure != nil {
			cndFailValue(ntAtKey("foreignAnnotations", failure.err))
		}
	}
	foreignList := make([]gopurs_runtime.Value, 0, len(cndValues(foreignArr)))
	for _, ident := range cndValues(foreignArr) {
		typeValue := cndNothing()
		if rawAnn, ok := foreignAnnotations.Lookup(ident.StrVal()); ok {
			ann := cndAnn(typeTable, rawAnn)
			typeValue = gopurs_runtime.RecordGet(ann, "type")
		}
		foreignList = append(foreignList, cndTuple(gopurs_runtime.Str(ident.StrVal()), typeValue))
	}
	// Coupling: the foreign annotations map is built by the generated
	// specialised Map.fromFoldable (the Map is an opaque native structure).
	// Calling the Map FFI insert path directly would require the Ord String
	// comparator as a Value; the generated helper is stable for a given PBO
	// version and a rename fails the build loudly.
	foreignMap := Call_Data_Map_Internal_fromFoldable__1911179134(gopurs_runtime.Array(foreignList))
	comments := cndArrayOfField(obj, "comments", cndComment)
	return gopurs_runtime.RecordDict(
		[]string{"classDecls", "comments", "dataDecls", "decls", "exports", "foreign", "imports", "name", "path", "reExports", "span"},
		[]gopurs_runtime.Value{
			gopurs_runtime.Array(classDecls),
			comments,
			gopurs_runtime.Array(dataDecls),
			decls,
			exports,
			foreignMap,
			imports,
			gopurs_runtime.Str(moduleName),
			gopurs_runtime.Str(path),
			reExports,
			span,
		})
}

// DecodeModuleImpl mirrors CoreFn.Json.decodeModule. The PureScript fallback
// argument is only used by the JavaScript backend.
func DecodeModuleImpl(fallback gopurs_runtime.Value, validate gopurs_runtime.Value, json gopurs_runtime.Value) (result gopurs_runtime.Value) {
	_ = fallback
	defer func() {
		if recovered := recover(); recovered != nil {
			if failure, ok := recovered.(cndFailure); ok {
				result = cndLeft(failure.err)
				return
			}
			panic(recovered)
		}
	}()
	obj := cndObject(json)
	name := cndFieldOf(obj, "moduleName", cndModuleNameValue)
	path := cndFieldOf(obj, "modulePath", cndStringValue)
	module := cndModulePrime(name.StrVal(), obj, path.StrVal())
	validation := gopurs_runtime.Apply(validate, module)
	if cndIsLeft(validation) {
		cndFailValue(cndLeftPayload(validation))
	}
	return cndRight(module)
}
