# Native text-to-module input specialization

`PureScript.Backend.Optimizer.CoreFn.Json.Text.parseModule` decodes a complete
JSON document into an owned `Module Ann`. JavaScript uses the ordinary parser
and `decodeModule`; Go validates/indexes the document and feeds typed cursors
directly into the native module decoder.

`generate.py` derives `src/PureScript/Backend/Optimizer/CoreFn/Json/Text.go` from
the canonical `CoreFn/Json.go` decoder and the two local input templates. Its
transformations change JSON access, not schema order, constructors, type-table
resolution or source-usage validation. Fixed discriminator sites are checked
explicitly before borrowing their temporary text. All stored strings are owned.
The specialization also retains the text decoder's native Int-literal policy:
`ndInt`/`cndInt` accept `2147483648`, the frontend operand of Int32-min's negation;
type-table indices keep their Int32 bounds.

After changing the canonical decoder or an input template:

```sh
python3 bin/json-text/generate.py
python3 bin/json-text/generate.py --check
```

The generated file is checked in; consumers need neither Python nor a generation
step. The Go implementation uses the same internal generated source-span/Map
helpers as the canonical native decoder. The module imports that decoder for
its public error/parser fallback, keeping those dependencies available.

Validation and benchmark artifacts for the initial integration are preserved in
the adjacent benchmark checkout under `var/benchmark/json-tast-cursor-20260924/`.
`test/json-text-native_test.go` exercises the public parser/error boundary in a
generated test workspace. The benchmark's `typed-tast/validate.py --integrated`
also runs the frozen-module, mutation, type-table, ownership and race checks.

`test/type-table-strings.mjs` checks the PureScript reference's PSString values,
row labels and error paths. `test/type-table-strings_test.go`, copied into a
retained native compiler's `output/purescript`, exercises the parsed-JSON and
typed-text paths with the same UTF-16 units. From that `output` directory, run:

```sh
go test -race ./purescript -run '^TestTypeTablePSString' -count=1 -v
```
