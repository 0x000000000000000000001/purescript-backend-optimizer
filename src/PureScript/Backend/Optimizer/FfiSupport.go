package PureScript_Backend_Optimizer_FfiSupport

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"gopurs/output/gopurs_runtime"
)

// Match JavaScript charCodeAt (UTF-16 code units), reverse traversal and uint32
// overflow exactly: these hashes are also emitted as constructor tags.
func HashString(value string) string {
	units := make([]uint16, 0, len(value))
	for len(value) > 0 {
		codepoint, size := utf8.DecodeRuneInString(value)
		// Native PureScript strings preserve isolated UTF-16 surrogates as WTF-8.
		if size == 1 && len(value) >= 3 && value[0] == 0xed && value[1] >= 0xa0 && value[1] <= 0xbf && value[2]&0xc0 == 0x80 {
			codepoint = rune(value[0]&0x0f)<<12 | rune(value[1]&0x3f)<<6 | rune(value[2]&0x3f)
			size = 3
		}
		if codepoint <= 0xffff {
			units = append(units, uint16(codepoint))
		} else {
			high, low := utf16.EncodeRune(codepoint)
			units = append(units, uint16(high), uint16(low))
		}
		value = value[size:]
	}
	hash := uint32(5381)
	for i := len(units) - 1; i >= 0; i-- {
		hash = hash*33 ^ uint32(units[i])
	}
	return strconv.FormatUint(uint64(hash), 10)
}

func nullablePath(value gopurs_runtime.Value) string {
	if value.UnsafePtr == nil {
		return ""
	}
	if value.Type == gopurs_runtime.TypeString {
		return value.StrVal()
	}
	if value.Type == gopurs_runtime.TypeAny {
		if value.AnyVal() == nil {
			return ""
		}
		if text, ok := value.AnyVal().(string); ok {
			return text
		}
	}
	panic("Expected Nullable String for FFI lookup")
}

func ffiPathExists(name string) bool {
	_, err := os.Stat(name)
	return err == nil
}

func ffiScanDirs(root string, ffiDir string, extra []string) []string {
	spagoDirs := []string{filepath.Join(root, ".spago"), filepath.Join(root, "spago.d")}
	for _, dir := range extra {
		spagoDirs = append(spagoDirs, filepath.Join(root, dir))
	}
	var dirs []string
	for _, dir := range spagoDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			if info, statErr := os.Stat(dir); statErr == nil && !info.IsDir() {
				continue
			}
			panic(err)
		}
		for _, entry := range entries {
			pkgDir := filepath.Join(dir, entry.Name())
			info, err := os.Stat(pkgDir)
			if err != nil {
				panic(err)
			}
			if !info.IsDir() {
				continue
			}
			versions, err := os.ReadDir(pkgDir)
			if err != nil {
				panic(err)
			}
			foundVersion := false
			for _, version := range versions {
				if !strings.HasPrefix(version.Name(), "v") {
					continue
				}
				versionDir := filepath.Join(pkgDir, version.Name())
				info, err := os.Stat(versionDir)
				if err != nil {
					panic(err)
				}
				if info.IsDir() {
					dirs = append(dirs, versionDir)
					foundVersion = true
				}
			}
			if !foundVersion {
				dirs = append(dirs, pkgDir)
			}
		}
	}
	if ffiDir != "" {
		dirs = append(dirs, filepath.Join(root, ffiDir))
	}
	return append(dirs, root)
}

func FindFfiFileImpl(extension string, extraSpagoDirs []string, ffiDir gopurs_runtime.Value, moduleName string, modulePath gopurs_runtime.Value, _ gopurs_runtime.Value) gopurs_runtime.Value {
	if source := nullablePath(modulePath); source != "" {
		candidate := strings.TrimSuffix(source, ".purs")
		if strings.HasSuffix(source, ".purs") {
			candidate += extension
		}
		if ffiPathExists(candidate) {
			return gopurs_runtime.Str(candidate)
		}
	}
	root, err := os.Getwd()
	if err != nil {
		panic(err)
	}
	for _, dir := range ffiScanDirs(root, nullablePath(ffiDir), extraSpagoDirs) {
		for _, candidate := range []string{
			filepath.Join(dir, "src", filepath.FromSlash(strings.ReplaceAll(moduleName, ".", "/"))) + extension,
			filepath.Join(dir, "src", moduleName) + extension,
			filepath.Join(dir, moduleName) + extension,
		} {
			if ffiPathExists(candidate) {
				return gopurs_runtime.Str(candidate)
			}
		}
	}
	return gopurs_runtime.Any(nil)
}

// CompareStringImpl compares native strings and returns one of the three
// orderings; same order as Data.Ord's OrdStringImpl, without the Value
// boundary (the generic T keeps the caller's representation).
func CompareStringImpl[T any](lt T, eq T, gt T, x string, y string) T {
	if x < y {
		return lt
	}
	if x == y {
		return eq
	}
	return gt
}

// CompareIntImpl is the same for Int (native int64) arguments.
func CompareIntImpl[T any](lt T, eq T, gt T, x int64, y int64) T {
	if x < y {
		return lt
	}
	if x == y {
		return eq
	}
	return gt
}
