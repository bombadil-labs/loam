// Erasure's pure law: the vocabulary, the order's shape and binding, and the readers of what the
// ground holds erased. Nothing here purges, reseats or reaches a pool; that is `erase.ts`. Kept
// free of the gateway so its readers can import it without joining the gateway's import cycle.

import { computeId, Reactor, verifyDelta, type Claims, type Delta } from "@bombadil/rhizomatic";
import { toWire } from "../federation/wire.js";
import { negatedAt } from "./negation.js";
import { CTX_SLATE, slatePointer } from "./slate-vocab.js";
import { cutErasureDefect, isStoreLocal } from "./recovery-cut.js";
import type { Signer } from "./signer.js";

export const ERASE_ENTITY = "loam:erasure";

export const CTX_ERASE = "loam.erasure";

// One erasure: the erased id (a delta-kind ref), the target's author recorded while it
// could still be verified, an optional human reason (the compliance log reads itself), and — when
// the erasure was one member of a CUT (SPEC §29.6) — one optional `slate` pointer. That pointer is
// the JOIN a graveyard reads: the graveyard does not list its erasures at all, so "which
// erasures belong to this erasure event" stays one small delta whether the cut had four members
// or forty thousand, and `readErasures` remains the single per-id law.
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
      // The one peer this order takes effect at (SPEC-6 §3). A governor other than the receiver's
      // own key must name it; any other peer keeps the order as testimony only.
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
  // EVERY reason on the delta, not the first. The door validates the erased id, the author, and the
  // §29.6 join, and says nothing about how many reasons an erasure carries — so a reader that took
  // one and dropped the rest would silently narrow a compliance record.
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

// The keys a ground pins as additional erasure governors (its host chain, for a pool). Held beside
// the reactor, like the user ground, so every reader that takes a reactor sees the same pins.
const erasureGovernors = new WeakMap<Reactor, readonly string[]>();

export function pinErasureGovernors(reactor: Reactor, keys: readonly string[]): void {
  erasureGovernors.set(reactor, keys);
}

/**
 * Does erasure `d` bind at the ground `operator` governs (SPEC-6 §3)? Its own key binds with no
 * receiver or with itself as receiver. A pinned governor binds only when the order names this
 * ground as its receiver. Any other erasure is testimony here.
 */
export function orderBinds(d: Delta, reactor: Reactor, operator: string): boolean {
  const receiver = erasureParts(d.claims).receiver;
  if (d.claims.author === operator) return receiver === undefined || receiver === operator;
  return receiver === operator && (erasureGovernors.get(reactor) ?? []).includes(d.claims.author);
}

/** The id an erasure erases, for readers that join on it (SPEC §29.6's arithmetic). */
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

// Is this delta an erasure, and if so, is it WELL-FORMED, AUTHORIZED law? Erasure is
// DESTRUCTIVE, so this is the strictest gate in the system, run at EVERY door that could admit
// an erasure — the append door (authorize) AND the federation door — so that an unauthorized
// removal-order is never even stored, let alone honored.
//
// ONE authority, and no other: the INSTANCE OPERATOR. Only the operator's own signature orders
// a record removed from this store. Not the record's author, not a grantee, not a peer — the
// substrate cannot stop anyone from *minting* an erasure delta, so the store must be certain to
// never *accept* one that its operator did not sign. (A data subject asks; the operator, as the
// controller, executes. An ungoverned store has no operator and so honors no erasure at all.)
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
  // The §29.6 join is OPTIONAL, but a PRESENT one is validated: a malformed join would make the
  // graveyard's arithmetic unreadable while looking like law.
  if (count.slate > 1 || (count.slate === 1 && slate === undefined)) {
    return `an erasure carries at most one \`slate\` pointer, an entity reference at ${CTX_SLATE}`;
  }
  if (count.receiver > 1) return "an erasure names at most one receiving peer";
  if (operator === undefined || !orderBinds(delta, reactor, operator)) {
    return "erasure is the instance operator's alone: only the operator may order a record removed";
  }
  // The operator's erasure must still tell the truth about whose record it forgot, whenever
  // the target can still be seen — an accurate compliance record.
  const target = reactor.get(targetId);
  // An erasure is never itself erased (§11): the refused set is derived from the held erasures, so
  // erasing one would undo an erasure. A target in the same batch is checked by `erasedInBatch`.
  if (target !== undefined && isErasure(target.claims)) {
    return "an erasure cannot itself be erased: an erasure is permanent";
  }
  // The records a recovery's history cut depends on are kept (recovery-history.md). Asked only of
  // those records: `refusedIds` binds local-control erasures through this function, so asking it of
  // every target recurses.
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

// The targets of every STANDING erasure: surviving, not negated and operator-signed. Only the
// operator's erasures bind, so an ungoverned store honors no erasure. A negated erasure
// leaves this set, while its target id stays in `refusedIds`, which the write and read paths
// consult.
export function readErasures(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): Set<string> {
  const dead = new Set<string>();
  for (const tomb of standingErasures(reactor, now, operator)) {
    dead.add(erasureParts(tomb.claims).targetId!); // standingErasures proved it well-shaped
  }
  return dead;
}

// The ids this store refuses FOREVER: the target of every erasure that ever bound here, whether
// or not it was later negated. An erasure is eternal (Myk, 2026-09-25): negating an erasure retracts
// the record, and the id still never returns. Separate from `standingErasures`, which answers "is
// this erasure standing testimony now" for receipts, the ledger and as-of reads.
//
// DERIVED, NOT PERSISTED, and that rests on one premise: an erasure can never itself be erased (§11).
// If that ever changes, this list must be kept in its own store, or an erasure can be undone.
// A batch that carries an erasure and its target is handled by `erasedInBatch`.
export function refusedIds(reactor: Reactor, operator: string | undefined): Set<string> {
  const refused = new Set<string>();
  for (const tomb of boundErasures(reactor, operator, undefined)) {
    refused.add(erasureParts(tomb.claims).targetId!);
  }
  return refused;
}

// What a reading must not show: every refused id, and, transitively, the target of a held negation
// that is itself refused. Showing that target while hiding its negation would show a retracted claim
// as live. A negation whose bytes are purged is gone, and its target revives: that is what erasing
// a negation means.
//
// Only ids whose bytes are still HELD are returned: a purged id cannot be read anyway. So once every
// purge completes, this set is empty again, and reads use warm materializations again.
export function erasedFromReading(reactor: Reactor, operator: string | undefined): Set<string> {
  const held = [...refusedIds(reactor, operator)].filter((id) => reactor.get(id) !== undefined);
  return withHeldDownTargets(new Set(held), (id) => reactor.get(id));
}

// Adds, transitively, the target of every hidden negation that `get` can still find.
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

// The ids that erasures inside one ingest batch refuse. The caller passes only members it has
// ALREADY accepted (verified, lawful, admitted), so a forged or refused erasure never counts,
// and a member's id is the hash of its content, so no forged copy can stand in for the target.
// An erasure counts only if it names its target's real author when the target is in the batch.
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

// The accepted erasures whose target is another erasure in the same batch. An erasure is never
// erased (§11), so the write paths refuse these: append refuses its batch, federate drops them.
// `eraseDefect` refuses the same thing when the target erasure is already held.
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

// The surviving, lawful, operator-signed erasures — the record of what this ground has
// forgotten (that it forgot, never what). One place computes the set both readErasures (the
// dead ids) and forgottenSince (the as-of annotation) draw from, so the author-confirmation and
// negation rules cannot drift between them.
export function standingErasures(
  reactor: Reactor,
  now: number,
  operator: string | undefined,
): Delta[] {
  return boundErasures(reactor, operator, now);
}

// The operator's well-shaped erasures. With `honorNegationsAt`, an ordinary erasure negated at that
// time is left out; without it, every erasure that ever bound is in.
function boundErasures(
  reactor: Reactor,
  operator: string | undefined,
  honorNegationsAt: number | undefined,
): Delta[] {
  if (operator === undefined) return []; // an ungoverned store honors no erasure at all
  const negated =
    honorNegationsAt !== undefined ? negatedAt(reactor, honorNegationsAt, operator) : () => false;
  const out: Delta[] = [];
  // Every erasure points at ERASE_ENTITY, so the by-target index finds them all without a full
  // walk of the delta set (H8). The index is written with the set, so it cannot lag it.
  for (const id of reactor.byTarget(ERASE_ENTITY)) {
    const delta = reactor.get(id);
    if (delta === undefined || !isErasure(delta.claims)) continue;
    if (inLocalContext(delta, LOCAL_CONTROL)) {
      // Generic preplanted strikes never become local negation when a marked order lands.
      if (localEraseTarget(delta, reactor, operator) === undefined) continue;
    } else if (negated(delta.id)) continue; // ordinary struck erasure = negated
    if (!orderBinds(delta, reactor, operator)) continue; // the operator's, or a pinned governor's for here
    const { targetId, count } = erasureParts(delta.claims);
    if (targetId === undefined || count.erases !== 1) continue; // shape the door enforces
    out.push(delta);
  }
  return out;
}

// The pre-boot variant for `loam serve`: given the deltas held across the tiers (before any
// gateway or reactor exists), report the SAME dead set the running store would — so
// heal(exclude) is guarded with full fidelity from the first moment. It builds a throwaway
// reactor from the deltas and defers to readErasures, so the author-confirmation and the
// lawful-negation (negation) rules are computed in exactly one place and cannot drift
// between boot and run. (A lawfully struck erasure is therefore NOT in the set — heal will
// not drop a negated record — and a self-erasure that disagrees with its target's author
// binds nothing here too.)
export function erasuresIn(
  deltas: Iterable<Delta>,
  now: number,
  operator: string | undefined,
): Set<string> {
  const probe = new Reactor();
  for (const d of deltas) probe.ingest(d);
  return readErasures(probe, now, operator);
}

/**
 * What a boot sweep must never bring back, read off raw rows before any gateway exists: the
 * target of every standing erasure, and every id the door refuses forever (`refusedIds`: the
 * target of an erasure that ever bound, even one later negated).
 */
export function neverReturns(
  deltas: Iterable<Delta>,
  now: number,
  operator: string | undefined,
): Set<string> {
  const probe = new Reactor();
  for (const d of deltas) probe.ingest(d);
  return new Set([...readErasures(probe, now, operator), ...refusedIds(probe, operator)]);
}

// The home files §36 keeps OUTSIDE the delta store, and therefore outside erasure's reach (T131,
// SPEC §36 phase 10). Erasure purges DELTAS from every tier; it never touches a home file, so a
// report that read as exhaustive while a forgotten user's password hash still sat in
// `credentials.json` would be H7 wearing letterhead — the honesty §11 owes named plainly.
//
// COMPLETE-BY-CONSTRUCTION, not by guess: this list is every home file that holds a data SUBJECT's
// per-user data — keyed by the human's user name — outside the ground. That rule resolves to exactly
// three, one per home path function §36 writes: `credentialsPath`, `locksPath`, and `userSeedPath`.
//
// NOT EVERY seed file is store infrastructure — the distinction is WHOSE key it is. `operator.seed`
// holds the STORE's own signing key, so it is off this list. But `user.<name>.seed` (`userSeedPath`)
// holds a SUBJECT's signing key, more sensitive than the password hash, because home access can still
// sign AS that user while the file stands — so it IS here. `oauth.json` is a home file too, and
// erasure does not sweep it either, but it is keyed by CONNECTOR (clientId): its grants and token
// digests are a connector's identity, not a human user's record, so erasing a user's record leaves no
// subject-keyed bytes there and it is off THIS list. If a later surface ever holds subject per-user
// data, it OWES this list an entry — the disclosure is the one place that must never itself omit a
// surface (T131 criterion 7 derives its expected set from the path functions to force exactly that).
//
// ONE source, read by BOTH the live `health()` report and the re-issuable compliance receipt
// (`deriveReceiptImpl`), so the two surfaces can never drift on what erasure does not reach. Each line
// names its file and says erasure does not reach it; the set as a whole affirms what erasure DOES
// forget (deltas), so "unswept" reads as a claim about these files and not a blanket disclaimer.
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

// What an erasure NEVER claims, whatever else it proves — the limits that hold for a single-delta
// erase and for a whole cut alike. ONE source, read by the §29.7 compliance receipt and by the
// terminal verb that performs a single erasure, so the two cannot drift on where the promise stops.
// (The receipt carries further non-claims that are specific to a CUT — the walls it kept, the walls
// it could not reach — and those stay where the cut computes them.)
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

// The ONE standing R1 violation (T105, §32's seam census): a renderer/resolver compiled from a
// source delta stays loaded in THIS PROCESS's ESM registry after the source delta is erased — the
// registry offers no eviction, and no tier probe can ask it. The disclosure names the tier as
// UNPROVEN (a tier that cannot be asked has proven nothing — H9) rather than letting the settled
// verdict read as exhaustive. Same ONE-SOURCE doctrine as the auth surfaces: health() and the
// compliance receipt both read this constant, so the two surfaces cannot drift. The COMPLETION
// half — tearing down a condemned module's compiled copy — is T105 (b); this is the honesty half.
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

// A verdict is a function of id, claims and signature alone, and claims that recompute to the id
// are the claims that were signed. So an object that verified once keeps its verdict while its id
// and signature are unchanged and its claims still recompute: a content hash, not an ed25519
// check. Deltas are not frozen, which is why the recompute stays: an object mutated since it
// verified misses the memo and takes the full check.
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

// The order a pool receives from this ground, in the fan-out and when the pool opens. A pool
// governed by this ground's own key takes this ground's erasure as is. A pool under its own key
// takes an order this ground signs as a pinned governor, naming that pool as its receiver: this
// ground's own erasure is testimony there. The order keeps the erasure's own time, so the same
// erasure always yields the same order for one pool: a reseed or a retried fan-out adds nothing.
export function orderForPool(
  ground: { readonly operatorAuthor: string | undefined; readonly signer: Signer | undefined },
  erasure: Delta,
  pool: { readonly operatorAuthor: string | undefined },
): Delta {
  if (pool.operatorAuthor === ground.operatorAuthor) return erasure;
  // The same order in this ground's voice, every pointer kept (a local-control marker included),
  // plus the one receiver it takes effect at.
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
