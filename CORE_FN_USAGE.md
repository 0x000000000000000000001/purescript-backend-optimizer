# CoreFn source usage facts in the Rust optimizer

`CoreFn.Json.decodeModule` reads `annotation.bindingUsage` and
`annotation.variableUse` directly, without a root marker, version or phase
selector. `Ann.sourceUsage` stores these blocks internally; it is not another
JSON property. Standalone `decodeAnn` leaves the facts unknown because it lacks
the originating module name.

Binding facts contain a required local `bindingId`, optional `maxUses`, and
optional `hasEscapingUseContext`. Occurrence facts contain a required
`bindingId` and optional `lastLocalUse`. Missing blocks, optional fields and
`null` remain unknown. They never become zero or a proof. Present malformed
facts are rejected.

`SourceBindingId` combines the module name and local ID. The reader validates
lexical scope, same-name shadowing, module-wide ID uniqueness and permitted
annotation positions. Binding facts belong to local bindings, parameters and
pattern bindings; occurrence facts belong to local variable references.
Globals and imports do not receive local identities.

`maxUses` bounds direct uses of each dynamic binding instance. The producer
counts with arbitrary-precision integers. This reader keeps nonnegative `Int`
bounds; larger integral bounds become unknown rather than wrapping. Negative
or fractional counts and source IDs outside the local `Int` range are rejected.
`lastLocalUse` accepts true or unknown. `hasEscapingUseContext` describes source
use contexts, not heap aliases. These facts do not establish transitive memory
uniqueness or permission to mutate an object.

The old `usageCount` and `escapes` fields are neither read nor stored. An old
`usageAnalysis` root property has no effect on decoding. Files without the new
annotation blocks therefore supply no source usage facts.

## Transformation boundary

`invalidateSourceUsageModule` clears source identities and facts from executable
annotations. `monomorphize` clears its output, including annotations copied from
imported bindings. `toBackendModule` clears its input before conversion and
optimization. `BackendSyntax` no longer carries a `UsageMeta` wrapper.

This prevents counts or last-use proofs from surviving substitution, inlining,
specialization, deletion or duplication. An ID rename alone would not make
those facts valid again. Backend liveness is computed from the transformed IR.
Purust's clone/move decisions continue to use its final lexical liveness;
destructive reuse also depends on its existing runtime `Rc` uniqueness checks.
Source facts do not override either analysis.

## Focused verification

After rebuilding Purust, from its package directory:

```sh
node ../../purescript-backend-optimizer-purust/test/source-usage.mjs ./output
node ../../purescript-backend-optimizer-purust/test/usage-metadata.mjs ./output
node tests/codegen/usage-metadata.mjs
```

The tests cover direct decoding, unknowns, malformed facts, lexical identity,
invalidation, unchanged backend output across source-fact variations, and
recomputed occurrence counts. The Rust runtime regression checks unique reuse,
shared persistence, retained arguments, guarded fallbacks, repeated closure
captures and representation conversions.
