// Serving rows are owned by the peer, before a parent unions them with any other ground.
import type { Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { poolOwner, ownerTerm } from "./inbox-owner.js";
import { condemnedClosure, readClosedIds } from "./slate-law.js";

export interface ReadContribution {
  readonly rows: readonly Delta[];
  /** Approved strikes, including those outside the requested membership/owner filter. */
  readonly negations: readonly Delta[];
  /** Only targets of withheld strikes cross into another peer's suppression scope. */
  readonly withheldTargets: ReadonlySet<string>;
  /** Raw membership ids support exclusion without disclosing withheld row contents. */
  readonly membership: ReadonlySet<string>;
}

export function readContributionImpl(
  gw: Gateway,
  now: number,
  options: { readonly inbox?: string; readonly asOf?: number } = {},
): ReadContribution {
  const closed = readClosedIds(
    {
      reactor: gw.reactor,
      operatorAuthor: gw.operatorAuthor,
      validityNow: () => gw.validityNow(now),
    },
    now,
  );
  const raw = [...gw.reactor.snapshot()];
  const withheldTargets = new Set<string>();
  for (const id of closed) {
    const delta = gw.reactor.get(id);
    for (const pointer of delta?.claims.pointers ?? []) {
      if (pointer.role === "negates" && pointer.target.kind === "delta")
        withheldTargets.add(pointer.target.deltaRef.delta);
    }
  }
  const targets = condemnedClosure(gw.reactor, withheldTargets);
  const approved = (d: Delta): boolean =>
    !closed.has(d.id) && (options.asOf === undefined || d.claims.timestamp <= options.asOf);
  let selected = raw;
  if (options.inbox !== undefined) {
    const owner = poolOwner(gw, gw.validityNow(now));
    if ("refusal" in owner)
      throw new Error(`serving contribution refused: inbox "${options.inbox}" ${owner.refusal}`);
    selected = gw.select(ownerTerm(gw, owner, options.inbox, gw.validityNow(now)), now);
  }
  return {
    rows: selected.filter(approved),
    negations: raw.filter(
      (d) => approved(d) && d.claims.pointers.some((p) => p.role === "negates"),
    ),
    withheldTargets: targets,
    membership: new Set(raw.map((d) => d.id)),
  };
}

/** Forward suppression closure over approved testimony only; raw peer reactors are not inputs. */
export function closeContributions(
  contributions: Iterable<ReadContribution>,
  admitted: readonly Delta[],
): Delta[] {
  const negations = new Map<string, Delta[]>();
  const strikes = new Map<string, Delta>();
  const withheld = new Set<string>();
  for (const contribution of contributions) {
    for (const id of contribution.withheldTargets) withheld.add(id);
    for (const delta of contribution.negations) {
      strikes.set(delta.id, delta);
      for (const pointer of delta.claims.pointers) {
        if (pointer.role !== "negates" || pointer.target.kind !== "delta") continue;
        const target = pointer.target.deltaRef.delta;
        const at = negations.get(target) ?? [];
        at.push(delta);
        negations.set(target, at);
      }
    }
  }
  // A target can itself be a strike held by another contributor. Withholding that link
  // must also withhold what it held down; otherwise composition revives the next target.
  const hidden = [...withheld];
  while (hidden.length > 0) {
    for (const pointer of strikes.get(hidden.pop()!)?.claims.pointers ?? []) {
      if (pointer.role !== "negates" || pointer.target.kind !== "delta") continue;
      const target = pointer.target.deltaRef.delta;
      if (withheld.has(target)) continue;
      withheld.add(target);
      hidden.push(target);
    }
  }
  const out = new Map(admitted.filter((d) => !withheld.has(d.id)).map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    for (const strike of negations.get(pending.pop()!) ?? []) {
      if (out.has(strike.id) || withheld.has(strike.id)) continue;
      out.set(strike.id, strike);
      pending.push(strike.id);
    }
  }
  return [...out.values()];
}
