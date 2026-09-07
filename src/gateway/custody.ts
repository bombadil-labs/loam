import type { StoreBackend } from "../store/backend.js";

/** Physical retention only. Possession of this capability confers no administrative
 * authority, receipt obligation, or permission to purge the underlying store. */
export type RetentionProbe = Pick<StoreBackend, "holds" | "heldAmong">;

/** Probe a physical tier independently of any Gateway's administrative receipts.
 * Failed batch probes never fall back to a potentially narrower tier. A partial
 * fallback failure preserves observed retention while leaving the batch unproven. */
export async function probePhysicalRetention(
  target: RetentionProbe,
  ids: readonly string[],
): Promise<{ held: Set<string>; unasked: Set<string> }> {
  const held = new Set<string>();
  const unasked = new Set<string>();
  if (ids.length === 0) return { held, unasked };
  try {
    if (target.heldAmong) {
      const requested = new Set(ids);
      for (const id of await target.heldAmong(ids)) if (requested.has(id)) held.add(id);
    } else {
      for (const id of ids) if (await target.holds(id)) held.add(id);
    }
  } catch {
    for (const id of ids) unasked.add(id);
  }
  return { held, unasked };
}
