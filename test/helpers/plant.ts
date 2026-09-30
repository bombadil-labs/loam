// Plant deltas around the door: no Loam check runs, the way a replanted cold copy or an older
// writer's rows arrive. A journaled host's rows are its journal's, so the plant is a local arrival
// in that journal: one transfer per delta, in the order given, because readers order events by
// arrival and one transfer's arrivals are simultaneous. An erasure order owes a purge when the
// store holds its target. An empty store given `peer` starts that peer's
// journal first (a seeded store, as a host would write it); an empty store with no `peer` takes
// the rows directly.

import type { Delta } from "@bombadil/rhizomatic";
import { erasureTarget, isErasure } from "../../src/gateway/erase.js";
import { admitErasureOrders, admitLocal, openHostPeer } from "../../src/gateway/peer-admission.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { holdsJournals } from "../../src/store/peer-image.js";

export async function plant(
  backend: StoreBackend,
  deltas: readonly Delta[],
  peer?: string,
): Promise<void> {
  if (holdsJournals(backend)) {
    const journals = await backend.journalPeers();
    const peerId = journals.length === 0 ? peer : journals.length === 1 ? journals[0] : undefined;
    if (peerId !== undefined) {
      const opened = await openHostPeer(backend.journalStore(), peerId);
      for (const d of deltas) {
        const at = Date.now();
        if (!isErasure(d.claims)) await admitLocal(opened.peer, [d], at, () => false);
        else {
          const targetId = erasureTarget(d.claims)!;
          const surfaceHoldsBytes = await backend.holds(targetId);
          await admitErasureOrders(
            opened.peer,
            [{ delta: d, targetId, surfaceHoldsBytes }],
            "local",
            at,
          );
        }
      }
      return;
    }
  }
  await backend.append(deltas);
}
