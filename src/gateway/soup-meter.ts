import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";

export const PERIODIC_MIN = 6;
export const PERIODIC_CV = 0.1;

export interface PeriodicStream {
  readonly author: string;
  readonly entity: string;
  readonly count: number;
  readonly meanIntervalMs: number;
}

export interface ContainerSoup {
  readonly total: number;
  readonly perDay: number;
  readonly periodicShare: number;
  readonly periodic: readonly PeriodicStream[];
}

const streamEntity = (d: Delta): string => {
  for (const p of d.claims.pointers) {
    if (p.target.kind === "entity") return p.target.entity.id;
  }
  return "";
};

export function soupMeterImpl(
  gw: Gateway,
  opts: { containers?: readonly string[] } = {},
): Map<string, ContainerSoup> {
  const table = gw.containers();
  const names = opts.containers ?? [...table.containers.keys()];
  const out = new Map<string, ContainerSoup>();
  for (const name of names) {
    if (!table.containers.has(name)) continue;
    const members = gw.containerScope({ containers: [name] });
    const total = members.length;
    const streams = new Map<string, { author: string; entity: string; stamps: number[] }>();
    let earliest = Infinity;
    let latest = -Infinity;
    for (const d of members) {
      earliest = Math.min(earliest, d.claims.timestamp);
      latest = Math.max(latest, d.claims.timestamp);
      const entity = streamEntity(d);
      const key = `${d.claims.author} ${entity}`;
      const held = streams.get(key) ?? { author: d.claims.author, entity, stamps: [] };
      held.stamps.push(d.claims.timestamp);
      streams.set(key, held);
    }
    const periodic: PeriodicStream[] = [];
    let flagged = 0;
    for (const s of streams.values()) {
      if (s.stamps.length < PERIODIC_MIN) continue;
      const stamps = [...s.stamps].sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i]! - stamps[i - 1]!);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (mean <= 0) continue;
      const variance = gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length;
      if (Math.sqrt(variance) / mean > PERIODIC_CV) continue;
      periodic.push({
        author: s.author,
        entity: s.entity,
        count: s.stamps.length,
        meanIntervalMs: mean,
      });
      flagged += s.stamps.length;
    }
    const spanDays = latest > earliest ? (latest - earliest) / 86_400_000 : 0;
    out.set(name, {
      total,
      perDay: spanDays > 0 ? total / spanDays : total,
      periodicShare: total === 0 ? 0 : flagged / total,
      periodic,
    });
  }
  return out;
}
