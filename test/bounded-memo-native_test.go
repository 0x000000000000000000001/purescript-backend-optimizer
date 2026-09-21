package purescript

import (
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"unsafe"

	"gopurs/output/gopurs_runtime"
)

func TestIdentityAndOrder(t *testing.T) {
	a, b, other := new(int), new(int), new(int)
	calls := 0
	f := createForTest(512, func(x, y *int) [2]*int {
		calls++
		return [2]*int{x, y}
	})()
	for i := 0; i < 3; i++ {
		if got := f(a, b); got != [2]*int{a, b} {
			t.Fatal(got)
		}
	}
	f(b, a)
	f(a, other)
	if calls != 3 {
		t.Fatalf("calls=%d", calls)
	}
}

func TestFIFOAndFreshFactoryEffects(t *testing.T) {
	calls := 0
	create := createForTest(2, func(a, b int) int { calls++; return a*10 + b })
	f := create()
	f(1, 0)
	f(2, 0)
	f(1, 0) // A hit does not make the oldest entry newer.
	f(3, 0)
	f(2, 0)
	if calls != 3 {
		t.Fatalf("calls=%d", calls)
	}
	f(1, 0)
	if calls != 4 {
		t.Fatalf("oldest key was not evicted: calls=%d", calls)
	}
	create()(1, 0)
	if calls != 5 {
		t.Fatalf("effects shared state: calls=%d", calls)
	}
}

func TestNonComparableAndFloatingKeysMiss(t *testing.T) {
	values := []any{[]int{1}, map[string]int{"x": 1}, func() {}, 1.0, complex(1, 2), struct{ X any }{[]int{1}}, nil}
	for _, value := range values {
		calls := 0
		f := createForTest(512, func(a, b any) int { calls++; return 7 })()
		for i := 0; i < 2; i++ {
			if f(value, 1) != 7 || f(1, value) != 7 {
				t.Fatal("wrong result")
			}
		}
		if calls != 4 {
			t.Fatalf("%T should miss: calls=%d", value, calls)
		}
	}
}

func TestNonpositiveCapacity(t *testing.T) {
	for _, capacity := range []int64{0, -1} {
		calls := 0
		f := createForTest(capacity, func(a, b int) int { calls++; return a + b })()
		if f(2, 3) != 5 || f(2, 3) != 5 || calls != 2 {
			t.Fatal(capacity, calls)
		}
	}
}

func TestNativeOpaqueRepresentation(t *testing.T) {
	a, b := new(int), new(int)
	x := gopurs_runtime.Value{Type: gopurs_runtime.TypeConstructor, UnsafePtr: unsafe.Pointer(a)}
	y := gopurs_runtime.Value{Type: gopurs_runtime.TypeConstructor, UnsafePtr: unsafe.Pointer(b)}
	calls := 0
	f := createForTest(512, func(a, b gopurs_runtime.Value) gopurs_runtime.Value {
		calls++
		return a
	})()
	if f(x, y) != x || f(x, y) != x || calls != 1 {
		t.Fatal(calls)
	}
	f(y, x)
	y.IntVal++
	f(x, y)
	if calls != 3 {
		t.Fatal(calls)
	}
	runtime.KeepAlive(a)
	runtime.KeepAlive(b)
}

func TestKeysKeepReferencesAlive(t *testing.T) {
	type object struct{ payload [4096]byte }
	finalized := make(chan struct{}, 1)
	f := createForTest(512, func(a, b gopurs_runtime.Value) int { return 1 })()
	func() {
		payload := new(object)
		runtime.SetFinalizer(payload, func(*object) { finalized <- struct{}{} })
		key := gopurs_runtime.Value{Type: gopurs_runtime.TypeConstructor, UnsafePtr: unsafe.Pointer(payload)}
		f(key, key)
	}()
	for i := 0; i < 5; i++ {
		runtime.GC()
		runtime.Gosched()
	}
	select {
	case <-finalized:
		t.Fatal("cached key lost its pointer reference")
	default:
	}
	runtime.KeepAlive(f)
}

func TestReentrantComputation(t *testing.T) {
	var f func(int, int) int
	f = createForTest(512, func(a, b int) int {
		if a == 0 {
			return b
		}
		return 1 + f(a-1, b)
	})()
	if f(8, 4) != 12 {
		t.Fatal("wrong recursive result")
	}
}

func TestConcurrentHitsMissesAndEvictions(t *testing.T) {
	var calls atomic.Int64
	f := createForTest(16, func(a, b int) int { calls.Add(1); return a*100 + b })()
	var tasks sync.WaitGroup
	for i := 0; i < 12; i++ {
		tasks.Add(1)
		go func(seed int) {
			defer tasks.Done()
			for j := 0; j < 300; j++ {
				a, b := (seed+j)%31, j%7
				if f(a, b) != a*100+b {
					t.Error("incorrect concurrent result")
				}
			}
		}(i)
	}
	tasks.Wait()
	if calls.Load() == 0 {
		t.Fatal("callback never ran")
	}
}

func createForTest[A, B, R any](capacity int64, callback func(A, B) R) func() func(A, B) R {
	create := PureScript_Backend_Optimizer_BoundedMemo_CreateBoundedMemo(capacity, callback)
	return func() func(A, B) R {
		memo := create()
		return func(a A, b B) R { return memo(a)(b) }
	}
}

func TestGeneratedBridge(t *testing.T) {
	rt := gopurs_runtime.Int
	calls := 0
	callback := gopurs_runtime.Func2(func(a, b gopurs_runtime.Value) gopurs_runtime.Value {
		calls++
		return rt(a.IntVal*10 + b.IntVal)
	})
	effect := gopurs_runtime.Apply2(_Gopurs_PureScript_Backend_Optimizer_BoundedMemo_CreateBoundedMemo, rt(512), callback)
	memo := gopurs_runtime.Apply(effect, gopurs_runtime.Value{})
	for i := 0; i < 3; i++ {
		if got := gopurs_runtime.Apply2(memo, rt(2), rt(3)); got.IntVal != 23 {
			t.Fatal(got)
		}
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	second := gopurs_runtime.Apply(effect, gopurs_runtime.Value{})
	gopurs_runtime.Apply2(second, rt(2), rt(3))
	if calls != 2 {
		t.Fatal("effect cache was shared", calls)
	}
}
