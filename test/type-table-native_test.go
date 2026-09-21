// Copy into a JSON/TAST diagnostic build's output/purescript directory,
// then from output run:
// go test ./purescript -run '^TestTypeTable' -count=1 -v
package purescript_test

import (
	"fmt"
	"testing"

	rt "gopurs/output/gopurs_runtime"
	p "gopurs/output/purescript"
)

type typeTableResult struct {
	error string
	types []rt.Value
}

func decodeTypeTableForTest(t *testing.T, text string) typeTableResult {
	t.Helper()
	parsed := p.Data_Argonaut_Parser__JsonParser(func(err any) any {
		t.Fatal(err)
		return nil
	}, func(value any) any { return value }, text).([]any)
	input := make([]rt.Value, len(parsed))
	for i, value := range parsed {
		input[i] = rt.Box(value)
	}
	result := rt.Apply(p.Get_Control_Monad_ST_Internal_run(), p.Call_PureScript_Backend_Optimizer_CoreFn_TypeTable_decodeTypeTableST(input))
	var decoded typeTableResult
	rt.Apply3(p.Get_Data_Either_either(), rt.Func(func(err rt.Value) rt.Value {
		show := rt.CoerceToStruct[p.Constructor_Data_Show_Show[rt.Value]](p.Get_Data_Argonaut_Decode_Error_showJsonDecodeError()).V0
		decoded.error = rt.Apply(show, err).StrVal()
		return rt.Value{}
	}), rt.Func(func(types rt.Value) rt.Value {
		decoded.types = rt.Unbox[[]rt.Value](types)
		return rt.Value{}
	}), result)
	return decoded
}

func TestTypeTableArgumentErrors(t *testing.T) {
	const argumentError = `(TypeMismatch "ExprType")`
	const returnError = `(AtKey "element" MissingValue)`
	for _, test := range []struct {
		name, table, want string
	}{
		{"first_argument_error", `[{"type":"Func","args":[1,2],"ret":3},"Unknown",{"type":"Array"},"Int"]`, argumentError},
		{"reversed_argument_errors", `[{"type":"Func","args":[2,1],"ret":3},"Unknown",{"type":"Array"},"Int"]`, returnError},
		{"pending_after_error", `[{"type":"Func","args":[1,2],"ret":3},"Unknown",{"type":"Array","element":2},{"type":"Array"}]`, returnError},
		{"pending_before_error", `[{"type":"Func","args":[2,1],"ret":3},"Unknown",{"type":"Array","element":2},{"type":"Array"}]`, returnError},
		{"forced_missing_after_error", `[{"type":"Func","args":[1,42],"ret":2},"Unknown","Int"]`, argumentError},
		{"forced_missing_before_error", `[{"type":"Func","args":[42,1],"ret":2},"Unknown","Int"]`, argumentError},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := decodeTypeTableForTest(t, test.table); got.error != test.want {
				t.Fatalf("got error %q, want %q", got.error, test.want)
			}
		})
	}
}

func TestTypeTableArguments(t *testing.T) {
	intType := p.Get_PureScript_Backend_Optimizer_CoreFn_Int()
	stringType := p.Get_PureScript_Backend_Optimizer_CoreFn_String()
	anyType := p.Get_PureScript_Backend_Optimizer_CoreFn_Any()
	equal := rt.CoerceToStruct[p.Constructor_Data_Eq_Eq[rt.Value]](p.Get_PureScript_Backend_Optimizer_CoreFn_eqExprType()).V0
	for _, constructor := range []struct {
		name, json string
		makeType   func([]rt.Value) rt.Value
	}{
		{"Adt", `{"type":"Adt","fqn":["Test","Args"],"args":%s}`, func(args []rt.Value) rt.Value {
			return rt.Apply3(p.Get_PureScript_Backend_Optimizer_CoreFn_ADT(), rt.Str("Test.Args"), rt.Array([]rt.Value{rt.Str("Test"), rt.Str("Args")}), rt.Array(args))
		}},
		{"TypeApp", `{"type":"TypeApp","constructor":1,"args":%s}`, func(args []rt.Value) rt.Value {
			return rt.Apply2(p.Get_PureScript_Backend_Optimizer_CoreFn_TypeApp(), intType, rt.Array(args))
		}},
		{"Func", `{"type":"Func","args":%s,"ret":1}`, func(args []rt.Value) rt.Value {
			return rt.Apply2(p.Get_PureScript_Backend_Optimizer_CoreFn_Func(), rt.Array(args), intType)
		}},
		{"ConstrainedType", `{"type":"ConstrainedType","constraints":[{"fqn":["Eq"],"args":%s}],"body":1}`, func(args []rt.Value) rt.Value {
			constraint := rt.Apply2(p.Get_Data_Tuple_Tuple(), rt.Array([]rt.Value{rt.Str("Eq")}), rt.Array(args))
			return rt.Apply2(p.Get_PureScript_Backend_Optimizer_CoreFn_ConstrainedType(), rt.Array([]rt.Value{constraint}), intType)
		}},
	} {
		for _, args := range []struct {
			name, ids string
			types     []rt.Value
		}{
			{"empty", `[]`, []rt.Value{}},
			{"ordered_forward_repeated", `[2,1,2]`, []rt.Value{stringType, intType, stringType}},
			{"self_cycle", `[0,1,0]`, []rt.Value{anyType, intType, anyType}},
			{"missing_references", `[2,-1,42,1]`, []rt.Value{stringType, anyType, anyType, intType}},
		} {
			t.Run(constructor.name+"/"+args.name, func(t *testing.T) {
				table := "[" + fmt.Sprintf(constructor.json, args.ids) + `,"Int","String"]`
				want := []rt.Value{constructor.makeType(args.types), intType, stringType}
				for run := 0; run < 2; run++ {
					got := decodeTypeTableForTest(t, table)
					if got.error != "" || len(got.types) != len(want) {
						t.Fatalf("run %d: got error %q and %d types, want %d types", run, got.error, len(got.types), len(want))
					}
					for i, typ := range got.types {
						if !rt.Apply2(equal, typ, want[i]).BoolVal() {
							t.Fatalf("run %d: type %d differs", run, i)
						}
					}
				}
			})
		}
	}
}
