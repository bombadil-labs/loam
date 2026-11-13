// What a law reader may ask of the deltas it reads: one delta by id, the deltas that point at an
// entity, the deltas that negate a delta, and which negations hold at an instant. A Reactor is a
// Ground as it stands. So is anything else that answers these five reads over a fixed set of
// deltas, such as a scope a door fetched in one batch.
//
// A function that takes a Ground reads the deltas it is handed and nothing else. Hold that line
// when you change one:
//
// - The record `declarationsOf` returns (erasure governors, the user ground, the read-hidden set,
//   the principal scope) and every per-ground cache are found through a WeakMap keyed on the
//   Reactor OBJECT: `ground-declarations.ts`, `ground-revision.ts`, the reading cache in
//   `erase-law.ts`, the table memo in `container-law.ts`, the arrival positions in
//   `recovery-cut.ts`, the protected-ingress memo in `local-channel-events.ts`. A Ground that is
//   not that Reactor would read an empty record and a cold cache, and nothing would say so. A
//   function that consults any of them therefore takes a Reactor. The compiler holds this as long
//   as nobody casts: a Ground does not pass where a Reactor is asked for.
// - A reader that needs a member outside this type (`snapshot`, `arrivalLog`, `size`, `subset`,
//   an evaluation) takes a Reactor too. Do not widen the type to admit it. Each member here is one
//   an indexed store can answer for a fetched scope; the whole set and the arrival order are not.
// - rhizomatic's `DeltaSource` names the same two index reads as `targets` and `negators`, and
//   has no negation readers. Readers here call the Reactor's own spellings, so this type is cut
//   from Reactor. To hand a Ground to `scopeIds` or `evalAnchored`, add those two members here.

import type { Reactor } from "@bombadil/rhizomatic";

export type Ground = Pick<
  Reactor,
  "get" | "byTarget" | "negationsOf" | "negationWitnesses" | "negationPredicate"
>;
