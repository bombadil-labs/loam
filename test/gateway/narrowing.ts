// A shared rail for NARROWING operations (hazard H1, see src/gateway/SUBSTRATE-HAZARDS.md).
//
// rhizomatic's `negated(d, D)` ranges over the OPERAND SET (SPEC-2 §4.3): suppression is a property
// of the set being evaluated, not of the delta. So any Loam operation that produces a SUBSET of the
// ground — a seeding edge, an offered lens, a frozen module version, a fork — can hand its consumer
// a claim that was struck at the source and reads as LIVE at the destination. Nothing errors; the
// result is well-formed and wrong.
//
// That class cost three sites before it was named (T38, T39). This helper exists so the fourth one
// is caught by construction rather than by whoever happens to remember. **Run every new narrowing
// operation through `assertPreservesSuppression`.**
//
// WHY IT ASSERTS A READING AND NOT A MEMBERSHIP. The weaker rail — "did delta X cross?" — is what
// the original T15 rails asked, and it passed while the bug shipped. Set membership and what a
// reader SEES come apart exactly when suppression is involved, which is the whole failure. So this
// helper only ever asks the resolved question: is this claim struck at the destination, as it was at
// the source?

import { expect } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../../src/gateway/gateway.js";

/** A retraction of `targetId`, in `author`'s own voice. */
export const retraction = (
  targetId: string,
  author: string,
  seed: string,
  timestamp: number,
): Delta =>
  signClaims(
    {
      timestamp,
      author,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    seed,
  );

/** Is `id` struck in this store, as a READER would find it (not merely absent)? */
export const isSuppressed = (gw: Gateway, id: string): boolean =>
  gw.reactor.negationsOf(id).some((n) => gw.reactor.get(n) !== undefined);

/** Is `id` present at all? Used only to distinguish "excluded" from "resurrected". */
export const isPresent = (gw: Gateway, id: string): boolean => gw.reactor.get(id) !== undefined;

export interface NarrowingCase {
  /** What the operation is called, for the failure message. */
  readonly what: string;
  /** The store the subset is taken FROM. */
  readonly source: Gateway;
  /** The store the subset lands IN — run the narrowing operation before calling this helper. */
  readonly destination: Gateway;
  /** A claim that is STRUCK in the source and expected to cross (or be excluded — never revived). */
  readonly struckClaim: string;
}

/**
 * The invariant every narrowing operation must satisfy (H1):
 *
 * > A claim suppressed at the source must never read as LIVE at the destination.
 *
 * Two outcomes are correct — the claim crosses **with** what struck it (still suppressed), or it
 * does not cross at all (excluded). Exactly one is wrong: present and unsuppressed. That is the
 * resurrection, and it is the only thing this asserts, so a narrowing operation stays free to
 * decide *what* it admits.
 */
export function assertPreservesSuppression(c: NarrowingCase): void {
  expect(
    isSuppressed(c.source, c.struckClaim),
    `${c.what}: fixture is wrong — the claim is not struck at the source, so this proves nothing`,
  ).toBe(true);

  const present = isPresent(c.destination, c.struckClaim);
  const suppressed = isSuppressed(c.destination, c.struckClaim);

  expect(
    present && !suppressed,
    `${c.what}: RESURRECTION — a claim struck at the source reads as LIVE at the destination. ` +
      `The operation narrowed the delta-set without carrying the negation closure of what it ` +
      `admitted (hazard H1; see src/gateway/SUBSTRATE-HAZARDS.md).`,
  ).toBe(false);
}

/**
 * The dual, and the reason a fix cannot simply admit everything: the closure runs FORWARD ONLY.
 * A negation whose target was never admitted must not drag that target in — otherwise the remedy
 * for H1 turns a scope into a leak.
 */
export function assertClosureDoesNotLeak(c: {
  readonly what: string;
  readonly destination: Gateway;
  readonly excludedTarget: string;
  readonly itsRetraction: string;
}): void {
  expect(
    isPresent(c.destination, c.excludedTarget),
    `${c.what}: LEAK — a delta the operation excluded was dragged in by something negating it. ` +
      `The negation closure must run from admitted deltas to their negations, never the reverse.`,
  ).toBe(false);
  expect(
    isPresent(c.destination, c.itsRetraction),
    `${c.what}: LEAK — a retraction crossed although its target never did.`,
  ).toBe(false);
}
