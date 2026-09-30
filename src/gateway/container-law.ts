// The container table's law: the vocabulary, the claims, and the pure readers over a reactor.
// Nothing here opens, attaches or reaches a pool; that is `container.ts`. Kept free of the gateway
// so every reader of the table can import it without joining the gateway's import cycle.

import { parseTerm, type Claims, type Delta, type Reactor } from "@bombadil/rhizomatic";
import { CTX_GRANTS } from "./governed-trust.js";
import { grantSubjects, honoredStrikeOn } from "./grants-law.js";
import { STORE_ENTITY } from "./genesis.js";
import {
  canonicalLeewayJson,
  parseLeeway,
  SEALED_LEEWAY,
  type Leeway,
  leewayFits,
  smallerEnvelope,
  type Terms,
  isSealed,
} from "./leeway.js";
import { lawfulDeltasAt, lawfulHistoryAt, lawfulSnapshot } from "./registration.js";
import { negatedAt } from "./negation.js";
import { readTrustPolicyAt, type TrustPolicy } from "./trust.js";
import { subjectKeyAt, USER_PREFIX } from "./user-root.js";
import { membershipForValidation } from "./member-of.js";

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
   * makes an inbox declaration shape-distinguishable from a plain one.
   */
  readonly inboxOf?: string;
  /**
   * What this container may do and what it allows beneath it (SPEC §58, position 4), inlined as
   * canonical JSON under role `leeway`. Absent means SEALED — every switch off — so a declaration
   * without one reads as the private journal.
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
    validFrom: timestamp,
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
    validFrom: timestamp,
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
    validFrom: timestamp,
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
    validFrom: timestamp,
    author,
    pointers: [primPtr("term", JSON.stringify(term))],
  };
}

// --- the door validator (wired into authorize beside trustDefect and its kin) ------------------

export const containerRef = (claims: Claims, context: string): string | undefined => {
  const p = claims.pointers.find(
    (x) =>
      x.role === "container" && x.target.kind === "entity" && x.target.entity.context === context,
  );
  return p?.target.kind === "entity" ? p.target.entity.id : undefined;
};

export const primitives = (claims: Claims, role: string): (string | number | boolean)[] =>
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
  now: number,
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
      parseTerm(membershipForValidation(JSON.parse(memberships[0])));
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
    // THE ONE RULE, WEIGHED WHERE A LEEWAY IS DECLARED (SPEC §58 position 4): a child's leeway —
    // its switches, its envelope, its own delegate — must fit inside the terms its parent
    // delegates, and the parent's own switches never enter the comparison. Weighed here, in the
    // one validator every append runs through the trust policy, so every road reads one rule and
    // the refusal names the ceiling. A child with nothing declared above it is free: the person
    // sets the top, and no subtree exceeds what they set there.
    // The person's HOME — a name with no colon — is the top the person sets, not a room with
    // terms: consent never binds it, and what a person declares directly under it IS what they
    // set at the top. Fit is weighed against a parent below the first colon.
    const parent = name.includes(":") ? name.slice(0, name.lastIndexOf(":")) : undefined;
    if (parent !== undefined && parent.includes(":")) {
      const governing = governingLeeway(readContainerTable(reactor, now, operator), parent);
      // A child that declares SEALED asks for nothing anyone could exceed: admitted under any
      // terms, since the read narrows and never widens, and a room may name its annex closed.
      if (governing !== undefined && !isSealed(read.leeway)) {
        const refusal = leewayFits(read.leeway, governing.leeway);
        if (refusal !== undefined) {
          return `a container's leeway does not fit the terms ${governing.at} delegates: ${refusal.why}`;
        }
      }
    }
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
  const table = readContainerTable(reactor, now, operator);
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
   * The leeway this container DECLARES (SPEC §58). NEVER optional and never undefined: a container
   * that declared none, and one whose declaration did not parse or was ambiguous, all read
   * `SEALED_LEEWAY`. A reader cannot forget to default, and there is no `undefined` here for
   * anyone to read as permission.
   *
   * IT IS WHAT THE CONTAINER ASKED FOR, not what it has. The one rule is weighed twice, and
   * neither reading is here: `containerDefect` refuses a declaration that does not fit the terms
   * above it, and `governingLeeway` narrows what stands by those terms at every depth. Ask it
   * for the leeway in force; this field is the ask.
   */
  readonly leeway: Leeway;
  /**
   * Whether this container's LATEST declaration carried a leeway pointer at all, however it
   * parsed. A container that spoke, even badly, reads sealed and that sealing binds; one whose
   * latest declaration did not speak is a pure namespace, and a road that walks the tree for the
   * governing leeway climbs past it (SPEC §58 position 4: an undeclared child inherits). Latest
   * wins per declaration, so a road that re-declares a standing container must carry the pointer
   * it found, or it deletes it. `leeway` alone cannot tell the two apart.
   */
  readonly leewayDeclared: boolean;
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
//
// THE TABLE IS ALSO A FUNCTION OF THE READ TIME. A declaration, exclusion or strike counts only
// inside its own [validFrom, validUntil), so a boundary moves the table with nothing written. The
// sweep keeps every validity boundary of container law, and a built table answers only for reads
// inside the interval between the boundaries around the time it was built.
interface TableMemo {
  readonly operator: string | undefined;
  swept: number; // arrival-log high-water mark
  lawCount: number; // container-law deltas in log[0, swept)
  builtAt: number; // the lawCount the table was computed from
  readonly bounds: number[]; // every validFrom and validUntil of container law in log[0, swept)
  from: number; // the table holds for a read time in [from, until)
  until: number;
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

export function readContainerTable(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): ContainerTable {
  let memo = tableMemo.get(reactor);
  if (memo === undefined || memo.operator !== operator) {
    memo = {
      operator,
      swept: 0,
      lawCount: 0,
      builtAt: -1,
      bounds: [],
      from: Infinity,
      until: -Infinity,
      table: EMPTY_TABLE,
    };
    tableMemo.set(reactor, memo);
  }
  const log = reactor.arrivalLog();
  for (; memo.swept < log.length; memo.swept += 1) {
    const d = log[memo.swept]!;
    if (!isContainerLaw(d, operator)) continue;
    memo.lawCount += 1;
    memo.bounds.push(d.claims.validFrom);
    if (d.claims.validUntil !== undefined) memo.bounds.push(d.claims.validUntil);
  }
  if (memo.builtAt !== memo.lawCount || now < memo.from || now >= memo.until) {
    memo.table = computeContainerTable(reactor, now, operator);
    memo.builtAt = memo.lawCount;
    memo.from = -Infinity;
    memo.until = Infinity;
    for (const b of memo.bounds) {
      if (b <= now) memo.from = Math.max(memo.from, b);
      else memo.until = Math.min(memo.until, b);
    }
  }
  return memo.table;
}

const EMPTY_TABLE: ContainerTable = {
  containers: new Map(),
  excluded: new Set(),
  detached: new Map(),
  defects: [],
};

function computeContainerTable(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): ContainerTable {
  if (operator === undefined) return EMPTY_TABLE;
  const negated = negatedAt(reactor, now, operator);
  const decls = new Map<string, Decl[]>();
  const excluded = new Set<string>();
  const detached = new Map<string, DetachRecord[]>();
  const defects: string[] = [];

  for (const delta of lawfulSnapshot(reactor, now, operator)) {
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
    const bound = boundContainer(claims);
    if (bound === undefined) continue; // malformed law binds nothing
    const { name, trust, posture } = bound;
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
        parseTerm(membershipForValidation(profile)); // validation only — consumers take the JSON profile, as select does
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
      leewayDeclared: declared.length > 0,
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
  now: number,
  operator: string | undefined,
  container: string,
): TrustPolicy {
  return readTrustPolicyAt(reactor, now, container, operator);
}

/**
 * What this delta declares, if it BINDS as a container — the name, and the two words the reader
 * normalizes. Absent when it declares nothing, or when it declares something malformed.
 *
 * THIS IS THE BIND TEST, AND IT IS NOT THE DOOR'S TEST. `containerDefect` weighs whether a NEW
 * declaration may be ADMITTED, against the state standing right now: it reads the leeway tree, so
 * a parent tightening its terms later can turn a declaration that was law when it was signed into
 * one the door would refuse today. That does not belong in the question "did this ever bind" — and
 * using the door's test for it was a licence to mint, because a name that answers "never declared"
 * is a name a walk will make again.
 *
 * So the table and `everDeclared` ask THIS, together. Two readers of one predicate cannot drift.
 */
function boundContainer(
  claims: Claims,
): { name: string; trust: string; posture: "shared" | "separate" } | undefined {
  // The two record kinds that are not declarations at all. The table `continue`s on each before it
  // looks for a declaration, so a delta carrying both is a detach or an exclusion and nothing else.
  if (containerRef(claims, CTX_CONTAINER_EXCLUDED) !== undefined) return undefined;
  if (containerRef(claims, CTX_CONTAINER_DETACHED) !== undefined) return undefined;
  const name = containerRef(claims, CTX_CONTAINER);
  if (name === undefined) return undefined;
  const trust = primitives(claims, "trust")[0];
  const posture = primitives(claims, "posture")[0];
  if (
    typeof trust !== "string" ||
    !TRUSTS.has(trust) ||
    typeof posture !== "string" ||
    !POSTURES.has(posture) ||
    (trust === "untrusted" && posture === "shared")
  ) {
    return undefined;
  }
  return { name, trust, posture: posture as ContainerPosture };
}

/** The declaration identity used by the container reader, excluding malformed and control rows. */
export function containerDeclarationName(claims: Claims): string | undefined {
  return boundContainer(claims)?.name;
}

/** Latest surviving declaration for one container, under the reader's own binding rules. */
export function currentContainerDeclarationId(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  entity: string,
): string | undefined {
  if (operator === undefined) return undefined;
  // Filed AT the container's entity, so the target index answers it (H8); `lawfulDeltasAt` already
  // keeps only the operator's deltas and carries no negation closure, so the strike filter is here.
  const negated = negatedAt(reactor, now, operator);
  return lawfulDeltasAt(reactor, now, { entity, context: CTX_CONTAINER }, operator)
    .filter((delta) => !negated(delta.id) && containerDeclarationName(delta.claims) === entity)
    .sort((a, b) => b.claims.timestamp - a.claims.timestamp || b.id.localeCompare(a.id))[0]?.id;
}

// The surviving lawful declaration ids for one entity — what a strike-the-declaration act negates.
export function survivingDeclarationIds(
  reactor: Reactor,
  now: number,
  operator: string,
  entity: string,
): string[] {
  // Filed AT the container's entity, so the target index answers it — the same H8 rule as
  // `everDeclared` below, on the road that drops a container. `lawfulDeltasAt` carries no negation
  // closure of its own, so the strike filter stays here.
  const negated = negatedAt(reactor, now, operator);
  return lawfulDeltasAt(reactor, now, { entity, context: CTX_CONTAINER }, operator)
    .filter((delta) => !negated(delta.id))
    .filter((delta) => containerRef(delta.claims, CTX_CONTAINER) === entity)
    .map((delta) => delta.id);
}

/**
 * Was this name EVER declared — struck or standing?
 *
 * The container table answers "does it stand". A road that mints a missing level needs the other
 * question, because the two states look identical to it and mean opposite things: a name nobody
 * declared is one to create, and a name a person STRUCK is one they removed. Re-minting the second
 * restores every surviving descendant to the reader, which is the person's act undone by the party
 * it was aimed at.
 */
export function everDeclared(
  reactor: Reactor,
  operator: string | undefined,
  entity: string,
): boolean {
  // FAILS CLOSED, AND CLOSED HERE MEANS TRUE. A false ABSENCE is a licence to mint — it is what
  // lets a walk declare this name — so a store with no operator to weigh law by cannot be allowed
  // to answer "never declared". `readContainerTable` fails closed the other way, returning an
  // empty table, and the two directions agree: neither hands out a name it could not judge.
  if (operator === undefined) return true;
  // THE TARGETED LOOKUP, NOT A SCAN (H8). A declaration is filed AT the container's entity, so the
  // substrate's own target index answers this in the size of that one container's history rather
  // than the size of the store. The scanning form cost a full materialization of every delta, and
  // the walk that calls this calls it once per missing level — sixteen store-sized passes on one
  // request.
  //
  // NOT A DERIVED MEMO, and that distinction is the whole of H8's index trap here. A false ABSENCE
  // is a licence to mint: it is what lets the walk re-declare a name, so a stale index would hand
  // a dropped subtree back to its reader. `byTarget` is written by ingest beside the set it
  // indexes and replayed whole by an erase, so it cannot answer absent for a delta the store
  // holds; a Set maintained on this side could.
  // HISTORY, NOT THE PRESENT. A declaration whose validity has ended was still made, so it still
  // forbids a re-mint; this read never filters by validity.
  // WELL-FORMED ONLY. Malformed law binds nothing — `computeContainerTable` skips a declaration
  // whose trust or posture the law refuses — so a name that only ever carried one never stood, and
  // reporting it as dropped would refuse a road forever over a container nobody ever had.
  return lawfulHistoryAt(reactor, { entity, context: CTX_CONTAINER }, operator).some(
    (delta) => boundContainer(delta.claims)?.name === entity,
  );
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
/**
 * The leeway that GOVERNS `name`: the nearest container at or above it whose latest declaration
 * carried a leeway (SPEC §58 position 4: a container that declared none is a pure namespace and
 * inherits), walking no higher than `ceiling` when one is given. Undefined when nothing on the way
 * up declared one: the name is governed by no leeway at all, which every road reads as it always
 * has (a receive refuses; an envelope keeps the operator's ceiling alone).
 *
 * THE WALK CLIMBS BY NAME. Names are paths and the tree agrees with the names (position 5); a
 * declared `parent` edge that disagrees with a name is the pathology, not a road — followed, it
 * carried a container named under one binding out to another person's leeway, and a pool named
 * under a small container up to a large ancestor's size. The one edge honoured is a POOL's
 * `inboxOf`, taken once at the start: a pool's name (`inbox:…`, `channel:…`) does not spell its
 * place, and its host is the container it was opened into. A pool whose host is itself has no
 * place at all, and reads SEALED — the floor, never the operator's wider ceiling, so a name that
 * cannot be placed cannot widen anything.
 */
export function governingLeeway(
  table: ContainerTable,
  name: string,
  ceiling?: string,
): { readonly at: string; readonly leeway: Leeway } | undefined {
  // A pool is known by its leading token, as the spec names it, not by the presence of an
  // `inboxOf` record: an operator-signed `inboxOf` on an ordinary container is not a hop.
  const isPool = name.startsWith("inbox:") || name.startsWith("channel:");
  const host = isPool ? table.containers.get(name)?.inboxOf : undefined;
  if (host === name) return { at: name, leeway: SEALED_LEEWAY };
  const up = (at: string): string | undefined =>
    at.includes(":") ? at.slice(0, at.lastIndexOf(":")) : undefined;
  // The levels this name answers to, listed TOP DOWN. A ceiling stops the list lower; the
  // person's home — a name with no colon — is the top they set rather than a room with terms,
  // and is skipped below.
  const levels: string[] = [];
  for (let at: string | undefined = host ?? name; at !== undefined; at = up(at)) {
    levels.push(at);
    if (at === ceiling) break;
  }
  levels.reverse();

  // THE ONE RULE, READ — AND READ AT EVERY DEPTH. What a container declared is what it ASKED FOR;
  // what it HAS is that, narrowed by the terms IN FORCE at its own level: the terms its parent
  // delegates, themselves already narrowed by everything above. Each step down DESCENDS those
  // terms by one level (`"same"` holds them still, `"off"` seals), so a person who wrote terms
  // about grandchildren governs grandchildren. Narrowing by each ancestor's TOP level at every
  // depth did not: a parent tightened about its grandchildren left every grandchild untouched,
  // and a fresh one was weighed at declaration against its parent's stale written terms. The
  // narrowed `delegate` is what `leewayFits` reads, so the two halves of the rule agree.
  //
  // A container that declared no leeway inherits what is in force, exactly. Nothing here ever
  // widens what a child asked for.
  let at: string | undefined;
  let effective: Leeway | undefined;
  let inForce: Terms | undefined;
  for (const level of levels) {
    const declared = table.containers.get(level);
    const asked = declared?.leewayDeclared === true ? declared.leeway : effective;
    if (asked === undefined) continue; // nothing above here has spoken yet
    if (declared?.leewayDeclared === true) at = level;
    effective = inForce === undefined ? asked : narrowedBy(asked, inForce);
    // THE HOME IS THE TOP THE PERSON SETS, NOT A ROOM WITH TERMS. What it declares is inherited
    // by a subtree that declares nothing of its own, but it sets no terms, so a container the
    // person declared directly beneath it IS what they set at the top and is narrowed by nothing.
    inForce = !level.includes(":")
      ? undefined
      : effective.delegate === "off"
        ? sealedTerms(effective)
        : effective.delegate;
  }
  return effective === undefined || at === undefined ? undefined : { at, leeway: effective };
}

/** The terms a container that delegates NOTHING sets below it: its own switches, and no further. */
const sealedTerms = (leeway: Leeway): Terms => ({
  receive: leeway.receive,
  offer: leeway.offer,
  publish: leeway.publish,
  envelope: leeway.envelope,
  delegate: "off",
});

/**
 * A leeway narrowed by the terms in force at its level: each switch needs the term's leave, the
 * envelope is no larger, and what it may delegate is its own chain narrowed by the chain those
 * terms allow one level down.
 */
function narrowedBy(leeway: Leeway, terms: Terms): Leeway {
  const below = terms.delegate === "same" ? terms : terms.delegate;
  return {
    receive: leeway.receive && terms.receive,
    offer: leeway.offer && terms.offer,
    publish: leeway.publish && terms.publish,
    envelope: smallerEnvelope(leeway.envelope, terms.envelope),
    delegate:
      leeway.delegate === "off" || below === "off" ? "off" : narrowTerms(leeway.delegate, below),
  };
}

/**
 * Two chains of terms, narrowed into one: the switches need both sides' leave, the envelope is the
 * smaller, and the chains below are narrowed together.
 *
 * TERMINATION. `"off"` on either side ends it; `"same"` on BOTH ends it, since terms that carry
 * themselves down are their own fixed point. Otherwise at least one side descends into a strictly
 * shorter written chain each step, so the walk is bounded by the deeper of the two as written. The
 * depth guard below is belt for that brace, and it fails CLOSED.
 */
function narrowTerms(own: Terms, allowed: Terms, depth = 0): Terms {
  const mine = own.delegate === "same" ? own : own.delegate;
  const theirs = allowed.delegate === "same" ? allowed : allowed.delegate;
  const below: "off" | "same" | Terms =
    mine === "off" || theirs === "off" || depth >= 32
      ? "off"
      : own.delegate === "same" && allowed.delegate === "same"
        ? "same"
        : narrowTerms(mine, theirs, depth + 1);
  return {
    receive: own.receive && allowed.receive,
    offer: own.offer && allowed.offer,
    publish: own.publish && allowed.publish,
    envelope: smallerEnvelope(own.envelope, allowed.envelope),
    delegate: below,
  };
}

/** The pools the table declares and has not detached: a recovery cuts each one. */
export function declaredInboxes(table: ContainerTable): string[] {
  return [...table.containers]
    .filter(([pool, rec]) => rec.inboxOf !== undefined && !table.detached.has(pool))
    .map(([pool]) => pool)
    .sort();
}

export function receivesNow(table: ContainerTable, into: string): boolean {
  return governingLeeway(table, into)?.leeway.receive === true;
}

/**
 * The nearest ancestor edge of `name` that points at a container the table does not hold, or
 * absent if every edge lands somewhere.
 *
 * A DANGLING EDGE IS WHAT A DROP LEAVES BEHIND. Dropping a shared container strikes that one
 * container's declarations; its children keep standing and keep their `parent`, which now names
 * nothing. Such a child passes every test made of its NAME while being unreachable from the
 * person's own pages, which walk edges — so it must not be somewhere new law can be hung.
 *
 * A container with NO parent edge is not dangling. Plenty stand that way by design, declared by
 * name alone; this asks only that the edges a record actually carries land on something.
 */
export function danglingAncestor(table: ContainerTable, name: string): string | undefined {
  const seen = new Set<string>();
  for (let at: string | undefined = name; at !== undefined && !seen.has(at);) {
    seen.add(at);
    const rec = table.containers.get(at);
    if (rec === undefined) return at === name ? undefined : at;
    at = rec.parent;
  }
  return undefined;
}

/**
 * The first name in this container's parent chain that does not stand, or absent when the whole
 * chain stands. `name` itself counts: a container that is gone breaks its own chain.
 *
 * ONE QUESTION, ASKED BY EVERY ROAD THAT ACTS ON A BINDING'S AUTHORITY. A shared drop strikes one
 * container and leaves its descendants standing, so "does my container stand" and "does my
 * container hang from anything" are different questions with the same stakes.
 */
export function chainBreaksAt(table: ContainerTable, name: string): string | undefined {
  const seen = new Set<string>();
  for (let at: string | undefined = name; at !== undefined && !seen.has(at);) {
    seen.add(at);
    const rec = table.containers.get(at);
    if (rec === undefined) return at;
    at = rec.parent;
  }
  return undefined;
}

/**
 * Does `name` sit inside `root`, by the edges a PERSON'S OWN PAGES walk?
 *
 * Their reach (src/server/subtree.ts) grows through `parent` AND through `inboxOf`, so this walks
 * up through both. That is a UNION, not a precedence: a record carrying both edges belongs to both
 * trees, and following only one of them answers about a tree the person may not be standing in.
 *
 * Walked from the name UP rather than from the root down. The table is not a forest under these
 * edges — `computeContainerTable` restores acyclicity over `parent` only, and nothing breaks a
 * cycle closed by an `inboxOf` — so the `seen` set is what makes this total, not an invariant.
 */
export function withinSubtree(table: ContainerTable, name: string, root: string): boolean {
  return climbFrom(table, name).has(root);
}

/**
 * The roots of the trees `name` stands in — every name above it with nowhere further to go.
 *
 * PLURAL, AND THAT IS THE POINT. A container carrying both a `parent` and an `inboxOf` stands in
 * two trees at once, so a caller asking "whose tree is this in" has no single answer, and a door
 * that took one would be choosing which person's page to honour. Callers that need a single tree
 * must refuse when this returns more than one; see `receiveRefusal`.
 */
export function treeRootsOf(table: ContainerTable, name: string): string[] {
  const up = climbFrom(table, name);
  return [...up].filter((at) => stepsUp(table, at).length === 0);
}

/** Every name at or above `name`, following both edge kinds. Total: `seen` bounds the walk. */
function climbFrom(table: ContainerTable, name: string): Set<string> {
  const seen = new Set<string>([name]);
  const queue = [name];
  while (queue.length > 0) {
    for (const next of stepsUp(table, queue.pop()!)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** One step up, both edges. A record the table does not hold has none. */
function stepsUp(table: ContainerTable, name: string): string[] {
  const rec = table.containers.get(name);
  if (rec === undefined) return [];
  return [rec.parent, rec.inboxOf].filter((e): e is string => e !== undefined);
}

export function subtreeUnder(table: ContainerTable, root: string): string[] {
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

// The inbox's deterministic name from (parent, connection key). A second bind of the same pair
// resumes the SAME inbox rather than spawning a new one — the inbox is durable (decision 3).
export function inboxName(container: string, connectionKey: string): string {
  return `inbox:${container}:${connectionKey}`;
}

// The surviving WRITE grant ids naming `subject` at this pool's store entity — what a revocation
// strikes. "Surviving" means no strike that holds under the pool's standing, the same rule the write
// door uses: a strike by an author without standing, such as the subject's own, leaves the grant
// standing, so it must leave it revocable too.
//
// NAMED GAP: this is narrower than the verb vocabulary. A `register` grant naming the same subject
// would survive an unbind. Nothing mints one for a connection key today — register standing is
// handed to OAuth connector actors, and `loam grant revoke` strikes every verb — so the gap is not
// reachable now. It becomes reachable the moment a connection key is granted `register`.
export function survivingWriteGrantIds(
  reactor: Reactor,
  now: number,
  subject: string,
  operator: string | undefined,
): string[] {
  return survivingGrantIds(reactor, now, subject, "write", operator);
}

/**
 * Did the operator strike `id` for good: a strike of the operator's, already in force, with no
 * end, and not undone by anyone who could ever undo it. Who could: the operator, or a key named by
 * an admin grant someone ELSE issued, held here struck or not (its standing may lapse and return),
 * directly or through a user who resolves to it now — or, since a user unreadable now may resolve
 * to anyone later, any key at all while such a user holds an admin grant here. `ignore` names a key
 * whose counter-strikes never count (the connection whose inbox this is: its writes are the ones a
 * bind or revoke must not let steer it).
 */
export function operatorStruckForGood(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  id: string,
  ignore?: string,
): boolean {
  if (operator === undefined) return false;
  // Computed once per call: the grant subjects, what each resolves to now, and whether a held
  // admin grant someone else issued names each.
  let facts: { subject: string; key: string | undefined; issuers: string[] }[] | undefined;
  const subjectFacts = () =>
    (facts ??= grantSubjects(reactor).map((subject) => ({
      subject,
      key: subjectKeyAt(reactor, now, operator, subject),
      issuers: heldGrantIds(reactor, subject, "admin").flatMap((g) => {
        const issuer = reactor.get(g)?.claims.author;
        return issuer === undefined ? [] : [issuer];
      }),
    })));
  const memo = new Map<string, boolean>();
  const canUndo = (author: string): boolean => {
    if (author === ignore) return false;
    if (author === operator) return true;
    const known = memo.get(author);
    if (known !== undefined) return known;
    const answer = subjectFacts().some(
      (f) =>
        f.issuers.some((issuer) => issuer !== author) &&
        (f.subject === author ||
          f.key === author ||
          (f.key === undefined && f.subject.startsWith(USER_PREFIX))),
    );
    memo.set(author, answer);
    return answer;
  };
  return reactor.negationsOf(id).some((n) => {
    const neg = reactor.get(n);
    return (
      neg?.claims.author === operator &&
      neg.claims.validFrom <= now &&
      neg.claims.validUntil === undefined &&
      !reactor.negationsOf(n).some((m) => {
        const author = reactor.get(m)?.claims.author;
        return author !== undefined && canUndo(author);
      })
    );
  });
}

/**
 * The keys this ground's grant subjects name right now: a key subject as itself, a `user:<name>`
 * subject as that user's current root. The roots a delegate here could act for.
 */
export function grantRoots(reactor: Reactor, now: number, operator: string | undefined): string[] {
  const out = new Set<string>();
  for (const subject of grantSubjects(reactor)) {
    const key = subjectKeyAt(reactor, now, operator, subject);
    if (key !== undefined) out.add(key);
  }
  return [...out];
}

/** Every held `verb` grant id naming `subject` at this ground's store entity, struck or not. */
export function heldGrantIds(reactor: Reactor, subject: string, wanted: string): string[] {
  return survivingGrantIds(reactor, undefined, subject, wanted, undefined);
}

/** The surviving `verb` grant ids naming `subject` at this ground's store entity. With no `now`,
 *  every held one, struck or not. */
export function survivingGrantIds(
  reactor: Reactor,
  now: number | undefined,
  subject: string,
  wanted: string,
  operator: string | undefined,
): string[] {
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
    if (subj !== subject || verb !== wanted) continue;
    if (now !== undefined && honoredStrikeOn(reactor, now, id, operator) !== undefined) continue;
    out.push(id);
  }
  return out;
}
