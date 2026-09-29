// The host cut and cut manifest a retiring recovery record needs at the append door
// (recovery-history.md), as `loam user recover` writes them: per retiring record in `batch`, its cut
// and a manifest naming it, in their OWN append before the batch's (one append's arrivals are
// simultaneous, SPEC-6 §3). It covers the host only: a store with declared pools also needs a cut
// in each, which the command writes and a rail must write too.

import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { refusedIds } from "../../src/gateway/erase.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import { cutClaims, incarnationId, manifestClaims } from "../../src/gateway/recovery-cut.js";
import { recordPrevious } from "../../src/gateway/user-root.js";

export function hostCutFor(gw: Gateway, seed: string, batch: readonly Delta[]): Delta[] {
  const op = authorForSeed(seed);
  const store = incarnationId(gw.reactor, op, refusedIds(gw.reactor, op));
  if (store === undefined) throw new Error("hostCutFor: the store has no incarnation marker");
  const cuts = batch.flatMap((d) => {
    const key = d.claims.author === op ? recordPrevious(d) : undefined;
    return key === undefined ? [] : [{ record: d, key }];
  });
  return [
    ...cuts.flatMap(({ record, key }) => {
      const cut = signClaims(
        cutClaims(
          { store, attempt: "fixture", recovery: record.id, key },
          op,
          record.claims.timestamp,
        ),
        seed,
      );
      return [
        cut,
        signClaims(manifestClaims(record.id, [cut.id], op, record.claims.timestamp), seed),
      ];
    }),
  ];
}

/** Append the barrier for `batch`, then `batch` itself, as two transfers. */
export async function appendWithHostCut(
  gw: Gateway,
  seed: string,
  batch: readonly Delta[],
): Promise<void> {
  const barrier = hostCutFor(gw, seed, batch);
  if (barrier.length > 0) await gw.append(barrier);
  await gw.append(batch);
}
