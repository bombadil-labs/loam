import { computeId, Reactor, verifyDelta, type Claims, type Delta } from "@bombadil/rhizomatic";
import { toWire } from "../federation/wire.js";
import { negatedAt } from "./negation.js";
import { CTX_SLATE, slatePointer } from "./slate-vocab.js";
import { cutErasureDefect, isStoreLocal } from "./recovery-cut.js";
import { declarationsOf } from "./ground-declarations.js";
import { groundRevision, raiseGroundRevision } from "./ground-revision.js";
import type { Signer } from "./signer.js";

export const ERASE_ENTITY = "loam:erasure";

export const CTX_ERASE = "loam.erasure";

export function eraseClaims(
  targetId: string,
  targetAuthor: string,
  author: string,
  timestamp: number,
  reason?: string,
  slate?: string,
  receiver?: string,
): Claims {
  return {
    timestamp,
    validFrom: timestamp,
    author,
    pointers: [
      {
        role: "declares",
        target: { kind: "entity", entity: { id: ERASE_ENTITY, context: CTX_ERASE } },
      },
      { role: "erases", target: { kind: "delta", deltaRef: { delta: targetId } } },
      { role: "spoken-by", target: { kind: "primitive", value: targetAuthor } },
      ...(reason === undefined
        ? []
        : [{ role: "reason", target: { kind: "primitive" as const, value: reason } }]),
      ...(slate === undefined ? [] : [slatePointer(slate)]),
      ...(receiver === undefined
        ? []
        : [{ role: "receiver", target: { kind: "primitive" as const, value: receiver } }]),
    ],
  };
}

export const erasureParts = (
  claims: Claims,
): {
  targetId: string | undefined;
  spokenBy: string | undefined;
  slate: string | undefined;
  reasons: string[];
  receiver: string | undefined;
  count: { erases: number; spokenBy: number; slate: number; receiver: number };
} => {
  let targetId: string | undefined;
  let spokenBy: string | undefined;
  let slate: string | undefined;
  let receiver: string | undefined;
  const reasons: string[] = [];
  const count = { erases: 0, spokenBy: 0, slate: 0, receiver: 0 };
  for (const p of claims.pointers) {
    if (p.role === "erases" && p.target.kind === "delta") {
      count.erases += 1;
      targetId = p.target.deltaRef.delta;
    }
    if (
      p.role === "reason" &&
      p.target.kind === "primitive" &&
      typeof p.target.value === "string"
    ) {
      reasons.push(p.target.value);
    }
    if (p.role === "spoken-by") {
      count.spokenBy += 1;
      if (p.target.kind === "primitive" && typeof p.target.value === "string") {
        spokenBy = p.target.value;
      }
    }
    if (p.role === "slate") {
      count.slate += 1;
      if (p.target.kind === "entity" && p.target.entity.context === CTX_SLATE) {
        slate = p.target.entity.id;
      }
    }
    if (p.role === "receiver") {
      count.receiver += 1;
      if (p.target.kind === "primitive" && typeof p.target.value === "string") {
        receiver = p.target.value;
      }
    }
  }
  return { targetId, spokenBy, slate, reasons, receiver, count };
};

export function pinErasureGovernors(reactor: Reactor, keys: readonly string[]): void {
  declarationsOf(reactor).erasureGovernors = keys;
  raiseGroundRevision(reactor);
}

export function orderBinds(d: Delta, reactor: Reactor, operator: string): boolean {
  const receiver = erasureParts(d.claims).receiver;
  if (d.claims.author === operator) return receiver === undefined || receiver === operator;
  return (
    receiver === operator &&
    (declarationsOf(reactor).erasureGovernors ?? []).includes(d.claims.author)
  );
}

export function erasureTarget(claims: Claims): string | undefined {
  return erasureParts(claims).targetId;
}

export function isErasure(claims: Claims): boolean {
  return claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ERASE_ENTITY &&
      p.target.entity.context === CTX_ERASE,
  );
}

export function eraseDefect(
  delta: Delta,
  reactor: Reactor,
  operator: string | undefined,
  batch: readonly Delta[] = [],
): string | undefined {
  if (!isErasure(delta.claims)) return undefined;
  const { targetId, spokenBy, slate, count } = erasureParts(delta.claims);
  if (count.erases !== 1 || targetId === undefined) {
    return "an erasure erases exactly one delta (one delta-kind `erases` pointer)";
  }
  if (count.spokenBy !== 1 || spokenBy === undefined) {
    return "an erasure carries exactly one string `spoken-by` (the erased delta's author)";
  }
  if (count.slate > 1 || (count.slate === 1 && slate === undefined)) {
    return `an erasure carries at most one \`slate\` pointer, an entity reference at ${CTX_SLATE}`;
  }
  if (count.receiver > 1) return "an erasure names at most one receiving peer";
  if (operator === undefined || !orderBinds(delta, reactor, operator)) {
    return "erasure is the instance operator's alone: only the operator may order a record removed";
  }
  const target = reactor.get(targetId);
  if (target !== undefined && isErasure(target.claims)) {
    return "an erasure cannot itself be erased: an erasure is permanent";
  }
  const cutDefect =
    target === undefined || !isStoreLocal(target)
      ? undefined
      : cutErasureDefect(
          reactor,
          operator,
          target,
          refusedIds(reactor, operator),
          erasedInBatch(batch, operator),
        );
  if (cutDefect !== undefined) return cutDefect;
  if (target !== undefined && target.claims.author !== spokenBy) {
    return "an erasure's spoken-by must be the erased delta's actual author";
  }
  return undefined;
}

export function readErasures(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): Set<string> {
  const dead = new Set<string>();
  for (const tomb of standingErasures(reactor, now, operator)) {
    dead.add(erasureParts(tomb.claims).targetId!);
  }
  return dead;
}

export function refusedIds(reactor: Reactor, operator: string | undefined): Set<string> {
  const refused = new Set<string>();
  for (const tomb of boundErasures(reactor, operator, undefined)) {
    refused.add(erasureParts(tomb.claims).targetId!);
  }
  return refused;
}

export function erasedFromReading(
  reactor: Reactor,
  operator: string | undefined,
): ReadonlySet<string> {
  const revision = groundRevision(reactor);
  const hit = readingCache.get(reactor);
  if (hit !== undefined && hit.revision === revision && hit.operator === operator) return hit.ids;
  const held = [...refusedIds(reactor, operator)].filter((id) => reactor.get(id) !== undefined);
  const ids = withHeldDownTargets(new Set(held), (id) => reactor.get(id));
  readingCache.set(reactor, { revision, operator, ids });
  return ids;
}

const readingCache = new WeakMap<
  Reactor,
  { revision: number; operator: string | undefined; ids: ReadonlySet<string> }
>();

export function withHeldDownTargets(
  hidden: Set<string>,
  get: (id: string) => Delta | undefined,
): Set<string> {
  const pending = [...hidden];
  while (pending.length > 0) {
    const negation = get(pending.pop()!);
    if (negation === undefined) continue;
    for (const p of negation.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const target = p.target.deltaRef.delta;
      if (hidden.has(target) || get(target) === undefined) continue;
      hidden.add(target);
      pending.push(target);
    }
  }
  return hidden;
}

export function erasedInBatch(
  accepted: readonly Delta[],
  operator: string | undefined,
): Set<string> {
  const out = new Set<string>();
  if (operator === undefined) return out;
  const byId = new Map(accepted.map((d) => [d.id, d]));
  const erasesErasure = erasuresOfErasures(accepted);
  for (const d of accepted) {
    if (!isErasure(d.claims) || inLocalContext(d, LOCAL_CONTROL)) continue;
    if (erasesErasure.has(d.id)) continue;
    if (d.claims.author !== operator) continue;
    const { targetId, spokenBy, count } = erasureParts(d.claims);
    if (targetId === undefined || count.erases !== 1) continue;
    const target = byId.get(targetId);
    if (target !== undefined && target.claims.author !== spokenBy) continue;
    out.add(targetId);
  }
  return out;
}

export function erasuresOfErasures(accepted: readonly Delta[]): Set<string> {
  const tombs = new Set(accepted.filter((d) => isErasure(d.claims)).map((d) => d.id));
  const out = new Set<string>();
  for (const d of accepted) {
    if (!isErasure(d.claims)) continue;
    const { targetId } = erasureParts(d.claims);
    if (targetId !== undefined && tombs.has(targetId)) out.add(d.id);
  }
  return out;
}

export function standingErasures(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): Delta[] {
  return boundErasures(reactor, operator, now);
}

function boundErasures(
  reactor: Reactor,
  operator: string | undefined,
  honorNegationsAt: number | undefined,
): Delta[] {
  if (operator === undefined) return [];
  const negated =
    honorNegationsAt !== undefined ? negatedAt(reactor, honorNegationsAt, operator) : () => false;
  const out: Delta[] = [];
  for (const id of reactor.byTarget(ERASE_ENTITY)) {
    const delta = reactor.get(id);
    if (delta === undefined || !isErasure(delta.claims)) continue;
    if (inLocalContext(delta, LOCAL_CONTROL)) {
      if (localEraseTarget(delta, reactor, operator) === undefined) continue;
    } else if (negated(delta.id)) continue;
    if (!orderBinds(delta, reactor, operator)) continue;
    const { targetId, count } = erasureParts(delta.claims);
    if (targetId === undefined || count.erases !== 1) continue;
    out.push(delta);
  }
  return out;
}

export function erasuresIn(
  deltas: Iterable<Delta>,
  now: number,
  operator: string | undefined,
): Set<string> {
  const probe = new Reactor();
  for (const d of deltas) probe.ingest(d);
  return readErasures(probe, now, operator);
}

export function neverReturns(
  deltas: Iterable<Delta>,
  now: number,
  operator: string | undefined,
): Set<string> {
  const probe = new Reactor();
  for (const d of deltas) probe.ingest(d);
  return new Set([...readErasures(probe, now, operator), ...refusedIds(probe, operator)]);
}

export const UNSWEPT_AUTH_SURFACES: readonly string[] = [
  "credentials.json IS NOT SWEPT: the server keeps per-user password hashes in the home's " +
    "credentials.json, OUTSIDE the delta store. Erasure purges deltas, so forgetting a user's " +
    "record delta shuts the login door — the ground then holds no role for them, and the credential " +
    "file cannot know the delta was erased — but the credential entry itself stays. Removing a " +
    "credential entry is a separate operation, out of erasure's scope.",
  "login-locks.json IS NOT SWEPT: the login delay keeps per-username failure records in the home's " +
    "login-locks.json, OUTSIDE the delta store. Erasure does not touch it; a record decays on its " +
    "own, and `loam user unlock` is its separate cure.",
  "user.<name>.seed IS NOT SWEPT: each operator-role user's OWN signing key lives in the home, in " +
    "user.<name>.seed, OUTSIDE the delta store. Erasure purges deltas, so forgetting a user's record " +
    "delta shuts their login door, but the seed file itself stays — and its signature keeps resolving " +
    "for a governed reader until its grant is negated. Removing the seed file, and negating its " +
    "signing grant (`loam user remove-role`), is a separate operation, out of erasure's scope.",
];

export const ERASURE_NON_CLAIMS: readonly string[] = [
  "PEERS ARE NOT REACHED: erasure does not reach federation peers — they are not the " +
    "operator's replicas, and a peer refuses a foreign operator's removal-order at its own door.",
  "ALREADY-SERVED READS ARE NOT RECALLED: egress closure stopped further spread from this " +
    "store during the window; nothing recalls what a door already served.",
  "A COPY RE-SPOKEN UNDER ANOTHER ID STILL STANDS: erasure is by ID, and a content-addressed " +
    "store cannot chase content. That covers a copy made BEFORE identification and also one a " +
    "standing pass (a rendering, a promotion) minted DURING the window under a slate that did " +
    "not close `cite` — the frozen set names ids, so a fresh id was never in it. Such a copy " +
    "must be slated by its own id; the slate report's `duplicates` lists the links this store " +
    "can follow, and it finds LINKS, never content.",
  "POINTERS ARE NOT CONTENT: the surviving deltas listed per member cite an erased id and " +
    "dangle at the hole — that is §11's citations manifest, not retained content.",
];

export const ESM_RESIDENCY_DISCLOSURE: readonly string[] = [
  "ESM RESIDENCY IS NOT SWEPT: a resolver or renderer compiled from a source delta stays loaded " +
    "and EXECUTABLE in this process's ESM registry after that delta is erased — the registry " +
    "offers no eviction, and no tier probe can ask it. The erasure verdicts above are byte-level " +
    "and this tier is not among the bytes they proved; it reads as UNPROVEN, not as swept. The " +
    "map holding Loam's own handle is keyed by the source's content address, so no door reads a " +
    "namespace out of it without already holding the erased bytes; the executable copy itself " +
    "remains until the process ends (SPEC §22/§23, T105).",
];

export const LOCAL_CONTROL = "loam.local.channel.control";

export const address = (v: unknown): v is string =>
  typeof v === "string" && /^1e20[0-9a-f]{64}$/.test(v);

export const text = (v: unknown, empty = false): v is string =>
  typeof v === "string" && (empty || v.length > 0) && !v.includes("\0");

export const inLocalContext = (d: Delta, context: string): boolean =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);

const verifiedAs = new WeakMap<Delta, { readonly id: string; readonly sig: string | undefined }>();

export function verified(d: Delta): boolean {
  const memo = verifiedAs.get(d);
  if (memo !== undefined && memo.id === d.id && memo.sig === d.sig && computeId(d.claims) === d.id)
    return true;
  if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified") return false;
  verifiedAs.set(d, { id: d.id, sig: d.sig });
  return true;
}

export function sameVerifiedDelta(a: Delta | undefined, b: Delta): boolean {
  return a !== undefined && verified(a) && JSON.stringify(toWire(a)) === JSON.stringify(toWire(b));
}

export function localEraseTarget(
  d: Delta,
  reactor: Reactor,
  operator: string | undefined,
): string | undefined {
  if (
    !isErasure(d.claims) ||
    !sameVerifiedDelta(d, d) ||
    eraseDefect(d, reactor, operator) !== undefined
  )
    return;
  const markers = d.claims.pointers.filter(
    (p) => p.target.kind === "entity" && p.target.entity.context === LOCAL_CONTROL,
  );
  const versions = d.claims.pointers.filter((p) => p.role === "local-control-version");
  const kinds = d.claims.pointers.filter((p) => p.role === "local-control-kind");
  const channels = d.claims.pointers.filter((p) => p.role === "local-control-channel");
  const marker = markers[0],
    version = versions[0],
    kind = kinds[0],
    channel = channels[0],
    target = erasureTarget(d.claims);
  if (
    markers.length !== 1 ||
    marker?.role !== "local-control" ||
    marker.target.kind !== "entity" ||
    marker.target.entity.id !== target ||
    !address(target) ||
    versions.length !== 1 ||
    version?.target.kind !== "primitive" ||
    version.target.value !== 1 ||
    kinds.length !== 1 ||
    kind?.target.kind !== "primitive" ||
    kind.target.value !== "erase" ||
    channels.length !== 1 ||
    channel?.target.kind !== "primitive" ||
    !text(channel.target.value) ||
    !channel.target.value.startsWith("channel:")
  )
    return;
  return target;
}

export function orderForPool(
  ground: { readonly operatorAuthor: string | undefined; readonly signer: Signer | undefined },
  erasure: Delta,
  pool: { readonly operatorAuthor: string | undefined },
): Delta {
  if (pool.operatorAuthor === ground.operatorAuthor) return erasure;
  const operator = ground.operatorAuthor!;
  return ground.signer!.sign({
    timestamp: erasure.claims.timestamp,
    validFrom: erasure.claims.validFrom,
    author: operator,
    pointers: [
      ...erasure.claims.pointers.filter((p) => p.role !== "receiver"),
      { role: "receiver", target: { kind: "primitive" as const, value: pool.operatorAuthor! } },
    ],
  });
}
