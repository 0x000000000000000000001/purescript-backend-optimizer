# CoreFn usage facts in the Go optimizer

`CoreFn.Json.decodeModule` accepts `usageAnalysis: {"version":1,"phase":"corefn"}`.
With a missing or unsupported contract, `Ann.sourceUsage` is `Nothing`, including
when future blocks have a different shape. Historical `usageCount` and `escapes`
do not supply version-one proofs. `decodeAnn` used on its own also leaves source
usage unknown because it has no root contract or module provenance.

Recognized blocks preserve missing/null facts as `Nothing`. Known bindings and
occurrences carry a `SourceBindingId` containing the originating module name and
the local ID. Decoding checks local lexical scope, same-name shadowing, unique
IDs throughout the module, and the permitted annotation positions. It does not
attempt to re-prove the upstream analysis from the JSON.

The Haskell producer uses arbitrary-precision counts. This optimizer stores only
nonnegative `Int` bounds; a larger integral bound becomes `Nothing`, never a
rounded or wrapped count. Negative/fractional counts and unsupported boolean
values are rejected under a recognized contract. Source IDs outside the local
`Int` range are rejected. `lastLocalUse` accepts only true or unknown; none of
these fields is evidence of object uniqueness.

## Transformation boundary

`invalidateSourceUsageModule` removes source identities and their facts from all
executable annotations. The Go pipeline applies it before collecting bodies for
monomorphization. `monomorphize` also strips its output, and `toBackendModule`
strips its input, covering direct callers and builds without specialization.
No version-one usage certificate or source binding ID is stored in `BackendSyntax`.
Historical `usageCount` and `escapes` remain separate and may be carried by
`UsageMeta`; invalidating `sourceUsage` does not turn them into version-one proofs.

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

After rebuilding the optimizer used by Go:

```sh
node test/source-usage.mjs /absolute/path/to/gopurs/output
```

The tests cover the contract gate, unknowns, range handling, provenance,
shadowing, malformed references, invalidation and absence of source certificates
in backend IR. They complement the Haskell analysis tests; parsing source facts
does not itself enable destructive updates.
