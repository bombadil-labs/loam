// `loam repair` (SPEC §25): reading and settling the quarantine, and the entity-ID legibility
// report. Quarantine is only honest if the operator can see and settle what it holds — a holding
// pen with no door out is just silent loss with extra steps. Repair is the natural sibling of
// erasure (§11): where `loam` already has verbs for FORGETTING a fact on purpose, repair has
// verbs for DECIDING THE FATE of a fact the store could not read. Like erasure, it is the
// instance operator's alone — running it in the home that holds the operator seed IS that
// authority.
//
// A quarantined row has exactly three honest ends:
//   - discard   — the row is genuine garbage (a stray UI key, a corrupt fragment): remove its
//                 bytes from the origin (backend.discardRow). A quarantined row is never a lawful
//                 fact in the ground, so discarding it is not an erasure — there was no fact to
//                 forget. (Forgetting a GOOD ground delta on purpose stays `erase`, §11.)
//   - re-admit  — the row was set aside for a transient reason (bytes that have since re-synced,
//                 a check that raced a write): re-run the admission and, if it now verifies, it
//                 returns to the ground on the next read. No bytes are reconstructed.
//   - leave     — inaction is legal. A row may stay quarantined indefinitely; repair is
//                 idempotent, so `list` tomorrow shows the same pen. Quarantine is not a countdown.
//
// Repair never fabricates a delta: it may discard, re-admit, or leave — never EDIT bytes into
// validity, because a delta's id hashes its claims and its signature binds them (§11). Forging a
// row into readability would make repair a forgery tool, exactly the rigidity §11 forbids.

import type { Delta } from "@bombadil/rhizomatic";
import type { RepairableBackend } from "../store/quarantine.js";

// The reservation (SPEC §25): the `loam:` id prefix and the `loam.` context prefix belong to
// constitutional entities — genesis, capabilities, erasure, public declarations, trust policy,
// and any future constitutional vocabulary. Application and user ids live outside them. This is
// a DOCUMENTED, LINT-ABLE convention, never a gate-enforced write refusal: entities are unowned
// (§7), so a stranger's claim at a `loam:` id binds nothing anyway (the constitutional readers
// honor only operator-rooted authorship) — the harm it does is to LEGIBILITY, and legibility is
// what this report protects.
export const RESERVED_ID_PREFIX = "loam:";
export const RESERVED_CTX_PREFIX = "loam.";

export interface LegibilityWarning {
  readonly deltaId: string;
  readonly author: string;
  // The reserved entity name this app delta points at — an id under `loam:` or a context under
  // `loam.` — so the operator can see exactly what collides.
  readonly reference: string;
}

// The entity-ID legibility warnings for a store's ground: every NON-operator delta that asserts
// at a reserved `loam:` id or `loam.` context. The operator's own deltas at those names ARE the
// constitution, so they never warn; an app delta minting `loam:store` does, because a
// constitutional reader would gather it alongside the real genesis and an auditor would have to
// squint to tell them apart. Ungoverned stores have no constitution to collide with, so they
// report nothing.
export function legibilityWarnings(
  deltas: Iterable<Delta>,
  operator: string | undefined,
): LegibilityWarning[] {
  if (operator === undefined) return [];
  const warnings: LegibilityWarning[] = [];
  for (const d of deltas) {
    if (d.claims.author === operator) continue; // the operator's loam:* deltas ARE the constitution
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
        break; // one warning per delta is enough to send a human to look
      }
    }
  }
  return warnings;
}

export type ReAdmitOutcome = "readmitted" | "still-quarantined" | "unknown";

// Re-admit one quarantined row (SPEC §25): re-run the read, which recomputes the quarantine from
// the origin's own bytes, and report where the row landed. If its transient cause has cleared the
// row is back in the ground (`readmitted`); if it still fails admission it stays set aside
// (`still-quarantined`); if the key is gone entirely it is `unknown`. No bytes are reconstructed —
// this only re-runs the check the boot read runs.
export async function reAdmit(backend: RepairableBackend, key: string): Promise<ReAdmitOutcome> {
  const good = await backend.deltasSince(new Set());
  const stillPenned = (await backend.quarantine()).some((r) => r.key === key);
  if (stillPenned) return "still-quarantined";
  // Not in the pen: either it re-admitted (its id now rides the good set) or the key vanished.
  // A localStorage key is `prefix + id`; a sqlite key IS the id — endsWith covers both.
  const readmitted = good.some((d) => key === d.id || key.endsWith(d.id));
  return readmitted ? "readmitted" : "unknown";
}
