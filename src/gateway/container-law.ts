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
import { lawfulDeltasAt, lawfulHistoryAt, lawfulSnapshot } from "./lawful.js";
import { negatedAt } from "./negation.js";
import { readTrustPolicyAt, type TrustPolicy } from "./trust.js";
import { subjectKeyAt, USER_PREFIX } from "./user-root.js";
import { membershipForValidation } from "./member-of.js";
import type { Ground } from "./ground.js";

export const CTX_CONTAINER = "loam.container";

export const CTX_CONTAINER_EXCLUDED = "loam.container.excluded";

export const CTX_CONTAINER_DETACHED = "loam.container.detached";

export const CONTAINER_CONTEXTS = [
  CTX_CONTAINER,
  CTX_CONTAINER_EXCLUDED,
  CTX_CONTAINER_DETACHED,
] as const;

export type ContainerTrust = "curated" | "untrusted";

export type ContainerPosture = "separate" | "shared";

const TRUSTS = new Set<string>(["curated", "untrusted"]);

const POSTURES = new Set<string>(["separate", "shared"]);

const NUL = "\u0000";

const NOTE_BYTES = 256;

export interface ContainerSpec {
  readonly container: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  readonly parent?: string;
  readonly membership?: unknown;
  readonly membershipAt?: string;
  readonly version?: string;

  readonly inboxOf?: string;

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

export function termClaims(term: unknown, author: string, timestamp: number): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [primPtr("term", JSON.stringify(term))],
  };
}

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
    const parent = name.includes(":") ? name.slice(0, name.lastIndexOf(":")) : undefined;
    if (parent !== undefined && parent.includes(":")) {
      const governing = governingLeeway(readContainerTable(reactor, now, operator), parent);
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

export interface ResolvedContainer {
  readonly entity: string;
  readonly trust: ContainerTrust;
  readonly posture: ContainerPosture;
  readonly parent?: string;
  readonly membership?: unknown;
  readonly membershipAt?: string;
  readonly version?: string;
  readonly inboxOf?: string;

  readonly leeway: Leeway;

  readonly leewayDeclared: boolean;
}

export interface DetachRecord {
  readonly id: string;
  readonly note?: string;
  readonly timestamp: number;
}

export interface ContainerTable {
  readonly containers: ReadonlyMap<string, ResolvedContainer>;
  readonly excluded: ReadonlySet<string>;
  readonly detached: ReadonlyMap<string, readonly DetachRecord[]>;
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

interface TableMemo {
  readonly operator: string | undefined;
  swept: number;
  lawCount: number;
  builtAt: number;
  readonly bounds: number[];
  from: number;
  until: number;
  table: ContainerTable;
}

const tableMemo = new WeakMap<Reactor, TableMemo>();

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
    if (bound === undefined) continue;
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
        parseTerm(membershipForValidation(profile));
        membership = profile;
      } catch {
        defects.push(
          `container "${name}": the inline membership is not a parseable Term — not binding`,
        );
      }
    }
    let leeway: Leeway = SEALED_LEEWAY;
    const declared = latest.leeways ?? [];
    const sealedBecause = (why: string): void => {
      defects.push(`container "${name}": ${why}; the container reads as sealed`);
    };
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

export function containerAdmission(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  container: string,
): TrustPolicy {
  return readTrustPolicyAt(reactor, now, container, operator);
}

function boundContainer(
  claims: Claims,
): { name: string; trust: string; posture: "shared" | "separate" } | undefined {
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

export function containerDeclarationName(claims: Claims): string | undefined {
  return boundContainer(claims)?.name;
}

export function currentContainerDeclarationId(
  reactor: Ground,
  now: number,
  operator: string | undefined,
  entity: string,
): string | undefined {
  if (operator === undefined) return undefined;
  const negated = negatedAt(reactor, now, operator);
  return lawfulDeltasAt(reactor, now, { entity, context: CTX_CONTAINER }, operator)
    .filter((delta) => !negated(delta.id) && containerDeclarationName(delta.claims) === entity)
    .sort((a, b) => b.claims.timestamp - a.claims.timestamp || b.id.localeCompare(a.id))[0]?.id;
}

export function survivingDeclarationIds(
  reactor: Ground,
  now: number,
  operator: string,
  entity: string,
): string[] {
  const negated = negatedAt(reactor, now, operator);
  return lawfulDeltasAt(reactor, now, { entity, context: CTX_CONTAINER }, operator)
    .filter((delta) => !negated(delta.id))
    .filter((delta) => containerRef(delta.claims, CTX_CONTAINER) === entity)
    .map((delta) => delta.id);
}

export function everDeclared(
  reactor: Ground,
  operator: string | undefined,
  entity: string,
): boolean {
  if (operator === undefined) return true;
  return lawfulHistoryAt(reactor, { entity, context: CTX_CONTAINER }, operator).some(
    (delta) => boundContainer(delta.claims)?.name === entity,
  );
}

export function governingLeeway(
  table: ContainerTable,
  name: string,
  ceiling?: string,
): { readonly at: string; readonly leeway: Leeway } | undefined {
  const isPool = name.startsWith("inbox:") || name.startsWith("channel:");
  const host = isPool ? table.containers.get(name)?.inboxOf : undefined;
  if (host === name) return { at: name, leeway: SEALED_LEEWAY };
  const up = (at: string): string | undefined =>
    at.includes(":") ? at.slice(0, at.lastIndexOf(":")) : undefined;
  const levels: string[] = [];
  for (let at: string | undefined = host ?? name; at !== undefined; at = up(at)) {
    levels.push(at);
    if (at === ceiling) break;
  }
  levels.reverse();

  let at: string | undefined;
  let effective: Leeway | undefined;
  let inForce: Terms | undefined;
  for (const level of levels) {
    const declared = table.containers.get(level);
    const asked = declared?.leewayDeclared === true ? declared.leeway : effective;
    if (asked === undefined) continue;
    if (declared?.leewayDeclared === true) at = level;
    effective = inForce === undefined ? asked : narrowedBy(asked, inForce);
    inForce = !level.includes(":")
      ? undefined
      : effective.delegate === "off"
        ? sealedTerms(effective)
        : effective.delegate;
  }
  return effective === undefined || at === undefined ? undefined : { at, leeway: effective };
}

const sealedTerms = (leeway: Leeway): Terms => ({
  receive: leeway.receive,
  offer: leeway.offer,
  publish: leeway.publish,
  envelope: leeway.envelope,
  delegate: "off",
});

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

export function declaredInboxes(table: ContainerTable): string[] {
  return [...table.containers]
    .filter(([pool, rec]) => rec.inboxOf !== undefined && !table.detached.has(pool))
    .map(([pool]) => pool)
    .sort();
}

export function receivesNow(table: ContainerTable, into: string): boolean {
  return governingLeeway(table, into)?.leeway.receive === true;
}

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

export function withinSubtree(table: ContainerTable, name: string, root: string): boolean {
  return climbFrom(table, name).has(root);
}

export function treeRootsOf(table: ContainerTable, name: string): string[] {
  const up = climbFrom(table, name);
  return [...up].filter((at) => stepsUp(table, at).length === 0);
}

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

export function inboxName(container: string, connectionKey: string): string {
  return `inbox:${container}:${connectionKey}`;
}

export function survivingWriteGrantIds(
  reactor: Reactor,
  now: number,
  subject: string,
  operator: string | undefined,
): string[] {
  return survivingGrantIds(reactor, now, subject, "write", operator);
}

export function operatorStruckForGood(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
  id: string,
  ignore?: string,
): boolean {
  if (operator === undefined) return false;
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

export function grantRoots(reactor: Reactor, now: number, operator: string | undefined): string[] {
  const out = new Set<string>();
  for (const subject of grantSubjects(reactor)) {
    const key = subjectKeyAt(reactor, now, operator, subject);
    if (key !== undefined) out.add(key);
  }
  return [...out];
}

export function heldGrantIds(reactor: Reactor, subject: string, wanted: string): string[] {
  return survivingGrantIds(reactor, undefined, subject, wanted, undefined);
}

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
