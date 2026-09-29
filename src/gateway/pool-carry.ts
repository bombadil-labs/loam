// The carry of an existing pool (step 6, option (a); refactor/audit/step6-handoff.md). An existing
// pool is a plain backend under its host's key, with no journal, so its state is Loam's derivation:
// its readable rows, every erasure order that binds there, and the bytes still owed. The handoff
// binds these bytes; this module must make them COMPLETE, and the rails prove that.
//
// It never drops what it cannot read and never makes up history: a pool with a quarantined row, or
// sidecar debt it cannot name, is not carried until its disposition is explicit.

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
  /** Where the bytes may still be: the rows, or the sqlite -wal sidecar's page images. */
  readonly surface: "rows" | "sidecar";
}

export interface PoolCarry {
  readonly holdings: readonly Delta[];
  readonly refusals: readonly CarriedRefusal[];
  readonly obligations: readonly CarriedObligation[];
}

export type CarryResult =
  | { readonly status: "carry"; readonly carry: PoolCarry }
  | { readonly status: "undisposed"; readonly reason: string; readonly rows: readonly string[] };

interface SidecarDebt {
  truncationDebt(): { ids: string[]; unknown: boolean };
}
const hasSidecarDebt = (b: unknown): b is SidecarDebt =>
  typeof (b as Partial<SidecarDebt>).truncationDebt === "function";

/** Freeze `pool` under its admission lock and capture its complete carry, or say why not. */
export function buildPoolCarry(pool: Gateway): Promise<CarryResult> {
  return underAdmissionLock(pool, async () => {
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
    const debt = hasSidecarDebt(backend) ? backend.truncationDebt() : { ids: [], unknown: false };
    if (debt.unknown) {
      return {
        status: "undisposed",
        reason: "the pool's -wal sidecar owes a truncation it cannot name",
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
    const obligations: CarriedObligation[] = [];
    for (const { targetId } of refusals) {
      if (await backend.holds(targetId)) obligations.push({ targetId, surface: "rows" });
    }
    for (const id of debt.ids) obligations.push({ targetId: id, surface: "sidecar" });
    // The refusal events and `refusedIds` read one source; a mismatch is a bug, not a carry.
    const refused = refusedIds(pool.reactor, pool.operatorAuthor);
    if (refused.size !== refusals.length || refusals.some((r) => !refused.has(r.targetId))) {
      throw new Error("pool carry: the refusal events disagree with the refused set");
    }
    return {
      status: "carry",
      carry: {
        holdings: [...rows].sort((a, b) => a.id.localeCompare(b.id)),
        refusals,
        obligations,
      },
    };
  });
}
