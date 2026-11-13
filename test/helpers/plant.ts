import type { Delta } from "@bombadil/rhizomatic";
import { erasureTarget, isErasure } from "../../src/gateway/erase-law.js";
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
