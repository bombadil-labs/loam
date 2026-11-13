import type { Delta } from "@bombadil/rhizomatic";
import { classifyClaim } from "./attention.js";
import type { Gateway } from "./gateway.js";
import { groupPrograms } from "./lifecycle.js";

export interface PoolContribution {
  readonly pool: string;
  readonly count: number;
}

export interface ContainerCensus {
  readonly physical: number;
  readonly linked: number;
  readonly physicalElsewhere: readonly PoolContribution[];
  readonly lit: number;
  readonly dark: number;
  readonly vocabulary: number;
}

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

  const poolMembers = new Map<string, Set<string>>();
  for (const [poolName, poolRec] of table.containers) {
    if (poolRec.inboxOf !== name) continue;
    if (table.detached.has(poolName)) continue;
    const pool = gw.store.namedPools(gw).get(poolName);
    if (pool === undefined || !gw.store.hasPool(gw, pool)) continue;
    poolMembers.set(poolName, new Set([...pool.reactor.snapshot()].map((d) => d.id)));
  }

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
