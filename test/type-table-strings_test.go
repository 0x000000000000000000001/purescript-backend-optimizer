package purescript

// Copy into a retained native compiler's output/purescript directory, then run
// go test ./purescript -run '^TestTypeTablePSString' -count=1 -v
// Exercise both the parsed-JSON decoder and the production typed-text decoder.
import (
	"fmt"
	"testing"

	rt "gopurs/output/gopurs_runtime"
)

func psStringTable(t *testing.T, text string, direct bool) ([]rt.Value, string) {
	t.Helper()
	var result rt.Value
	if direct {
		cursor, ok := directIndex(text)
		if !ok {
			t.Fatalf("Invalid JSON test input: %s", text)
		}
		result = tc_decodeTypeTableNative(tcCursor(cursor))
	} else {
		parsed := Data_Argonaut_Parser__JsonParser(func(err any) any {
			t.Fatal(err)
			return nil
		}, func(value any) any { return value }, text)
		result = PureScript_Backend_Optimizer_CoreFn_Json_DecodeTypeTableImpl(rt.Any(parsed))
	}
	if result.IntVal == ntTagLeft {
		err := rt.CoerceToStruct[Constructor_Data_Either_Left[rt.Value, rt.Value]](result).V0
		show := rt.CoerceToStruct[Constructor_Data_Show_Show[rt.Value]](Get_Data_Argonaut_Decode_Error_showJsonDecodeError()).V0
		return nil, rt.Apply(show, err).StrVal()
	}
	if result.IntVal != ntTagRight {
		t.Fatalf("Unexpected result: %#v", result)
	}
	return rt.Unbox[[]rt.Value](rt.CoerceToStruct[Constructor_Data_Either_Right[rt.Value, rt.Value]](result).V0), ""
}

func TestTypeTablePSStringValuesAndLabels(t *testing.T) {
	for _, test := range []struct{ name, input, want string }{
		{"plain", `"hello"`, "hello"},
		{"empty_string", `""`, ""},
		{"empty_units", `[]`, ""},
		{"bmp_units", `[0,34,92,10,65,233,65535]`, "\x00\"\\\nAé\uffff"},
		{"astral_string", `"𝌆"`, "𝌆"},
		{"high_surrogate", `[55348]`, "\xed\xa0\xb4"},
		{"low_surrogate", `[57094]`, "\xed\xbc\x86"},
		{"pair", `[55348,57094]`, "𝌆"},
		{"reversed", `[57094,55348]`, "\xed\xbc\x86\xed\xa0\xb4"},
		{"split_pair", `[55348,65,57094]`, "\xed\xa0\xb4A\xed\xbc\x86"},
		{"consecutive_high", `[55348,55348,57094]`, "\xed\xa0\xb4𝌆"},
		{"trailing_high", `[55348,57094,55348]`, "𝌆\xed\xa0\xb4"},
		{"replacement_character", `[65533]`, "\ufffd"},
	} {
		for _, direct := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/text=%t", test.name, direct), func(t *testing.T) {
				text := fmt.Sprintf(`["Int",{"type":"TypeLevelString","value":%s},{"type":"Row","fields":[{"label":%s,"type":0}]}]`, test.input, test.input)
				types, err := psStringTable(t, text, direct)
				if err != "" || len(types) != 3 {
					t.Fatalf("got %q and %d types", err, len(types))
				}
				symbol := rt.CoerceToStruct[Constructor_PureScript_Backend_Optimizer_CoreFn_TypeLevelString](types[1]).V0
				row := rt.CoerceToStruct[Constructor_PureScript_Backend_Optimizer_CoreFn_Row](types[2])
				if len(row.V0) != 1 || symbol != test.want || row.V0[0].V0 != test.want {
					t.Fatalf("got symbol %q / row %#v, want bytes %x", symbol, row.V0, test.want)
				}
			})
		}
	}
}

func TestTypeTablePSStringErrors(t *testing.T) {
	for _, input := range []string{
		`null`, `true`, `42`, `{}`, `[-1]`, `[65536]`, `[1114111]`, `[1114112]`,
		`[0.5]`, `[4294967296]`, `[null]`, `[true]`, `["x"]`, `[[65]]`,
		`[55348,null]`, `[55348,65536]`, `[65,57094,0.5]`,
	} {
		for _, direct := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/text=%t", input, direct), func(t *testing.T) {
				for _, field := range []struct{ table, want string }{
					{`[{"type":"TypeLevelString","value":` + input + `}]`, `(AtKey "value" (TypeMismatch "Failed decode"))`},
					{`[{"type":"Row","fields":[{"label":` + input + `,"type":0}]}]`, `(AtKey "fields" (AtKey "label" (TypeMismatch "Failed decode")))`},
				} {
					if _, got := psStringTable(t, field.table, direct); got != field.want {
						t.Fatalf("got %q, want %q", got, field.want)
					}
				}
			})
		}
	}
	for _, direct := range []bool{false, true} {
		for _, test := range []struct{ table, want string }{
			{`[{"type":"TypeLevelString"}]`, `(AtKey "value" MissingValue)`},
			{`[{"type":"Row","fields":[{"type":0}]}]`, `(AtKey "fields" (AtKey "label" MissingValue))`},
			{`[{"type":"Row","fields":[{"label":[55348]}]}]`, `(AtKey "fields" (AtKey "type" MissingValue))`},
		} {
			if _, got := psStringTable(t, test.table, direct); got != test.want {
				t.Errorf("%s/text=%t: got %q, want %q", test.table, direct, got, test.want)
			}
		}
	}
}
