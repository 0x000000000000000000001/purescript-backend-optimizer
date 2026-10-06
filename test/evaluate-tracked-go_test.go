package purescript

import (
	"sync"
	"sync/atomic"
	"testing"

	"gopurs/output/gopurs_runtime"
)

func trackedForTest(action gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Apply(_Gopurs_PureScript_Backend_Optimizer_Monomorphize_EvaluateTracked, action)
}

func TestTrackedDeferralReplayAndCompletion(t *testing.T) {
	var calls atomic.Int64
	action := trackedForTest(gopurs_runtime.Func(func(_ gopurs_runtime.Value) gopurs_runtime.Value {
		return gopurs_runtime.Int(calls.Add(1))
	}))
	if calls.Load() != 0 { t.Fatal("construction evaluated the callback") }
	for want := int64(1); want <= 3; want++ {
		got := gopurs_runtime.Apply(action, gopurs_runtime.Value{})
		if got.IntVal != want || calls.Load() != want { t.Fatal("observation preceded complete evaluation", got, calls.Load()) }
	}
	var workers sync.WaitGroup
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for j := 0; j < 100; j++ { gopurs_runtime.Apply(action, gopurs_runtime.Value{}) }
		}()
	}
	workers.Wait()
	if calls.Load() != 803 { t.Fatal("lost or duplicated effects", calls.Load()) }
}

func TestTrackedOriginalFailure(t *testing.T) {
	failure := new(int)
	action := trackedForTest(gopurs_runtime.Func(func(_ gopurs_runtime.Value) gopurs_runtime.Value { panic(failure) }))
	defer func() { if recover() != failure { t.Fatal("original panic did not propagate") } }()
	gopurs_runtime.Apply(action, gopurs_runtime.Value{})
}
