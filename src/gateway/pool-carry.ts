// The carry of an existing pool (step 6, option (a); refactor/audit/step6-handoff.md). An existing
// pool is a plain backend under its host's key, with no journal, so its state is Loam's derivation:
// its admitted rows, every erasure order that binds there, and the bytes still owed. The handoff
// binds these bytes; this module must make them COMPLETE, and the rails prove that.
//
// It never drops what it cannot read and never makes up history: a pool with a quarantined row,
// sidecar debt it cannot name, or bytes only a shadow tier holds is not carried until its
// disposition is explicit.

import type { Delta } from "@bombadil/rhizomatic";
import { isRepairable } from "../store/quarantine.js";
import { bindingErasureOrders, refusedIds } from "./erase.js";
import type { Gateway } from "./gateway.js";
import { underAdmissionLock } from "./ingest.js";

export interface CarriedRefusal {
  readonly targetId: string;
  /** Every order that binds the refusal here, with its signer, so the source stays qualified. */
  readonly orders: readonly { readonly id: string; readonly signer: string }[];
}

export interface CarriedObligation {
  readonly targetId: string;
  /** Where the bytes may still be: the rows, or a sqlite -wal sidecar's page images. */
  readonly surface: "rows" | "sidecar";
}

export interface PoolCarry {
  /** The admitted rows: every readable row except a refused one, whose bytes are an obligation. */
  readonly holdings: readonly Delta[];
  readonly refusals: readonly CarriedRefusal[];
  readonly obligations: readonly CarriedObligation[];
}

export type CarryResult =
  | {
      readonly status: "carry";
      readonly carry: PoolCarry;
      /** Lift the fence: the surface stays responsible, and its held emissions are written. */
      readonly release: () => Promise<readonly Delta[]>;
    }
  | { readonly status: "undisposed"; readonly reason: string; readonly rows: readonly string[] };

interface SidecarDebt {
  truncationDebt(): { ids: string[]; unknown: boolean };
}
interface TierGap {
  tierGap(): Promise<string[]>;
}
const hasSidecarDebt = (b: unknown): b is SidecarDebt =>
  typeof (b as Partial<SidecarDebt>).truncationDebt === "function";
const hasTierGap = (b: unknown): b is TierGap =>
  typeof (b as Partial<TierGap>).tierGap === "function";

/**
 * Fence `pool` and capture its complete carry, or say why not. Under the admission lock the fence
 * goes up (nothing is admitted, written through or purged), the pending writes drain, and only then
 * is the surface read. On success the fence stays up until `release` or the handoff's commit.
 */
export function buildPoolCarry(pool: Gateway): Promise<CarryResult> {
  return underAdmissionLock(pool, async () => {
    pool.assertUnfenced("a second carry");
    const fence = { reason: "a handoff carry", held: [] as Delta[] };
    pool.fence = fence;
    const release = async (): Promise<readonly Delta[]> => {
      if (pool.fence !== fence) return [];
      pool.fence = undefined;
      if (fence.held.length > 0) await pool.backend.append(fence.held);
      return fence.held;
    };
    try {
      await pool.flush(); // every write that started before the fence is durable, or failed
      const result = await capture(pool);
      if (result.status !== "carry") await release();
      return result.status === "carry" ? { ...result, release } : result;
    } catch (err) {
      await release();
      throw err;
    }
  });
}

async function capture(
  pool: Gateway,
): Promise<
  | { status: "carry"; carry: PoolCarry }
  | { status: "undisposed"; reason: string; rows: readonly string[] }
> {
  const backend = pool.backend;
  const rows = await backend.deltasSince(new Set());
  if (isRepairable(backend)) {
    const pen = await backend.quarantine();
    if (pen.length > 0) {
      return {
        status: "undisposed",
        reason: "the pool holds rows it cannot read; repair or discard them first",
        rows: pen.map((r) => r.key),
      };
    }
  }
  if (hasTierGap(backend)) {
    const gap = await backend.tierGap();
    if (gap.length > 0) {
      return {
        status: "undisposed",
        reason: "a shadow tier holds rows the primary does not; heal the tiers first",
        rows: gap,
      };
    }
  }
  const debt = hasSidecarDebt(backend) ? backend.truncationDebt() : { ids: [], unknown: false };
  if (debt.unknown) {
    return {
      status: "undisposed",
      reason: "a -wal sidecar owes a truncation it cannot name",
      rows: [],
    };
  }
  const byTarget = new Map<string, { id: string; signer: string }[]>();
  for (const { targetId, order } of bindingErasureOrders(pool.reactor, pool.operatorAuthor)) {
    const list = byTarget.get(targetId) ?? [];
    list.push({ id: order.id, signer: order.claims.author });
    byTarget.set(targetId, list);
  }
  const refusals = [...byTarget]
    .map(([targetId, orders]) => ({
      targetId,
      orders: orders.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.targetId.localeCompare(b.targetId));
  // The refusal events and `refusedIds` read one source; a mismatch is a bug, not a carry.
  const refused = refusedIds(pool.reactor, pool.operatorAuthor);
  if (refused.size !== refusals.length || refusals.some((r) => !refused.has(r.targetId))) {
    throw new Error("pool carry: the refusal events disagree with the refused set");
  }
  const obligations: CarriedObligation[] = [];
  for (const { targetId } of refusals) {
    if (await backend.holds(targetId)) obligations.push({ targetId, surface: "rows" });
  }
  for (const id of debt.ids) obligations.push({ targetId: id, surface: "sidecar" });
  return {
    status: "carry",
    carry: {
      holdings: rows.filter((d) => !refused.has(d.id)).sort((a, b) => a.id.localeCompare(b.id)),
      refusals,
      obligations,
    },
  };
}
