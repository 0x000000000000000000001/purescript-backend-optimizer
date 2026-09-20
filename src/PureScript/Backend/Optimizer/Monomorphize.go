import "reflect"

// Private guard for immutable compiler inputs. The native FFI bridge passes
// opaque comparable values unchanged, including their pointer and numeric bits.
// Unsupported representations simply miss the cache. This is not a general
// equality operation for mutable objects or arbitrary native Go structures.
func SameIdentity(a, b any) bool {
	x, y := reflect.ValueOf(a), reflect.ValueOf(b)
	if !x.IsValid() || !y.IsValid() || x.Type() != y.Type() || !x.Comparable() || !y.Comparable() {
		return false
	}
	switch x.Kind() {
	case reflect.Float32, reflect.Float64, reflect.Complex64, reflect.Complex128:
		return false
	}
	return x.Equal(y)
}
