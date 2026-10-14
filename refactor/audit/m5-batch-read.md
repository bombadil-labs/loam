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

## Slice 3 findings

- The capacity boundary is exact. A source of 4096 appearances runs portable. A source of 4097
  stays native with reason `input-capacity`. Both answer the native digests. The count is the
  snapshot's appearances: every delta of the authorized source, law included.
- A present source that cannot be read refuses `source-unavailable` at gather. It does not throw
  and does not fall back.
- The cost of one portable read is linear in the source. Measured on Linux, one Plant read:

  | appearances | preflight | gather and resolve |
  | --- | --- | --- |
  | 512 | 2.2 s | 7.2 s |
  | 1024 | 4.3 s | 14.5 s |
  | 2048 | 10.0 s | 28.9 s |
  | 4096 | about 79 s in total | |

- About 70% of that time is ed25519 signature checks in the package. One read decodes the full
  source snapshot four times: in the preflight (about 23% of the time), in the gather endpoint
  (about 26%), and in `readMaterializationResult` for the gather result and for the resolve result
  (about 47% together). Each decode checks each appearance's signature once, when
  `decodeMaterializationAppearance` re-encodes it.
- So the default-on cost is mostly package-side. A verified-snapshot handle that the preflight, the
  endpoint and the result reader share would cut it by about four times. That needs a rhizomatic
  request.

## Slice 4 findings: scoped capture (SPEC-17)

Myk ruled on 2026-10-14 that no cost may scale with the size of the system. This slice moves the
door onto scoped capture from rhizomatic's PR #73.

- The capture holds S(scope), not the store. The scope is the read's root, its constant anchors
  and every expanded child. `Reactor.evalAnchored` finds it from the index.
- Program selection reads the definition entities by index. It no longer scans all law.
- The freshness check recomputes S(scope) from the index. It does not read the whole ground.
- The library builds the snapshot (`produceMaterializationSnapshot`). Loam no longer assembles it.
- A program that is not anchored stays native with the new reason `unanchored`.
- The capacity limit now counts the scoped appearances. 5000 unrelated facts leave the capture and
  the route unchanged. 4096 facts in the scope run portable; 4097 stay native.
- The producer applies the source limits first. Its `resource-limit` maps to `input-capacity`.

Measured on Linux, one Plant read with N facts on the root, after this slice:

| N in scope | append of N | classify | portable read | native read |
| --- | --- | --- | --- | --- |
| 400 | 2.1 s | 0.8 s | 3.2 s | 25 ms |
| 1000 | 3.8 s | 1.6 s | 8.3 s | 70 ms |

Two more costs came out of the profile and are fixed:

- Append was quadratic in a batch on one entity: 77 s for 1000 facts. Each delta refreshed the warm
  view over the whole entity. An admitted batch now enters the reactor as one update
  (`ingestBatch`), so each view refreshes once per batch. An animated gateway still ingests one
  delta at a time, because its host fires bindings per delta.
- The same signature was checked at ingest, in the producer and in each envelope decode.
  Rhizomatic #73 remembers successful checks. A 400-fact read went from 11.8 s to 4.0 s.

What stays: a portable read still decodes the snapshot several times. Its cost is linear in the
scope, about 8 ms per delta. That is footprint cost, not store cost.

### Review of slice 4

Three fresh-context lenses read the diff: suppression closure, scan scale and hollow rails. No
resurrection was found. Fixed in this slice:

- Program selection used its own strike rule. It counted any author's strike and one link only.
  A stranger's strike, or a struck withdrawal, made a parent lens's portable read throw where
  native answered. Selection and `bound()` now use native law's rule: a law author's act, in its
  window, not retired by a surviving lawful strike.
- New rails: law selection (2 cases), a slate that lands in flight, the as-of operand cut, the
  scoped capacity boundary with unrelated facts present, the capture revision under growth, a
  refused batch, and a claim with its strike in one batch. Each one fails with its fix reverted.

Found and not fixed here. Each one costs the store's history on every read or catch-up, on the
native route as well:

- `readClosedIds` walks every erasure ever filed and every slated member. A read calls it three
  or four times. The fix is a closed-set index, or a closed set scoped to S(scope).
- Catch-up rereads the whole journal and copies the whole snapshot when the head moves.
- `notifyUserDependents` refreshes every materialization in a watching pool on every batch.
- A lowered (governed) warm view refreshes over the whole store.
- A lens registered at an override entity is not found by index. It routes native as
  `unpublished-law`. That loses coverage. It does not give a wrong answer.

## Open questions

- The receiver, caller and capturer keys are all this peer's key in the trial. A separate caller
  key is possible later.
- When does the portable route become the default? Its cost no longer grows with the store. It
  is still about 100 times the native read per scoped delta. That is Myk's call.
- The capture lists only operands as held. SPEC-16 MR-10a says `rawIds` are what each peer holds
  within the scope. Should a read-closed or past-the-cut id appear in signed testimony? That is a
  design call for SPEC-16.
- A portable read checks its source once, before gather. A write that lands between that check
  and the answer is not seen. MR-10 states this window. Native reads have no such window.
