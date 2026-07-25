// Module-version identity (SPEC §27.2, §27.6 question 2). Membership is a QUERY — a Term → dset,
// built as `select`/`watch` (ingest.ts, §27.6). A LIVING container re-evaluates that Term as the
// ground grows; a MODULE VERSION is the same Term evaluated ONCE and frozen, and this is where the
// frozen thing gets its NAME.
//
// The name is a content address over the members, and §27.2 fixed the one property that matters:
// it is ORDER-FREE, because the members are a CRDT set. Nothing about how a member was reached —
// which Term named it, which side of a union it arrived on, what the store's iteration order
// happened to be, what time it was — may reach the address. Only WHICH DELTAS ARE IN. That is the
// whole promise, and everything the version is for rests on it: two consumers who froze the same
// members get the same id without coordinating, so a module version dedups, verifies, and
// reproduces. A package hash.
//
// THE RUNG (§22.3 / §23.10's economics ladder — `inline → content-addressed ref → Merkle-chunked
// tree`, written for a byte-blob and here pointed at a delta-SET): this is rung 2, a hash over the
// sorted member ids. Order-freedom is bought by the sort, and every property §27.2 asks for holds
// except INCREMENTAL sharing — "ship me only the members I do not already have." The Merkle-set is
// rung 3 and buys exactly that increment, and nothing in the arc consumes it yet: reference-load
// pulls by federation (§27.3) and merge-load re-signs (§24.3, built #111), so neither one diffs two
// versions to find the delta. When something does — a module registry, an incremental pull — rung 3
// is the named next step. It stays cheap to take because the id is OPAQUE behind `addressOf` below:
// no call site parses it, so the rung can change without any of them moving.
//
// Note what is NOT in the address, deliberately: no timestamp, no author, no store identity, no
// count, no Term. A member's own id already commits to its content and its signature (deltas are
// content-addressed), so hashing the ids commits to the members transitively — and hashing anything
// else would break the agreement between two stores that hold the same members for different
// reasons.

import { contentAddress, type Delta } from "@bombadil/rhizomatic";

/**
 * A frozen container: an immutable delta-set plus the content address that names it (SPEC §27.2).
 * The members are captured at freeze time and never re-evaluated — that non-drift IS the
 * living→frozen distinction, not an optimization of it.
 *
 * So a version HANDS OUT real deltas, and an erasure cannot come back for them: the gateway keeps no
 * reference to any version it minted (`freeze` builds and returns — nothing caches it), which means
 * the retention lives wholly in the caller's own variable, past the reach of the purge, the re-seat,
 * and the pool fan-out (SPEC §11). What the gateway can promise is that it holds no copy itself and
 * will never serve these bytes again; what it cannot promise is a version already in someone's hand.
 * A caller that must survive an erasure should hold the ADDRESS and re-`select` — the persisted form
 * §27.8 requires for exactly this reason: a stored version NAMES its members rather than holding
 * them.
 */
export interface ModuleVersion {
  /** The content address over the members — order-free, and equal across stores. */
  readonly id: string;
  /** The members, as they were when the Term was evaluated. Immutable. */
  readonly members: readonly Delta[];
}

// The version's byte-form, and the only place the rung is decided. Sorted member ids, NUL-joined
// (a separator no delta id contains, so no two distinct member sets can share a preimage by
// running together), then content-addressed. The `loam.container.v1` prefix is a domain tag: it
// keeps a module-version address from ever colliding with some other content address computed over
// the same bytes elsewhere in the store, and it is the seam a future rung changes.
const addressOf = (memberIds: readonly string[]): string =>
  contentAddress(
    new TextEncoder().encode(`loam.container.v1\u0000${[...memberIds].sort().join("\u0000")}`),
  );

/**
 * Freeze an already-evaluated membership into a module version (SPEC §27.2).
 *
 * Takes the members rather than the Term, so the door's one refusal voice for a non-dset Term stays
 * in `select` and is not restated here — `freeze` IS `select` plus an address, and it must never
 * widen what `select` accepts.
 */
export function freezeMembers(members: readonly Delta[]): ModuleVersion {
  const frozen = Object.freeze([...members]);
  return Object.freeze({
    id: addressOf(frozen.map((d) => d.id)),
    members: frozen,
  });
}
