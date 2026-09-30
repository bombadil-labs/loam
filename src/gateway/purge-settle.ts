// Paying owed purges: the one erasure effect the admission doors call after they admit an order.

import type { Gateway } from "./gateway.js";
import { rebaseHostPeer, reportPurged } from "./peer-admission.js";

/**
 * Pay the purges this host's journal holds owed. An admitted erasure order whose target the store
 * held records an obligation; `eraseImpl` pays its own, and this pays every other one (an order
 * that came through the append or federation door). The journal is rebased first, so the frames
 * that admitted a target go too. A step that fails leaves its obligation owed, and the erasure
 * screens read it as still held; the next door that admits an order retries it, and
 * `loam erase <id>` pays it (it anchors on the standing order).
 */
export async function settleOwedPurges(gw: Gateway): Promise<void> {
  const peer = gw.peer;
  if (peer === undefined) return;
  const owed = peer.journal
    .snapshot()
    .obligations.filter((o) => o.status !== "removed")
    .map((o) => o.targetId);
  if (owed.length === 0) return;
  try {
    await rebaseHostPeer(peer);
  } catch {
    return;
  }
  let fault: string | undefined;
  try {
    await gw.backend.purge(owed);
  } catch (err) {
    fault = err instanceof Error ? err.message : String(err);
  }
  for (const id of owed) {
    const gone = fault === undefined && !(await gw.backend.holds(id).catch(() => true));
    await reportPurged(
      peer,
      id,
      gone
        ? { status: "removed" }
        : { status: "failed", fault: fault ?? "the store still holds the bytes" },
    ).catch(() => {});
  }
}
