package purescript

// Copy into a generated native compiler's output/purescript directory, then run
// go test ./purescript -run '^TestForeignAnnotationsMap' -count=1 -v
import (
	"fmt"
	"testing"

	rt "gopurs/output/gopurs_runtime"
)

func TestForeignAnnotationsMap(t *testing.T) {
	for _, test := range []struct {
		name    string
		foreign string
		size    int64
	}{
		{"empty", `[]`, 0},
		{"annotated_and_unannotated", `["untyped","typed","last"]`, 3},
		{"duplicate_identifiers", `["untyped","typed","typed","last"]`, 3},
	} {
		for _, direct := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/text=%t", test.name, direct), func(t *testing.T) {
				text := fmt.Sprintf(`{"sourceSpan":{"start":[1,1],"end":[1,2]},"imports":[],"exports":[],"reExports":{},"decls":[],"comments":[],"typeTable":["Int"],"foreign":%s,"foreignAnnotations":{"typed":{"type":0}}}`, test.foreign)
				var module rt.Value
				if direct {
					cursor, ok := directIndex(text)
					if !ok {
						t.Fatal("invalid fixture JSON")
					}
					module = tc_cndModulePrime("Fixture", tcCursor(cursor), "Fixture.purs")
				} else {
					parsed := Data_Argonaut_Parser__JsonParser(func(err any) any {
						t.Fatal(err)
						return nil
					}, func(value any) any { return value }, text)
					module = cndModulePrime("Fixture", cndObject(parsed), "Fixture.purs")
				}
				foreign := rt.RecordGet(module, "foreign")
				if size := rt.Apply(Get_Data_Map_Internal_size(), foreign).IntVal; size != test.size {
					t.Fatalf("map size = %d, want %d", size, test.size)
				}
				lookup := func(key string) rt.Value {
					return rt.Apply3(Get_Data_Map_Internal_lookup(), Get_Data_Ord_ordString(), rt.Str(key), foreign)
				}
				if cndIsJust(lookup("missing")) {
					t.Fatal("unexpected missing-key entry")
				}
				if test.size == 0 {
					return
				}
				for _, key := range []string{"untyped", "last"} {
					entry := lookup(key)
					if !cndIsJust(entry) || cndIsJust(cndFromJust(entry)) {
						t.Fatalf("%s: expected an entry containing Nothing", key)
					}
				}
				typed := lookup("typed")
				if !cndIsJust(typed) || !cndIsJust(cndFromJust(typed)) || cndFromJust(cndFromJust(typed)).IntVal != ntTagInt {
					t.Fatal("typed: expected an entry containing Just Int")
				}
			})
		}
	}
}
