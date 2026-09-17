package PureScript_Backend_Optimizer_FfiSupport

import (
	"os"
	"path/filepath"
	"testing"

	foreign "gopurs/output/foreign"
	rt "gopurs/output/gopurs_runtime"
)

func TestFindFfiNullableContract(t *testing.T) {
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(cwd); err != nil {
			t.Error(err)
		}
	})
	root, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	null, unit := rt.Any(nil), rt.Value{}
	missing := FindFfiFileImpl(".go", nil, null, "Missing.Module", null, unit)
	// Data.Nullable.toMaybe distinguishes Foreign.isNull from isUndefined.
	// An undefined result enters Just and later crashes when read as a string.
	if !foreign.IsNull(missing).BoolVal() || foreign.IsUndefined(missing).BoolVal() {
		t.Fatalf("missing FFI must be null, not undefined: type=%d", missing.Type)
	}
	path := filepath.Join(root, "Example.go")
	if err := os.WriteFile(path, []byte("package Example\n"), 0644); err != nil {
		t.Fatal(err)
	}
	found := FindFfiFileImpl(".go", nil, null, "Example", rt.Str(filepath.Join(root, "Example.purs")), unit)
	if foreign.IsNull(found).BoolVal() || foreign.IsUndefined(found).BoolVal() {
		t.Fatal("existing FFI must be a non-null string")
	}
	if found.Type != rt.TypeString || found.StrVal() != path {
		t.Fatalf("unexpected FFI path: %#v", found)
	}
}
