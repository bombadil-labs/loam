// The host cut a retiring recovery record needs at the append door (recovery-history.md), as
// `loam user recover` writes it. `withHostCut` prepends one cut per retiring record in `batch`. It
// covers the host only: a store with declared pools also
// needs a cut in each, which the command writes and a rail must write too.

import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { refusedIds } from "../../src/gateway/erase.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import { cutClaims, incarnationId } from "../../src/gateway/recovery-cut.js";
import { recordPrevious } from "../../src/gateway/user-root.js";

export function withHostCut(gw: Gateway, seed: string, batch: readonly Delta[]): Delta[] {
  const op = authorForSeed(seed);
  const store = incarnationId(gw.reactor, op, refusedIds(gw.reactor, op));
  if (store === undefined) throw new Error("withHostCut: the store has no incarnation marker");
  const cuts = batch.flatMap((d) => {
    const key = d.claims.author === op ? recordPrevious(d) : undefined;
    return key === undefined ? [] : [{ record: d, key }];
  });
  return [
    ...cuts.map(({ record, key }) =>
      signClaims(
        cutClaims(
          { store, attempt: "fixture", recovery: record.id, key },
          op,
          record.claims.timestamp,
        ),
        seed,
      ),
    ),
    ...batch,
  ];
}
