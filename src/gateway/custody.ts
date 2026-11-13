import type { StoreBackend } from "../store/backend.js";

export type RetentionProbe = Pick<StoreBackend, "holds" | "heldAmong">;

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

export async function storeInventory(backend: StoreBackend): Promise<Set<string> | string> {
  if (backend.ids === undefined) return "the store offers no inventory";
  try {
    return await backend.ids();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
export async function storeHoldsAny(backend: StoreBackend): Promise<boolean> {
  if (backend.holdsAny === undefined) return true;
  try {
    return await backend.holdsAny();
  } catch {
    return true;
  }
}
