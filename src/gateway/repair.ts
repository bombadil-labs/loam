import type { Delta } from "@bombadil/rhizomatic";
import type { RepairableBackend } from "../store/quarantine.js";

export const RESERVED_ID_PREFIX = "loam:";
export const RESERVED_CTX_PREFIX = "loam.";

export interface LegibilityWarning {
  readonly deltaId: string;
  readonly author: string;
  readonly reference: string;
}

export function legibilityWarnings(
  deltas: Iterable<Delta>,
  operator: string | undefined,
): LegibilityWarning[] {
  if (operator === undefined) return [];
  const warnings: LegibilityWarning[] = [];
  for (const d of deltas) {
    if (d.claims.author === operator) continue;
    for (const p of d.claims.pointers) {
      if (p.target.kind !== "entity") continue;
      const { id, context } = p.target.entity;
      const reserved = id.startsWith(RESERVED_ID_PREFIX)
        ? id
        : context !== undefined && context.startsWith(RESERVED_CTX_PREFIX)
          ? context
          : undefined;
      if (reserved !== undefined) {
        warnings.push({ deltaId: d.id, author: d.claims.author, reference: reserved });
        break;
      }
    }
  }
  return warnings;
}

export type ReAdmitOutcome = "readmitted" | "still-quarantined" | "unknown";

export async function reAdmit(backend: RepairableBackend, key: string): Promise<ReAdmitOutcome> {
  const good = await backend.deltasSince(new Set());
  const stillPenned = (await backend.quarantine()).some((r) => r.key === key);
  if (stillPenned) return "still-quarantined";
  const readmitted = good.some((d) => key === d.id || key.endsWith(d.id));
  return readmitted ? "readmitted" : "unknown";
}
