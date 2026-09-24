package purescript_test

// Used with type-table-native_test.go and the diagnostic's typed-text bridge.
// Compare complete results against the generated PureScript resolver, including
// cycles, forward/missing links and error precedence across fields and tails.
import (
	"encoding/json"
	"fmt"
	"math/rand"
	"testing"

	rt "gopurs/output/gopurs_runtime"
	p "gopurs/output/purescript"
)

func resolutionOutcome(t *testing.T, result rt.Value) typeTableResult {
	t.Helper()
	var out typeTableResult
	rt.Apply3(p.Get_Data_Either_either(), rt.Func(func(err rt.Value) rt.Value {
		show := rt.CoerceToStruct[p.Constructor_Data_Show_Show[rt.Value]](p.Get_Data_Argonaut_Decode_Error_showJsonDecodeError()).V0
		out.error = rt.Apply(show, err).StrVal()
		return rt.Value{}
	}), rt.Func(func(types rt.Value) rt.Value {
		out.types = rt.Unbox[[]rt.Value](types)
		return rt.Value{}
	}), result)
	return out
}

func TestTypeTableResolutionDifferential(t *testing.T) {
	cases := []string{
		`[]`, `["Int"]`,
		`[{"type":"Row","fields":[{"label":"x","type":1},{"label":"y","type":2}],"tail":"wrong"},"Unknown",{"type":"Array","element":2}]`,
		`[{"type":"Row","fields":[{"label":"y","type":2},{"label":"x","type":1}],"tail":42},"Unknown",{"type":"Array","element":2}]`,
		`[{"type":"Row","fields":[{"label":"a","type":1},{"label":"b","type":2}],"tail":3},{"type":"Array"},"Unknown",{"type":"Array","element":3}]`,
		`[{"type":"Row","fields":[{"label":"x","type":1},{"label":"x","type":1}],"tail":null},"Int"]`,
		`[{"type":"ConstrainedType","constraints":[{"fqn":["Eq"],"args":[1]},{"fqn":["Ord"],"args":[2]}],"body":"wrong"},"Unknown",{"type":"Array","element":2}]`,
		`[{"type":"ConstrainedType","constraints":[{"fqn":["Eq"],"args":[2]},{"fqn":["Ord"],"args":[1]}],"body":42},"Unknown",{"type":"Array","element":2}]`,
		`[{"type":"ConstrainedType","constraints":[],"body":0}]`,
		`[{"type":"TypeApp","constructor":1,"args":"wrong"},{"type":"Array","element":1}]`,
	}
	rng := rand.New(rand.NewSource(2026092404))
	for iteration := 0; iteration < 2000; iteration++ {
		count := 1 + rng.Intn(12)
		link := func() int { return rng.Intn(count+3) - 1 }
		args := func() []int {
			ids := make([]int, rng.Intn(5))
			for i := range ids {
				ids[i] = link()
			}
			return ids
		}
		entries := make([]any, count)
		for i := range entries {
			var entry map[string]any
			switch rng.Intn(12) {
			case 0:
				entries[i] = "Int"
				continue
			case 1:
				entries[i] = "Unknown"
				continue
			case 2:
				entry = map[string]any{"type": "Adt", "fqn": []string{"Test", fmt.Sprint(i)}, "args": args()}
			case 3:
				entry = map[string]any{"type": "TypeApp", "constructor": link(), "args": args()}
			case 4:
				entry = map[string]any{"type": "Func", "args": args(), "ret": link()}
			case 5:
				entry = map[string]any{"type": "Array", "element": link()}
			case 6:
				entry = map[string]any{"type": "Record", "row": link()}
			case 7:
				fields := make([]any, rng.Intn(4))
				for j := range fields {
					fields[j] = map[string]any{"label": fmt.Sprint(j), "type": link()}
				}
				entry = map[string]any{"type": "Row", "fields": fields, "tail": link()}
			case 8:
				entry = map[string]any{"type": "ForAll", "vars": []string{"a", "b"}, "body": link()}
			case 9:
				constraints := make([]any, rng.Intn(3))
				for j := range constraints {
					constraints[j] = map[string]any{"fqn": []string{"Eq"}, "args": args()}
				}
				entry = map[string]any{"type": "ConstrainedType", "constraints": constraints, "body": link()}
			case 10:
				entry = map[string]any{"type": "TypeVar", "name": "owned-a"}
			case 11:
				entry = map[string]any{"type": "TypeLevelString", "value": "owned-é🙂"}
			}
			if rng.Intn(4) == 0 {
				keys := []string{"args", "constructor", "ret", "row", "element", "fields", "tail", "body", "constraints", "fqn", "vars"}
				key := keys[rng.Intn(len(keys))]
				if rng.Intn(2) == 0 {
					delete(entry, key)
				} else {
					entry[key] = "wrong"
				}
			}
			entries[i] = entry
		}
		text, err := json.Marshal(entries)
		if err != nil {
			t.Fatal(err)
		}
		cases = append(cases, string(text))
	}
	equal := rt.CoerceToStruct[p.Constructor_Data_Eq_Eq[rt.Value]](p.Get_PureScript_Backend_Optimizer_CoreFn_eqExprType()).V0
	successes, failures := 0, 0
	for i, text := range cases {
		parsed := p.Data_Argonaut_Parser__JsonParser(func(err any) any { t.Fatal(err); return nil }, func(value any) any { return value }, text).([]any)
		input := make([]rt.Value, len(parsed))
		for j, value := range parsed {
			input[j] = rt.Box(value)
		}
		want := resolutionOutcome(t, rt.Apply(p.Get_Control_Monad_ST_Internal_run(), p.Call_PureScript_Backend_Optimizer_CoreFn_TypeTable_decodeTypeTableST(input)))
		actual := []rt.Value{p.PureScript_Backend_Optimizer_CoreFn_Json_DecodeTypeTableImpl(rt.Any(parsed)), p.TypedDecodeTypeTableText(text)}
		for mode, result := range actual {
			got := resolutionOutcome(t, result)
			if got.error != want.error || len(got.types) != len(want.types) {
				t.Fatalf("case %d mode %d: got %q/%d want %q/%d: %s", i, mode, got.error, len(got.types), want.error, len(want.types), text)
			}
			for j, value := range got.types {
				if !rt.Apply2(equal, value, want.types[j]).BoolVal() {
					t.Fatalf("case %d mode %d type %d differs: %s", i, mode, j, text)
				}
			}
		}
		if want.error == "" {
			successes++
		} else {
			failures++
		}
	}
	t.Logf("%d type-table graphs: %d successes / %d exact errors; DOM and typed inputs match PureScript", len(cases), successes, failures)
}

func TestTypeTablePublishedArrayIndependence(t *testing.T) {
	const text = `["Int",{"type":"Array","element":0}]`
	first := resolutionOutcome(t, p.TypedDecodeTypeTableText(text))
	second := resolutionOutcome(t, p.TypedDecodeTypeTableText(text))
	if first.error != "" || second.error != "" {
		t.Fatal(first.error, second.error)
	}
	first.types[0] = p.Get_PureScript_Backend_Optimizer_CoreFn_String()
	equal := rt.CoerceToStruct[p.Constructor_Data_Eq_Eq[rt.Value]](p.Get_PureScript_Backend_Optimizer_CoreFn_eqExprType()).V0
	if !rt.Apply2(equal, second.types[0], p.Get_PureScript_Backend_Optimizer_CoreFn_Int()).BoolVal() || !rt.Apply2(equal, first.types[1], second.types[1]).BoolVal() {
		t.Fatal("published table storage aliases another table or its constructor arguments")
	}
}
