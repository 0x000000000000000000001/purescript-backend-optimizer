package purescript

// Copy into a generated PBO test workspace. The public text API must preserve
// parser errors before schema errors, including invalid ignored members.
import (
	"math/rand"
	"strings"
	"testing"

	rt "gopurs/output/gopurs_runtime"
)

func TestPublicModuleParserAndErrorBoundary(t *testing.T) {
	cases := []string{
		``, ` `, `null`, `true`, `[]`, `{}`, `{"moduleName":null}`,
		`{"moduleName":[],"modulePath":1}`, `{"moduleName":[],"modulePath":"owned"}`,
		`{"moduleName":[],"modulePath":"owned","typeTable":["Int",{"type":"TypeApp","constructor":100,"args":[]}]}`,
		`{"ignored":1e999}`, `{"ignored":-1e999}`, `{"ignored":1e-999}`,
		`{"ignored":"\x00"}`, `{"ignored":"\u000z"}`, `{"ignored":[0,]}`,
		`{"moduleName":["Bad"],"ignored":false,}`, `{} false`, `01`, `1e+`,
		`{"moduleName":"wrong","moduleName":[]}`, `{"moduleName":[],"\u006doduleName":null}`,
		`{"moduleName":["\ud800"]}`, "{\"moduleName\":[\"\xff\"]}",
		strings.Repeat("[", 10001) + "0" + strings.Repeat("]", 10001),
	}
	rng := rand.New(rand.NewSource(2026092403))
	seed := []byte(`{"ignored":[true,null,-0,1.2e-15,"é🙂\ud800\u0000"],"nested":{"x":1}}`)
	for i := 0; i < 2000; i++ {
		text := append([]byte(nil), seed...)
		text[rng.Intn(len(text))] = byte(rng.Intn(256))
		cases = append(cases, string(text))
	}
	decode := Get_PureScript_Backend_Optimizer_CoreFn_Json_Text_parseModule()
	fallback := Get_PureScript_Backend_Optimizer_CoreFn_Json_Text_parseModulePS()
	for i, text := range cases {
		got := rt.Apply(decode, rt.Str(text))
		want := rt.Apply(fallback, rt.Str(text))
		if !tc_cndIsLeft(got) || !tc_cndIsLeft(want) {
			t.Fatalf("case %d: expected two failures: %q", i, text)
		}
		actual, expected := tc_cndLeftPayload(got).StrVal(), tc_cndLeftPayload(want).StrVal()
		if actual != expected {
			t.Fatalf("case %d: actual %q expected %q: %q", i, actual, expected, text)
		}
	}
	t.Logf("%d public parser/schema error cases match the ordinary boundary", len(cases))
}
