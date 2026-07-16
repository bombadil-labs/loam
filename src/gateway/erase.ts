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
import type { Gateway } from "./gateway.js";

export const ERASE_ENTITY = "loam:erasure";
export const CTX_ERASE = "loam.erasure";

// One tombstone: the erased id (a delta-kind ref), the target's author recorded while it
// could still be verified, and an optional human reason (the compliance log reads itself).
export function eraseClaims(
  targetId: string,
  targetAuthor: string,
  author: string,
  timestamp: number,
  reason?: string,
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
    ],
  };
}

const tombstoneParts = (
  claims: Claims,
): {
  targetId: string | undefined;
  spokenBy: string | undefined;
  count: { erases: number; spokenBy: number };
} => {
  let targetId: string | undefined;
  let spokenBy: string | undefined;
  const count = { erases: 0, spokenBy: 0 };
  for (const p of claims.pointers) {
    if (p.role === "erases" && p.target.kind === "delta") {
      count.erases += 1;
      targetId = p.target.deltaRef.delta;
    }
    if (p.role === "spoken-by") {
      count.spokenBy += 1;
      if (p.target.kind === "primitive" && typeof p.target.value === "string") {
        spokenBy = p.target.value;
      }
    }
  }
  return { targetId, spokenBy, count };
};

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
  const { targetId, spokenBy, count } = tombstoneParts(delta.claims);
  if (count.erases !== 1 || targetId === undefined) {
    return "a tombstone erases exactly one delta (one delta-kind `erases` pointer)";
  }
  if (count.spokenBy !== 1 || spokenBy === undefined) {
    return "a tombstone carries exactly one string `spoken-by` (the erased delta's author)";
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
function survivingTombstones(reactor: Reactor, operator: string | undefined): Delta[] {
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
  opts: { reason?: string } = {},
): Promise<{ erased: string; citations: string[] }> {
  // Erasure is the operator's alone (SPEC §11): destructive, so the only signer is the store's
  // own operator. A data subject's request is honored BY the operator, never by the subject
  // directly — there is no actor override here on purpose.
  const seed = gw.options.seed;
  if (seed === undefined || gw.operatorAuthor === undefined) {
    throw new Error("erasure is the instance operator's alone, and this store has no operator");
  }
  const target = gw.reactor.get(id);
  if (target === undefined) {
    throw new Error(`nothing to erase: ${id} is not held here`);
  }
  if (isTombstone(target.claims)) {
    // The erasure log is the record of what was forgotten; it stays append-only. Un-erasure
    // is striking the tombstone (forgiveness), never erasing it.
    throw new Error("the erasure log is append-only: a tombstone cannot itself be erased");
  }
  // The manifest: every delta citing the id (negations, provenance links) — the holes the
  // cut will leave, enumerated before it is made. Cascade is the caller's choice.
  const citations = [...gw.reactor.snapshot()]
    .filter((d) =>
      d.claims.pointers.some((p) => p.target.kind === "delta" && p.target.deltaRef.delta === id),
    )
    .map((d) => d.id);
  const tombstone = signClaims(
    eraseClaims(id, target.claims.author, gw.operatorAuthor, gw.nextTimestamp(), opts.reason),
    seed,
  );
  await gw.append([tombstone]);
  await gw.flush(); // the tombstone must be ground before the target stops being ground
  await gw.backend.purge([id]);
  await gw.reseat();
  // §24.8 — the erasure reaches every attached QUARANTINE POOL (the operator's own replicas of this
  // ground): the same tombstone lands there and the byte is purged there too, so a forgotten record can
  // never live on in a staging area inside the operator's own walls. §11 reaches through the one-way
  // glass unconditionally; a quarantine that could hide a purged byte would be an erasure-evasion channel.
  const seen = new Set<Gateway>([gw]);
  for (const pool of gw.quarantinePools) await pool.eraseReplica(tombstone, id, seen);
  return { erased: id, citations };
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
  await gw.backend.purge([id]);
  await gw.reseat();
  // Transitive: a pool of a pool holds the operator's bytes too. `seen` guards the walk — a cycle
  // among pools cannot arise from openQuarantine (each pool is a fresh gateway), but a fan-out
  // that could infinite-loop would be a worse bug than the one this fixed.
  seen.add(gw);
  for (const pool of gw.quarantinePools) {
    if (!seen.has(pool)) await pool.eraseReplica(tombstone, id, seen);
  }
}
