// The CONTAINER (SPEC §27, ticket T32) — the named generalization of the quarantine pool, and the
// at-rest vocabulary for §27.1's knob vector. A container is an entity the operator names,
// declared by an operator-signed claim at `loam.container`; the declaration is the at-rest form
// of the knobs, re-resolved live from the ground like `loam:trust` — a knob change is a delta,
// never a restart. Two knobs are NOT knobs (§28.4 proved neither transition is a flag flip):
// `trust` and `posture` are immutable per container entity, enforced at the door AND at the
// reader, because a flip has two arrival paths and only one passes a door.
//
// Bytes follow the POSTURE; law follows the TRUST. A PROPERTY container is a query over shared
// ground — pointer arrangement, zero copies. A WALL is a separate arena — real bytes, because
// discard-with-zero-trace is the one thing sharing cannot provide. Trust decides which postures
// are lawful (§28.3: untrusted must be a wall — delegated admission over shared ground is
// refused); posture decides where bytes are paid. The quarantine (SPEC §24) is ONE PRESET of
// this primitive: UNTRUSTED · wall · one-way-seeded · droppable — `openQuarantine` keeps its
// signature and its behavior, implemented over `openContainerImpl` below.
//
// The two "trusts" are §28.1's two AXES, never one value: the knob's `trust` role is the
// EFFECTIVENESS axis (whose trust domain the content belongs to); the `loam:trust` declaration
// filed AT the container entity (§28.6) is the ADMISSION axis (who may federate INTO it).
// Admission resolves from the subject declaration and never from the knob; posture legality
// gates on the knob and never from the roster.

import { parseTerm, signClaims, type Claims, type Delta, type Reactor } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../store/backend.js";
import { MemoryBackend } from "../store/memory.js";
import { isRepairable } from "../store/quarantine.js";
import { isTombstone, readTombstones } from "./erase.js";
import { withNegationClosure } from "./ingest.js";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";
import { readTrustPolicyAt, type TrustPolicy } from "./trust.js";
import { Gateway, type FederationReport } from "./gateway.js";

export const CTX_CONTAINER = "loam.container";
export const CTX_CONTAINER_EXCLUDED = "loam.container.excluded";
export const CTX_CONTAINER_DETACHED = "loam.container.detached";
// The whole mint, enumerable — the vocabulary rail asserts the prefix discipline over this list.
export const CONTAINER_CONTEXTS = [
  CTX_CONTAINER,
  CTX_CONTAINER_EXCLUDED,
  CTX_CONTAINER_DETACHED,
] as const;

export type ContainerTrust = "curated" | "untrusted";
export type ContainerPosture = "wall" | "property";

const TRUSTS = new Set<string>(["curated", "untrusted"]);
const POSTURES = new Set<string>(["wall", "property"]);
const NUL = "\u0000";
const NOTE_BYTES = 256;

// --- claim builders (the at-rest shapes; the door validates what any client hands it) ----------

export interface ContainerSpec {
  readonly container: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  readonly parent?: string;
  /** The membership Term, inlined as canonical JSON under role `membership`. */
  readonly membership?: unknown;
  /** The content address of a published Term (see `termClaims`) under role `membershipAt`. */
  readonly membershipAt?: string;
  /** A ModuleVersion address citation (SPEC §27.2) — provenance, no runtime effect yet. */
  readonly version?: string;
}

const entityPtr = (role: string, id: string, context: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const primPtr = (role: string, value: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value },
});

export function containerClaims(spec: ContainerSpec, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [
      entityPtr("container", spec.container, CTX_CONTAINER),
      primPtr("trust", spec.trust),
      primPtr("posture", spec.posture),
      ...(spec.parent === undefined ? [] : [entityPtr("parent", spec.parent, CTX_CONTAINER)]),
      ...(spec.membership === undefined
        ? []
        : [primPtr("membership", JSON.stringify(spec.membership))]),
      ...(spec.membershipAt === undefined ? [] : [primPtr("membershipAt", spec.membershipAt)]),
      ...(spec.version === undefined ? [] : [primPtr("version", spec.version)]),
    ],
  };
}

export function exclusionClaims(container: string, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [entityPtr("container", container, CTX_CONTAINER_EXCLUDED)],
  };
}

export function detachClaims(
  container: string,
  note: string | undefined,
  author: string,
  timestamp: number,
): Claims {
  return {
    timestamp,
    author,
    pointers: [
      entityPtr("container", container, CTX_CONTAINER_DETACHED),
      ...(note === undefined ? [] : [primPtr("note", note)]),
    ],
  };
}

/**
 * Publish a Term at rest: one delta carrying the Term's canonical JSON under role `term`. Its
 * DELTA ID is the content address a declaration's `membershipAt` cites — content addressing makes
 * the citation self-verifying, so who published it never matters (the same reasoning as
 * ModuleVersion's address, container-identity.ts).
 */
export function termClaims(term: unknown, author: string, timestamp: number): Claims {
  return {
    timestamp,
    author,
    pointers: [primPtr("term", JSON.stringify(term))],
  };
}

// --- the door validator (wired into authorize beside trustDefect and its kin) ------------------

const containerRef = (claims: Claims, context: string): string | undefined => {
  const p = claims.pointers.find(
    (x) =>
      x.role === "container" && x.target.kind === "entity" && x.target.entity.context === context,
  );
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

const primitives = (claims: Claims, role: string): (string | number | boolean)[] =>
  claims.pointers
    .filter((p) => p.role === role && p.target.kind === "primitive")
    .map((p) => (p.target as { value: string | number | boolean }).value);

const noteBytes = (note: string): number => new TextEncoder().encode(note).length;

// Is this delta container law, and if so, is it WELL-FORMED, LAWFUL law? Shape defects are
// refused for everyone (malformed law must not sit in the audit looking like law); the
// state-dependent rules — immutability, the tree, the cross-trust move — bind only law that
// would BIND, i.e. the operator's own declarations. A stranger's declaration is inert data
// wherever it lands, so the door does not arbitrate its state conflicts.
export function containerDefect(
  delta: Delta,
  reactor: Reactor,
  operator: string | undefined,
): string | undefined {
  const claims = delta.claims;

  const detached = containerRef(claims, CTX_CONTAINER_DETACHED);
  if (detached !== undefined) {
    if (detached.includes(NUL)) return "a container's name must not contain NUL";
    const notes = primitives(claims, "note");
    if (notes.length > 1) return "a detach record carries at most one note";
    const note = notes[0];
    if (note !== undefined) {
      if (typeof note !== "string") return "a detach note is one string primitive";
      if (note.includes(NUL)) return "a detach note must not contain NUL";
      if (noteBytes(note) > NOTE_BYTES) {
        return `a detach note is bounded at ${NOTE_BYTES} bytes — it is permanent metadata, not a dumping surface`;
      }
    }
    return undefined;
  }

  const excluded = containerRef(claims, CTX_CONTAINER_EXCLUDED);
  if (excluded !== undefined) {
    if (excluded.includes(NUL)) return "a container's name must not contain NUL";
    return undefined;
  }

  const name = containerRef(claims, CTX_CONTAINER);
  if (name === undefined) return undefined;
  if (name.length === 0 || name.includes(NUL)) return "a container's name must not contain NUL";

  const trusts = primitives(claims, "trust");
  if (trusts.length !== 1 || typeof trusts[0] !== "string" || !TRUSTS.has(trusts[0])) {
    return 'a container declaration carries exactly one trust: "curated" or "untrusted"';
  }
  const postures = primitives(claims, "posture");
  if (postures.length !== 1 || typeof postures[0] !== "string" || !POSTURES.has(postures[0])) {
    return (
      'a container declaration carries exactly one posture: "wall" or "property" — §28.4 ' +
      'recommends "wall" (a separate store) when unsure; the recommendation lives in this ' +
      "refusal, never in a silent default"
    );
  }
  const trust = trusts[0] as ContainerTrust;
  const posture = postures[0] as ContainerPosture;
  if (trust === "untrusted" && posture === "property") {
    return (
      'trust "untrusted" cannot take posture "property" — a container that admits what its ' +
      "parent does not trust must be a wall (§28.3)"
    );
  }

  const memberships = primitives(claims, "membership");
  const membershipAts = primitives(claims, "membershipAt");
  if (memberships.length > 0 && membershipAts.length > 0) {
    return (
      "a container declaration carries its membership inline OR by address (membershipAt), " +
      "never both — the two shapes must not blur (the §20 corollary)"
    );
  }
  if (memberships.length > 1 || membershipAts.length > 1) {
    return "a container declaration carries at most one membership role";
  }
  if (memberships.length === 1) {
    if (typeof memberships[0] !== "string") {
      return "a container declaration's membership is a Term's canonical JSON in one string primitive";
    }
    try {
      parseTerm(JSON.parse(memberships[0]));
    } catch {
      return "a container declaration's membership is a Term's canonical JSON in one string primitive";
    }
  }
  if (membershipAts.length === 1 && typeof membershipAts[0] !== "string") {
    return "a container declaration's membershipAt is one string content address";
  }
  if (posture === "property" && memberships.length === 0 && membershipAts.length === 0) {
    return (
      "a property container IS its membership: declare membership or membershipAt — without one " +
      "every scoped read would resolve it silently empty (the H9 shape through a different door). " +
      'A WALL needs no scope Term; if a seeded arena is what you meant, declare posture "wall"'
    );
  }

  const parents = claims.pointers.filter(
    (p) =>
      p.role === "parent" &&
      p.target.kind === "entity" &&
      p.target.entity.context === CTX_CONTAINER,
  );
  if (parents.length > 1) return "a container declaration carries at most one parent";
  const parent = parents[0]?.target.kind === "entity" ? parents[0].target.entity.id : undefined;
  if (parent === name) {
    return `declaring "${name}" under itself would close a containment cycle — containment is a tree (§28.8)`;
  }

  // The state-dependent rules bind only law that would bind: the operator's own word.
  if (operator === undefined || claims.author !== operator) return undefined;
  const table = readContainerTable(reactor, operator);
  const standing = table.containers.get(name);
  if (standing !== undefined) {
    if (standing.trust !== trust || standing.posture !== posture) {
      return (
        `trust and posture are immutable per container (§28.4): "${name}" stands declared ` +
        `${standing.trust}/${standing.posture}, and a different trust posture is a NEW container`
      );
    }
    // The cross-trust move — §28.4's transition wearing a tree edit. The effective domain a
    // container sits IN is its parent's trust (the root is the operator's own store: curated).
    const trustOf = (p: string | undefined): ContainerTrust | undefined =>
      p === undefined ? "curated" : table.containers.get(p)?.trust;
    const from = trustOf(standing.parent);
    const to = trustOf(parent);
    if (parent !== standing.parent && from !== undefined && to !== undefined && from !== to) {
      return (
        `re-pointing "${name}" under ${parent === undefined ? "the root" : `"${parent}"`} ` +
        `crosses trust domains (${from} → ${to}) — the §28.4 transition wearing a tree edit; ` +
        `a different trust posture is a NEW container`
      );
    }
  }
  if (parent !== undefined) {
    // Would this edge close a cycle in the RESOLVED graph? Walk up from the proposed parent;
    // reaching the declared name closes the loop. Runs on EVERY declaration carrying `parent` —
    // the likely cycle arrives by re-pointing an existing container, not by the initial build.
    let cursor: string | undefined = parent;
    const seen = new Set<string>([name]);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        return (
          `declaring "${name}" under "${parent}" would close a containment cycle — ` +
          `containment is a tree (§28.8)`
        );
      }
      seen.add(cursor);
      cursor = table.containers.get(cursor)?.parent;
    }
  }
  return undefined;
}

// --- the reader: the resolved container table ----------------------------------------------------

export interface ResolvedContainer {
  readonly entity: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  readonly parent?: string;
  /** The parsed membership Term of the latest surviving declaration, when inline. */
  readonly membership?: unknown;
  readonly membershipAt?: string;
  readonly version?: string;
}

export interface DetachRecord {
  readonly id: string;
  readonly note?: string;
  readonly timestamp: number;
}

export interface ContainerTable {
  readonly containers: ReadonlyMap<string, ResolvedContainer>;
  /** Containers with a surviving exclusion claim — subtracted from scoped reads, flippably. */
  readonly excluded: ReadonlySet<string>;
  /** Currently-detached containers, from the ground alone — the repair listing's source. */
  readonly detached: ReadonlyMap<string, readonly DetachRecord[]>;
  /** Named, deterministic defects: immutable-knob flips and restored cycles. Sorted. */
  readonly defects: readonly string[];
}

interface Decl {
  readonly id: string;
  readonly ts: number;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  readonly parent?: string;
  readonly membershipRaw?: string;
  readonly membershipAt?: string;
  readonly version?: string;
}

const byAge = (a: { ts: number; id: string }, b: { ts: number; id: string }): number =>
  a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The table in force, resolved fresh from the live deltas — the same discipline as
// readTrustPolicy: only lawful (operator-signed, unstruck) claims bind, so a federated
// stranger's declaration, exclusion, or detach record moves nothing here. The reader carries
// its own guards for what no door saw arrive: trust/posture are fixed by the EARLIEST surviving
// declaration (a federated flip is not-binding, named); the parent edges are restored to a
// forest (per remaining cycle, the latest edge is not-binding, named) — a boot never refuses, a
// walk never hangs. An ungoverned store has no lawful voice and therefore no containers.
export function readContainerTable(reactor: Reactor, operator: string | undefined): ContainerTable {
  const empty: ContainerTable = {
    containers: new Map(),
    excluded: new Set(),
    detached: new Map(),
    defects: [],
  };
  if (operator === undefined) return empty;
  const negated = lawfulNegated(reactor, operator);
  const decls = new Map<string, Decl[]>();
  const excluded = new Set<string>();
  const detached = new Map<string, DetachRecord[]>();
  const defects: string[] = [];

  for (const delta of lawfulSnapshot(reactor, operator)) {
    if (negated(delta.id)) continue;
    const claims = delta.claims;
    const excludedName = containerRef(claims, CTX_CONTAINER_EXCLUDED);
    if (excludedName !== undefined) {
      excluded.add(excludedName);
      continue;
    }
    const detachedName = containerRef(claims, CTX_CONTAINER_DETACHED);
    if (detachedName !== undefined) {
      const note = primitives(claims, "note")[0];
      const records = detached.get(detachedName) ?? [];
      records.push({
        id: delta.id,
        timestamp: claims.timestamp,
        ...(typeof note === "string" ? { note } : {}),
      });
      detached.set(detachedName, records);
      continue;
    }
    const name = containerRef(claims, CTX_CONTAINER);
    if (name === undefined) continue;
    const trust = primitives(claims, "trust")[0];
    const posture = primitives(claims, "posture")[0];
    if (
      typeof trust !== "string" ||
      !TRUSTS.has(trust) ||
      typeof posture !== "string" ||
      !POSTURES.has(posture) ||
      (trust === "untrusted" && posture === "property")
    ) {
      continue; // malformed law binds nothing, at the reader as at the door
    }
    const parentPtr = claims.pointers.find(
      (p) =>
        p.role === "parent" &&
        p.target.kind === "entity" &&
        p.target.entity.context === CTX_CONTAINER,
    );
    const membershipRaw = primitives(claims, "membership")[0];
    const membershipAt = primitives(claims, "membershipAt")[0];
    const version = primitives(claims, "version")[0];
    const list = decls.get(name) ?? [];
    list.push({
      id: delta.id,
      ts: claims.timestamp,
      trust: trust as ContainerTrust,
      posture: posture as ContainerPosture,
      ...(parentPtr?.target.kind === "entity" ? { parent: parentPtr.target.entity.id } : {}),
      ...(typeof membershipRaw === "string" ? { membershipRaw } : {}),
      ...(typeof membershipAt === "string" ? { membershipAt } : {}),
      ...(typeof version === "string" ? { version } : {}),
    });
    decls.set(name, list);
  }

  const containers = new Map<string, ResolvedContainer>();
  const edges = new Map<string, { parent: string; ts: number; id: string }>();
  for (const [name, list] of decls) {
    list.sort(byAge);
    const earliest = list[0]!;
    const latest = list[list.length - 1]!;
    // The immutable knobs keep the earliest surviving declaration's word; a later declaration
    // differing in either is not-binding FOR THOSE ROLES (its mutable roles still bind).
    for (const d of list) {
      if (d.trust !== earliest.trust) {
        defects.push(
          `container "${name}": a later declaration flips trust to "${d.trust}" — trust and ` +
            `posture are fixed by the earliest surviving declaration (§28.4); the flip is not binding`,
        );
      }
      if (d.posture !== earliest.posture) {
        defects.push(
          `container "${name}": a later declaration flips posture to "${d.posture}" — trust and ` +
            `posture are fixed by the earliest surviving declaration (§28.4); the flip is not binding`,
        );
      }
    }
    let membership: unknown;
    if (latest.membershipRaw !== undefined) {
      try {
        const profile: unknown = JSON.parse(latest.membershipRaw);
        parseTerm(profile); // validation only — consumers take the JSON profile, as select does
        membership = profile;
      } catch {
        defects.push(
          `container "${name}": the inline membership is not a parseable Term — not binding`,
        );
      }
    }
    containers.set(name, {
      entity: name,
      trust: earliest.trust,
      posture: earliest.posture,
      ...(latest.parent !== undefined ? { parent: latest.parent } : {}),
      ...(membership !== undefined ? { membership } : {}),
      ...(latest.membershipAt !== undefined ? { membershipAt: latest.membershipAt } : {}),
      ...(latest.version !== undefined ? { version: latest.version } : {}),
    });
    if (latest.parent !== undefined) {
      edges.set(name, { parent: latest.parent, ts: latest.ts, id: latest.id });
    }
  }

  // Restore acyclicity: while ANY cycle remains, its latest edge (by (timestamp, id), within
  // that cycle) is not-binding — federation can deliver several disjoint cycles at once, so the
  // loop runs until the resolved graph is a forest. Deterministic: starts are visited in sorted
  // order, so a replayed ground resolves the same forest and the same defects.
  const names = [...containers.keys()].sort();
  for (;;) {
    let cycle: string[] | undefined;
    for (const start of names) {
      const path: string[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined = start;
      while (cursor !== undefined && containers.has(cursor)) {
        if (seen.has(cursor)) {
          cycle = path.slice(path.indexOf(cursor));
          break;
        }
        seen.add(cursor);
        path.push(cursor);
        cursor = edges.get(cursor)?.parent;
      }
      if (cycle !== undefined) break;
    }
    if (cycle === undefined) break;
    let latest: { child: string; parent: string; ts: number; id: string } | undefined;
    for (const child of cycle) {
      const e = edges.get(child)!;
      if (latest === undefined || byAge(latest, e) < 0) {
        latest = { child, parent: e.parent, ts: e.ts, id: e.id };
      }
    }
    edges.delete(latest!.child);
    const rec = containers.get(latest!.child)!;
    const rest = { ...rec };
    delete rest.parent;
    containers.set(latest!.child, rest);
    defects.push(
      `containment cycle: the edge "${latest!.child}" → "${latest!.parent}" is not binding ` +
        `(latest in its cycle) — acyclicity is restored until the graph is a forest (§28.8)`,
    );
  }

  for (const records of detached.values()) {
    records.sort((a, b) => byAge({ ts: a.timestamp, id: a.id }, { ts: b.timestamp, id: b.id }));
  }
  defects.sort();
  return { containers, excluded, detached, defects };
}

// The ADMISSION axis (§28.6): the `loam:trust` shape, filed at the container's entity. Resolved
// per subject; the root's policy is untouched by it, and it never reads the container's knob.
export function containerAdmission(
  reactor: Reactor,
  operator: string | undefined,
  container: string,
): TrustPolicy {
  return readTrustPolicyAt(reactor, container, operator);
}

// The surviving lawful declaration ids for one entity — what a strike-the-declaration act negates.
function survivingDeclarationIds(reactor: Reactor, operator: string, entity: string): string[] {
  const negated = lawfulNegated(reactor, operator);
  const out: string[] = [];
  for (const delta of lawfulSnapshot(reactor, operator)) {
    if (negated(delta.id)) continue;
    if (containerRef(delta.claims, CTX_CONTAINER) === entity) out.push(delta.id);
  }
  return out;
}

const retractionOf = (targetId: string, author: string, timestamp: number): Claims => ({
  timestamp,
  author,
  pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
});

// --- the scope-merge operation (SPEC §27.4's decided formalism) ---------------------------------

// A read scope is union(active containers) MINUS excluded, and "active" is defined, not implied:
// a container is ACTIVE iff its declaration survives AND no surviving detach record covers it.
// The parent edge is containment, never auto-inclusion — a child participates by its own
// membership. Exclusion operates on the active union (excluded-but-declared is in the union and
// then subtracted — that is what makes re-inclusion a pure negation), and the result carries the
// forward negation closure of what it admits (H1, fourth site): exclusion may narrow what a
// scope sees, never revive what was struck. Every unresolvable dependency FAILS THE READ CLOSED —
// a dangling membershipAt, an unreachable wall — because an empty-set fallback would shrink a
// scoped result into partial data with no error, the H9 shape on the read side.
export function containerScopeImpl(
  gw: Gateway,
  opts: { containers?: readonly string[] } = {},
): Delta[] {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const requested = opts.containers ?? [...table.containers.keys()].sort();
  for (const name of requested) {
    if (!table.containers.has(name)) {
      throw new Error(`containerScope refused: no surviving declaration names "${name}"`);
    }
  }
  const isActive = (name: string): boolean => !table.detached.has(name);

  // Each active container's members, from its own ground — the primary for a property scope,
  // the wall's own store for an attached wall.
  const membersOf = (name: string): { deltas: Delta[]; ground: Gateway } => {
    const rec = table.containers.get(name)!;
    if (rec.posture === "wall") {
      const pool = gw.attachedContainers.get(name);
      if (pool === undefined || !gw.quarantinePools.has(pool)) {
        throw new Error(
          `containerScope refused: the wall container "${name}" is not attached — its bytes ` +
            `cannot be read, and a scope must never resolve as if it were empty (H9). Attach it ` +
            `(openContainer), or detach() it on the record to take it out of scope deliberately.`,
        );
      }
      return { deltas: [...pool.reactor.snapshot()], ground: pool };
    }
    let term = rec.membership;
    if (term === undefined && rec.membershipAt !== undefined) {
      const published = gw.reactor.get(rec.membershipAt);
      const raw = published === undefined ? undefined : primitives(published.claims, "term")[0];
      if (typeof raw !== "string") {
        throw new Error(
          `containerScope refused: the membership address ${rec.membershipAt} of container ` +
            `"${name}" resolves to nothing here — partial federation or a missing publish; the ` +
            `read must not be evaluated as if the container were empty (H9)`,
        );
      }
      term = JSON.parse(raw);
    }
    if (term === undefined) {
      throw new Error(
        `containerScope refused: container "${name}" resolves no membership — a property ` +
          `container IS its membership, and an empty fallback would be the H9 shape`,
      );
    }
    return { deltas: gw.select(term), ground: gw };
  };

  const union = new Map<string, { delta: Delta; ground: Gateway }>();
  for (const name of requested) {
    if (!isActive(name)) continue; // a detach cover contributes NOTHING, without any exclusion
    const { deltas, ground } = membersOf(name);
    for (const d of deltas) if (!union.has(d.id)) union.set(d.id, { delta: d, ground });
  }

  // The minus side: members of every excluded, declared, ACTIVE container — a detached container
  // is out of the scope-merge world entirely (it contributed nothing for the union to subtract).
  const minus = new Set<string>();
  for (const name of table.excluded) {
    if (!table.containers.has(name) || !isActive(name)) continue;
    for (const d of membersOf(name).deltas) minus.add(d.id);
  }

  // Subtract, THEN close: the closure re-admits any negation whose target survives the
  // subtraction — from admitted deltas to the negations OF them, per home ground, never the
  // reverse (narrowing may drop a claim; it must never revive one).
  const survivors = [...union.values()].filter(({ delta }) => !minus.has(delta.id));
  const byGround = new Map<Gateway, Delta[]>();
  for (const { delta, ground } of survivors) {
    const list = byGround.get(ground) ?? [];
    list.push(delta);
    byGround.set(ground, list);
  }
  const out = new Map<string, Delta>();
  for (const [ground, deltas] of byGround) {
    for (const d of withNegationClosure(ground, deltas)) if (!out.has(d.id)) out.set(d.id, d);
  }
  return [...out.values()];
}

// --- the runtime handle ---------------------------------------------------------------------------

export interface ContainerOptions {
  /** The store a WALL lives in. Defaults to a fresh in-memory backend. */
  readonly backend?: StoreBackend;
  /** The seeding predicate (§24.2) — the degenerate form of the membership knob. Walls only. */
  readonly admit?: (d: Delta) => boolean;
  /** The membership Term (§24.10/§27.6): a wall's SEEDING scope, or a property's query. */
  readonly membership?: unknown;
  /** Attach a DECLARED container: knobs and membership resolve from the table. */
  readonly name?: string;
  /** Anonymous containers name their knobs explicitly (the preset path). */
  readonly trust?: ContainerTrust;
  readonly posture?: ContainerPosture;
}

export interface Container {
  /** The declared entity, absent for an anonymous container (today's nameless pool). */
  readonly entity?: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  /** A WALL's own gateway over its own store; a property container has none — that is criterion 6. */
  readonly gateway?: Gateway;
  /** The current members: a property's live query, a wall's surviving ground. */
  members(): Delta[];
  /** Re-pulse the one-way inbound seeding edge. Walls only; a property container refuses. */
  reseed(): Promise<FederationReport>;
  /** DISCARD: purge + byte-verify (walls), strike the declaration (named). Refuses over doubt. */
  drop(): Promise<void>;
  /** KEEP: close without purging; a NAMED container lands the at-rest detach record. */
  detach(note?: string): Promise<void>;
}

// Open a container over this store — the generalized body behind `Gateway.openContainer` AND
// (with `voice: "openQuarantine"`, trust/posture preset) `Gateway.openQuarantine`. The voice
// parameter keeps the preset's refusal prefixes byte-stable: those strings are matched by rails
// and by code, and the lifting must not move them.
export async function openContainerImpl(
  gw: Gateway,
  opts: ContainerOptions = {},
  voice: "openContainer" | "openQuarantine" = "openContainer",
): Promise<Container> {
  let entity: string | undefined;
  let trust: ContainerTrust | undefined;
  let posture: ContainerPosture | undefined;
  let membership: unknown = opts.membership;
  let membershipAt: string | undefined;

  if (opts.name !== undefined) {
    const table = readContainerTable(gw.reactor, gw.operatorAuthor);
    const rec = table.containers.get(opts.name);
    if (rec === undefined) {
      throw new Error(
        `${voice}: no surviving declaration names "${opts.name}" — declare it first ` +
          `(an operator-signed claim at ${CTX_CONTAINER})`,
      );
    }
    if (
      (opts.trust !== undefined && opts.trust !== rec.trust) ||
      (opts.posture !== undefined && opts.posture !== rec.posture)
    ) {
      throw new Error(
        `${voice}: "${opts.name}" is declared ${rec.trust}/${rec.posture} — the declaration owns ` +
          `the knobs (§28.4); do not restate them differently at the opener`,
      );
    }
    if (opts.membership !== undefined || opts.admit !== undefined) {
      throw new Error(
        `${voice}: "${opts.name}" resolves its membership from its declaration — re-declare the ` +
          `container to change the knob (a knob change is a delta, never an argument)`,
      );
    }
    entity = opts.name;
    trust = rec.trust;
    posture = rec.posture;
    membership = rec.membership;
    membershipAt = rec.membershipAt;
  } else {
    trust = opts.trust;
    posture = opts.posture;
    if (trust === undefined || posture === undefined) {
      throw new Error(
        `${voice}: an anonymous container names its trust and posture explicitly — there is no ` +
          `declaration to resolve them from`,
      );
    }
  }
  if (trust === "untrusted" && posture === "property") {
    throw new Error(
      `${voice}: trust "untrusted" cannot take posture "property" — a container that admits ` +
        `what its parent does not trust must be a wall (§28.3)`,
    );
  }

  if (posture === "property") {
    return openProperty(gw, {
      trust,
      membership,
      ...(entity !== undefined ? { entity } : {}),
      ...(membershipAt !== undefined ? { membershipAt } : {}),
      ...(opts.admit !== undefined ? { admit: opts.admit } : {}),
    });
  }
  return openWall(
    gw,
    {
      trust,
      membership,
      ...(entity !== undefined ? { entity } : {}),
      ...(opts.admit !== undefined ? { admit: opts.admit } : {}),
      ...(opts.backend !== undefined ? { backend: opts.backend } : {}),
    },
    voice,
  );
}

function openProperty(
  gw: Gateway,
  spec: {
    entity?: string;
    trust: ContainerTrust;
    membership: unknown;
    membershipAt?: string;
    admit?: (d: Delta) => boolean;
  },
): Container {
  if (spec.admit !== undefined) {
    throw new Error(
      "openContainer: a property container has no seeding edge — admit is a wall's knob (§24.2)",
    );
  }
  const resolveTerm = (): unknown => {
    if (spec.entity !== undefined) {
      // Live: the declaration owns the knob, so every read re-resolves it from the table.
      const table = readContainerTable(gw.reactor, gw.operatorAuthor);
      const rec = table.containers.get(spec.entity);
      if (rec === undefined) {
        throw new Error(
          `container "${spec.entity}" no longer resolves — its declaration was struck`,
        );
      }
      if (rec.membership !== undefined) return rec.membership;
      if (rec.membershipAt !== undefined) {
        const published = gw.reactor.get(rec.membershipAt);
        const raw = published === undefined ? undefined : primitives(published.claims, "term")[0];
        if (typeof raw !== "string") {
          throw new Error(
            `the membership address ${rec.membershipAt} of container "${spec.entity}" resolves ` +
              `to nothing here — the read fails closed (H9)`,
          );
        }
        return JSON.parse(raw);
      }
      throw new Error(
        `container "${spec.entity}" resolves no membership — the read fails closed (H9)`,
      );
    }
    if (spec.membership === undefined) {
      throw new Error(
        "openContainer: a property container IS its membership — give a membership Term (H9)",
      );
    }
    return spec.membership;
  };
  resolveTerm(); // prove it resolvable NOW — an opener must not hand back a handle that only fails later
  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "property",
    members: () => gw.select(resolveTerm()),
    reseed: () => {
      return Promise.reject(
        new Error(
          "a property container has no seeding edge — it is a query over shared ground; " +
            "reads re-evaluate live",
        ),
      );
    },
    drop: async () => {
      // A property container holds no bytes of its own; dropping it is striking its declaration.
      if (spec.entity === undefined || gw.options.seed === undefined) return;
      const ids = survivingDeclarationIds(gw.reactor, gw.operatorAuthor!, spec.entity);
      for (const id of ids) {
        await gw.append([
          signClaims(retractionOf(id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed),
        ]);
      }
    },
    detach: async (note?: string) => {
      if (spec.entity === undefined || gw.options.seed === undefined) return; // anonymous: recordless
      await gw.append([
        signClaims(
          detachClaims(spec.entity, note, gw.operatorAuthor!, gw.nextTimestamp()),
          gw.options.seed,
        ),
      ]);
    },
  };
}

// The WALL: a second gateway on its OWN backend, seeded ONE-WAY from the primary by federation,
// sharing THE PRIMARY's operator (§24.1 — the one sanctioned shared-seed case: the wall is the
// operator's own arena, so the operator's erasure stays authoritative there, §24.8). The edge is
// inbound only — nothing is ever wired back. This is the T72 body, generalized: the settle, the
// seeding closure, the drop-verify, and the detach are the invariants the lifting preserves.
async function openWall(
  gw: Gateway,
  spec: {
    entity?: string;
    trust: ContainerTrust;
    membership: unknown;
    admit?: (d: Delta) => boolean;
    backend?: StoreBackend;
  },
  voice: "openContainer" | "openQuarantine",
): Promise<Container> {
  if (gw.options.seed === undefined) {
    throw new Error(
      voice === "openQuarantine"
        ? "only an operated store can open a quarantine pool (§24.1)"
        : "only an operated store can attach a container wall (§24.1)",
    );
  }
  if (spec.entity !== undefined && gw.attachedContainers.has(spec.entity)) {
    throw new Error(
      `${voice}: "${spec.entity}" is already attached here — drop() or detach() it first`,
    );
  }
  const backend: StoreBackend = spec.backend ?? new MemoryBackend();
  // SETTLE ERASURE DEBT BEFORE THE WALL EXISTS (T72). A durable store being (re)opened may hold
  // bytes whose tombstones landed at the primary while it was detached — the seeding edge
  // DELIVERS a tombstone as data and executes nothing, so attaching first would boot a reader
  // that resolves the forgotten byte LIVE beside its own tombstone. The primary's surviving
  // tombstones are authoritative here (the wall shares its operator), so the debt is swept at
  // the bytes NOW — before any reactor replays the store — and a store that cannot be proven
  // clean of it refuses to attach at all (H9: unproven bytes do not come back inside the walls).
  const dead = [...readTombstones(gw.reactor, gw.operatorAuthor)];
  if (dead.length > 0) {
    let owed: Set<string>;
    try {
      if (backend.heldAmong) {
        owed = await backend.heldAmong(dead);
      } else {
        owed = new Set<string>();
        for (const id of dead) if (await backend.holds(id)) owed.add(id);
      }
      if (owed.size > 0) {
        await backend.purge([...owed]);
        for (const id of owed) {
          if (await backend.holds(id)) {
            throw new Error(`the store still holds ${id} after the settling purge`);
          }
        }
      }
    } catch (err) {
      throw new Error(
        `${voice} refused: this store carries erasure debt that could not be settled — ` +
          `bytes the operator ordered forgotten must not come back inside the walls as a live ` +
          `reader. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  const pool = await Gateway.open(backend, { seed: gw.options.seed });
  if (spec.admit !== undefined && spec.membership !== undefined) {
    throw new Error(
      `${voice}: give a membership Term OR an admit predicate, not both — admit is the ` +
        `degenerate form of the same knob (§24.10)`,
    );
  }
  // A membership Term is proven at the door (parse + dset-sort, via the same select the reading
  // surface serves) and re-evaluated on every pulse — the scope is LIVE, like the ground it cuts.
  if (spec.membership !== undefined) gw.select(spec.membership);
  const base = spec.admit;
  const memberAdmit = (): ((d: Delta) => boolean) | undefined => {
    if (spec.membership === undefined) return base === undefined ? undefined : base;
    // The members are the Term's dset PLUS its negation closure (§28.4, T38). A scope may narrow
    // what the wall sees; it may never resurrect what was struck — `negated` ranging over the
    // operand set means a claim admitted without its retraction reads as live inside.
    const members = new Set(withNegationClosure(gw, gw.select(spec.membership)).map((d) => d.id));
    return (d) => members.has(d.id);
  };
  const reseed = (): Promise<FederationReport> => {
    const admit = memberAdmit();
    return pool.federate(
      gw.offeredDeltas(),
      // A scope narrows what the wall SEES, never what it must FORGET (§24.8): the operator's
      // tombstones pass the seeding edge unconditionally, membership and predicate alike.
      admit === undefined ? {} : { admit: (d) => isTombstone(d.claims) || admit(d) },
    );
  };
  await reseed(); // one-way INBOUND seeding; the reverse leg is never wired
  // Bind the operator's federated schemas so the wall RESOLVES the seeded ground — a dry-run
  // reads a living lens, not raw deltas. (Foreign law stays inert until promoted.)
  pool.replayRegistrations();
  await pool.preloadResolvers();
  gw.quarantinePools.add(pool);
  if (spec.entity !== undefined) {
    gw.attachedContainers.set(spec.entity, pool);
    // Reattach settles the LISTING: negate EVERY surviving detach record for this entity (H4 —
    // two detaches mint two records; one negation must not leave the container half-listed).
    // After the attach succeeded, never before: a refused attach must leave the records standing.
    const table = readContainerTable(gw.reactor, gw.operatorAuthor);
    for (const record of table.detached.get(spec.entity) ?? []) {
      await gw.append([
        signClaims(
          retractionOf(record.id, gw.operatorAuthor!, gw.nextTimestamp()),
          gw.options.seed,
        ),
      ]);
    }
  }

  const unregister = (): void => {
    gw.quarantinePools.delete(pool);
    if (spec.entity !== undefined) gw.attachedContainers.delete(spec.entity);
  };

  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "wall",
    gateway: pool,
    members: () => [...pool.reactor.snapshot()],
    reseed,
    // Drop DISCARDS — at the bytes, on every backend (T72). Purge everything the wall can NAME,
    // then VERIFY at the bytes (holds — a purge's count is evidence, never the verdict, T70),
    // and on any survivor REFUSE while leaving the wall attached: a store that cannot prove
    // discard stays inside the erasure fan-out rather than slipping out of it.
    drop: async () => {
      const refuse = (why: string, cause?: unknown): never => {
        throw new Error(
          `drop refused: ${why} — a dropped pool must not become bytes outside the erasure ` +
            `fan-out. The pool remains ATTACHED (still in erasure reach); resolve the store ` +
            `fault and drop again, or detach() to keep it deliberately.`,
          cause === undefined ? undefined : { cause },
        );
      };
      try {
        // The dead set is everything this wall can NAME — and a read alone cannot name it all
        // (the erasure lens's finding): a mirror's `deltasSince` is primary-only, and a RETRY
        // after a partial purge reads EMPTY. The session reactor remembers what the read cannot,
        // so the enumeration is their union; and the §25 quarantine pen — rows a read SET ASIDE
        // as corrupt, still legible bytes on disk — is swept by its own door, since no id-keyed
        // purge can reach a row whose id was never returned.
        const ids = new Set((await pool.backend.deltasSince(new Set())).map((d) => d.id));
        for (const d of pool.reactor.snapshot()) ids.add(d.id);
        if (isRepairable(pool.backend)) {
          for (const row of await pool.backend.quarantine()) {
            await pool.backend.discardRow(row.key);
          }
        }
        if (ids.size > 0) {
          const batch = [...ids];
          await pool.backend.purge(batch);
          // The verdict, H9-closed: a probe that cannot answer has proven nothing, so a
          // rejecting store refuses the drop exactly like a retaining one.
          let survivors: Set<string>;
          if (pool.backend.heldAmong) {
            survivors = await pool.backend.heldAmong(batch);
          } else {
            survivors = new Set<string>();
            for (const id of batch) if (await pool.backend.holds(id)) survivors.add(id);
          }
          if (survivors.size > 0) {
            refuse(
              `this pool's store still holds ${survivors.size} of ${batch.length} delta(s) ` +
                `after the discard purge`,
            );
          }
        }
        // What no read and no session ever named is outside drop's jurisdiction — a straggler
        // bearing an unlisted id is heal's domain (§11), stated rather than implied clean.
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("drop refused:")) throw err;
        refuse(
          `this pool's store could not be proven clean (${
            err instanceof Error ? err.message : String(err)
          })`,
          err,
        );
      }
      unregister();
      // A NAMED wall proven empty strikes its own declaration: leaving it standing would turn
      // every future erase into a completeness refusal over a store that provably ceased.
      if (spec.entity !== undefined) {
        for (const id of survivingDeclarationIds(gw.reactor, gw.operatorAuthor!, spec.entity)) {
          await gw.append([
            signClaims(retractionOf(id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed!),
          ]);
        }
      }
      await pool.close();
    },
    // Detach KEEPS — the deliberate act, distinct in name from the discard. No purge, no
    // verification: the caller is choosing to hold these bytes outside the fan-out, and
    // reattachment is openContainer over the surviving store. A NAMED container lands the
    // at-rest record FIRST (T72's named deferral, fulfilled): if the record cannot land, the
    // wall stays attached — the erasure guard must never lose sight of bytes it was promised.
    detach: async (note?: string) => {
      if (spec.entity !== undefined) {
        await gw.append([
          signClaims(
            detachClaims(spec.entity, note, gw.operatorAuthor!, gw.nextTimestamp()),
            gw.options.seed!,
          ),
        ]);
      }
      unregister();
      await pool.close();
    },
  };
}

// --- the erase completeness guard (SPEC §24.8 × the mint) ----------------------------------------

// The mint makes containers enumerable AT REST, and erase fans out over the ATTACHED set — after
// a restart those can differ. The honest rule: erase refuses to report completeness while the
// resolved table names a WALL-posture container — untrusted OR curated, since bytes follow
// posture — that is neither currently attached nor covered by a surviving detach record. An
// unreachable wall is a named fault, never a silent gap; a covered one is listed as deliberately
// kept. (The full locator machinery rides T78's mounts; this is the rule, shipped with the mint.)
export function unreachableWallReport(gw: Gateway): { faults: string[]; kept: string[] } {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const faults: string[] = [];
  const kept: string[] = [];
  for (const [entity, rec] of table.containers) {
    if (rec.posture !== "wall") continue;
    const attached = gw.attachedContainers.get(entity);
    if (attached !== undefined && gw.quarantinePools.has(attached)) continue;
    if (table.detached.has(entity)) {
      kept.push(entity);
      continue;
    }
    faults.push(
      `the declared wall container "${entity}" is neither attached nor covered by a detach ` +
        `record — its store may hold bytes outside this sweep. Attach it (openContainer) and ` +
        `re-run, or detach() it on the record to keep it deliberately.`,
    );
  }
  faults.sort();
  kept.sort();
  return { faults, kept };
}
