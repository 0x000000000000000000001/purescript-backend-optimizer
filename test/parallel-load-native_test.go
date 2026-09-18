// Copy into a retained gopurs native bootstrap's output/purescript directory.
// GOPURS_TEST_CORPUS=<TAST directory> go test -race ./purescript -run TestParallelLoad -v
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
