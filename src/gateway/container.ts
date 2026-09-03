// The CONTAINER (SPEC §27, ticket T32) — the named generalization of the quarantine pool, and the
// at-rest vocabulary for §27.1's knob vector. A container is an entity the operator names,
// declared by an operator-signed claim at `loam.container`; the declaration is the at-rest form
// of the knobs, re-resolved live from the ground like `loam:trust` — a knob change is a delta,
// never a restart. Two knobs are NOT knobs (§28.4 proved neither transition is a flag flip):
// `trust` and `posture` are immutable per container entity, enforced at the door AND at the
// reader, because a flip has two arrival paths and only one passes a door.
//
// Bytes follow the POSTURE; law follows the TRUST. The posture axis is STORAGE, and the two words
// say only that: a SHARED container is a query over ground this store already holds — pointer
// arrangement, zero copies — and a SEPARATE container keeps its own bytes in its own store, because
// discard-with-zero-trace is the one thing sharing cannot provide. Trust decides which postures
// are lawful (§28.3: untrusted must be separate — delegated admission over shared ground is
// refused); posture decides where bytes are paid. The quarantine (SPEC §24) is ONE PRESET of
// this primitive: UNTRUSTED · separate · one-way-seeded · droppable — `openQuarantine` keeps its
// signature and its behavior, implemented over `openContainerImpl` below.
//
// The two "trusts" are §28.1's two AXES, never one value: the knob's `trust` role is the
// EFFECTIVENESS axis (whose trust domain the content belongs to); the `loam:trust` declaration
// filed AT the container entity (§28.6) is the ADMISSION axis (who may federate INTO it).
// Admission resolves from the subject declaration and never from the knob; posture legality
// gates on the knob and never from the roster.

import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import type { StoreBackend } from "../store/backend.js";
import { MemoryBackend } from "../store/memory.js";
import { isRepairable } from "../store/quarantine.js";
import { CTX_GRANTS, grantClaims, holdsGrant, revocationClaims } from "./accounts.js";
import { STORE_ENTITY } from "./genesis.js";
import { isTombstone, readTombstones } from "./erase.js";
import { canonicalLeewayJson, parseLeeway, SEALED_LEEWAY, type Leeway } from "./leeway.js";
import {
  clampedTo,
  newPoolEnvelope,
  poolsBeneath,
  resolveEnvelope,
  type QuarantineEnvelope,
} from "./envelope.js";
import { withNegationClosure, withNegationClosureAcross } from "./ingest.js";
import { lawfulNegated, lawfulSnapshot } from "./registration.js";
import { readTrustPolicyAt, type TrustPolicy } from "./trust.js";
import { Gateway, type ConnectionBinding, type FederationReport } from "./gateway.js";

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
/** Where this container's bytes live: in its OWN store, or nowhere but the ground it reads. */
export type ContainerPosture = "separate" | "shared";

const TRUSTS = new Set<string>(["curated", "untrusted"]);
const POSTURES = new Set<string>(["separate", "shared"]);

// The at-rest posture words before the storage rename, and what each one meant. The §20 step
// `container-posture-storage-words` carries a surviving declaration forward; these stay legible here
// for two reasons no migration can cover. A store is migrated only when someone RUNS `loam migrate`,
// so until then the reader must resolve a legacy declaration exactly as it always did — a container
// that dropped out of the table would drop out of every scope and out of the erasure guard, with no
// error anywhere (the H9 shape). And the step re-signs only SURVIVING law, so a STRUCK legacy
// declaration keeps these bytes forever — which is precisely what `unreachableStoreReport` reads to
// ask whether anything in a lineage ever named a store of its own.
export const LEGACY_POSTURES: ReadonlyMap<string, ContainerPosture> = new Map([
  ["wall", "separate"],
  ["property", "shared"],
]);

// The posture a primitive BINDS — current word or retired one. The door does not use this (it
// refuses a retired word outright, naming the migration); every READER does, because a reader's job
// is to resolve the bytes it was given rather than the bytes it wishes it had.
const asPosture = (value: string | number | boolean | undefined): ContainerPosture | undefined =>
  typeof value !== "string"
    ? undefined
    : POSTURES.has(value)
      ? (value as ContainerPosture)
      : LEGACY_POSTURES.get(value);
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
  /**
   * This container is the INBOX POOL of the named parent container (SPEC §39). A separate pool that
   * a connection's writes land in; its members compose into the parent's gather. The pointer is what
   * makes an inbox declaration shape-distinguishable from a plain one (no §20 migration owed — an old
   * declaration simply has no `inboxOf`).
   */
  readonly inboxOf?: string;
  /**
   * What this container may do and what it allows beneath it (SPEC §58, position 4), inlined as
   * canonical JSON under role `leeway`. Absent means SEALED — every switch off — so an older
   * declaration reads as the private journal and owes no §20 migration, exactly as `inboxOf` does.
   */
  readonly leeway?: Leeway;
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
      ...(spec.inboxOf === undefined ? [] : [primPtr("inboxOf", spec.inboxOf)]),
      ...(spec.leeway === undefined ? [] : [primPtr("leeway", canonicalLeewayJson(spec.leeway))]),
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
    // A RETIRED word gets its own refusal. The door speaks one vocabulary and only the current one
    // — but a declaration carrying the old bytes is a store that has not been migrated, not a
    // malformed claim, and telling it so is the difference between a fixable error and a mystery.
    const retired = typeof postures[0] === "string" ? LEGACY_POSTURES.get(postures[0]) : undefined;
    if (retired !== undefined) {
      return (
        `posture "${postures[0]}" is the retired word for "${retired}" — the axis is STORAGE (its ` +
        `own bytes, or a reading over ground already held), so the words say storage now. An older ` +
        `store is carried forward by \`loam migrate\` (§20), never by re-minting the old bytes`
      );
    }
    return (
      'a container declaration carries exactly one posture: "separate" (its own bytes in its own ' +
      'store) or "shared" (a reading over ground this store already holds) — §28.4 recommends ' +
      '"separate" when unsure; the recommendation lives in this refusal, never in a silent default'
    );
  }
  const trust = trusts[0] as ContainerTrust;
  const posture = postures[0] as ContainerPosture;
  if (trust === "untrusted" && posture === "shared") {
    return (
      'trust "untrusted" cannot take posture "shared" — a container that admits what its ' +
      'parent does not trust keeps its own store, posture "separate" (§28.3)'
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
  if (posture === "shared" && memberships.length === 0 && membershipAts.length === 0) {
    return (
      "a shared container IS its membership: declare membership or membershipAt — without one " +
      "every scoped read would resolve it silently empty (the H9 shape through a different door). " +
      "A SEPARATE container needs no scope Term; if a seeded arena is what you meant, declare " +
      'posture "separate"'
    );
  }

  const leeways = primitives(claims, "leeway");
  if (leeways.length > 1) return "a container declaration carries at most one leeway pointer";
  if (leeways.length === 1) {
    const raw = leeways[0];
    if (typeof raw !== "string") return "a container's leeway is one JSON string primitive";
    const read = parseLeeway(raw);
    if ("defect" in read) return `a container's leeway is malformed: ${read.defect}`;
  }

  const inboxOfs = primitives(claims, "inboxOf");
  if (inboxOfs.length > 1) return "a container declaration carries at most one inboxOf pointer";
  if (inboxOfs.length === 1) {
    const parentName = inboxOfs[0];
    if (typeof parentName !== "string" || parentName.length === 0 || parentName.includes(NUL)) {
      return "a container's inboxOf names one parent container and must not contain NUL";
    }
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
  /** Set on an INBOX pool (SPEC §39): the parent container whose gather this pool composes into. */
  readonly inboxOf?: string;
  /**
   * The leeway in force (SPEC §58). NEVER optional and never undefined: a container that declared
   * none, and one whose declaration did not parse, both read `SEALED_LEEWAY`. A reader therefore
   * cannot forget to default, and there is no `undefined` here for anyone to read as permission.
   */
  readonly leeway: Leeway;
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
  readonly inboxOf?: string;
  readonly leeways?: readonly unknown[];
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
//
// MEMOIZED per reactor, keyed on the count of CONTAINER LAW in the arrival log — and that key is
// what makes the memo unable to lie (H8). The table is a pure function of exactly two kinds of
// delta, and `computeContainerTable` reads nothing else: an operator-signed record filed at a
// container context (declaration, exclusion, detach — `containerRef` on the three contexts) and an
// operator-signed negation (`lawfulNegated`: only the operator's strikes retire law, transitively,
// and every strike carries a delta pointer). Nothing another author writes binds here, and the
// operator's own DATA — a claim with no delta pointer at no container context — binds nothing
// either, so neither invalidates the memo. A reactor only ever GROWS — no delete, no in-place
// replace; an erasure reseats onto a fresh reactor, which is a fresh key. So the memo sweeps the log
// forward from a high-water mark counting law (O(new) per call), and recomputes only when that
// count moved. Nobody mutates a returned table (its fields are read-only views), which is what lets
// one instance be shared. Without this every door that consulted the table paid a full snapshot
// copy and walk per call — ~200ms at a 10k-delta ground.
interface TableMemo {
  readonly operator: string | undefined;
  swept: number; // arrival-log high-water mark
  lawCount: number; // container-law deltas in log[0, swept)
  builtAt: number; // the lawCount the table was computed from
  table: ContainerTable;
}
const tableMemo = new WeakMap<Reactor, TableMemo>();

/** Could this delta move the container table? The operator's container records and strikes. */
export function isContainerLaw(d: Delta, operator: string | undefined): boolean {
  if (operator === undefined || d.claims.author !== operator) return false;
  return (
    d.claims.pointers.some((p) => p.target.kind === "delta") ||
    containerRef(d.claims, CTX_CONTAINER) !== undefined ||
    containerRef(d.claims, CTX_CONTAINER_EXCLUDED) !== undefined ||
    containerRef(d.claims, CTX_CONTAINER_DETACHED) !== undefined
  );
}

export function readContainerTable(reactor: Reactor, operator: string | undefined): ContainerTable {
  let memo = tableMemo.get(reactor);
  if (memo === undefined || memo.operator !== operator) {
    memo = { operator, swept: 0, lawCount: 0, builtAt: -1, table: EMPTY_TABLE };
    tableMemo.set(reactor, memo);
  }
  const log = reactor.arrivalLog();
  for (; memo.swept < log.length; memo.swept += 1) {
    if (isContainerLaw(log[memo.swept]!, operator)) memo.lawCount += 1;
  }
  if (memo.builtAt !== memo.lawCount) {
    memo.table = computeContainerTable(reactor, operator);
    memo.builtAt = memo.lawCount;
  }
  return memo.table;
}

const EMPTY_TABLE: ContainerTable = {
  containers: new Map(),
  excluded: new Set(),
  detached: new Map(),
  defects: [],
};

function computeContainerTable(reactor: Reactor, operator: string | undefined): ContainerTable {
  if (operator === undefined) return EMPTY_TABLE;
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
    // A RETIRED posture word still binds HERE, unlike at the door: a store is migrated when someone
    // runs `loam migrate`, and until then dropping its containers would empty every scope and blind
    // the erasure guard without saying a word (H9). The word is normalized, never widened — the
    // legacy pair maps onto the same two postures, so nothing new becomes lawful.
    const posture = asPosture(primitives(claims, "posture")[0]);
    if (
      typeof trust !== "string" ||
      !TRUSTS.has(trust) ||
      posture === undefined ||
      (trust === "untrusted" && posture === "shared")
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
    const inboxOf = primitives(claims, "inboxOf")[0];
    const leeways = primitives(claims, "leeway");
    const list = decls.get(name) ?? [];
    list.push({
      id: delta.id,
      ts: claims.timestamp,
      trust: trust as ContainerTrust,
      posture,
      ...(parentPtr?.target.kind === "entity" ? { parent: parentPtr.target.entity.id } : {}),
      ...(typeof membershipRaw === "string" ? { membershipRaw } : {}),
      ...(typeof membershipAt === "string" ? { membershipAt } : {}),
      ...(typeof version === "string" ? { version } : {}),
      ...(typeof inboxOf === "string" ? { inboxOf } : {}),
      ...(leeways.length > 0 ? { leeways } : {}),
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
    // LEEWAY TAKES THE LATEST, unlike trust and posture above: "a leeway is a declaration on the
    // container, so changing it later ... is a delta the next request obeys" (§58 position 4). A
    // leeway that does not parse is NOT BINDING and the container falls back to SEALED — never to
    // the previous declaration, which would let a malformed later delta pin an older, wider grant
    // in place.
    let leeway: Leeway = SEALED_LEEWAY;
    const declared = latest.leeways ?? [];
    const sealedBecause = (why: string): void => {
      defects.push(`container "${name}": ${why}; the container reads as sealed`);
    };
    // THE READER AGREES WITH THE DOOR, or the door is decoration. Arity is checked HERE too: the
    // door refuses two leeway pointers as ambiguous, and taking the first at rest would bind a
    // grant the door called unreadable — wide, silently, and whichever one the author put first.
    if (declared.length > 1) {
      sealedBecause(
        "the declaration carries more than one leeway pointer, so its law is ambiguous and binds " +
          "nothing",
      );
    } else if (declared.length === 1) {
      const raw = declared[0];
      if (typeof raw !== "string") {
        sealedBecause("a container's leeway is one JSON string primitive, and this is not one");
      } else {
        const read = parseLeeway(raw);
        if ("defect" in read) sealedBecause(`the declared leeway is not binding — ${read.defect}`);
        else leeway = read.leeway;
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
      ...(latest.inboxOf !== undefined ? { inboxOf: latest.inboxOf } : {}),
      leeway,
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
export function survivingDeclarationIds(
  reactor: Reactor,
  operator: string,
  entity: string,
): string[] {
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
// a dangling membershipAt, an unreachable store — because an empty-set fallback would shrink a
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

  // Each active container's members, from its own ground — the primary for a shared scope,
  // its own store for an attached separate container.
  const membersOf = (name: string): { deltas: Delta[]; ground: Gateway } => {
    const rec = table.containers.get(name)!;
    if (rec.posture === "separate") {
      // THIS STORE IS THAT CONTAINER. A separate container's ground is a one-way seeded copy of its
      // host's, so it carries the host's declaration OF ITSELF — and a scope built INSIDE it then
      // asks it to attach itself, which it can never do. Its own reactor holds exactly those bytes,
      // so answering from there is the reading, not a fallback: H9's concern is a scope resolving as
      // if a container were EMPTY, and this is the one case where the bytes are already in hand.
      //
      // Without it a pool cannot resolve any lens whose gather scopes the parent — which is every
      // lens a channel blesses. It survives a restart only because of this: a re-attach re-pulses
      // the seeding edge, and a full replay then builds the scope that asks the question.
      if (name === gw.poolHandle) return { deltas: [...gw.reactor.snapshot()], ground: gw };
      const pool = gw.attachedContainers.get(name);
      if (pool === undefined || !gw.quarantinePools.has(pool)) {
        throw new Error(
          `containerScope refused: the separate container "${name}" is not attached — its bytes ` +
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
        `containerScope refused: container "${name}" resolves no membership — a shared ` +
          `container IS its membership, and an empty fallback would be the H9 shape`,
      );
    }
    return { deltas: gw.select(term), ground: gw };
  };

  // The gather is the requested ACTIVE containers PLUS every active inbox pool bound to one of them
  // (SPEC §39): an inbox is a separate container whose declaration marks its parent with `inboxOf`,
  // and a connection's writes land in that pool. The pool stays a container in its own right — drop()
  // and forensics still reach it — but its members COMPOSE into the parent's gather here. An inbox
  // that is active yet unattached faults through membersOf like any separate container (H9): a
  // parent read must never silently drop a connection's writes.
  const toGather: string[] = [];
  const seenGather = new Set<string>();
  const addGather = (name: string): void => {
    if (seenGather.has(name)) return;
    seenGather.add(name);
    toGather.push(name);
  };
  for (const name of requested) {
    if (!isActive(name)) continue; // a detach cover contributes NOTHING, without any exclusion
    addGather(name);
    for (const [inboxName, rec] of table.containers) {
      if (rec.inboxOf === name && isActive(inboxName)) addGather(inboxName);
    }
  }

  // EVERY contributing ground is remembered per delta, never a first-wins home (the suppression
  // lens's finding): a separate store's snapshot and a shared query can admit the SAME id, and only
  // one of their grounds may hold the strike — the snapshot is point-in-time, the primary is live.
  const contributions = new Map<Gateway, Map<string, Delta>>();
  for (const name of toGather) {
    const { deltas, ground } = membersOf(name);
    const per = contributions.get(ground) ?? new Map<string, Delta>();
    for (const d of deltas) if (!per.has(d.id)) per.set(d.id, d);
    contributions.set(ground, per);
  }

  // The minus side: members of every excluded, declared, ACTIVE container — a detached container
  // is out of the scope-merge world entirely (it contributed nothing for the union to subtract).
  const minus = new Set<string>();
  for (const name of table.excluded) {
    if (!table.containers.has(name) || !isActive(name)) continue;
    for (const d of membersOf(name).deltas) minus.add(d.id);
  }

  // Subtract, THEN close — over the UNION of every contributing ground, not per-ground (SPEC §39,
  // decision 1). A parent composes its own ground with each inbox pool, and a strike of an admitted
  // delta can live in ANY of them; a per-ground closure treats a separate pool as a closure boundary
  // and hands the reader a claim while its strike sits one ground over. Union closure re-admits any
  // negation whose target survives the subtraction, across every ground, never the reverse
  // (narrowing may drop a claim; it must never revive one).
  const grounds = [...contributions.keys()];
  const admitted: Delta[] = [];
  const seen = new Set<string>();
  for (const per of contributions.values()) {
    for (const d of per.values()) {
      if (minus.has(d.id) || seen.has(d.id)) continue;
      seen.add(d.id);
      admitted.push(d);
    }
  }
  return withNegationClosureAcross(grounds, admitted);
}

// A connection's read (SPEC §39.1.2): the binding is an UPPER BOUND, not a routing rule. A
// connection bound to `bound` reaches that container and its descendants by naming them (nesting is
// addressing, §39.3a); it cannot reach outside its own subtree. With no explicit names it reads its
// bound container. Reaching a container outside the subtree refuses — the owner chooses the width by
// choosing the binding.
// Every container at or beneath `root` by PARENT edge — the set a bound connection reads over
// (SPEC §58 position 2: the read is scoped to the bound container's SUBTREE). A fixpoint rather
// than one pass, because the table's iteration order guarantees nothing about parents preceding
// children. Pools are NOT walked here: `containerScopeImpl` composes each requested container's
// own pools already, so descending the parent edges reaches every pool under the subtree exactly
// once, and the two steps stay separately legible.
//
// This is deliberately NARROWER than `subtreeOf` (the admin page's reach), which also follows
// `inboxOf` edges to answer "what may this person act on". Reach and read are different questions.
function subtreeUnder(table: ContainerTable, root: string): string[] {
  const reach = new Set<string>([root]);
  for (;;) {
    let grew = false;
    for (const [name, rec] of table.containers) {
      if (reach.has(name) || rec.parent === undefined) continue;
      if (reach.has(rec.parent)) {
        reach.add(name);
        grew = true;
      }
    }
    if (!grew) return [...reach];
  }
}

export function connectionScopeImpl(
  gw: Gateway,
  opts: { bound: string; containers?: readonly string[] },
): Delta[] {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  if (!table.containers.has(opts.bound)) {
    throw new Error(
      `connectionScope refused: no surviving declaration names the bound container "${opts.bound}"`,
    );
  }
  const within = (target: string): boolean => {
    let cursor: string | undefined = target;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor)) {
      if (cursor === opts.bound) return true;
      seen.add(cursor);
      cursor = table.containers.get(cursor)?.parent;
    }
    return false;
  };
  // THE WHOLE SUBTREE by default: a workspace reads its own nested rooms, which is what position 2
  // decided and what S1 first shipped too narrowly. An explicit `containers` list still narrows it,
  // and every entry is fenced by `within` — the binding is an upper bound, never a routing rule.
  //
  // FAIL-CLOSED IS THE PRICE, and it is the right one (Myk, 2026-09-02): a descendant that is
  // separate and unattached faults the whole read through `membersOf`, so one unreachable room
  // stops the workspace rather than quietly shrinking it (H9). Detach a room to take it out of
  // scope deliberately.
  const targets = opts.containers ?? subtreeUnder(table, opts.bound);
  for (const t of targets) {
    if (!within(t)) {
      throw new Error(
        `connectionScope refused: the connection is bound to "${opts.bound}" and cannot reach ` +
          `"${t}" — the binding is an upper bound, not a routing rule (§39.1.2), and "${t}" is ` +
          `outside its subtree`,
      );
    }
  }
  return containerScopeImpl(gw, { containers: targets });
}

// --- the runtime handle ---------------------------------------------------------------------------

export interface ContainerOptions {
  /** The store a SEPARATE container lives in. Defaults to a fresh in-memory backend. */
  readonly backend?: StoreBackend;
  /**
   * The seeding predicate (§24.2) — the degenerate form of the membership knob. SEPARATE only.
   */
  readonly admit?: (d: Delta) => boolean;
  /** The membership Term (§24.10/§27.6): a SEPARATE container's SEEDING scope, or a SHARED one's query. */
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
  /**
   * A SEPARATE container's own gateway over its own store; a SHARED one has none — criterion 6.
   */
  readonly gateway?: Gateway;
  /**
   * The current members, as a READING-safe set on both postures: a SHARED container's live query
   * PLUS the forward negation closure of what it admits (H1 — a struck member crosses with its
   * strike, deliberately more than `select`'s raw dset), or a SEPARATE one's surviving ground
   * (which carries its strikes natively). One name, one closure contract.
   */
  members(): Delta[];
  /** Re-pulse the one-way inbound seeding edge. SEPARATE only; a SHARED container refuses. */
  reseed(): Promise<FederationReport>;
  /**
   * DISCARD: purge + byte-verify (SEPARATE), strike the declaration (named). Refuses over doubt.
   */
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
  if (trust === "untrusted" && posture === "shared") {
    throw new Error(
      `${voice}: trust "untrusted" cannot take posture "shared" — a container that admits ` +
        `what its parent does not trust keeps its own store, posture "separate" (§28.3)`,
    );
  }

  if (posture === "shared") {
    return openShared(gw, {
      trust,
      membership,
      ...(entity !== undefined ? { entity } : {}),
      ...(membershipAt !== undefined ? { membershipAt } : {}),
      ...(opts.admit !== undefined ? { admit: opts.admit } : {}),
    });
  }
  return openSeparate(
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

function openShared(
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
      "openContainer: a shared container has no seeding edge — admit is a separate container's " +
        "knob (§24.2)",
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
        "openContainer: a shared container IS its membership — give a membership Term (H9)",
      );
    }
    return spec.membership;
  };
  resolveTerm(); // prove it resolvable NOW — an opener must not hand back a handle that only fails later
  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "shared",
    members: () => withNegationClosure(gw, gw.select(resolveTerm())),
    reseed: () => {
      return Promise.reject(
        new Error(
          "a shared container has no seeding edge — it is a query over shared ground; " +
            "reads re-evaluate live",
        ),
      );
    },
    drop: async () => {
      // A shared container holds no bytes of its own; dropping it is striking its declaration.
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

// The SEPARATE posture: a second gateway on its OWN backend, seeded ONE-WAY from the primary by
// federation, sharing THE PRIMARY's operator (§24.1 — the one sanctioned shared-seed case: the store
// is the operator's own arena, so the operator's erasure stays authoritative there, §24.8). The edge
// is inbound only — nothing is ever wired back. This is the T72 body, generalized: the settle, the
// seeding closure, the drop-verify, and the detach are the invariants the lifting preserves.
async function openSeparate(
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
        : "only an operated store can attach a container's own store (§24.1)",
    );
  }
  if (spec.entity !== undefined && gw.attachedContainers.has(spec.entity)) {
    throw new Error(
      `${voice}: "${spec.entity}" is already attached here — drop() or detach() it first`,
    );
  }
  // A SEPARATE container's store may not BE a store already in this tree. The whole posture is
  // that its bytes are its own and can be discarded whole; handed the opener's backend, a
  // "sequestered" write lands in canonical ground while every surface says it did not — and since
  // drop()'s fan-out walks the WHOLE tree (poolsBeneath), a nested pool handed ANY ancestor's or
  // sibling's backend would have that store purged wholesale by a drop above it: parent ground,
  // bystanders, tombstones. Identity only — two handles onto one file are not decidable here —
  // but the obvious mistake is, at every level.
  if (spec.backend !== undefined) {
    if (spec.backend === gw.backend) {
      throw new Error(
        `${voice}: a separate container may not take the store it is opened from as its own — its ` +
          `bytes must be discardable without touching the host's`,
      );
    }
    let root: Gateway = gw;
    while (root.attachedTo !== undefined) root = root.attachedTo;
    if (
      spec.backend === root.backend ||
      [...poolsBeneath(root)].some(({ pool: p }) => p.backend === spec.backend)
    ) {
      throw new Error(
        `${voice}: a separate container may not take a store already inside this tree as its ` +
          `own — a drop's fan-out walks the whole tree, and a shared store would let one ` +
          `container's discard purge another's ground`,
      );
    }
  }
  const backend: StoreBackend = spec.backend ?? new MemoryBackend();
  // SETTLE ERASURE DEBT BEFORE THE CONTAINER OPENS (T72). A durable store being (re)opened may hold
  // bytes whose tombstones landed at the primary while it was detached — the seeding edge
  // DELIVERS a tombstone as data and executes nothing, so attaching first would boot a reader
  // that resolves the forgotten byte LIVE beside its own tombstone. The primary's surviving
  // tombstones are authoritative here (the container shares its operator), so the debt is swept at
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
  // THE PEN WRITES INTO THE POOL (SPEC §23.3 × §24.7). A write-enabled renderer signs its form-submits
  // as a per-renderer granted author whose SEED lives in config, and the pool was opened without that
  // config — so a quarantined app's every write refused "this renderer's pen is not provisioned", and a
  // probationary app could only ever paint a frozen preview. The pool already holds the operator's own
  // seed, which is strictly stronger custody than any pen, so carrying the pens across adds no key the
  // pool did not have. Authorization is NOT loosened either, and the door is where that is enforced:
  // the pen's grant reaches the pool as data, but a seeded copy is frozen until someone re-pulses the
  // edge, so `writeRouteImpl` asks the ROOT store's live word through `attachedTo` before it signs —
  // the same call mounts.ts makes about §12 publicness, for the same reason (a revocation must
  // arrive). The pens travel only into an UNTRUSTED pool: that is the container the frame exists for,
  // and it leaves a curated container and a §39 inbox pool — which build authority in their OWN
  // ground on purpose — exactly as they were.
  const probationary = spec.trust === "untrusted";
  const pool = await Gateway.open(backend, {
    seed: gw.options.seed,
    ...(probationary && gw.options.pens !== undefined ? { pens: gw.options.pens } : {}),
  });
  pool.attachedTo = gw;
  // A probationary pool KNOWS it is one, for the renderer door's sequestered frame (SPEC §24.7).
  if (probationary) {
    pool.probation = spec.entity === undefined ? {} : { container: spec.entity };
  }
  // THE §24.5 RESOURCE ENVELOPE — the operator's second undelegatable power (the first is erasure
  // reach, §24.8). A child may admit deltas its parent does not trust, and what keeps that safe to
  // HOST is that the operator can still cap the bill.
  //
  // THE CEILING RIDES EVERY SEPARATE CONTAINER, enveloped or not, and the reason is a strike. A
  // container's ground is a one-way seeded COPY, re-pulsed only on reseed — so a declaration that
  // crossed the edge and was later STRUCK on the parent stays live in the copy (H1: the strike does
  // not follow it). A pool opened INSIDE that container resolves against the copy. So the ceiling
  // below is resolved from the OPENER's live reactor and composed downward: every descendant is
  // bounded by what the operator's ground says right now, however stale the ground it sits on.
  // Nothing below the operator can widen; it can only tighten.
  pool.poolHandle = spec.entity ?? `anonymous#${(gw.anonymousPoolsOpened += 1)}`;
  // The ground is the ROOT's, passed down unchanged: a container's own reactor is a seeded copy, and
  // resolving a descendant's ceiling from it would read a declaration the operator struck after the
  // seeding as still live — at the report AND at the gate, so the two would agree on the wrong
  // answer and no single-sided assertion could see it.
  const ground =
    gw.envelopeGround ??
    ((subject?: string): QuarantineEnvelope =>
      resolveEnvelope(gw.reactor, gw.operatorAuthor, subject));
  pool.envelopeGround = ground;
  const ownEnvelope = (): QuarantineEnvelope => ground(spec.entity);
  const outerCeiling = gw.envelopeCeiling;
  const ceiling = outerCeiling === undefined ? ownEnvelope : clampedTo(ownEnvelope, outerCeiling);
  pool.envelopeCeiling = ceiling;
  // ENFORCEMENT attaches to an UNTRUSTED container, and to EVERYTHING BELOW ONE. A curated container
  // opened directly on the primary keeps the store's ordinary door budgets — the argument for
  // metering a child is that it admits what its parent does not trust. But a curated container opened
  // INSIDE a pool is still inside the pool: its `trust` knob is read from the pool's seeded copy of
  // the container table, where a strike on the parent never lands, so letting that knob decide
  // metering would let a metered pool host an unmetered child at the operator's expense. Once you are
  // below an untrusted container, you are metered.
  if (spec.trust === "untrusted" || gw.envelope !== undefined) {
    pool.envelope = newPoolEnvelope(pool.poolHandle, spec.entity, ceiling);
  }
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
  // The members are the scope's dset PLUS its negation closure (§28.4). A scope may narrow what the
  // container sees; it may never resurrect what was struck — `negated` ranging over the operand set
  // means a claim admitted without its retraction reads as live inside.
  //
  // BOTH KNOBS OWE THIS, and the predicate is the one that looks exempt: it is applied per delta, so
  // there seems to be nothing to close over. There is — a predicate selects DOMAIN facts, and a
  // negation carries only a `negates` pointer (no entity, no context), so a hand-picked subset can
  // never match one. The closure runs over the offer the predicate was about to filter, which keeps
  // it forward-only and costs no extra pass over the ground.
  const memberAdmit = (offer: readonly Delta[]): ((d: Delta) => boolean) | undefined => {
    if (spec.membership === undefined && base === undefined) return undefined;
    const selected =
      spec.membership !== undefined ? gw.select(spec.membership) : offer.filter((d) => base!(d));
    const members = new Set(withNegationClosure(gw, selected).map((d) => d.id));
    return (d) => members.has(d.id);
  };
  const reseed = (): Promise<FederationReport> => {
    const offer = gw.offeredDeltas();
    const admit = memberAdmit(offer);
    return pool.federate(
      offer,
      // A scope narrows what the container SEES, never what it must FORGET (§24.8): the operator's
      // tombstones pass the seeding edge unconditionally, membership and predicate alike.
      admit === undefined ? {} : { admit: (d) => isTombstone(d.claims) || admit(d) },
    );
  };
  await reseed(); // one-way INBOUND seeding; the reverse leg is never wired
  // Bind the operator's federated schemas so the container RESOLVES the seeded ground — a dry-run
  // reads a living lens, not raw deltas. (Foreign law stays inert until promoted.)
  pool.replayRegistrations();
  await pool.preloadResolvers();
  gw.quarantinePools.add(pool);

  const unregister = (): void => {
    gw.quarantinePools.delete(pool);
    if (spec.entity !== undefined) gw.attachedContainers.delete(spec.entity);
    // The back-pointer goes with the attachment. A detached pool is nobody's replica, and a stale
    // host would be a live handle into a store this one no longer reaches.
    pool.attachedTo = undefined;
  };

  if (spec.entity !== undefined) {
    gw.attachedContainers.set(spec.entity, pool);
    // Reattach settles the LISTING: negate EVERY surviving detach record for this entity, in ONE
    // batch — append validates and lands a batch whole, so two records clear together or not at
    // all (H4: one negation must not leave the container half-listed). After the attach
    // succeeded, never before: a refused attach must leave the records standing. And if the
    // batch itself cannot land, the attach ROLLS BACK — the alternative is an attached pool the
    // caller holds no handle to, listed as detached while it is not.
    const table = readContainerTable(gw.reactor, gw.operatorAuthor);
    const records = table.detached.get(spec.entity) ?? [];
    if (records.length > 0) {
      const strikes = records.map((r) =>
        signClaims(retractionOf(r.id, gw.operatorAuthor!, gw.nextTimestamp()), gw.options.seed!),
      );
      try {
        await gw.append(strikes);
      } catch (err) {
        unregister();
        await pool.close();
        throw new Error(
          `${voice}: the reattach could not clear the detach record(s), so the attach was ` +
            `rolled back — the listing never half-clears (H4). ` +
            `${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }
  }

  return {
    ...(spec.entity !== undefined ? { entity: spec.entity } : {}),
    trust: spec.trust,
    posture: "separate",
    gateway: pool,
    members: () => [...pool.reactor.snapshot()],
    reseed,
    // Drop DISCARDS — at the bytes, on every backend (T72). Purge everything the container can NAME,
    // then VERIFY at the bytes (holds — a purge's count is evidence, never the verdict, T70),
    // and on any survivor REFUSE while leaving it attached: a store that cannot prove
    // discard stays inside the erasure fan-out rather than slipping out of it.
    drop: async () => {
      // Nested stores sweep sequentially, so a later refusal arrives over an already-swept
      // prefix. The refusal must say so — a report claiming an intact tree over a partially
      // emptied one is a report that can be false — and it must not offer detach()-to-keep
      // when part of what would be "kept" is already gone.
      const emptied: string[] = [];
      const refuse = (why: string, cause?: unknown): never => {
        const forward =
          emptied.length === 0
            ? `The pool remains ATTACHED (still in erasure reach); resolve the store ` +
              `fault and drop again, or detach() to keep it deliberately.`
            : `The tree remains ATTACHED (still in erasure reach), but ${emptied.length} nested ` +
              `store(s) were already emptied before the fault: ${emptied.join(", ")}. ` +
              `detach() would keep only what the sweep left, so resolve the store fault and ` +
              `drop again — the session reactors still name every purged id, and the re-run ` +
              `completes the discard.`;
        throw new Error(
          `drop refused: ${why} — a dropped pool must not become bytes outside the erasure ` +
            `fan-out. ${forward}`,
          cause === undefined ? undefined : { cause },
        );
      };
      // One store's discard, proven at the bytes. The dead set is everything the pool can NAME —
      // and a read alone cannot name it all (a mirror's `deltasSince` is primary-only, and a RETRY
      // after a partial purge reads EMPTY): the session reactor remembers what the read cannot,
      // so the enumeration is their union; and the §25 quarantine pen — rows a read SET ASIDE
      // as corrupt, still legible bytes on disk — is swept by its own door, since no id-keyed
      // purge can reach a row whose id was never returned.
      const discardBytes = async (target: Gateway, who: string): Promise<void> => {
        const ids = new Set((await target.backend.deltasSince(new Set())).map((d) => d.id));
        for (const d of target.reactor.snapshot()) ids.add(d.id);
        if (isRepairable(target.backend)) {
          for (const row of await target.backend.quarantine()) {
            await target.backend.discardRow(row.key);
            // A pen key is the row's id where the driver knows one (sqlite) — feed it to the
            // byte verdict below too; discardRow's boolean is evidence, never the verdict (H7).
            ids.add(row.key);
          }
        }
        if (ids.size > 0) {
          const batch = [...ids];
          await target.backend.purge(batch);
          // The verdict, H9-closed: a probe that cannot answer has proven nothing, so a
          // rejecting store refuses the drop exactly like a retaining one.
          let survivors: Set<string>;
          if (target.backend.heldAmong) {
            survivors = await target.backend.heldAmong(batch);
          } else {
            survivors = new Set<string>();
            for (const id of batch) if (await target.backend.holds(id)) survivors.add(id);
          }
          if (survivors.size > 0) {
            refuse(
              `${who}'s store still holds ${survivors.size} of ${batch.length} delta(s) ` +
                `after the discard purge`,
            );
          }
        }
        // The pen's own byte verdict: quarantine() recomputes only when a read walks the origin,
        // so walk it again and ask — a discardRow that returned true while removing nothing
        // (or a storage-keyed row the id probe cannot see) must refuse here, not read as clean.
        if (isRepairable(target.backend)) {
          await target.backend.deltasSince(new Set());
          const pen = await target.backend.quarantine();
          if (pen.length > 0) {
            refuse(`${who}'s §25 pen still holds ${pen.length} set-aside row(s) after the sweep`);
          }
        }
      };
      // The subtree, in the SAME walk the §24.5 envelope report runs (`poolsBeneath` — one
      // traversal, two consumers, so what a report can bill a drop can always reach). Collected
      // before anything is purged: a pool attached mid-drop is outside this order's jurisdiction.
      const beneath = [...poolsBeneath(pool, `${pool.poolHandle ?? "?"}/`)];
      try {
        for (const { pool: nested, handle } of beneath) {
          await discardBytes(nested, `the nested pool "${handle}"`);
          emptied.push(`"${handle}"`);
        }
        await discardBytes(pool, "this pool");
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
      // The whole subtree closes with the drop, deepest first: a nested pool proven empty must
      // not survive as a live handle on a discarded store.
      for (const { pool: nested } of [...beneath].reverse()) {
        nested.attachedTo = undefined;
        await nested.close();
      }
      await pool.close();
      // A NAMED container proven empty strikes its own declaration: leaving it standing would turn
      // every future erase into a completeness refusal over a store that provably ceased. Last of
      // all, and wrapped — at this point the BYTES are settled, so a failure here is a LISTING
      // fault, and the caller must be told exactly what state they hold rather than handed a raw
      // append error that claims nothing.
      if (spec.entity !== undefined) {
        try {
          for (const id of survivingDeclarationIds(gw.reactor, gw.operatorAuthor!, spec.entity)) {
            await gw.append([
              signClaims(
                retractionOf(id, gw.operatorAuthor!, gw.nextTimestamp()),
                gw.options.seed!,
              ),
            ]);
          }
        } catch (err) {
          throw new Error(
            `drop discarded "${spec.entity}" at the bytes — every store in its subtree is ` +
              `proven empty and closed — but the declaration could not be struck, so the ` +
              `LISTING still names it. When the primary recovers, openContainer({ name }) and ` +
              `drop() again to settle the listing; the re-run is safe over the empty store. ` +
              `${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
      }
    },
    // Detach KEEPS — the deliberate act, distinct in name from the discard. No purge, no
    // verification: the caller is choosing to hold these bytes outside the fan-out, and
    // reattachment is openContainer over the surviving store. A NAMED container lands the
    // at-rest record FIRST (T72's named deferral, fulfilled): if the record cannot land, the
    // container stays attached — the erasure guard must never lose sight of bytes it was promised.
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

// --- the connection binding (SPEC §39: a connection binds to a container) ------------------------

export interface BindConnectionOptions {
  /** The parent container this connection is bound to. Its gather composes the inbox pool. */
  readonly container: string;
  /** The connection's actor public key — provably the owner's, signs every connection write. */
  readonly connectionKey: string;
  /** The owner's signing seed (their §36 session in the real flow). Authors the connection grant. */
  readonly ownerSeed: string;
  /** The inbox pool's own store. Defaults to a fresh in-memory backend. */
  readonly backend?: StoreBackend;
}

// The inbox's deterministic name from (parent, connection key). A second bind of the same pair
// resumes the SAME inbox rather than spawning a new one — the inbox is durable (decision 3).
export function inboxName(container: string, connectionKey: string): string {
  return `inbox:${container}:${connectionKey}`;
}

// The pool a BOUND request writes into (SPEC §58): the live handle for the binding's inbox. Fail
// CLOSED on every miss — an unattached pool (no backend factory, bytes missing at boot, dropped) and
// a pool mid-drop (unregistered, its handle not yet cleared) both refuse. There is no fallback to
// this store: a connection's write landing in the primary is exactly the leak the binding closes.
export function poolForBindingImpl(gw: Gateway, binding: ConnectionBinding): Gateway {
  // THE CONTAINER FIRST. A pool outlives the container it was bound under: dropping a shared
  // container strikes its declaration and leaves the inbox declared and attached. Without this
  // the write lands durably in the pool and the read that follows it refuses by name, so the door
  // answers 200 with an error over a delta that is really there — and every retry mints another.
  // Refuse before anything is signed; the connection is bound nowhere until it consents again.
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  if (!table.containers.has(binding.container)) {
    throw new Error(
      `the container ${binding.container} this connection is bound to no longer stands, so this ` +
        `write is refused — it would land where nothing can read it. Consent again and choose a ` +
        `container that stands.`,
    );
  }
  const held = gw.connectionInboxes.get(binding.inbox);
  if (held?.gateway === undefined) {
    throw new Error(
      `the inbox ${binding.inbox} is not attached here, so this write is refused — the ` +
        `connection's pool is where its writes land, and nothing stands in for it. Consent ` +
        `again to bind the connection to a pool this store holds.`,
    );
  }
  if (gw.attachedContainers.get(binding.inbox) !== held.gateway) {
    throw new Error(
      `the inbox ${binding.inbox} is being dropped, so this write is refused — write again ` +
        `once the drop has settled, or consent again to bind afresh`,
    );
  }
  return held.gateway;
}

// The surviving WRITE grant ids naming `subject` at this pool's store entity — what a revocation
// strikes. "Surviving" is no standing negation; effectiveness is grantHeld's concern, not this.
//
// NAMED GAP: this is narrower than the verb vocabulary. A `register` grant naming the same subject
// would survive an unbind. Nothing mints one for a connection key today — register standing is
// handed to OAuth connector actors, and `loam grant revoke` strikes every verb — so the gap is not
// reachable now. It becomes reachable the moment a connection key is granted `register`.
function survivingWriteGrantIds(reactor: Reactor, subject: string): string[] {
  const out: string[] = [];
  for (const id of reactor.byTarget(STORE_ENTITY)) {
    const delta = reactor.get(id);
    if (delta === undefined) continue;
    const ptrs = delta.claims.pointers;
    const atGrants = ptrs.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === STORE_ENTITY &&
        p.target.entity.context === CTX_GRANTS,
    );
    if (!atGrants) continue;
    let subj: string | undefined;
    let verb: string | undefined;
    for (const p of ptrs) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string") subj = p.target.value;
      if (p.role === "verb" && typeof p.target.value === "string") verb = p.target.value;
    }
    if (subj !== subject || verb !== "write") continue;
    if (reactor.negationsOf(id).some((n) => reactor.get(n) !== undefined)) continue; // already struck
    out.push(id);
  }
  return out;
}

// Spawn (or resume) a per-connection inbox pool for `container` and provision its authority chain.
// The pool is a SEPARATE container marked `inboxOf: container`, so its members compose into the
// parent's gather (containerScopeImpl). Its seeding scope selects only this connection's own deltas,
// so it starts clean and only connection writes land in it. Idempotent on (container, connectionKey):
// a live handle resumes untouched, and a re-open never double-grants (holdsGrant guards both grants).
export async function bindConnectionImpl(
  gw: Gateway,
  opts: BindConnectionOptions,
): Promise<Container> {
  if (gw.options.seed === undefined) {
    throw new Error(
      "bindConnection: only an operated store can bind a connection to a container (§39)",
    );
  }
  const operatorSeed = gw.options.seed;
  const operator = gw.operatorAuthor!;
  const owner = authorForSeed(opts.ownerSeed);
  const name = inboxName(opts.container, opts.connectionKey);

  // Durable (decision 3): a live handle for a STANDING declaration resumes — its grant chain is
  // re-verified below, idempotently, so a pool re-attached at boot is provisioned exactly like one
  // this process spawned. The handle's own drop is the one place a handle is cleared, and it clears
  // only once the pool is unregistered, so a held handle is always a standing declaration; the
  // table is still consulted, defensively, so a struck name can never be resumed from a handle.
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const declared = table.containers.has(name);
  const held = declared ? gw.connectionInboxes.get(name) : undefined;
  // A drop unregisters the pool before its declaration is struck and its handle cleared; in that
  // window the handle stands over a closed pool. Binding must not answer with it.
  if (held !== undefined && gw.attachedContainers.get(name) !== held.gateway) {
    throw new Error(
      `bindConnection: the inbox ${name} is being dropped — bind again once the drop has settled`,
    );
  }
  const live = held;
  if (!declared) {
    // The inbox seeds only THIS connection's deltas, and only those written AFTER the binding
    // (SPEC §58 criterion 8): a delta the key authored elsewhere before it was bound here — under
    // a pre-§58 store-wide grant, say — is not this pool's, at the bytes. The clock is wall time
    // with a monotonic bump on both gateways, so a write through the pool always lands later
    // than its own declaration. A connection is provably the owner's, so the pool is the owner's
    // trust domain (curated), separate storage.
    const boundAt = gw.nextTimestamp();
    const membership = {
      op: "select",
      pred: {
        and: [
          { match: { field: "author", cmp: "eq", const: opts.connectionKey } },
          { match: { field: "timestamp", cmp: "gt", const: boundAt } },
        ],
      },
      in: "input",
    };
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: name,
            trust: "curated",
            posture: "separate",
            membership,
            inboxOf: opts.container,
          },
          operator,
          gw.nextTimestamp(),
        ),
        operatorSeed,
      ),
    ]);
  }

  // Durability is the store's choice, not the connection's (the channel pools' rule, §46): a store
  // with a pool backend factory keeps the inbox on disk, so a binding outlives the process that
  // made it and `resumeInboxes` re-attaches it at the next boot.
  const backend = opts.backend ?? gw.options.channelBackend?.(name);
  const inbox =
    live ??
    (await openContainerImpl(gw, {
      name,
      ...(backend !== undefined ? { backend } : {}),
    }));
  const pool = inbox.gateway!;

  // The grant chain, in the pool's OWN ground (decision 2): the operator authors the owner's ADMIN
  // grant, then the OWNER authors the connection's WRITE grant. The pool is its own gateway with its
  // own store entity, so this never touches the real store's authority; grantHeld resolves
  // connection-write → owner-admin → operator. The store operator appears once here (administrative
  // provisioning, §39.1 point 3) and never on the read/write data path.
  if (!holdsGrant(pool.reactor, STORE_ENTITY, owner, "admin", operator)) {
    await pool.append([
      signClaims(
        grantClaims(STORE_ENTITY, owner, "admin", operator, pool.nextTimestamp()),
        operatorSeed,
      ),
    ]);
  }
  if (!holdsGrant(pool.reactor, STORE_ENTITY, opts.connectionKey, "write", operator)) {
    await pool.append([
      signClaims(
        grantClaims(STORE_ENTITY, opts.connectionKey, "write", owner, pool.nextTimestamp()),
        opts.ownerSeed,
      ),
    ]);
  }

  if (live !== undefined) return live;
  const handle = inboxHandle(gw, name, inbox);
  gw.connectionInboxes.set(name, handle);
  return handle;
}

// The ONE kind of handle an inbox pool is held by, whether this process spawned it or re-attached
// it at boot. An inbox is DURABLE (§39 decision 3): the connection lifecycle is bind / revoke /
// drop, never detach. Detach is the KEEP path — it marks the pool inactive WITHOUT striking its
// declaration or purging its bytes, so a strike a connection wrote into its inbox would silently
// stop being gathered and a primary-ground claim it retracted would resolve LIVE again. That
// asymmetric un-suppression has no place in the lifecycle, so the handle refuses detach and names
// the two operations that DO belong: drop() for a total forget, revokeConnection to refuse further
// writes while keeping the record.
//
// Drop ends the live binding — clear the durable handle so a later bind spawns fresh rather than
// resuming a purged pool. The delete runs in a `finally`, but ONLY once the pool is unregistered:
// a drop the store REFUSES (bytes that survive the purge) throws before unregistering, and the pool
// then stands exactly as before — attached, declared, its grant live — so its handle must stand
// too, or the binding is stranded on every door (no revoke, no re-bind, no second drop) until a
// restart. After a real purge, even if the declaration-strike append fails, the stale handle must
// not survive to be resumed.
function inboxHandle(gw: Gateway, name: string, inbox: Container): Container {
  const baseDrop = inbox.drop.bind(inbox);
  return {
    ...inbox,
    drop: async () => {
      try {
        await baseDrop();
      } finally {
        if (!gw.attachedContainers.has(name)) gw.connectionInboxes.delete(name);
      }
    },
    detach: () =>
      Promise.reject(
        new Error(
          `an inbox is durable (§39): it does not detach. Use drop() for a total forget, or ` +
            `revokeConnection to refuse further writes while keeping the connection's record.`,
        ),
      ),
  };
}

// Attach every declared inbox pool at boot (SPEC §58): a binding made by one process is readable by
// the next. The pool's grant chain lives in its own ground, so re-attaching needs no seed — only
// the store's pool backend factory, which is where the bytes went. Idempotent, and failure-tolerant
// per pool, exactly like `resumeChannels`: a pool whose bytes are missing must not stop the store
// from booting, and a read of it meets containerScope's refusal by name, which is the honest answer.
export async function resumeInboxesImpl(gw: Gateway): Promise<void> {
  if (gw.operatorAuthor === undefined) return;
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  for (const [name, rec] of table.containers) {
    if (rec.inboxOf === undefined || !name.startsWith("inbox:")) continue;
    if (gw.connectionInboxes.has(name) || table.detached.has(name)) continue;
    // No factory, no bytes: an EMPTY in-memory pool would answer as if the connection wrote
    // nothing (H9), so the pool is left unattached and a read of it refuses by name instead.
    const backend = gw.options.channelBackend?.(name);
    if (backend === undefined) continue;
    try {
      const handle = await openContainerImpl(gw, { name, backend });
      gw.connectionInboxes.set(name, inboxHandle(gw, name, handle));
    } catch {
      continue; // left unattached, deliberately; see above
    }
  }
}

// Revoke a connection: strike its WRITE grant in the inbox pool, owner-authored (§39.3c). The door
// then refuses new writes signed by that key; past deltas keep their author and stay readable, and
// other connections are untouched — one-connection blast radius, two-sided by construction.
export async function revokeConnectionImpl(opts: {
  inbox: Container;
  connectionKey: string;
  ownerSeed: string;
}): Promise<void> {
  const pool = opts.inbox.gateway;
  if (pool === undefined) {
    throw new Error("revokeConnection: the inbox has no pool of its own — nothing to revoke (§39)");
  }
  const owner = authorForSeed(opts.ownerSeed);
  const grantIds = survivingWriteGrantIds(pool.reactor, opts.connectionKey);
  if (grantIds.length === 0) {
    throw new Error(
      `revokeConnection: no surviving write grant names ${opts.connectionKey} in this inbox`,
    );
  }
  await pool.append(
    grantIds.map((id) =>
      signClaims(revocationClaims(id, owner, pool.nextTimestamp()), opts.ownerSeed),
    ),
  );
}

// --- the erase completeness guard (SPEC §24.8 × the mint) ----------------------------------------

// The mint makes containers enumerable AT REST, and erase fans out over the ATTACHED set — after
// a restart those can differ. The honest rule: erase refuses to report completeness while the
// resolved table names a SEPARATE-posture container — untrusted OR curated, since bytes follow
// posture — that is neither currently attached nor covered by a surviving detach record. An
// unreachable store is a named fault, never a silent gap; a covered one is listed as deliberately
// kept. (The full locator machinery rides T78's mounts; this is the rule, shipped with the mint.)
export function unreachableStoreReport(gw: Gateway): {
  faults: string[];
  kept: string[];
  /** The FAULT containers by entity name. `faults` carries sentences; a reader that must name a TIER
   *  needs the name, and deriving one by parsing a refusal message is how a report goes stale. */
  faultEntities: string[];
} {
  const table = readContainerTable(gw.reactor, gw.operatorAuthor);
  const faults: string[] = [];
  const kept: string[] = [];
  const faultEntities: string[] = [];
  // §28.4's knobs must not flip through the survival algebra either (the erasure lens's
  // finding): strike the earliest declaration while a federated flip survives, and the binding
  // posture would change separate→shared with the bytes still on disk — dissolving this
  // guard through a door no validator watches. So the guard remembers: an entity still ALIVE in
  // the table whose lineage holds a STRUCK separate declaration is treated as separate. Forgetting
  // the container WHOLE (striking every declaration) still ends the entity and clears the guard —
  // that is the honest forget, unchanged.
  //
  // The struck posture is read through `asPosture`, so a RETIRED word counts. The §20 rename step
  // re-signs only SURVIVING law, which means a struck declaration keeps its legacy bytes forever;
  // matching the current word alone would have quietly retired this guard for every store that
  // predates the rename, and a guard that stops firing reports completeness it never proved (H7).
  const struckSeparate = new Set<string>();
  if (gw.operatorAuthor !== undefined) {
    const negated = lawfulNegated(gw.reactor, gw.operatorAuthor);
    for (const delta of lawfulSnapshot(gw.reactor, gw.operatorAuthor)) {
      if (!negated(delta.id)) continue;
      const name = containerRef(delta.claims, CTX_CONTAINER);
      if (name !== undefined && asPosture(primitives(delta.claims, "posture")[0]) === "separate") {
        struckSeparate.add(name);
      }
    }
  }
  for (const [entity, rec] of table.containers) {
    if (rec.posture !== "separate" && !struckSeparate.has(entity)) continue;
    const attached = gw.attachedContainers.get(entity);
    if (attached !== undefined && gw.quarantinePools.has(attached)) continue;
    if (table.detached.has(entity)) {
      kept.push(entity);
      continue;
    }
    faultEntities.push(entity);
    faults.push(
      rec.posture === "separate"
        ? `the declared separate container "${entity}" is neither attached nor covered by a detach ` +
            `record — its store may hold bytes outside this sweep. Attach it (openContainer) and ` +
            `re-run, or detach() it on the record to keep it deliberately.`
        : `container "${entity}" resolves posture "${rec.posture}", but a struck declaration in ` +
            `its lineage gave it a store of its OWN — which may still hold bytes outside this ` +
            `sweep (§28.4: the knobs do not flip through the survival algebra). Cover it with a ` +
            `detach record, or forget the container whole and declare a new name.`,
    );
  }
  // A surviving detach record whose declaration is gone is a store mid-forget: still parked at
  // the operator's own say-so, so it is reported kept rather than silently absent.
  for (const entity of table.detached.keys()) {
    if (!table.containers.has(entity) && !kept.includes(entity)) kept.push(entity);
  }
  faults.sort();
  kept.sort();
  faultEntities.sort();
  return { faults, kept, faultEntities };
}
