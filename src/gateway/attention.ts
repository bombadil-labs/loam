// The attention surface (SPEC §49 positions 2 and 4, T212): what changed since a reader last
// looked, counted and never listed, and quiet as a preference of the READING rather than a
// state of the STORAGE. Two claim kinds and three readings; the pulse law (position 1) is
// obeyed by construction — a look supersedes one standing row in place, and reading writes
// nothing.
//
// THE LOOKED-RECORD IS KEYED BY THE USER'S NAME, NOT A KEY. The composite key rides the entity
// id (`looked:<user>:<container>`, the channel record's own idiom), so any key that speaks for
// the user supersedes the same row and two devices — or a recovered key — share one moment.
// Which keys speak for a user is the CALLER's question: the ground holds no canonical user↔key
// binding (that is T137's arc), so the readings take an explicit accepted-author set and the
// admin door answers it from the user's own seed. A record whose author is outside the set is
// a claim ABOUT the store, not attention of it — kept, and ignored, exactly as a stranger's
// channel-shaped delta is.
//
// ATTENTION BOOKKEEPING IS NOT ATTENTION-WORTHY. The summary skips loam.looked and loam.quiet
// rows when it counts: a store where marking-as-read made the unread count move would be soup
// about soup, the exact regress position 2 refuses.
//
// TIME IS THE AUTHOR'S CLOCK. `claims.timestamp` orders both supersession and the since-filter,
// and a federated peer stamps its own; a backdated claim can hide beneath a looked-moment. The
// honest close reads arrival attestations (loam.arrival) instead of author stamps and belongs
// to the follow-on that indexes arrival order — stated here so nobody reads more into a quiet
// row than it promises.

import type { Claims, Delta } from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { lawfulNegated } from "./registration.js";
import { CONTAINER_CONTEXTS } from "./container.js";

export const CTX_LOOKED = "loam.looked";
export const CTX_QUIET = "loam.quiet";

/** One reader looked at one container at one moment — the standing row, superseded in place. */
export function lookedClaims(
  user: string,
  container: string,
  at: number,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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

/** The operator's quiet mark — a toggle, latest-wins, exactly the channel-record shape. */
export function quietClaims(
  container: string,
  quiet: boolean,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
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

/**
 * Latest-wins over EXACTLY-NAMED marker entities: first-seen wins ties, the channel reader's
 * discipline. Reads through `byTarget` — the reactor's own by-entity index, written at ingest
 * beside the set it indexes, so it is the safe kind (work completed, cannot lag the ground) —
 * rather than walking the snapshot: the callers always know their keys, so the walk would be
 * the items-by-candidates inversion H8 names.
 */
function latestByKey(
  gw: Gateway,
  context: string,
  entityIds: readonly string[],
  accept: (d: Delta) => boolean,
): Map<string, Delta> {
  const negated = lawfulNegated(gw.reactor, gw.operatorAuthor);
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

/** The containers the operator marked quiet — a reading preference, never a storage state. */
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

/** Each container's looked-moment for one user, from the accepted keys only. */
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

/**
 * One claim's consequence class, from its on-wire vocabulary (the promotionRefusal traversal:
 * roles, entity contexts, delta-ref contexts). Precedence erasure > trust > law > data, so a
 * claim wearing two vocabularies reads as its gravest. A delta-kind pointer with no loam
 * vocabulary is a naked negation — it changes what is in force, so it classes as law.
 */
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
  /** Set when this container's members could not be read (a detached pool, a refused scope):
   *  the counts above are then 0 BY ABSENCE, not by quiet, and the surface must say so —
   *  a zero that means "unreadable" rendered as calm would be H9 at the attention layer. */
  readonly unreadable?: string;
}

/**
 * The since-last-looked summary: per active container, the claims newer than the user's
 * looked-moment, counted by consequence class and author — counts only, never bodies. Quiet
 * containers are omitted unless asked for. COST, stated whole (H8): one container-scope read
 * per container — the same read the detail page pays per view — and each of those calls also
 * re-derives every EXCLUDED container's members and runs its own negation closure, so the
 * dashboard's bill is O(ground x containers x (1 + exclusions)) plus a closure per call. The
 * admin door bounds it with the session user's reach; the swept-index affordance (listing.ts's
 * shape) is the named follow-on if a measured store outgrows this — measure after the cheap
 * fix, before infrastructure.
 */
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
    // One container whose members cannot be read (an unattached separate pool, a refused
    // scope) must not take the whole summary down with it — the dashboard is the landing page,
    // and a dead page teaches less than an honest row.
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
      if (marker !== undefined) continue; // attention bookkeeping is not attention-worthy
      if (CONTAINER_CONTEXTS.some((c) => markerOf(d, c) !== undefined)) continue; // the container's own law made it, not news within it
      total += 1;
      byClass[classifyClaim(d)] += 1;
      byAuthor.set(d.claims.author, (byAuthor.get(d.claims.author) ?? 0) + 1);
    }
    out.set(name, { lookedAt, total, byClass, byAuthor });
  }
  return out;
}
