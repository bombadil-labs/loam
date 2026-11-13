import type { Gateway } from "./gateway.js";
import { rebaseHostPeer, reportPurged } from "./peer-admission.js";

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
