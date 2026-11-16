import type { Delta, PeerStore } from "@bombadil/rhizomatic";

export async function fillStore(peer: PeerStore, deltas: readonly Delta[]): Promise<number> {
  const snapshot = await peer.read();
  const { head, count, revision } = snapshot;
  snapshot.release();
  const result = await peer.append({
    expectedHead: head,
    nextHead: `head-${revision + 1}`,
    frame: null,
    added: deltas.map((delta, i) => ({
      delta,
      arrival: {
        id: delta.id,
        at: Date.now(),
        sequence: count + i + 1,
        transfer: 1,
        sender: "fixture",
      },
    })),
  });
  if (result.status !== "committed") throw new Error(`fillStore: append ${result.status}`);
  return result.revision;
}
