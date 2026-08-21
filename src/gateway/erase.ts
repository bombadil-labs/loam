// Erasure — degrees of forgetting (SPEC §11). The store remembers THAT it forgot — who asked,
// when, which id — never what. A TOMBSTONE is an append-only claim at `loam:erasure` naming
// the erased delta; the bytes themselves are purged from every tier (the seam's purge, PR
// #34); and admission composes the tombstone set so the id is refused re-entry forever.
// Content addressing is what makes this honest: retaining a hash retains zero content.
//
// ONE erasure authority, nobody else: the INSTANCE OPERATOR. Erasure is destructive, so the
// store is deliberately unforgiving about it — only the operator's own signature orders a
// record removed, and every door (append AND federation) refuses a tombstone the operator did
// not sign, so an unauthorized removal-order is never even stored. This is the GDPR shape: a
// data subject asks; the operator, as the controller, executes; and the tombstone records the
// target's author (`spoken-by`) as the compliance log, verified against the live target while
// it can still be seen.
//
// Degrees of forgetting are compositions the operator performs, never new mutation machinery:
// anonymous reassertion = erase + append the content in another voice (with NO on-record link —
// the old id would otherwise let anyone re-identify the author by trial); sealed authorship = a
// `hash(salt‖author)` commitment pointer on the reassertion, reclaimable by revealing the
// preimage; partial redaction = reassert with values replaced.

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { Reactor, signClaims } from "@bombadil/rhizomatic";
import type { Claims, Delta } from "@bombadil/rhizomatic";
import { lawfulNegated } from "./registration.js";
import { unreachableStoreReport } from "./container.js";
import {
  CTX_SLATE,
  forgivenHealth,
  readSlates,
  slateHealth,
  slatePointer,
  type ForgivenHealth,
  type SlateHealth,
} from "./slate.js";
import type { Gateway } from "./gateway.js";

export const ERASE_ENTITY = "loam:erasure";
export const CTX_ERASE = "loam.erasure";

// One tombstone: the erased id (a delta-kind ref), the target's author recorded while it
// could still be verified, an optional human reason (the compliance log reads itself), and — when
// the erasure was one member of a CUT (SPEC §29.6) — one optional `slate` pointer. That pointer is
// the JOIN a graveyard reads: the graveyard does not list its tombstones at all, so "which
// tombstones belong to this erasure event" stays one small delta whether the cut had four members
// or forty thousand, and `readTombstones` remains the single per-id law.
export function eraseClaims(
  targetId: string,
  targetAuthor: string,
  author: string,
  timestamp: number,
  reason?: string,
  slate?: string,
): Claims {
  return {
    timestamp,
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
    ],
  };
}

const tombstoneParts = (
  claims: Claims,
): {
  targetId: string | undefined;
  spokenBy: string | undefined;
  slate: string | undefined;
  // EVERY reason on the delta, not the first. The door validates the erased id, the author, and the
  // §29.6 join, and says nothing about how many reasons a tombstone carries — so a reader that took
  // one and dropped the rest would silently narrow a compliance record.
  reasons: string[];
  count: { erases: number; spokenBy: number; slate: number };
} => {
  let targetId: string | undefined;
  let spokenBy: string | undefined;
  let slate: string | undefined;
  const reasons: string[] = [];
  const count = { erases: 0, spokenBy: 0, slate: 0 };
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
  }
  return { targetId, spokenBy, slate, reasons, count };
};

/** The id a tombstone erases, for readers that join on it (SPEC §29.6's arithmetic). */
export function tombstoneTarget(claims: Claims): string | undefined {
  return tombstoneParts(claims).targetId;
}

/** The slate a tombstone was minted BY, when it was one member of a cut (SPEC §29.6's join). */
export function tombstoneSlate(claims: Claims): string | undefined {
  return tombstoneParts(claims).slate;
}

export function isTombstone(claims: Claims): boolean {
  return claims.pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === ERASE_ENTITY &&
      p.target.entity.context === CTX_ERASE,
  );
}

// Is this delta a tombstone, and if so, is it WELL-FORMED, AUTHORIZED law? Erasure is
// DESTRUCTIVE, so this is the strictest gate in the system, run at EVERY door that could admit
// a tombstone — the append door (authorize) AND the federation door — so that an unauthorized
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
): string | undefined {
  if (!isTombstone(delta.claims)) return undefined;
  const { targetId, spokenBy, slate, count } = tombstoneParts(delta.claims);
  if (count.erases !== 1 || targetId === undefined) {
    return "a tombstone erases exactly one delta (one delta-kind `erases` pointer)";
  }
  if (count.spokenBy !== 1 || spokenBy === undefined) {
    return "a tombstone carries exactly one string `spoken-by` (the erased delta's author)";
  }
  // The §29.6 join is OPTIONAL forever — every tombstone any store already holds carries none, so
  // no §20 step is engaged — but a PRESENT one is validated: a malformed join would make the
  // graveyard's arithmetic unreadable while looking like law.
  if (count.slate > 1 || (count.slate === 1 && slate === undefined)) {
    return `a tombstone carries at most one \`slate\` pointer, an entity reference at ${CTX_SLATE}`;
  }
  if (operator === undefined || delta.claims.author !== operator) {
    return "erasure is the instance operator's alone: only the operator may order a record removed";
  }
  // The operator's tombstone must still tell the truth about whose record it forgot, whenever
  // the target can still be seen — an accurate compliance record.
  const target = reactor.get(targetId);
  if (target !== undefined && target.claims.author !== spokenBy) {
    return "a tombstone's spoken-by must be the erased delta's actual author";
  }
  return undefined;
}

// The ids this ground refuses to hold: every surviving lawful tombstone's target. Binding
// tombstones are the operator's, and self-erasures (author === spoken-by — the door verified
// the claim while the target existed). A struck tombstone (lawful negation) is forgiveness:
// the id may return.
// The ids this ground refuses to hold: the target of every surviving, unstruck, OPERATOR-signed
// tombstone. Only the operator's tombstones bind — the same authority the door enforces — so an
// ungoverned store (no operator) honors no erasure, and a non-operator tombstone that somehow
// sits in the ground binds nothing. A struck tombstone (lawful negation) is forgiveness: the id
// may return.
export function readTombstones(reactor: Reactor, operator: string | undefined): Set<string> {
  const dead = new Set<string>();
  for (const tomb of survivingTombstones(reactor, operator)) {
    dead.add(tombstoneParts(tomb.claims).targetId!); // survivingTombstones proved it well-shaped
  }
  return dead;
}

// The surviving, lawful, operator-signed tombstones — the record of what this ground has
// forgotten (that it forgot, never what). One place computes the set both readTombstones (the
// dead ids) and forgottenSince (the as-of annotation) draw from, so the author-confirmation and
// forgiveness rules cannot drift between them.
export function survivingTombstones(reactor: Reactor, operator: string | undefined): Delta[] {
  if (operator === undefined) return []; // an ungoverned store honors no erasure at all
  const negated = lawfulNegated(reactor, operator);
  const out: Delta[] = [];
  for (const delta of reactor.snapshot()) {
    if (!isTombstone(delta.claims) || negated(delta.id)) continue; // struck = forgiven
    if (delta.claims.author !== operator) continue; // erasure is the operator's alone
    const { targetId, count } = tombstoneParts(delta.claims);
    if (targetId === undefined || count.erases !== 1) continue; // shape the door enforces
    out.push(delta);
  }
  return out;
}

/** One receipt, as a reader sees it: THAT an id was forgotten, by whose order, when, and why. */
export interface TombstoneReceipt {
  /** The receipt's own content address — what an erase prints and what a reader can look up. */
  readonly tombstone: string;
  /** The id it forgot. Retaining a hash retains zero content, which is what makes this honest. */
  readonly erased: string;
  /**
   * The erased delta's author, recorded while the target could still be seen. ABSENT rather than
   * blank when the tombstone carries none: `eraseDefect` requires it at the DOOR, and replay ingests
   * straight into the reactor, so a receipt replanted from an archive or written by an older version
   * can survive without one. A blank cell reads as an oversight; an absence has to be stated.
   */
  readonly spokenBy?: string;
  /** Who signed the removal order. §11 admits exactly one signer, so this is always the operator. */
  readonly orderedBy: string;
  readonly at: number;
  /** Why, in the operator's own words. EMPTY when the tombstone carries none — never invented. */
  readonly reasons: readonly string[];
  /** The §29.6 cut this was one member of. Absent on an ordinary single-delta erase, forever. */
  readonly slate?: string;
}

/**
 * The receipts this ground still stands behind, oldest first — read through `survivingTombstones`,
 * so no surface can print a receipt the admission door does not honour, or hide one it does.
 *
 * `inert` is the other half, and it is not decoration. A struck tombstone is FORGIVENESS: the
 * erasure order is withdrawn and the id may return, so the receipt leaves the surviving set. On a
 * screen that merely drops the row, an omission and a revocation look identical — and this listing
 * is read on the morning that difference decides a case. So the count is disclosed.
 *
 * It counts OPERATOR-AUTHORED tombstone-shaped deltas that are not in the surviving set: struck, or
 * malformed in a way the surviving reader refuses. A tombstone signed by anyone else was never a
 * receipt here — the door refuses one at admission — so it is not counted as one lost.
 */
export function receiptLedger(
  reactor: Reactor,
  operator: string | undefined,
): { receipts: TombstoneReceipt[]; inert: number } {
  // ONE walk, not two. `reactor.snapshot()` re-derives every delta's content address on the way in
  // — a full claim validation and a hash each — so a second pass to count the shaped set would pay
  // the whole store twice. `byTarget(ERASE_ENTITY)` narrows it to the tombstones: the index is
  // written beside the set it indexes, so it cannot go stale against a snapshot taken in the same
  // breath, and a row the driver set aside is invisible to both.
  let shaped = 0;
  if (operator !== undefined) {
    for (const id of reactor.byTarget(ERASE_ENTITY)) {
      const delta = reactor.get(id);
      if (delta !== undefined && isTombstone(delta.claims) && delta.claims.author === operator) {
        shaped += 1;
      }
    }
  }
  const surviving = survivingTombstones(reactor, operator);
  const receipts = surviving
    .map((d) => {
      const parts = tombstoneParts(d.claims);
      return {
        tombstone: d.id,
        erased: parts.targetId!, // survivingTombstones proved it well-shaped
        ...(parts.spokenBy === undefined ? {} : { spokenBy: parts.spokenBy }),
        orderedBy: d.claims.author,
        at: d.claims.timestamp,
        reasons: parts.reasons,
        ...(parts.slate === undefined ? {} : { slate: parts.slate }),
      };
    })
    .sort((a, b) => a.at - b.at || (a.tombstone < b.tombstone ? -1 : 1));
  return { receipts, inert: shaped - receipts.length };
}

// The erasure annotation (SPEC §26): the moments at which this ground lawfully forgot something
// SINCE a moment T. An as-of read reconstructs the SURVIVING ground at T; an erasure spoken after T
// may have redacted a fact that stood at T, so the read confesses each discontinuity's TIMESTAMP —
// never the content, for a tombstone keeps only THAT it forgot and WHEN. Erasures spoken at or
// before T are already baked into the moment's honest absence (the fact was gone by T) and need no
// mark; a present read needs none at all. Store-wide by necessity: a purged delta's entity is
// unknowable, so the honest signal is temporal — the sorted moments an erasure fell in the window
// since T (their length is the count), never scoped to this view.
export function forgottenSince(
  reactor: Reactor,
  operator: string | undefined,
  since: number,
): number[] {
  return survivingTombstones(reactor, operator)
    .map((d) => d.claims.timestamp)
    .filter((t) => t > since)
    .sort((a, b) => a - b);
}

// The pre-boot variant for `loam serve`: given the deltas held across the tiers (before any
// gateway or reactor exists), report the SAME dead set the running store would — so
// heal(exclude) is guarded with full fidelity from the first moment. It builds a throwaway
// reactor from the deltas and defers to readTombstones, so the author-confirmation and the
// lawful-negation (forgiveness) rules are computed in exactly one place and cannot drift
// between boot and run. (A lawfully struck tombstone is therefore NOT in the set — heal will
// not drop a forgiven record — and a self-erasure that disagrees with its target's author
// binds nothing here too.)
export function tombstonesIn(deltas: Iterable<Delta>, operator: string | undefined): Set<string> {
  const probe = new Reactor();
  for (const d of deltas) probe.ingest(d);
  return readTombstones(probe, operator);
}

// Sealed authorship (degree 3): a commitment carried on an anonymous reassertion. Anonymous
// today; reveal (salt, author) and anyone can recompute the hash — provably yours whenever
// you choose, no new cryptography.
export function sealCommitment(salt: string, author: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${salt}\u0000${author}`)));
}

// --- the Gateway's erasure behaviors (ticket T19: the body lives beside its vocabulary) ---------
// These are the implementations behind `Gateway.erase` / `Gateway.eraseReplica` — thin delegating
// methods on the class, bodies here where the tombstone vocabulary and its readers already live.
// They reach the gateway only through its declared internals seam (the `@internal` members on the
// class — see the seam note in gateway.ts).

// Erase one delta (the body of `Gateway.erase`): verify authority WHILE THE TARGET EXISTS, show the
// blast radius, land the tombstone (through authorize — the door validates it against the live
// target), purge every tier, and re-seat the gateway on the post-purge ground. The store remembers
// THAT it forgot — never what. Live subscriptions re-attach exactly as they do after a schema
// evolution or a crash; an animated gateway's runner must be re-attached (the host holds the old
// reactor).
export async function eraseImpl(
  gw: Gateway,
  id: string,
  opts: { reason?: string; slate?: string } = {},
): Promise<{
  erased: string;
  citations: string[];
  kept: string[];
  tombstone: string;
  spokenBy: string;
}> {
  // Erasure is the operator's alone (SPEC §11): destructive, so the only signer is the store's
  // own operator. A data subject's request is honored BY the operator, never by the subject
  // directly — there is no actor override here on purpose.
  const seed = gw.options.seed;
  if (seed === undefined || gw.operatorAuthor === undefined) {
    throw new Error("erasure is the instance operator's alone, and this store has no operator");
  }
  // The completeness guard (SPEC §27.7, T32), BEFORE any work: the mint made containers
  // enumerable AT REST while this fan-out walks only the ATTACHED set — after a restart those
  // can differ. A declared SEPARATE-posture container (bytes follow posture, so curated and
  // untrusted alike) that is neither attached nor covered by a surviving detach record could
  // hold this byte outside the sweep, so the erase refuses UP FRONT — nothing half-done, no
  // tombstone standing over an unreported gap. A covered store is returned in `kept`, on the
  // record; erasing a detach record out of order re-arms this guard for the NEXT erase.
  const stores = unreachableStoreReport(gw);
  if (stores.faults.length > 0) {
    throw new Error(
      `erase ${id} refused before any work began: the resolved container table names a store ` +
        `this sweep cannot reach, and an unreachable store would be a silent gap in §11's ` +
        `fan-out. ${stores.faults.length} fault(s):\n  ${stores.faults.join("\n  ")}\n` +
        `Attach the container(s) (openContainer), or detach() them onto the record, then re-run.`,
    );
  }
  // Retry anchors on the TOMBSTONE, read before the `nothing to erase` guard: a partial attempt
  // can leave the target gone from the reactor while a tier still holds the bytes, and a re-run
  // must not mint a second tombstone (a fresh timestamp is a new content address).
  // Anchor only on a tombstone that is SURVIVING (a struck one is forgiveness — the id may
  // return) and that ERASES this id (a pointer merely mentioning it is not an erasure of it).
  // `survivingTombstones` owns both rules, so the anchor and the dead set cannot drift.
  const already = survivingTombstones(gw.reactor, gw.operatorAuthor).find(
    (d) => tombstoneParts(d.claims).targetId === id,
  );
  const target = gw.reactor.get(id);
  // Bypass the guard only for an OUTSTANDING erasure — an id erased cleanly long ago also has a
  // surviving tombstone, and resolving `{ erased }` for it would report work never done.
  // Outstanding is asked of this ground AND its pools; the local backend alone would strand the
  // pool-retention retry. (A struck tombstone lands here too, correctly: forgiveness withdraws
  // the erasure, so a fresh one must be spoken rather than the old one silently reused.)
  if (target === undefined && (already === undefined || !(await erasureOutstanding(gw, id)))) {
    throw new Error(`nothing to erase: ${id} is not held here`);
  }
  if (target !== undefined && isTombstone(target.claims)) {
    // The erasure log is the record of what was forgotten; it stays append-only. Un-erasure
    // is striking the tombstone (forgiveness), never erasing it.
    throw new Error("the erasure log is append-only: a tombstone cannot itself be erased");
  }
  // A STANDING SLATE'S PINNED MEMBERSHIP TERM is not an ordinary delta (SPEC §29.2): erasing it leaves
  // that slate unable to read its own condemned set, so every door it closed silently stops enforcing
  // while the slate still reports itself standing. Refused here rather than tolerated, which is what
  // keeps that state unreachable through a door at all — the cut refuses the same delta as a member.
  const pinning = readSlates(gw.reactor, gw.operatorAuthor, Date.now()).find(
    (s) => s.membershipAt === id,
  );
  if (pinning !== undefined) {
    throw new Error(
      `erase ${id} refused: it is the PINNED membership Term of the standing slate over ` +
        `"${pinning.container}", and the slate's closures are all seeded from the ids it names. ` +
        `Erasing it would reopen every door that slate closed while it still read as standing. ` +
        `Cut the slate (which removes its members and drops the container), or strike its record and ` +
        `its declaration first — un-slating is free (§29.8).`,
    );
  }
  const tombstone =
    already ??
    signClaims(
      eraseClaims(
        id,
        target!.claims.author,
        gw.operatorAuthor,
        gw.nextTimestamp(),
        opts.reason,
        opts.slate,
      ),
      seed,
    );
  // The manifest: every delta citing the id (negations, provenance links) — the holes the
  // cut will leave, enumerated before it is made. Cascade is the caller's choice.
  // Excluded BY IDENTITY: only the tombstone this erasure mints or reuses. A shape filter would
  // both catch it on retry (a manifest that varies between attempts, a cascading caller sent to
  // erase the cut itself) and wrongly drop a struck tombstone from a forgiven earlier erasure —
  // a surviving delta dangling at the hole, which the manifest exists to enumerate.
  const citations = [...gw.reactor.snapshot()]
    .filter((d) => d.id !== tombstone.id)
    .filter((d) =>
      d.claims.pointers.some((p) => p.target.kind === "delta" && p.target.deltaRef.delta === id),
    )
    .map((d) => d.id);
  if (already === undefined) {
    await gw.append([tombstone]);
    await gw.flush(); // the tombstone must be ground before the target stops being ground
  }
  // The purge count is evidence of work, never the verdict: 0 means "never held" as often as
  // "refused to remove", and a mirror returns the max of its two sides, hiding a retaining tier.
  // Only byte-presence (`holds`) answers §11, asked at the end after re-seat and pool fan-out.
  // A local refusal is a fault to COLLECT, never an abort: thrown here it would deny the
  // tombstone and the sweep to every attached pool — one tier's fault becoming every replica's leak.
  let localPurge: unknown;
  try {
    await gw.backend.purge([id]);
  } catch (err) {
    localPurge = err;
  }
  try {
    await gw.reseat();
  } catch (err) {
    // Same backend the purge just used — same fault class, same collection; aborting here
    // would deny the pools their sweep.
    localPurge = localPurge ?? err;
  }
  // §24.8 — the erasure reaches every attached QUARANTINE POOL (the operator's own replicas of this
  // ground): the same tombstone lands there and the byte is purged there too, so a forgotten record can
  // never live on in a staging area inside the operator's own walls. §11 reaches through the one-way
  // glass unconditionally; a quarantine that could hide a purged byte would be an erasure-evasion channel.
  // SETTLE the whole fan-out, then report: a sequential walk aborts at the first refusing pool
  // and starves every replica behind it of both tombstone and purge — one replica's fault must
  // not become every other replica's leak (`MirrorBackend.purge`/`close` compose the same way).
  // `seen` membership is claimed synchronously at dispatch: a pool attached beneath two parents
  // is reachable, and a claim recorded only after the child's awaits could dispatch it twice.
  const seen = new Set<Gateway>([gw]);
  const targets = [...gw.quarantinePools].filter((pool) => !seen.has(pool));
  for (const pool of targets) seen.add(pool);
  const fanned = await Promise.allSettled(
    targets.map((pool) => pool.eraseReplica(tombstone, id, seen)),
  );
  // The verdict is asked of the BYTES, unconditionally — a purge count proves some tier removed
  // something, never that every tier did. Every fault lands in ONE report: the remedy is
  // "resolve and re-run", and one fault per round trip would cost a re-run per replica.
  const faults = await incompleteErasureFaults(gw, id, fanned);
  if (localPurge !== undefined) {
    faults.unshift({
      what: `this store's purge refused: ${localPurge instanceof Error ? localPurge.message : JSON.stringify(localPurge)}`,
      cause: localPurge,
    });
  }
  if (faults.length > 0) {
    throw new Error(
      `erase ${id}: the tombstone is recorded, but the content is STILL ` +
        `HELD by the store — erasure is not complete. ${faults.length} fault(s):\n  ` +
        `${faults.map((f) => f.what).join("\n  ")}\n` +
        `Resolve them and re-run; the re-run is safe and will not mint a second tombstone.`,
      { cause: faults[0]?.cause },
    );
  }
  // `kept` is the guard's entry-time reading — the container stores a surviving detach record
  // deliberately holds outside this sweep, reported rather than silent. The tombstone's id and the
  // target's author ride out too: a cut collects them per member (§29.5) rather than re-deriving them
  // from a ground the purge just moved.
  return {
    erased: id,
    citations,
    kept: stores.kept,
    tombstone: tombstone.id,
    spokenBy: tombstoneParts(tombstone.claims).spokenBy!,
  };
}

// Is this erasure still OUTSTANDING anywhere in reach — this ground or any replica of it? Its
// fault model must be the verdict's, or the two drift: outstanding means bytes held (or
// unprovable — a tier that cannot answer has proven nothing; H9), OR a reachable replica that
// does not yet carry the operator's tombstone for the id.
export async function erasureOutstanding(
  gw: Gateway,
  id: string,
  seen = new Set<Gateway>(),
): Promise<boolean> {
  return (await erasureStanding(gw, id, seen)) !== "settled";
}

/**
 * What a standing receipt is worth, keeping the difference a boolean throws away.
 *
 * "Could not be asked" and "still holds it" are both reasons not to call an erasure done, and they
 * are not the same sentence to whoever reads the screen: one is a measurement, the other is a
 * refusal to guess. Collapsed into `true`, a screen built on this reports a fact it never
 * established (H9).
 */
export type ErasureStanding =
  /** A tier still has the bytes at rest. */
  | "held"
  /** A tier refused the question. Nothing was proven in either direction. */
  | "unasked"
  /** No receipt in some ground in reach: the delivery is still owed there. */
  | "owed"
  /** Asked everywhere in reach, and clean. */
  | "settled";

// STRONGEST WINS, and "unasked" outranks "owed" deliberately: a tier that refused the question is
// the fact that most limits what any sentence below may claim, and a screen that said "no receipt
// yet" would be reporting the half it could measure while burying the half it could not.
//
// A RANK CANNOT CARRY A REFUSAL, though, which is why `unasked` is ALSO returned as its own set.
// "Held here" is a stronger true sentence than "unasked there", so it wins the cell — and if that
// were the only record, a store whose primary refused a purge while a pool's file was locked would
// report `unproven: false` and settle-in-progress over a tier that had answered nothing. The rank
// decides what a screen SAYS; the set decides what the store may claim to have established.
const STANDING_RANK: Record<ErasureStanding, number> = {
  held: 3,
  unasked: 2,
  owed: 1,
  settled: 0,
};

/** Per-id verdicts, and — independently — every id some ground could not be asked about. */
export interface StandingReport {
  readonly standings: ReadonlyMap<string, ErasureStanding>;
  readonly unasked: ReadonlySet<string>;
}

export async function erasureStanding(
  gw: Gateway,
  id: string,
  seen = new Set<Gateway>(),
): Promise<ErasureStanding> {
  return (await erasureStandings(gw, [id], seen)).standings.get(id) ?? "settled";
}

/**
 * THE ONE WALK, for one id or a thousand.
 *
 * An id is outstanding where bytes are held, where a tier cannot answer (H9 — unprovable is not
 * clean), or where a reachable replica does not yet carry the tombstone. This is the ONLY place
 * that model lives: the erase door, the health door and the receipt readers all read it from here,
 * because three copies of one fault model in one file is three chances for the screens to disagree
 * about a single store.
 *
 * Batched because the cost is not per id: `readTombstones` walks a whole ground, and
 * `ArchiveBackend.holds` pays a full sweep for every ABSENT id. The tombstone set is read once per
 * ground, and the backend is asked through `heldAmong` — one pass for the whole set — wherever the
 * driver offers it.
 */
export async function erasureStandings(
  gw: Gateway,
  ids: readonly string[],
  seen = new Set<Gateway>(),
): Promise<StandingReport> {
  const standings = new Map<string, ErasureStanding>(ids.map((id) => [id, "settled"]));
  const unasked = new Set<string>();
  const note = (id: string, verdict: ErasureStanding): void => {
    if (verdict === "unasked") unasked.add(id); // recorded whatever a louder ground says
    if (STANDING_RANK[verdict] > STANDING_RANK[standings.get(id) ?? "settled"]) {
      standings.set(id, verdict);
    }
  };
  if (ids.length === 0 || seen.has(gw)) return { standings, unasked };
  seen.add(gw);
  try {
    if (gw.backend.heldAmong) {
      for (const id of await gw.backend.heldAmong(ids)) note(id, "held");
    } else {
      for (const id of ids) if (await gw.backend.holds(id)) note(id, "held");
    }
  } catch {
    for (const id of ids) note(id, "unasked"); // proven nothing here, in either direction
  }
  // ASKED EVEN WHERE THE BYTES COULD NOT BE. The reactor is a separate question from the tier, and
  // a ground with no receipt still owes the delivery whatever its disk would have said.
  const tombs = readTombstones(gw.reactor, gw.operatorAuthor);
  for (const id of ids) if (!tombs.has(id)) note(id, "owed");
  for (const pool of gw.quarantinePools) {
    const sub = await erasureStandings(pool, ids, seen);
    for (const [id, verdict] of sub.standings) note(id, verdict);
    for (const id of sub.unasked) unasked.add(id); // a refusal one ground down is still a refusal
  }
  return { standings, unasked };
}

// Everything standing between this call and a completed erasure, collected rather than raced:
// this ground's retained bytes (or a tier that could not be asked), plus every replica refusal.
// Shared by both fan-out layers so the two halves cannot drift on how faults compose.
async function incompleteErasureFaults(
  gw: Gateway,
  id: string,
  fanned: readonly PromiseSettledResult<void>[],
): Promise<{ what: string; cause?: unknown }[]> {
  const faults: { what: string; cause?: unknown }[] = [];
  try {
    if (await gw.backend.holds(id)) {
      faults.push({ what: `this store STILL HOLDS the content at rest` });
    }
  } catch (err) {
    // Could not be asked is not clean — a tier that cannot answer has proven nothing (H9).
    faults.push({
      what: `this store could not be proven clean: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
    });
  }
  for (const r of fanned) {
    if (r.status === "rejected") {
      faults.push({
        what: `an attached quarantine pool refused: ${
          r.reason instanceof Error ? r.reason.message : String(r.reason)
        }`,
        cause: r.reason,
      });
    }
  }
  return faults;
}

// Honor an erasure DECIDED by the primary operator (the body of `Gateway.eraseReplica`, SPEC §24.8),
// called on a pool by the primary's fan-out: land the operator's tombstone (so the pool remembers the
// hole and refuses re-entry — the federation door already enforces that, §11), purge the byte, re-seat,
// and fan the same order into any pools of THIS pool (the law is transitive — a nested replica is still
// the operator's replica). No local target need exist; the erasure was decided upstream, and the shared
// operator makes the tombstone lawful here. This is what keeps a pool from becoming a place a forgotten
// byte can hide.
//
// A FAN-OUT MUST RE-DERIVE ITS OWN REACH. The purge re-checks the tombstone's lawfulness itself
// (eraseDefect — the authorization gate, checked FIRST and explicitly); the tombstone crosses the
// federation door past the pool's own TRUST policy (an explicit admit — trust is admission
// configuration, whose data do I want; erasure is LAW, §11 through the one-way glass
// unconditionally, and a `closed` pool is still the operator's own replica); and if the lawful
// tombstone STILL did not land, the only remaining cause is the store itself failing — so it
// THROWS, and the primary's `erase` rejects. Best-effort-and-loud, never a silent success.
export async function eraseReplicaImpl(
  gw: Gateway,
  tombstone: Delta,
  id: string,
  seen: Set<Gateway>,
): Promise<void> {
  // Authorization first, on its own: a forged or foreign removal-order is refused WITHOUT purging
  // — loudly, since only a hostile direct caller can reach this branch (the primary's fan-out only
  // ever hands over the tombstone its own erase door just validated).
  const defect = eraseDefect(tombstone, gw.reactor, gw.operatorAuthor);
  if (defect !== undefined) {
    throw new Error(`a replica purge is the operator's alone: ${defect}`);
  }
  await gw.federate([tombstone], { admit: () => true }); // lawful (checked above) — trust policy does not apply
  await gw.flush();
  if (!readTombstones(gw.reactor, gw.operatorAuthor).has(id)) {
    throw new Error(
      `the erasure did not complete: the operator's tombstone for ${id} could not land in an attached pool`,
    );
  }
  let localPurge: unknown;
  try {
    await gw.backend.purge([id]);
  } catch (err) {
    localPurge = err; // collected below — a pool tier's fault must not starve its own children
  }
  try {
    await gw.reseat();
  } catch (err) {
    localPurge = localPurge ?? err; // same fault class, same collection — see eraseImpl
  }
  // Transitive FIRST, verdict LAST (the order `eraseImpl` keeps): a verdict thrown before the
  // walk would starve every pool behind and beneath this one of both tombstone and purge —
  // trading one silent leak for a blocking leak across all the others. `seen` guards the walk
  // against a cycle; the whole walk is settled, then reported, so one unprovable replica cannot
  // hide another.
  seen.add(gw);
  const nested = [...gw.quarantinePools].filter((pool) => !seen.has(pool));
  for (const pool of nested) seen.add(pool); // claimed at dispatch — see the eraseImpl note
  const walked = await Promise.allSettled(
    nested.map((pool) => pool.eraseReplica(tombstone, id, seen)),
  );
  // This tier's own bytes AND every nested refusal, in ONE report, via the collector shared with
  // `eraseImpl`. A pool is where §11 is easiest to evade — a silently-retaining replica must not
  // read as clean outward, and a store that cannot be ASKED is a fault beside the others, never
  // an escape hatch that drops the nested refusals already in hand.
  const faults = await incompleteErasureFaults(gw, id, walked);
  if (localPurge !== undefined) {
    faults.unshift({
      what: `this pool's purge refused: ${localPurge instanceof Error ? localPurge.message : JSON.stringify(localPurge)}`,
      cause: localPurge,
    });
  }
  if (faults.length > 0) {
    throw new Error(
      `the erasure did not complete in an attached quarantine pool: a forgotten record must not ` +
        `survive inside the operator's own replica. ${faults.length} fault(s):\n  ` +
        `${faults.map((f) => f.what).join("\n  ")}\n` +
        `Resolve them and re-run the erasure; the re-run is safe and mints no second tombstone.`,
      { cause: faults[0]?.cause },
    );
  }
}

// --- health: the settling report (T70; Myk, 2026-07-24) --------------------------------------------
//
// This store is eventually consistent about FORGETTING: an erasure is decided the moment its
// tombstone lands, but the bytes leave each tier on that tier's own time — a lagging mirror, a
// locked WAL, a pool that was offline. That gap is a HEALTH state, not a fault: serve keeps
// serving, and health() answers, live, whether every erasure this ground has promised has settled
// to bytes. Live means computed NOW, from the reactor's surviving tombstones and a byte probe over
// the backend AND every attached quarantine pool — never a boot-time snapshot that goes stale as
// erasures land or bytes resurface. (Scope, honestly: the promise SET reads through the reactor,
// which seeds from the primary's deltasSince — a primary that lost its tombstones mid-run while a
// mirror kept a forgotten byte is out of this instrument's sight until the next boot heal.)

export interface ErasureHealth {
  readonly settled: boolean; // every promise is bytes-gone on every tier owned AND every attached pool
  readonly promised: number; // ids promised forgotten (targets of surviving operator tombstones)
  readonly pending: number; // of those, ids not yet settled everywhere in reach
  readonly outstanding: readonly string[]; // the ids themselves — operator-only surface
  readonly unproven: boolean; // some tier could not be examined: not settled, not failed (H9)
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
    "for a governed reader until its grant is struck. Removing the seed file, and striking its " +
    "signing grant (`loam user remove-role`), is a separate operation, out of erasure's scope.",
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

export interface StoreHealth {
  // "ok"       — every promise settled, nothing lagging.
  // "settling" — converging, not broken: erasure debt outstanding somewhere in reach, or a mirror
  //              behind on DURABILITY (lag is missing copies, not retained bytes — a different debt
  //              folded into the same "not yet ok").
  // "unproven" — a tier could not answer; treat as settling at best, never as ok (H9).
  //
  // A LAPSED SLATE MOVES NONE OF THESE (SPEC §29.4). `settling` means a promise already MADE has not
  // reached the bytes; a lapsed slate means a promise has not been KEPT, and the remedies differ —
  // wait or repair a tier, versus CUT. Conflating them teaches whoever watches `status` that
  // `settling` sometimes just means someone filed a slate, which is how a field earns the right to
  // be ignored. So the compliance clock lives in `slates`, and `status` keeps its meaning exactly.
  readonly status: "ok" | "settling" | "unproven";
  readonly erasure: ErasureHealth;
  readonly slates: SlateHealth;
  readonly forgiven: ForgivenHealth;
  readonly lagging?: boolean; // present when the backend exposes mirror lag (MirrorBackend)
  // The surfaces erasure does NOT reach, disclosed unconditionally: the two §36 home files
  // (T131, out of scope by design) and the ESM registry (T105 a, in scope but unprovable) — so
  // the report is honest about its own edges whatever the erasure state. A top-level field, never a
  // field of `ErasureHealth`: that interface is pinned by a `toEqual` rail (T70), and this fact is
  // about the report's scope rather than any one promise's settling.
  readonly nonSwept: readonly string[];
}

// The health door's reading of `erasureStandings` — the SAME walk the erase door and the receipt
// readers use, so the three cannot drift on what "outstanding" means. Everything but `settled` is
// outstanding; `unasked` is also what `unproven` means, which is why the walk keeps them apart.
async function outstandingAmong(
  gw: Gateway,
  ids: readonly string[],
  seen: Set<Gateway>,
): Promise<{ outstanding: Set<string>; unproven: boolean }> {
  const report = await erasureStandings(gw, ids, seen);
  const outstanding = new Set<string>();
  for (const [id, verdict] of report.standings) if (verdict !== "settled") outstanding.add(id);
  // FROM THE SET, NEVER FROM THE CELLS. A tier that refused is not visible in a verdict another
  // ground answered louder, and `unproven` is the one field that must not miss it.
  for (const id of report.unasked) outstanding.add(id);
  return { outstanding, unproven: report.unasked.size > 0 };
}

export async function healthImpl(gw: Gateway, now = Date.now()): Promise<StoreHealth> {
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  const ids = [...dead];
  let erasure: ErasureHealth;
  if (ids.length === 0) {
    erasure = { settled: true, promised: 0, pending: 0, outstanding: [], unproven: false };
  } else {
    const verdict = await outstandingAmong(gw, ids, new Set());
    erasure = {
      settled: verdict.outstanding.size === 0,
      promised: ids.length,
      pending: verdict.outstanding.size,
      outstanding: [...verdict.outstanding].sort(),
      unproven: verdict.unproven,
    };
  }
  const lagging = (gw.backend as { lagging?: unknown }).lagging;
  // T105 (a), deliberate: the ESM disclosure in nonSwept names an unprovable tier but does NOT
  // move the top-level verdict — the byte probes answered every tier they can ask, and an
  // unaskable tier reads as UNPROVEN beside them rather than as a failing probe. Moving the
  // verdict itself is the teardown half's decision (T105 b).
  const status = erasure.unproven
    ? "unproven"
    : erasure.settled && lagging !== true
      ? "ok"
      : "settling";
  return {
    status,
    erasure,
    // Both sections are LAWFUL facts rather than debt, so neither moves `status` — but without them
    // a lapsed compliance window and a forgiven-and-returned id are invisible to every instrument
    // the store has (a struck tombstone leaves `readTombstones`, and therefore `promised`, entirely).
    slates: slateHealth(gw, now),
    forgiven: forgivenHealth(gw),
    ...(typeof lagging === "boolean" && { lagging }),
    // The unswept-surface disclosures, unconditional: the home files (T131) are outside erasure's
    // reach by design, and the ESM registry (T105 a) is in scope but unprovable to the tier probes.
    // Both stay listed whether the store has forgotten nothing, something, or is mid-settle. The
    // receipt reads the SAME constants, so the two surfaces cannot drift.
    nonSwept: [...UNSWEPT_AUTH_SURFACES, ...ESM_RESIDENCY_DISCLOSURE],
  };
}
