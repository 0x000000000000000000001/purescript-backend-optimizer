package PureScript_Backend_Optimizer_CoreFn

// The Go host must not reimplement the comparison: the adapter applies the
// authoritative PureScript oracle once, in order, and unboxes the Boolean
// result of the equality path. Copied next to CoreFn.go by
// test/corefn-qualified-native.mjs.
import (
	"testing"

	"gopurs/output/gopurs_runtime"
)

func TestQualifiedComparisonDelegatesToPureScript(t *testing.T) {
	calls := 0
	compare := gopurs_runtime.Func2(func(a, b gopurs_runtime.Value) gopurs_runtime.Value {
		calls++
		if a.StrVal() != "Data.Map" || b.StrVal() != "empty" {
			t.Fatalf("reference received %q %q", a.StrVal(), b.StrVal())
		}
		return gopurs_runtime.Int(7)
	})
	got := CompareQualifiedIdentImpl(compare, gopurs_runtime.Str("Data.Map"), gopurs_runtime.Str("empty"))
	if got.IntVal != 7 || calls != 1 {
		t.Fatalf("CompareQualifiedIdentImpl must delegate exactly once: %v calls=%d", got, calls)
	}

	trueValue := gopurs_runtime.Func2(func(a, b gopurs_runtime.Value) gopurs_runtime.Value {
		return gopurs_runtime.Int(1)
	})
	falseValue := gopurs_runtime.Func2(func(a, b gopurs_runtime.Value) gopurs_runtime.Value {
		return gopurs_runtime.Int(0)
	})
	if !EqQualifiedIdentImpl(trueValue, gopurs_runtime.Str("M"), gopurs_runtime.Str("x")) {
		t.Fatal("a true oracle result must survive the Boolean boundary")
	}
	if EqQualifiedIdentImpl(falseValue, gopurs_runtime.Str("M"), gopurs_runtime.Str("x")) {
		t.Fatal("a false oracle result must survive the Boolean boundary")
	}
}
