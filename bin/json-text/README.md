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
