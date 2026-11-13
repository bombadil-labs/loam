import type { Delta } from "@bombadil/rhizomatic";
import type { Peer } from "./peer.js";

export interface CitationTier {
  readonly tier: string;
  readonly citations: readonly string[];
}

export function reachableTiers(ground: Peer): { tier: string; gw: Peer }[] {
  const out: { tier: string; gw: Peer }[] = [{ tier: "primary", gw: ground }];
  const named = new Map([...ground.store.namedPools(ground)].map(([name, pool]) => [pool, name]));
  let anon = 0;
  for (const pool of ground.store.pools(ground)) {
    out.push({ tier: named.get(pool) ?? `pool:${(anon += 1)}`, gw: pool });
  }
  return out;
}

export function danglingCitations(
  ground: Peer,
  id: string,
  exclude: (deltaId: string) => boolean = () => false,
): { citations: string[]; citationTiers: CitationTier[] } {
  const seen = new Set<string>();
  const flat: string[] = [];
  const citationTiers: CitationTier[] = [];
  const cites = (d: Delta): boolean =>
    d.claims.pointers.some((p) => p.target.kind === "delta" && p.target.deltaRef.delta === id);
  for (const { tier, gw: g } of reachableTiers(ground)) {
    const here: string[] = [];
    for (const d of g.reactor.snapshot()) {
      if (exclude(d.id) || !cites(d)) continue;
      here.push(d.id);
      if (!seen.has(d.id)) {
        seen.add(d.id);
        flat.push(d.id);
      }
    }
    citationTiers.push({ tier, citations: here.sort() });
  }
  return { citations: flat.sort(), citationTiers };
}
