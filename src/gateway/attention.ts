import type { Claims, Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { negatedAt } from "./negation.js";
import { CONTAINER_CONTEXTS } from "./container-law.js";

export const CTX_LOOKED = "loam.looked";
export const CTX_QUIET = "loam.quiet";

export function lookedClaims(
  user: string,
  container: string,
  at: number,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "looked",
        target: {
          kind: "entity",
          entity: { id: `looked:${user}:${container}`, context: CTX_LOOKED },
        },
      },
      { role: "user", target: { kind: "primitive", value: user } },
      { role: "container", target: { kind: "primitive", value: container } },
      { role: "at", target: { kind: "primitive", value: at } },
    ],
  };
}

export function quietClaims(
  container: string,
  quiet: boolean,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "quiet",
        target: { kind: "entity", entity: { id: `quiet:${container}`, context: CTX_QUIET } },
      },
      { role: "container", target: { kind: "primitive", value: container } },
      { role: "value", target: { kind: "primitive", value: quiet } },
    ],
  };
}

const markerOf = (d: Delta, context: string): string | undefined => {
  for (const p of d.claims.pointers) {
    if (p.target.kind === "entity" && p.target.entity.context === context) {
      return p.target.entity.id;
    }
  }
  return undefined;
};

const primOf = (d: Delta, role: string): string | number | boolean | undefined => {
  for (const p of d.claims.pointers) {
    if (p.role === role && p.target.kind === "primitive") return p.target.value;
  }
  return undefined;
};

function latestByKey(
  gw: Gateway,
  context: string,
  entityIds: readonly string[],
  accept: (d: Delta) => boolean,
): Map<string, Delta> {
  const negated = negatedAt(gw.reactor, gw.validityNow(), gw.operatorAuthor);
  const held = new Map<string, { at: number; d: Delta }>();
  for (const id of entityIds) {
    for (const deltaId of gw.reactor.byTarget(id)) {
      const d = gw.reactor.get(deltaId);
      if (d === undefined) continue;
      const key = markerOf(d, context);
      if (key !== id || negated(d.id) || !accept(d)) continue;
      const prior = held.get(key);
      if (prior !== undefined && prior.at >= d.claims.timestamp) continue;
      held.set(key, { at: d.claims.timestamp, d });
    }
  }
  return new Map([...held].map(([k, v]) => [k, v.d]));
}

export function quietContainersImpl(gw: Gateway): Set<string> {
  const operator = gw.operatorAuthor;
  const names = [...gw.containers().containers.keys()];
  const rows = latestByKey(
    gw,
    CTX_QUIET,
    names.map((n) => `quiet:${n}`),
    (d) => d.claims.author === operator,
  );
  const quiet = new Set<string>();
  for (const [key, d] of rows) {
    if (primOf(d, "value") === true) quiet.add(key.slice("quiet:".length));
  }
  return quiet;
}

export function readLookedImpl(
  gw: Gateway,
  user: string,
  acceptAuthors: ReadonlySet<string>,
  containers?: readonly string[],
): Map<string, number> {
  const prefix = `looked:${user}:`;
  const names = containers ?? [...gw.containers().containers.keys()];
  const rows = latestByKey(
    gw,
    CTX_LOOKED,
    names.map((n) => `${prefix}${n}`),
    (d) => acceptAuthors.has(d.claims.author),
  );
  const looked = new Map<string, number>();
  for (const [key, d] of rows) {
    if (!key.startsWith(prefix)) continue;
    const at = primOf(d, "at");
    looked.set(key.slice(prefix.length), typeof at === "number" ? at : 0);
  }
  return looked;
}

export type ConsequenceClass = "data" | "law" | "trust" | "erasure";

const TRUST_CONTEXTS = new Set([
  "loam.trust",
  "loam.grants",
  "loam.members",
  "loam.tenant",
  "loam.role",
  "loam.user",
]);
const ERASURE_CONTEXTS = new Set(["loam.erasure", "loam.erasure.slate", "loam.erasure.graveyard"]);

export function classifyClaim(d: Delta): ConsequenceClass {
  let sawLaw = false;
  let sawTrust = false;
  for (const p of d.claims.pointers) {
    const ctx =
      p.target.kind === "entity"
        ? p.target.entity.context
        : p.target.kind === "delta"
          ? p.target.deltaRef.context
          : undefined;
    if (ctx !== undefined) {
      if (ERASURE_CONTEXTS.has(ctx)) return "erasure";
      if (TRUST_CONTEXTS.has(ctx)) sawTrust = true;
      else if (ctx.startsWith("loam.")) sawLaw = true;
    }
    if (p.role.startsWith("rhizomatic.")) sawLaw = true;
    if (p.target.kind === "delta") sawLaw = true;
  }
  return sawTrust ? "trust" : sawLaw ? "law" : "data";
}

export interface ContainerAttention {
  readonly lookedAt: number;
  readonly total: number;
  readonly byClass: Record<ConsequenceClass, number>;
  readonly byAuthor: Map<string, number>;

  readonly unreadable?: string;
}

export function attentionSummaryImpl(
  gw: Gateway,
  user: string,
  acceptAuthors: ReadonlySet<string>,
  opts: { containers?: readonly string[]; includeQuiet?: boolean } = {},
): Map<string, ContainerAttention> {
  const table0 = gw.containers();
  const looked = readLookedImpl(gw, user, acceptAuthors, [...table0.containers.keys()]);
  const quiet = quietContainersImpl(gw);
  const table = gw.containers();
  const names =
    opts.containers ??
    [...table.containers.keys()].filter((name) => table.containers.get(name) !== undefined);
  const out = new Map<string, ContainerAttention>();
  for (const name of names) {
    if (quiet.has(name) && opts.includeQuiet !== true) continue;
    if (!table.containers.has(name)) continue;
    const lookedAt = looked.get(name) ?? 0;
    const byClass: Record<ConsequenceClass, number> = { data: 0, law: 0, trust: 0, erasure: 0 };
    const byAuthor = new Map<string, number>();
    let total = 0;
    let members;
    try {
      members = gw.containerScope({ containers: [name] });
    } catch (err) {
      out.set(name, {
        lookedAt,
        total: 0,
        byClass,
        byAuthor,
        unreadable: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const d of members) {
      if (d.claims.timestamp <= lookedAt) continue;
      const marker = markerOf(d, CTX_LOOKED) ?? markerOf(d, CTX_QUIET);
      if (marker !== undefined) continue;
      if (CONTAINER_CONTEXTS.some((c) => markerOf(d, c) !== undefined)) continue;
      total += 1;
      byClass[classifyClaim(d)] += 1;
      byAuthor.set(d.claims.author, (byAuthor.get(d.claims.author) ?? 0) + 1);
    }
    out.set(name, { lookedAt, total, byClass, byAuthor });
  }
  return out;
}
