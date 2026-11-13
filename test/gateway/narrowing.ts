import { expect } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "../../src/gateway/gateway.js";

export const retraction = (
  targetId: string,
  author: string,
  seed: string,
  timestamp: number,
): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    seed,
  );

export const isSuppressed = (gw: Gateway, id: string): boolean =>
  gw.reactor.negationsOf(id).some((n) => gw.reactor.get(n) !== undefined);

export const isPresent = (gw: Gateway, id: string): boolean => gw.reactor.get(id) !== undefined;

export interface NarrowingCase {
  readonly what: string;
  readonly source: Gateway;
  readonly destination: Gateway;
  readonly struckClaim: string;
}

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
