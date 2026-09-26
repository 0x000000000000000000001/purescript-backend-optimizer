package PureScript_Backend_Optimizer_Cache

import (
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"
	"sync"
	"time"

	"gopurs/output/gopurs_runtime"
)

var processEpoch = time.Now()

// NowMillis reports monotonic elapsed milliseconds for instrumentation.
func NowMillis() float64 {
	return float64(time.Since(processEpoch).Nanoseconds()) / 1e6
}

// Native bootstrap keeps immutable implementations in memory for one build.
// V8's .purmeta encoding is not portable to Go. There is no disk fallback, so
// clear/trim cannot evict this authoritative store. BeginPurmetaBuild releases
// the previous build's implementations and prevents stale specialization reuse.
// Unlike the JavaScript LRU, this first native implementation has no byte budget.
var purmetaMu sync.RWMutex
var purmetaModules = make(map[string]gopurs_runtime.Value)

func BeginPurmetaBuild(_ gopurs_runtime.Value) gopurs_runtime.Value {
	purmetaMu.Lock()
	purmetaModules = make(map[string]gopurs_runtime.Value)
	purmetaMu.Unlock()
	return gopurs_runtime.Value{}
}

func WritePurmetaSyncImpl(moduleName string, data gopurs_runtime.Value, _ gopurs_runtime.Value) gopurs_runtime.Value {
	purmetaMu.Lock()
	purmetaModules[moduleName] = data
	purmetaMu.Unlock()
	return gopurs_runtime.Value{}
}

func ReadPurmetaSyncImpl(moduleName string, just gopurs_runtime.Value, nothing gopurs_runtime.Value, _ gopurs_runtime.Value) gopurs_runtime.Value {
	purmetaMu.RLock()
	data, found := purmetaModules[moduleName]
	purmetaMu.RUnlock()
	if !found {
		return nothing
	}
	return gopurs_runtime.Apply(just, data)
}

// WriteAllocProfileImpl writes the cumulative allocation profile (pprof
// "allocs") to the given path. Used by allocation campaigns; errors are
// reported on stderr and never fail the build.
func WriteAllocProfileImpl(path string, _ gopurs_runtime.Value) gopurs_runtime.Value {
	f, err := os.Create(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[Cache] cannot create allocation profile %s: %v\n", path, err)
		return gopurs_runtime.Value{}
	}
	if err := pprof.Lookup("allocs").WriteTo(f, 0); err != nil {
		fmt.Fprintf(os.Stderr, "[Cache] cannot write allocation profile %s: %v\n", path, err)
	}
	if err := f.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "[Cache] cannot close allocation profile %s: %v\n", path, err)
	}
	return gopurs_runtime.Value{}
}

func ClearPurmetaCacheImpl(_ gopurs_runtime.Value) gopurs_runtime.Value {
	// There is no secondary decoded cache in the native implementation.
	return gopurs_runtime.Value{}
}

func TrimPurmetaCacheImpl(_ gopurs_runtime.Value) gopurs_runtime.Value {
	return gopurs_runtime.Value{}
}

func LogMemoryImpl(label string, _ gopurs_runtime.Value) gopurs_runtime.Value {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	fmt.Printf("[Memory - %s] HeapAlloc: %d MB | HeapSys: %d MB\n", label, stats.HeapAlloc/(1024*1024), stats.HeapSys/(1024*1024))
	return gopurs_runtime.Value{}
}
