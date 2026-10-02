# JavaScript `.purmeta` storage contract

`PureScript.Backend.Optimizer.Cache` keeps implementations available during one
build, using a decoded RAM LRU and disk scratch files. **Disk persistence alone
does not authorize reuse in another build.** This contract describes the
JavaScript implementation in `src/PureScript/Backend/Optimizer/Cache.js`.

## Directory and ownership

The path is `.purmeta/<ModuleName>.purmeta`, relative to the process's working
directory at each operation. Dotted names stay dotted: module `Data.Map` uses
`.purmeta/Data.Map.purmeta`. The writer creates `.purmeta` on demand.

The directory is independent of the frontend's input/output directory, main
selection and RAM budget. There is no directory option in this API. Names come
from the compiler's module names; this is not a general file-path API.

A publication scope requires a stable working directory and exclusive ownership
of its scratch files. Independent builds sharing a directory must run serially;
the cache state is process-global, keyed only by module name. After changing
projects or working directories, callers start a new scope with
`beginPurmetaBuild`. PBO's parallel builder coordinates one build and is distinct
from overlapping independent builder invocations.

Starting a build clears RAM and membership without scanning or deleting files.
Files for deleted, absent or not-yet-published modules can remain on disk, but
their presence grants no read access. Each successful publication overwrites its
module's file. Scratch files can be removed between builds and are regenerated
from fresh or externally validated restored modules.

## Payload and version status

The logical payload is only `BackendImplementations`:

```purescript
Map (Qualified Ident) (Tuple BackendAnalysis ExternImpl)
```

It is **not a complete `BackendModule`**: restoring directives, exports, private
globals and frontend contributions requires the builder/frontend's other state.

The current bytes are produced by `v8.serialize` after a constructor-tag walk:

1. Recognized PureScript instances become ordinary objects containing
   `__ps: "<registry-prefix>$<constructor-name>"` plus enumerable own fields.
2. Arrays and ordinary objects are recursively copied. A temporary symbol on
   source objects memoizes this encoding walk; it is removed after the walk.
3. `v8.deserialize` reads the tagged data. Recognized tags are reconstructed with
   the corresponding constructor prototype and their fields; `__ps` is removed.

The registry covers `Semantics`, `Syntax`, `CoreFn`, `Analysis`, `DataMap`,
`DataTuple`, `DataMaybe`, `DataEither`, `DataList` and `DataNonEmptyArray`.
Constructor names/fields are coupled to the loaded optimizer and libraries.

**There is no PBO file-protocol version or envelope in this format.** In
particular, it contains no PBO magic/version, module identity, compiler identity,
input/dependency key or checksum. V8's own wire-version marker only describes
its serializer format; successful V8 decoding establishes no optimizer-level
compatibility. The diagnostics JSON's `schema: 1` describes the report, not these
files.

Equal values can have different V8 encodings. Byte equality or file size is not
a semantic cache key. The decoder is recursive and does not memoize reconstructed
constructor instances, so preservation of constructor sharing is not guaranteed.
It also has no complete schema/constructor-field validation: unknown tags remain
ordinary data. These scratch payloads assume the current producer and its
acyclic optimizer data; they are not a validated interchange format.

## Publication and invalidation

The process starts with an **empty membership set**, including before the first
builder invocation. A direct read cannot bootstrap itself from residual disk
files. Direct callers can publish into this initial scope; subsequent
`beginPurmetaBuild` calls invalidate those publications like any previous scope.

| Operation | RAM | Current-scope membership | Disk |
| --- | --- | --- | --- |
| Process initialization | Empty | Empty | Existing files ignored |
| `beginPurmetaBuild` | Emptied | Emptied | Left in place |
| Successful `writePurmetaSync` | Insert/replace and refresh recency | Add module after the write succeeds | Serialize and overwrite module file |
| Read of an unpublished module | Not consulted | Reject | No existence probe or read |
| Read of a published module | Hit refreshes recency; miss may insert decoded data | Retained | Fallback after a RAM miss |
| `clearPurmetaCache` | Emptied | Retained | Current-scope fallback remains available |
| `trimPurmetaCache` | Evict oldest entries to the serialized-size budget | Retained | Current-scope fallback remains available |

Both `buildModules` and `buildModulesParallel` call `beginPurmetaBuild` on every
execution, including empty inputs and repeated execution of the same action.
The sequential builder publishes fresh implementations after its codegen
callback; an accepted `onSkipModule` result is also republished. The parallel
builder publishes finalized implementations before flushing ordered codegen;
attempts with pending predecessors are deferred rather than published.

In all cases an `onSkipModule` producer is responsible for validating its restored
module. The membership set records **publication**, not an independent content
verification. Module names, matching mtimes and a decodable old file do not
replace that validation. Specialization names and accumulated optimizer state
must belong to the current build.

### Failure behavior

Writes are synchronous, direct replacements, without a temporary-file/rename
protocol. Serialization or write errors propagate; a first failed publication
does not add membership. A failed replacement may leave a truncated file and an
older RAM entry, so the build must abort on the write failure. A new build starts
with empty membership and republishes before reading.

For a published module, a missing disk file returns `Nothing`. Read/decoding
exceptions log `Failed to read purmeta for ...` and return `Nothing`; they are
counted when diagnostics are enabled. This is a lookup fallback, not validation
of arbitrary replacement bytes. RAM hits do not inspect disk changes.

## Requirements before cross-build reuse

A persistent reuse protocol must explicitly add and validate:

- **Namespace and version:** a deliberate cache root, target/toolchain namespace
  and PBO semantic-format version, with incompatible versions treated as misses.
- **Identity and invalidation:** module identity, captured input bytes, effective
  optimizer options/foreign semantics/directives, compiler and Node/V8 identities,
  dependencies and the relevant ordered preceding build state. Changes to
  specialization naming or constructor layouts invalidate entries. Membership
  in a former build is insufficient.
- **Validated publication:** an integrity-checked, versioned envelope; an explicit
  typed codec; atomic file publication and isolation between independent writers.
  Invalid/truncated/unknown data must miss before reaching the optimizer.
- **Complete restoration:** the corresponding directives and naming/private
  global context must be restored or proven equivalent, and the accepted result
  must enter the current publication path. A map of implementations alone is
  insufficient to skip an entire module's work.

The existing cache API enables none of these by retaining a `.purmeta` directory.
RAM budget and profiling are storage/measurement choices, not semantic keys.

## Native implementation and validation

`Cache.go` uses an authoritative in-memory implementation map for one build; it
does not read or write V8 `.purmeta` files. Its explicit clear/trim operations are
no-ops because there is no secondary disk store. `BeginPurmetaBuild` releases the
previous map.

`test/purmeta-build-cache.mjs` covers startup rejection in a fresh process,
repeated and empty builds, restored publication and sequential publication
order. The startup regression checks that valid and corrupt residual files are
rejected before any filesystem probe, then exercises a fresh publication and
the next reset. LRU, budget, stats, implementation-lookup and parallel-visibility
tests cover disk fallback, errors and builder visibility within the scope.
