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
	"strings"
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
	case map[string]any:
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

func ntStringField(obj map[string]any, key string) (string, gopurs_runtime.Value, bool) {
	raw, ok := obj[key]
	if !ok {
		return "", ntAtKey(key, ntMissingValue()), false
	}
	value, ok := ntNative(raw).(string)
	if !ok {
		return "", ntAtKey(key, ntTypeMismatch("Failed decode")), false
	}
	return value, gopurs_runtime.Value{}, true
}

func ntIntField(obj map[string]any, key string) (int64, gopurs_runtime.Value, bool) {
	raw, ok := obj[key]
	if !ok {
		return 0, ntAtKey(key, ntMissingValue()), false
	}
	value, err, ok := ntInt(raw)
	if !ok {
		return 0, ntAtKey(key, err), false
	}
	return value, gopurs_runtime.Value{}, true
}

func ntStringArrayField(obj map[string]any, key string) ([]string, gopurs_runtime.Value, bool) {
	raw, ok := obj[key]
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

func ntIntArrayField(obj map[string]any, key string) ([]int64, gopurs_runtime.Value, bool) {
	raw, ok := obj[key]
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
	kind  uint8
	ok    bool
	err   gopurs_runtime.Value
	value gopurs_runtime.Value

	name  string
	fqn   []string
	args  []int64
	ctor  int64
	fargs []int64
	ret   int64
	el    int64
	row   int64

	fields   []ntFieldRef
	tailKind uint8
	tail     int64
	tailErr  gopurs_runtime.Value

	vars []string
	body int64

	constraints []ntConstraintRef
	bodyKind    uint8
	bodyErr     gopurs_runtime.Value

	argsErr gopurs_runtime.Value
	argsOK  bool
}

func (t *ntTable) decodeRef(entry gopurs_runtime.Value) ntRef {
	raw := ntNative(entry)
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
			return ntRef{err: ntTypeMismatch("ExprType")}
		}
	}
	obj, ok := raw.(map[string]any)
	if !ok {
		return ntRef{err: ntTypeMismatch("ExprType")}
	}
	typRaw, hasType := obj["type"]
	typ, typOK := ntNative(typRaw).(string)
	if !hasType || !typOK {
		if tvRaw, ok := obj["TypeVar"]; ok {
			if name, ok := ntNative(tvRaw).(string); ok {
				return ntRef{ok: true, kind: ntRefStatic, value: ntTypeVar(name)}
			}
		}
		return ntRef{err: ntAtKey("type", ntMissingValue())}
	}
	switch typ {
	case "Adt":
		fqn, err, ok := ntStringArrayField(obj, "fqn")
		if !ok {
			return ntRef{err: err}
		}
		args, err, ok := ntIntArrayField(obj, "args")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefADT, name: strings.Join(fqn, "."), fqn: fqn, args: args}
	case "TypeApp":
		ctor, err, ok := ntIntField(obj, "constructor")
		if !ok {
			return ntRef{err: err}
		}
		args, argsErr, argsOK := ntIntArrayField(obj, "args")
		return ntRef{ok: true, kind: ntRefTypeApp, ctor: ctor, args: args, argsOK: argsOK, argsErr: argsErr}
	case "Func":
		args, err, ok := ntIntArrayField(obj, "args")
		if !ok {
			return ntRef{err: err}
		}
		ret, err, ok := ntIntField(obj, "ret")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefFunc, fargs: args, ret: ret}
	case "Array":
		el, err, ok := ntIntField(obj, "element")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefArray, el: el}
	case "TypeVar":
		name, err, ok := ntStringField(obj, "name")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefStatic, value: ntTypeVar(name)}
	case "Record":
		row, err, ok := ntIntField(obj, "row")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefRecord, row: row}
	case "Row":
		fields, err, ok := ntDecodeFields(obj)
		if !ok {
			return ntRef{err: err}
		}
		ref := ntRef{ok: true, kind: ntRefRow, fields: fields, tailKind: ntTailNone}
		if tailRaw, present := obj["tail"]; present {
			if isNull, known := ntIsNull(tailRaw); !known {
				return ntRef{err: ntAtKey("tail", ntTypeMismatch("Failed decode"))}
			} else if !isNull {
				tail, tailErr, ok := ntInt(tailRaw)
				if !ok {
					ref.tailKind = ntTailError
					ref.tailErr = tailErr
				} else {
					ref.tailKind = ntTailJust
					ref.tail = tail
				}
			}
		}
		return ref
	case "ForAll":
		vars, err, ok := ntStringArrayField(obj, "vars")
		if !ok {
			return ntRef{err: err}
		}
		body, err, ok := ntIntField(obj, "body")
		if !ok {
			return ntRef{err: err}
		}
		return ntRef{ok: true, kind: ntRefForAll, vars: vars, body: body}
	case "ConstrainedType":
		constraints, err, ok := ntDecodeConstraints(obj)
		if !ok {
			return ntRef{err: err}
		}
		ref := ntRef{ok: true, kind: ntRefConstrained, constraints: constraints}
		bodyRaw, present := obj["body"]
		if !present {
			ref.bodyKind = ntBodyError
			ref.bodyErr = ntAtKey("body", ntMissingValue())
			return ref
		}
		body, bodyErr, ok := ntInt(bodyRaw)
		if !ok {
			ref.bodyKind = ntBodyError
			ref.bodyErr = ntAtKey("body", bodyErr)
			return ref
		}
		ref.body = body
		return ref
	case "TypeLevelString":
		value, err, ok := ntStringField(obj, "value")
		if !ok {
			return ntRef{err: err}
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
		return ntRef{err: ntTypeMismatch("ExprType")}
	}
}

func ntDecodeFields(obj map[string]any) ([]ntFieldRef, gopurs_runtime.Value, bool) {
	raw, ok := obj["fields"]
	if !ok {
		return nil, ntAtKey("fields", ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey("fields", ntTypeMismatch("Failed decode")), false
	}
	out := make([]ntFieldRef, len(arr))
	for i, element := range arr {
		field, ok := ntNative(element).(map[string]any)
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

func ntDecodeConstraints(obj map[string]any) ([]ntConstraintRef, gopurs_runtime.Value, bool) {
	raw, ok := obj["constraints"]
	if !ok {
		return nil, ntAtKey("constraints", ntMissingValue()), false
	}
	arr, ok := ntNative(raw).([]any)
	if !ok {
		return nil, ntAtKey("constraints", ntTypeMismatch("Failed decode")), false
	}
	out := make([]ntConstraintRef, len(arr))
	for i, element := range arr {
		constraint, ok := ntNative(element).(map[string]any)
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
	errs    []gopurs_runtime.Value
	types   []gopurs_runtime.Value
}

func (t *ntTable) set(id int64, result ntResult) {
	if result.right {
		t.state[id] = 2
		t.types[id] = result.value
	} else {
		t.state[id] = 1
		t.errs[id] = result.value
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
		return ntResult{ok: true, right: true, value: t.types[id]}
	case 1:
		return ntResult{ok: true, right: false, value: t.errs[id]}
	}
	if force {
		return ntResult{ok: true, right: true, value: ntStaticValue(ntTagAny)}
	}
	return ntResult{}
}

func (t *ntTable) resolveArgs(args []int64, force bool) ntResult {
	values := make([]gopurs_runtime.Value, 0, len(args))
	waiting := false
	firstErr := gopurs_runtime.Value{}
	hasErr := false
	for _, id := range args {
		resolved := t.resolveId(id, force)
		if !resolved.ok {
			waiting = true
			continue
		}
		if !resolved.right {
			if !hasErr {
				firstErr = resolved.value
				hasErr = true
			}
			continue
		}
		values = append(values, resolved.value)
	}
	if waiting {
		return ntResult{}
	}
	if hasErr {
		return ntResult{ok: true, right: false, value: firstErr}
	}
	return ntResult{ok: true, right: true, value: gopurs_runtime.Array(values), slice: values}
}

func (t *ntTable) resolveType(ref *ntRef, force bool) ntResult {
	if !ref.ok {
		return ntResult{ok: true, right: false, value: ref.err}
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
		return ntResult{ok: true, right: true, value: ntADT(ref.name, ref.fqn, args.slice)}
	case ntRefTypeApp:
		ctor := t.resolveId(ref.ctor, force)
		if !ctor.ok {
			return ntResult{}
		}
		if !ctor.right {
			return ctor
		}
		if !ref.argsOK {
			return ntResult{ok: true, right: false, value: ref.argsErr}
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
		args := t.resolveArgs(ref.fargs, force)
		ret := t.resolveId(ref.ret, force)
		if args.ok && !args.right {
			return args
		}
		if ret.ok && !ret.right {
			return ret
		}
		if args.ok && ret.ok {
			return ntResult{ok: true, right: true, value: ntFunc(args.slice, ret.value)}
		}
		return ntResult{}
	case ntRefArray:
		element := t.resolveId(ref.el, force)
		if !element.ok {
			return ntResult{}
		}
		if !element.right {
			return element
		}
		return ntResult{ok: true, right: true, value: ntArrayType(element.value)}
	case ntRefRecord:
		row := t.resolveId(ref.row, force)
		if !row.ok {
			return ntResult{}
		}
		if !row.right {
			return row
		}
		return ntResult{ok: true, right: true, value: ntRecordType(row.value)}
	case ntRefRow:
		resolved := make([]ntResult, len(ref.fields))
		for i := range ref.fields {
			field := t.resolveId(ref.fields[i].typeId, force)
			if !field.ok {
				return ntResult{}
			}
			resolved[i] = field
		}
		for _, field := range resolved {
			if !field.right {
				return field
			}
		}
		fields := make([]*Constructor_Data_Tuple_Tuple[string, gopurs_runtime.Value], len(resolved))
		for i, field := range resolved {
			fields[i] = &Constructor_Data_Tuple_Tuple[string, gopurs_runtime.Value]{1, ref.fields[i].label, field.value}
		}
		switch ref.tailKind {
		case ntTailError:
			return ntResult{ok: true, right: false, value: ref.tailErr}
		case ntTailNone:
			return ntResult{ok: true, right: true, value: ntRowType(fields, nil)}
		default:
			tail := t.resolveId(ref.tail, force)
			if !tail.ok {
				return ntResult{}
			}
			if !tail.right {
				return tail
			}
			return ntResult{ok: true, right: true, value: ntRowType(fields, &Constructor_Data_Maybe_Just[gopurs_runtime.Value]{1, tail.value})}
		}
	case ntRefForAll:
		body := t.resolveId(ref.body, force)
		if !body.ok {
			return ntResult{}
		}
		if !body.right {
			return body
		}
		return ntResult{ok: true, right: true, value: ntForAll(ref.vars, body.value)}
	case ntRefConstrained:
		resolved := make([]ntResult, len(ref.constraints))
		for i := range ref.constraints {
			constraint := t.resolveArgs(ref.constraints[i].args, force)
			if !constraint.ok {
				return ntResult{}
			}
			resolved[i] = constraint
		}
		for _, constraint := range resolved {
			if !constraint.right {
				return constraint
			}
		}
		if ref.bodyKind == ntBodyError {
			return ntResult{ok: true, right: false, value: ref.bodyErr}
		}
		body := t.resolveId(ref.body, force)
		if !body.ok {
			return ntResult{}
		}
		if !body.right {
			return body
		}
		constraints := make([]*Constructor_Data_Tuple_Tuple[[]string, []gopurs_runtime.Value], len(resolved))
		for i, constraint := range resolved {
			constraints[i] = &Constructor_Data_Tuple_Tuple[[]string, []gopurs_runtime.Value]{1, ref.constraints[i].fqn, constraint.slice}
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
		next := make([]int64, 0, len(indices))
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
	var entries []gopurs_runtime.Value
	switch {
	case json.Type == gopurs_runtime.TypeArray && json.UnsafePtr != nil:
		entries = *(*[]gopurs_runtime.Value)(json.UnsafePtr)
	case json.Type == gopurs_runtime.TypeAny && json.UnsafePtr != nil:
		raw := *(*any)(json.UnsafePtr)
		if arr, ok := raw.([]any); ok {
			entries = make([]gopurs_runtime.Value, len(arr))
			for i := range arr {
				entries[i] = gopurs_runtime.Box(arr[i])
			}
		}
	}
	if entries == nil {
		return ntLeft(ntTypeMismatch("Failed decode"))
	}
	count := len(entries)
	table := &ntTable{
		refs:    make([]ntRef, count),
		pending: make([]int64, count),
		state:   make([]uint8, count),
		errs:    make([]gopurs_runtime.Value, count),
		types:   make([]gopurs_runtime.Value, count),
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
	out := make([]gopurs_runtime.Value, count)
	for i := range out {
		switch table.state[i] {
		case 2:
			out[i] = table.types[i]
		case 1:
			return ntLeft(table.errs[i])
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
	return 0, ndPublic("Failed decode")
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
	return "", ndPublic("Failed decode")
}

func ndBoolean(raw any) (bool, *ndFailure) {
	if value, ok := raw.(bool); ok {
		return value, nil
	}
	return false, ndPublic("Failed decode")
}

func ndObject(raw any) (map[string]any, *ndFailure) {
	if value, ok := raw.(map[string]any); ok {
		return value, nil
	}
	return nil, ndPublic("Failed decode")
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
	return nil, ndPublic("Failed decode")
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
func ndField(obj map[string]any, key string, decode ndElementDecoder) (gopurs_runtime.Value, *ndFailure) {
	raw, present := obj[key]
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
func ndOptionalField(obj map[string]any, key string, decode ndElementDecoder) (gopurs_runtime.Value, *ndFailure) {
	raw, present := obj[key]
	if !present || ndNullable(ndReify(raw)) {
		return ndNothing(), nil
	}
	value, failure := decode(raw)
	if failure != nil {
		return gopurs_runtime.Value{}, failure
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
		rawIdentifiers, present := obj["identifiers"]
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
func ndSourceUsage(moduleName string, obj map[string]any) (gopurs_runtime.Value, *ndFailure) {
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
	rawType, present := obj["type"]
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
