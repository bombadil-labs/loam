// The container census (SPEC §55, T254): three numbers that tell an operator whether a
// container is a real place, a reading, or a graveyard. PHYSICAL — residents of the
// container's own attached store. LINKED — deltas its membership selects out of the primary.
// DARK — data-class members no surviving lens can gather: the read-side soup detector, §49.5's
// complement.
//
// DARK IS AN APPROXIMATION IN THE SAFE DIRECTION, and every surface that shows it says so. The
// predicate is the listing door's own: does any entity-pointer context — or any pointer ROLE,
// because a byRole-grouped body files under roles and its props keys ARE role names — appear in
// a surviving program's union (read from the GROUPING, never the flat list — a superseded
// binding's contexts light nothing, the H6 family). A Term can still filter a delta whose
// context matches, so true darkness is UNDERCOUNTED; an advisory metric must never over-alarm.
// The one residue: a {const}-grouped body files everything under one fixed prop and its members
// are not identifiable from their own pointers — such a reading's members can still read dark
// falsely. No shape Loam mints groups that way; stated so nobody reads more into the number.
//
// LAW IS A BUCKET, NOT DARKNESS. Members classing law/trust/erasure (§49's classifier) count
// as vocabulary: a store's constitution is not soup — and every negation classes law, so the
// strikes the closure carries land there too.
//
// TWO LEVELS, DELIBERATELY, AND LABELED. The physical/linked/elsewhere buckets count the
// GROUND — every byte the scope composes, struck and striking alike, because "how many deltas
// are here" is a question about bytes. The lit/dark split counts only SURVIVING data members —
// readability is a question about what a reader can still see, and a struck stray alarming
// dark forever would be the over-alarm this metric forbids. The scope's closure carries every
// strike beside its target, so survival is decidable from the members alone.
//
// COST: one scope read for the named container (the detail page already pays exactly this per
// view) plus the pool membership sets for a parent whose gather composes inbox pools. The
// dashboard tree deliberately does NOT call this per node (§55 position 4, H8).

import type { Delta } from "@bombadil/rhizomatic";
import { classifyClaim } from "./attention.js";
import type { Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";

export interface PoolContribution {
  readonly pool: string;
  readonly count: number;
}

export interface ContainerCensus {
  /** Members resident in this container's own attached store (separate and inbox postures). */
  readonly physical: number;
  /** Members selected out of the primary by this container's membership (shared posture). */
  readonly linked: number;
  /** Members living in this container's own inbox pools — physical elsewhere, named by pool. */
  readonly physicalElsewhere: readonly PoolContribution[];
  /** Data-class members at least one surviving lens can gather. */
  readonly lit: number;
  /** Data-class members NO surviving lens can gather — undercounted by design, see header. */
  readonly dark: number;
  /** Members wearing law/trust/erasure vocabulary — the constitution's bucket, never soup. */
  readonly vocabulary: number;
}

/**
 * Every context a SURVIVING lens resolves into a field, across every registered program. Read
 * from the GROUPING, never the flat list: the grouping's lens map is latest-wins per lens name,
 * so a superseded binding's contexts light nothing (the H6 family). Pure over a binding list so
 * the supersession property is testable in isolation; the gateway wrapper is the callers' form.
 */
export function survivingContextsOf(regs: readonly Gateway["registered"][number][]): Set<string> {
  const union = new Set<string>();
  for (const program of groupPrograms(regs).values()) {
    for (const lens of program.lenses.values()) {
      for (const context of lens.schema.props.keys()) union.add(context);
    }
  }
  return union;
}

export const survivingContexts = (gw: Gateway): Set<string> => survivingContextsOf(gw.registered);

const entityContexts = (d: Delta): string[] => {
  const out: string[] = [];
  for (const p of d.claims.pointers) {
    if (p.target.kind === "entity" && p.target.entity.context !== undefined) {
      out.push(p.target.entity.context);
    }
  }
  return out;
};

export function containerCensusImpl(gw: Gateway, name: string): ContainerCensus {
  const table = gw.containers();
  const rec = table.containers.get(name);
  const members = gw.containerScope({ containers: [name] });

  // A parent whose gather composes inbox pools reports those contributions apart — physical
  // elsewhere, named by pool — so its own linked count never silently absorbs another store's
  // residents.
  const poolMembers = new Map<string, Set<string>>();
  for (const [poolName, poolRec] of table.containers) {
    if (poolRec.inboxOf !== name) continue;
    // Attribute only against pools the GATHER actually composed: a detached pool, or one this
    // process attached without registering as a quarantine, contributes nothing to the scope,
    // and intersecting against it would move members into an "elsewhere" the reader never saw.
    if (table.detached.has(poolName)) continue;
    const pool = gw.attachedContainers.get(poolName);
    if (pool === undefined || !gw.quarantinePools.has(pool)) continue;
    poolMembers.set(poolName, new Set([...pool.reactor.snapshot()].map((d) => d.id)));
  }

  // The strikes ride the scope (the closure adds them beside their targets), so the struck
  // set is computable from the members themselves — closed over exactly the grounds composed.
  const struck = new Set<string>();
  for (const d of members) {
    for (const ptr of d.claims.pointers) {
      if (ptr.role === "negates" && ptr.target.kind === "delta")
        struck.add(ptr.target.deltaRef.delta);
    }
  }

  const elsewhere = new Map<string, number>();
  let own = 0;
  let lit = 0;
  let dark = 0;
  let vocabulary = 0;
  const union = survivingContexts(gw);
  for (const d of members) {
    // A delta the PRIMARY holds is the primary's, whatever pools also carry a seeded copy —
    // the same rule the promote button reads (held ONLY in the pool is what promotion moves).
    let home: string | undefined;
    if (gw.reactor.get(d.id) === undefined) {
      for (const [poolName, ids] of poolMembers) {
        if (ids.has(d.id)) {
          home = poolName;
          break;
        }
      }
    }
    if (home !== undefined) {
      elsewhere.set(home, (elsewhere.get(home) ?? 0) + 1);
    } else {
      own += 1;
    }
    if (classifyClaim(d) !== "data") {
      vocabulary += 1;
    } else if (!struck.has(d.id)) {
      const litByContext = entityContexts(d).some((c) => union.has(c));
      const litByRole = d.claims.pointers.some((ptr) => union.has(ptr.role));
      if (litByContext || litByRole) lit += 1;
      else dark += 1;
    }
  }

  // The container's OWN posture decides its own bucket: separate (and inbox) postures hold
  // residents; a shared posture selects. An unknown container answers all-zero rather than
  // guessing — the page's absence handling is the caller's (§55's surface says what it cannot
  // read; this reading never throws for a name the table lacks).
  const resident = rec?.posture === "separate" || rec?.inboxOf !== undefined;
  return {
    physical: resident ? own : 0,
    linked: resident ? 0 : own,
    physicalElsewhere: [...elsewhere].map(([pool, count]) => ({ pool, count })),
    lit,
    dark,
    vocabulary,
  };
}
