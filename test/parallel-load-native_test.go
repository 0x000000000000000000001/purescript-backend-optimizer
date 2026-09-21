// Copy into a retained gopurs native bootstrap's output/purescript directory.
// GOPURS_TEST_CORPUS=<TAST directory> go test -race ./purescript -run 'Test(ParallelLoad|ModuleReadConcurrency)' -v
package purescript

import (
	"context"
	"os"
	"reflect"
	"runtime"
	"testing"
	"time"

	"gopurs/output/gopurs_runtime"
)

func TestModuleReadConcurrency(t *testing.T) {
	t.Run("unset", func(t *testing.T) {
		t.Setenv("GOPURS_JOBS", "")
		if err := os.Unsetenv("GOPURS_JOBS"); err != nil {
			t.Fatal(err)
		}
		if got := PureScript_Backend_Optimizer_App_ModuleReadConcurrency(); got != 8 {
			t.Fatalf("unset GOPURS_JOBS: got %d, want 8", got)
		}
	})
	for _, test := range []struct {
		configured string
		want       int
	}{
		{"", 8}, {"0", 8}, {"-1", 8}, {"65", 8}, {"1.5", 8},
		{"4x", 8}, {" 4", 8}, {"4 ", 8}, {"1e1", 8},
		{"999999999999999999999999999999999999", 8},
		{"1", 1}, {"4", 4}, {"8", 8}, {"64", 64},
	} {
		t.Run(test.configured, func(t *testing.T) {
			t.Setenv("GOPURS_JOBS", test.configured)
			if got := PureScript_Backend_Optimizer_App_ModuleReadConcurrency(); got != test.want {
				t.Fatalf("GOPURS_JOBS=%q: got %d, want %d", test.configured, got, test.want)
			}
		})
	}
}

func TestParallelLoad(t *testing.T) {
	corpus := os.Getenv("GOPURS_TEST_CORPUS")
	if corpus == "" {
		t.Skip("set GOPURS_TEST_CORPUS to an existing TAST directory")
	}
	var baseline []string
	// Parallel first also exercises concurrent initialization of shared values.
	for _, jobs := range []string{"4", "1", "8", "1", "4", "8"} {
		t.Setenv("GOPURS_JOBS", jobs)
		runtime.GC()
		started := time.Now()
		aff := Call_PureScript_Backend_Optimizer_App_coreFnModulesFromOutput(corpus)
		result, err := runAffSync(gopurs_runtime.Unbox[AffFn](aff), context.Background())
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("jobs=%s load+sort=%s", jobs, time.Since(started))
		modules := gopurs_runtime.CoerceToStruct[Constructor_Data_List_Types_Cons[gopurs_runtime.Value]](gopurs_runtime.Box(result))
		var names []string
		for current := modules; current != nil; current = current.V1 {
			names = append(names, gopurs_runtime.RecordGet(current.V0, "name").StrVal())
		}
		if len(names) == 0 {
			t.Fatal("empty decoded corpus")
		}
		if baseline == nil {
			baseline = names
		} else if !reflect.DeepEqual(baseline, names) {
			t.Fatal("parallel and sequential module order differ")
		}
	}
}
