# CoreFn source usage facts

`CoreFn.Json.decodeModule` reads `annotation.bindingUsage` and
`annotation.variableUse` directly. There is no root marker, version or phase
selector. `Ann.sourceUsage` is the optimizer's internal representation of these
two blocks, not an additional JSON field.

A binding block contains a required `bindingId`, an optional `maxUses` and an
optional `hasEscapingUseContext`. An occurrence block contains a required
`bindingId` and an optional `lastLocalUse`. Missing blocks or optional facts,
and `null`, remain unknown (`Nothing`); they never become zero or a proof.
Present malformed blocks are rejected. `decodeAnn` used on its own leaves source
usage unknown because it does not receive module provenance; `decodeModule`
attaches that provenance and validates the annotations together.

Known bindings and occurrences carry a `SourceBindingId` containing the
originating module name and the local ID. Decoding checks local lexical scope,
same-name shadowing, unique IDs throughout the module, and permitted annotation
positions. Binding facts belong to local bindings, abstraction parameters and
pattern bindings; occurrence facts belong to local variable references. The
reader does not attempt to re-prove the upstream analysis from the JSON.

`maxUses` bounds direct uses of each dynamic instance of a binding, not the
number of textual occurrences or calls of its enclosing function. The Haskell
producer uses arbitrary-precision counts. This optimizer stores only
nonnegative `Int` bounds; a larger integral bound becomes `Nothing`, never a
rounded or wrapped count. Negative/fractional counts and unsupported boolean
values are rejected. Source IDs outside the local `Int` range are rejected.
`lastLocalUse` accepts only true or unknown: true proves no later direct use of
that binding instance on the relevant execution paths. The escaping-context
flag describes the upstream classification of use contexts, not heap aliases.
None of these facts proves object uniqueness or permission to mutate memory.

The obsolete `usageCount` and `escapes` fields are not decoded or stored.
An obsolete `usageAnalysis` root property, like other unrelated JSON fields,
has no effect on reading or validating the annotation facts. Old files without
the two new blocks therefore carry no source usage facts.

## Transformation boundary

`invalidateSourceUsageModule` removes source identities and their facts from all
executable annotations. The Go pipeline applies it before collecting bodies for
monomorphization. `monomorphize` also strips its output, and `toBackendModule`
strips its input, covering direct callers and builds without specialization.
No source usage certificate or source binding ID is stored in `BackendSyntax`.
The historical `UsageMeta` and `SemUsageMeta` wrappers have been removed.
Purust also uses these conversion and monomorphization boundaries; its final
lexical liveness drives clone/move decisions, and destructive reuse retains
its runtime `Rc` uniqueness checks. Source facts do not override either analysis.

This deliberately avoids transporting stale counts through dictionary inlining,
specialization, pattern compilation, closure rewrites, deletion or duplication.
There is no source ID left to remap once this boundary has been crossed. New
backend facts must be computed on the final transformed body. Replacing an ID
alone would not validate a count or a last-use proof.

Backend locals use lexical `Level` values. `Convert.intro/currentLevel` assign
their scopes and semantic quotation introduces levels through `nextLevel`.
Levels are **not globally unique**: unrelated functions and sibling scopes can
reuse the same numeric level. A downstream ownership analysis must resolve each
occurrence in the current function and lexical environment, and assign a fresh
analysis identity to each binding occurrence. Its summaries must be discarded
or recomputed if any later pass changes that body.

## Focused verification

After rebuilding the relevant backend, from this optimizer checkout:

```sh
node test/source-usage.mjs /absolute/path/to/backend/output
node test/usage-metadata.mjs /absolute/path/to/backend/output
```

The tests cover direct decoding without a root marker, unknowns, rejection of
malformed facts, ignored obsolete fields, range handling, provenance, shadowing,
invalidation and absence of source certificates in backend IR. They complement
the Haskell analysis tests; parsing source facts does not itself enable
destructive updates.

From the Purust package, `node tests/codegen/usage-metadata.mjs` also checks
unique reuse, shared persistence, retained arguments, guarded fallbacks, repeated
closure captures and representation conversions in generated Rust.
