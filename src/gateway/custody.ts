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

// Every id a store holds on any tier, or undefined when it cannot be listed: a backend with no
// inventory, or a tier that refuses, cannot be accounted for (H9).
export async function storeInventory(backend: StoreBackend): Promise<Set<string> | string> {
  if (backend.ids === undefined) return "the store offers no inventory";
  try {
    return await backend.ids();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
// Does a store hold bytes on any tier? Unprovable is TRUE: a backend with no whole-store probe,
// or a tier that refuses the question, cannot license an erasure (H9).
export async function storeHoldsAny(backend: StoreBackend): Promise<boolean> {
  if (backend.holdsAny === undefined) return true;
  try {
    return await backend.holdsAny();
  } catch {
    return true;
  }
}
