import (
	"reflect"
	"sync"
)

// A curried result uses the existing native FFI callback return convention.
func CreateBoundedMemo[A, B, R any](capacity int64, f func(A, B) R) func() func(A) func(B) R {
	create := createBoundedMemoCache(capacity, f)
	return func() func(A) func(B) R {
		lookup := create()
		return func(a A) func(B) R {
			return func(b B) R { return lookup(a, b) }
		}
	}
}

// Private memoization for immutable compiler trees. Comparable opaque native
// representations are keyed without traversing their contents. Unsupported
// representations deliberately miss. This is not a general mutable-object cache.
func createBoundedMemoCache[A, B, R any](capacity int64, f func(A, B) R) func() func(A, B) R {
	return func() func(A, B) R {
		if capacity <= 0 {
			return f
		}
		type key struct{ first, second any }
		var entries map[key]R
		var fifo []key
		next := 0
		var mutex sync.RWMutex
		return func(a A, b B) R {
			if !boundedMemoIdentitySupported(a) || !boundedMemoIdentitySupported(b) {
				return f(a, b)
			}
			k := key{a, b}
			mutex.RLock()
			result, found := entries[k]
			mutex.RUnlock()
			if found {
				return result
			}
			// Keep pure computation outside the lock: nested calls cannot deadlock.
			result = f(a, b)
			mutex.Lock()
			if existing, found := entries[k]; found {
				mutex.Unlock()
				return existing
			}
			if entries == nil {
				entries = make(map[key]R)
				fifo = make([]key, int(capacity))
			}
			if len(entries) == len(fifo) {
				delete(entries, fifo[next])
			}
			fifo[next] = k
			next = (next + 1) % len(fifo)
			entries[k] = result
			mutex.Unlock()
			return result
		}
	}
}

func boundedMemoIdentitySupported(value any) bool {
	v := reflect.ValueOf(value)
	if !v.IsValid() || !v.Comparable() {
		return false
	}
	switch v.Kind() {
	case reflect.Float32, reflect.Float64, reflect.Complex64, reflect.Complex128:
		return false
	}
	return true
}
