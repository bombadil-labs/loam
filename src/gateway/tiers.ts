// The tiers a §11 sweep walks: a ground's primary and each directly attached pool, and the citations
// each tier holds of an erased id. A leaf: the erase door and the cut both read it.

import type { Delta, Reactor } from "@bombadil/rhizomatic";

/**
 * The citations manifest, ATTRIBUTED to the tier each dangler lives on (T216). The flat `citations`
 * id list stays a bare `string[]` (a frozen T64 shape), and this rides beside it — one entry per tier
 * the byte verdict walks, so a reader can never learn absence multi-tier while reading danglers
 * single-tier. `citations` carries no `holds`, so it is not a byte verdict and never a §29.7
 * observation field: it names WHICH deltas point at the hole on WHICH tier, a fact about the ground.
 */
export interface CitationTier {
  readonly tier: string;
  readonly citations: readonly string[];
}

/** A ground a sweep walks: its attached containers by name, and its quarantine pools. */
export interface Tiered<G> {
  readonly attachedContainers: ReadonlyMap<string, G>;
  readonly quarantinePools: Iterable<G>;
}

/** A walkable ground whose tiers each hold a reactor. */
export interface ReactorTiers extends Tiered<ReactorTiers> {
  readonly reactor: Reactor;
}

// The DIRECT tiers a §11 sweep can WALK: this store's primary, then each attached quarantine pool (the
// operator's own replicas), labeled by the pool's declared container name or `pool:N` when anonymous.
// Named ONCE, here, so the byte verdict and the citations manifest walk the SAME set — a walkable tier
// the verdict probes is a walkable tier the manifest enumerates, and neither can name one the other
// skips. Two limits are inherited from the old `tierVerdicts`, not introduced here:
//   - A WALL (unreachable — a `kept`/faulted store) is not walkable, so it is NOT in this set. The
//     byte verdict adds walls as `unproven` (`notReached`, added by callers); the manifest cannot
//     enumerate a store it cannot reach, so it carries no entry for one. `tiers` is therefore a strict
//     superset of `citationTiers` BY TIER NAME whenever a wall stands — the honest relation, since a
//     store you cannot reach cannot be proven clean OR enumerated for danglers.
//   - This reach is FLAT: primary plus the DIRECTLY-attached pools. The erase fan-out and `health()`
//     recurse into nested pools; the verdict and the manifest do not itemize a pool-of-a-pool. The
//     nested byte is still SWEPT and guaranteed by §11's recursive throw — it is just not a named row.
//   - `pool:N` is SYNTHESIZED, so a container literally named `pool:1` collides with an anonymous
//     pool's synthetic label — a consumer keying by tier name resolves it ambiguously (H8, low, old).
export function reachableTiers<G extends Tiered<G>>(ground: G): { tier: string; gw: G }[] {
  const out: { tier: string; gw: G }[] = [{ tier: "primary", gw: ground }];
  const named = new Map([...ground.attachedContainers].map(([name, pool]) => [pool, name]));
  let anon = 0;
  for (const pool of ground.quarantinePools) {
    out.push({ tier: named.get(pool) ?? `pool:${(anon += 1)}`, gw: pool });
  }
  return out;
}

// Every surviving delta that dangles at the hole `id` leaves, enumerated across every WALKABLE tier
// (T216) — the same reachable set the byte verdict walks (`reachableTiers`: primary plus the directly-
// attached pools). Before this, both callers walked the primary's reactor alone, so a pool-resident
// citation (a T207 arrival stamp echoing an erased delta, a federated negation) was omitted while a
// gather still served a signed pointer at the hole.
//
// The flat `citations` list is deduplicated across tiers and sorted, so it is stable across a re-issue
// and a bare `string[]` (the frozen T64 shape). `citationTiers` carries one entry PER walkable tier,
// empty ones included. It is NOT the verdict's whole tier set: the verdict additionally names any WALL
// (`notReached`) as `unproven`, and a wall cannot be walked for citations, so `citationTiers` covers
// the walkable tiers and the verdict's `tiers` is a superset by tier name whenever a wall stands.
// `exclude` drops a delta by identity on every tier (erase.ts excludes the erasure it mints from its
// own manifest); a re-issue passes none.
export function danglingCitations(
  ground: ReactorTiers,
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
