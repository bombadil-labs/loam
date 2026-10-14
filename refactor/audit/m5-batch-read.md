# M5: ordinary PRIMARY reads through the portable batch path

This note plans Loam's side of SPEC-16 M5. The contract is rhizomatic's
`contracts/materialization/LOAM-TRIAL.md` and the ten M5 cases in its `MILESTONES.json`. Loam pins
the published release B, `@bombadil/rhizomatic@0.11.0-next.9`.

## The door

The target is `resolvedNodeImpl` in `src/gateway/reads.ts`, on the ordinary named PRIMARY branch
of `gatherImpl`. Today that branch evaluates the lowered program natively, or reads a warm
materialization. After M5 an eligible read runs the package's batch gather, then batch resolve.
Present and historical reads both move. Bound, channel, pinned, watch and subscription reads stay
native.

## What Loam builds

1. **A frozen invocation value.** The door samples the host time once. It fixes the route, the
   source selection, the definition selection, the operand time and the serving time. Nothing
   reads the clock after that.
2. **The source capability.** It captures the whole authorized PRIMARY source at that time: the
   same narrowed ground the native branch reads (`readGround`, or `asOfGroundImpl` for a
   historical read). It signs the source binding, authority, capture and snapshot with this
   peer's key. The current-source check compares the journal's present source with the captured
   revision. A changed source is a visible typed failure.
3. **Exact definition extraction.** The selected registration's original signed HyperSchema and
   reading acts come from admitted law, by act identity. A missing promised act is an error. A
   native-only `register()` fixture without published acts is a declared bystander.
4. **Eligibility before dispatch.** The read is eligible only when every term, reference,
   reflection, alias and reading order is core, and no governed lowering applies. A pure
   classifier returns `portable` or a named native reason. Tests observe the result.
5. **Capacity before dispatch.** The classifier also preflights the full source and the built
   request against every input limit, with carrier overhead counted. Outside input capacity
   selects the native branch before dispatch, with unchanged answers. After dispatch, every error
   surfaces; nothing falls back to native.
6. **The async door.** `resolvedNodeImpl` is synchronous. The portable path is an explicit async
   read at the GraphQL field resolver. Each call makes one attempt with no retry.
7. **Application-owned steps stay.** Child decoration, resolvers, the memo and as-of annotations
   run on the decoded envelope, as they run today on the native HView.

## Slices

| Slice | Content | Cases |
| --- | --- | --- |
| 0 | Pin 0.11.0-next.9. | — |
| 1 | `portable-read.ts`: invocation value, source capability, definition extraction, classifier, package invocation. A spike test proves the Plant read matches native bytes. | 1, part of 8 |
| 2 | The async door for present and historical PRIMARY reads, with native exclusion before dispatch. | 1, 4, 6 |
| 3 | The remaining schedules on journal-backed stores. | 2, 3, 5, 7, 8, 9 |
| 4 | Remove the eligible duplication; record counts and bytes for Plant and Bed. | 10 |

## Slice 1 findings

- Exact closure extraction works. A Plant read built from Loam's own published acts and source
  answers the native HView and View digests, through the package endpoint. So does the nested
  Bed read, and an as-of read.
- A published lens can depend on a `register()` lens that never published acts. That read stays
  native with reason `unpublished-law`. A missing act whose lens has a binding in law is an error.
- The portable route is opt-in (`portableReads`). Each portable read captures and verifies the
  whole PRIMARY source. In the browser tutorial that took seconds per read, and lessons timed out
  when the route was on by default. Default-on waits for a source that is not recaptured per read.
- `onReadRoute` reports each read's route and native reason, so tests observe the classifier.

## Open questions

- The snapshot and capture documents are assembled in Loam with the package's exported encoders.
  A producer in rhizomatic would remove that duplication. That needs a rhizomatic request.
- The receiver, caller and capturer keys are all this peer's key in the trial. A separate caller
  key is possible later.
- When does the portable route become the default? It needs either a cheaper source capture or a
  ruling that the cost is acceptable. That is Myk's call.
