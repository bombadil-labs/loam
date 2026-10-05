import {
  protectedIngressIds,
  verifiesAgainstHeld,
  parseLocalEvent,
  openingAgrees,
  localChannelEvidence,
  eventHeader,
  eventPrimitive,
  eventRef,
  type LocalChannelOpening,
} from "../federation/local-channel-events.js";
import { sameVerifiedDelta, localEraseTarget } from "./erase-law.js";
// The ingest doors (ticket T19: the Gateway's two entry points for deltas, in their own module).
// APPEND is the governed door: the batch is validated whole (verified signatures, the erasure
// holes, capability standing, resource budgets), persisted BEFORE it is served, refused loudly.
// FEDERATE is the union door: a peer's deltas cross by VERIFICATION alone plus an admission
// predicate — never authorize() — because federation is union at the substrate, not a governed
// mutation ("no authority deciding whose truth survives", SPEC §8); whether a peer's facts shape a
// local view is a read-time TRUST choice. Both doors remember the hole (§11): an erased id is
// refused re-entry until its erasure is lawfully struck.
//
// Foreign law stays inert by the SAME operator-rooting the local store uses: a federated grant /
// membership / registration / binding-definition authored by anyone but this store's operator binds
// nothing (grantHeld / readRegistrations / readBindingDefinitions all filter on the operator). This
// rests on one invariant the federation must keep: DISTINCT OPERATOR SEEDS ACROSS INSTANCES — two
// stores sharing an operator seed share legacy constitutional authority. Protected local channel
// events and controls are excluded regardless of signature. Give every instance
// its own operator identity. (The §24.1 quarantine pool is the one sanctioned shared-seed case.)
//
// These are the implementations behind `Gateway.append` / `federate` / `admitFor` / `offeredDeltas`
// — thin delegating methods on the class, bodies here. They reach the gateway only through its
// declared internals seam (the `@internal` members on the class — see the seam note in gateway.ts).

import {
  computeId,
  evalTermRaw,
  parseTerm,
  verifyDelta,
  type Delta,
  type DeltaSet,
  type EvalResult,
  type Term,
} from "@bombadil/rhizomatic";
import { authorize } from "./accounts.js";
import { budgetRefusal } from "./budget.js";
import { settleOwedPurges } from "./purge-settle.js";
import {
  ERASE_ENTITY,
  eraseDefect,
  erasedInBatch,
  erasureTarget,
  isErasure,
  refusedIds,
  erasuresOfErasures,
} from "./erase-law.js";
import {
  admitErasureOrders,
  admitLocal,
  admitReceived,
  JournalConflict,
  rereadHostPeer,
} from "./peer-admission.js";
import { Channel, streamAfter } from "./channel.js";
import type { AppendReceipt, FederationReport, Gateway } from "./gateway.js";
import { publicDefect } from "./public.js";
import { artifactDefect } from "./artifact.js";
import {
  readSlates,
  slateDefect,
  slateRefusal,
  egressWithheld,
  landsReadClosure,
} from "./slate-law.js";
import { declaresTrust, readTrustPolicy } from "./trust.js";
import { governedProgram, needsLowering } from "./governed-trust.js";
import { recordPrevious, recoveryDefect, userGroundOf } from "./user-root.js";
import { hasMemberOf, lowerMembershipJson } from "./member-of.js";
import { attachedPool } from "./container.js";
import { declaredInboxes, readContainerTable } from "./container-law.js";
import {
  cutForHere,
  isCutManifest,
  isStoreLocal,
  lateCutDefect,
  liveCutIds,
  manifestsFor,
  manifestDefect,
  pausedKeys,
} from "./recovery-cut.js";
import { withNegationClosure } from "./negation-closure.js";

// Persist a batch, THEN serve it (the body of `Gateway.append`). The batch is validated whole (one
// bad delta refuses the lot); it lands in the backend before the reactor sees it, so nothing a
// query or a subscriber can observe is ever less durable than the ground — a failed write means
// nothing happened, and the caller may simply retry. Only verified signatures pass: the substrate
// accepts unsigned deltas, the gateway does not (authority is always attested here). And each
// delta's author must hold STANDING — the operator, or a surviving operator-rooted write grant on
// this store; what the delta points at is not authorization's business (entities are unowned —
// trust is the reader's). Authorization reads the state as it stands before the batch — a batch
// cannot bootstrap its own permissions.
export async function appendImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  opts: { settle?: boolean } = {},
): Promise<AppendReceipt> {
  const batch = [...deltas];
  const protectedIds = protectedIngressIds(gw.reactor, batch);
  if (batch.some((d) => protectedIds.has(d.id)))
    throw new Error(
      "append rejected: protected local channel event/control requires the local service",
    );
  return appendValidated(gw, batch, opts.settle ?? true);
}

type LifecycleEventInput =
  | { action: "open"; opening: Omit<LocalChannelOpening, "id"> }
  | { action: "close"; channel: string; opening: string };

/** Channel lifecycle callers cannot construct receive receipts, including JavaScript callers. */
export async function issueChannelEvent(gw: Gateway, input: LifecycleEventInput): Promise<Delta> {
  if (input.action !== "open" && input.action !== "close")
    throw new Error("local channel received events require actual receive admission");
  return persistChannelEvent(gw, input);
}

async function persistChannelEvent(
  gw: Gateway,
  input:
    | LifecycleEventInput
    | {
        action: "received";
        channel: string;
        opening: string;
        received: readonly string[];
      },
): Promise<Delta> {
  const signer = gw.signer;
  if (signer === undefined || gw.operatorAuthor === undefined)
    throw new Error("local event requires an operated gateway");
  const channel = input.action === "open" ? input.opening.channel : input.channel;
  // The parent container comes from the opening this event belongs to, never from the caller.
  const into =
    input.action === "open"
      ? input.opening.into
      : (() => {
          const held = gw.reactor.get(input.opening);
          const parsed = held === undefined ? undefined : parseLocalEvent(held, gw.operatorAuthor);
          if (parsed?.action !== "open" || parsed.opening.channel !== channel)
            throw new Error("local channel event names no held opening of its channel");
          return parsed.opening.into;
        })();
  const pointers = [...eventHeader(channel, input.action, into)];
  if (input.action === "open") {
    const o = input.opening;
    const nonce = [...globalThis.crypto.getRandomValues(new Uint8Array(32))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    pointers.push(
      eventPrimitive("nonce", nonce),
      eventPrimitive("into", o.into),
      eventPrimitive("prefix", o.prefix),
      eventPrimitive("from", o.from),
      eventPrimitive("opener-kind", o.openedBy === undefined ? "root" : "bound"),
    );
    if (o.openedBy !== undefined)
      pointers.push(
        eventPrimitive("opened-by", o.openedBy),
        eventPrimitive("opened-from", o.openedFrom!),
      );
    pointers.push(
      eventRef("status-at-open", o.statusAtOpen),
      eventRef("pool-declaration", o.poolDeclaration),
    );
  } else {
    pointers.push(eventRef("opening", input.opening));
    if (input.action === "close") pointers.push(eventPrimitive("reason", "drop"));
    else pointers.push(...input.received.map((id) => eventRef("received", id)));
  }
  const d = signer.sign({ author: signer.author, ...gw.stamp(), pointers });
  const parsed = parseLocalEvent(d, gw.operatorAuthor);
  if (parsed === undefined || (parsed.action === "open" && !openingAgrees(gw, parsed.opening)))
    throw new Error("invalid local channel event association");
  const receipt = await appendValidated(gw, [d], true);
  if (receipt.accepted + receipt.duplicates !== 1 || !sameVerifiedDelta(gw.reactor.get(d.id), d))
    throw new Error("local channel event did not ingest");
  return d;
}
export type ChannelReceiveResult =
  | { readonly ok: true; readonly report: FederationReport }
  | {
      readonly ok: false;
      readonly report: FederationReport;
      readonly error: unknown;
      readonly missingAdmittedIds: boolean;
    };

/** Internal receive primitive: the caller already owns the channel's commit queue. */
export async function receiveChannelOfferInCommit(
  gw: Gateway,
  opening: LocalChannelOpening,
  offered: readonly Delta[],
): Promise<ChannelReceiveResult> {
  const expected = { ...opening };
  const offer = structuredClone([...offered]);
  const pool = gw.store.channels(gw).get(expected.channel);
  const ground = pool?.gateway;
  const currentEvidence = () => {
    const evidence = localChannelEvidence(gw, expected.channel);
    if (
      ground === undefined ||
      gw.store.channels(gw).get(expected.channel) !== pool ||
      pool?.gateway !== ground ||
      !gw.store.holds(gw, ground) ||
      evidence.state !== "open" ||
      evidence.opening.id !== expected.id ||
      evidence.opening.channel !== expected.channel ||
      evidence.opening.into !== expected.into ||
      evidence.opening.prefix !== expected.prefix ||
      evidence.opening.from !== expected.from ||
      evidence.opening.openedBy !== expected.openedBy ||
      evidence.opening.openedFrom !== expected.openedFrom ||
      evidence.opening.statusAtOpen !== expected.statusAtOpen ||
      evidence.opening.poolDeclaration !== expected.poolDeclaration
    )
      throw new Error("stale channel receive: opening association changed or unavailable");
    return evidence;
  };
  currentEvidence();
  // Use the actual door, including its admission and persistence fault seams.
  const report = await ground!.federate(offer, { ids: true, admittedIds: true });
  let missingAdmittedIds = false;
  try {
    const recorded = new Set(currentEvidence().received.map((d) => d.id));
    if (report.admittedIds === undefined) {
      if (report.accepted > 0 || offer.some((d) => !recorded.has(d.id))) {
        missingAdmittedIds = true;
        throw new Error("pool did not report actual admitted IDs");
      }
    } else {
      const received = [...new Set(report.admittedIds.filter((id) => !recorded.has(id)))].sort();
      if (received.length > 0)
        await persistChannelEvent(gw, {
          action: "received",
          channel: expected.channel,
          opening: expected.id,
          received,
        });
    }
    return { ok: true, report };
  } catch (error) {
    return { ok: false, report, error, missingAdmittedIds };
  }
}

/** Marked erasures reach this only from the operated erase service or verified attached fan-out. */
export async function appendLocalErasure(gw: Gateway, erasure: Delta): Promise<void> {
  if (localEraseTarget(erasure, gw.reactor, gw.operatorAuthor) === undefined)
    throw new Error("invalid local erasure control");
  await appendValidated(gw, [erasure], false); // the erase that sent it pays the purge
  if (!sameVerifiedDelta(gw.reactor.get(erasure.id), erasure))
    throw new Error("local erasure did not ingest");
}
async function appendValidated(
  gw: Gateway,
  deltas: Iterable<Delta>,
  settle: boolean,
): Promise<AppendReceipt> {
  const batch = [...deltas];
  const { receipt, fresh } = await admitting(gw, () =>
    retrying(gw, (clock) => appendAdmitted(gw, batch, clock)),
  );
  // An erasure order admitted here owes its target's purge (the journal recorded it).
  if (settle && fresh.some((d) => isErasure(d.claims))) await settleOwedPurges(gw);
  // A landing slate that closes `read` ends live subscriptions the way an erase does (SPEC §29.3).
  // `reseat()` already solves precisely this one phase later — "a parked reader must not keep serving
  // a view built on the pre-erase ground" — and the reason is identical here: nothing in the slate's
  // own deltas moves the watched entity's materialization, so no sink fires and no open stream would
  // ever narrow. Readers wake with `done` and resubscribe into the narrowed gather. Already-delivered
  // frames are not recalled; nothing can recall them, and §29.3's asymmetry already says so.
  if (landsReadClosure(gw, fresh, Date.now())) {
    for (const channel of [...gw.channels]) await channel.return();
  }
  return receipt;
}

// Admission is serialized per gateway. A batch is checked against the state it finds, then awaits
// the backend, then ingests; two unserialized batches could each pass a check that reads the same
// state (a pause, a budget, a recovery barrier) and both land. Only check, write and ingest run under
// the lock: closing streams after it may await a reader, and a reader may append.
const admissions = new WeakMap<Gateway, Promise<unknown>>();
export function admitting<T>(gw: Gateway, fn: () => Promise<T>): Promise<T> {
  const run = (admissions.get(gw) ?? Promise.resolve()).then(fn);
  admissions.set(
    gw,
    run.catch(() => {}),
  );
  return run;
}

// The one receive time of an admission, kept across its retries.
interface ArrivalClock {
  at?: number;
}

const CONFLICT_RETRIES = 3;

// Another writer on the same peer journal moved its head. Reopen, take in what it admitted, and run
// the whole admission again (Loam's checks, then the journal's), with the first receive time. A
// conflict is neither a refusal nor a write; past the bound it surfaces as a retryable error.
async function retrying<T>(gw: Gateway, fn: (clock: ArrivalClock) => Promise<T>): Promise<T> {
  const clock: ArrivalClock = {};
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn(clock);
    } catch (err) {
      if (!(err instanceof JournalConflict)) throw err;
      if (attempt >= CONFLICT_RETRIES) {
        throw new Error(
          `not committed: another writer changed this store ${attempt + 1} times during the ` +
            "admission. Nothing was admitted or refused; try again.",
        );
      }
      await catchUp(gw);
    }
  }
}

/**
 * Take in what another gateway committed to this container's journal since this one last read it.
 * The journal is the source of truth; a gateway's reactor is its view. Run under the admission
 * lock, so a read never ingests the rows of an append that is between its commit and its ingest.
 */
export function refreshImpl(gw: Gateway): Promise<void> {
  const peer = gw.peer;
  if (peer === undefined) return Promise.resolve();
  return admitting(gw, async () => {
    const read = await peer.store.readHead(peer.journal.peerId);
    if (read.status !== "head") throw new Error(`refresh: journal head is ${read.status}`);
    if (!gw.needsJournalRefresh && read.head === peer.journal.currentHead()) return;
    await catchUp(gw);
  });
}

/** @internal — take in what another writer admitted to this host's journal. */
export async function catchUp(gw: Gateway): Promise<void> {
  const recovering = gw.needsJournalRefresh;
  gw.needsJournalRefresh = true;
  const admitted = await rereadHostPeer(gw.peer!);
  const ids = new Set(admitted.map((d) => d.id));
  if (recovering || [...gw.reactor.snapshot().ids()].some((id) => !ids.has(id))) {
    // A removed row can survive in cached views and parked streams. Rebuild those together.
    await gw.reseat();
    gw.needsJournalRefresh = false;
    return;
  }
  const rows = admitted.filter((d) => gw.reactor.get(d.id) === undefined);
  if (rows.length === 0) {
    gw.needsJournalRefresh = false;
    return;
  }
  gw.advanceToNow();
  for (const d of rows) gw.justPersisted.add(d.id);
  try {
    for (const d of rows) {
      gw.ingestVia(d);
      gw.noteAuthorTime(d);
      gw.noteRegistrationTime(d);
    }
  } finally {
    for (const d of rows) gw.justPersisted.delete(d.id);
    gw.replayRegistrations();
    gw.armValidityTimer();
    gw.notifyUserDependents();
  }
  gw.needsJournalRefresh = false;
}

/** @internal Shared governed admission checks; caller must hold the admission queue. */
export function preflightAppend(gw: Gateway, batch: readonly Delta[], at: number): void {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  // An erased id is refused re-entry forever (SPEC §11), through append as through federation, even
  // after its erasure is negated. An erasure in this same batch is checked once the batch is valid.
  const dead = refusedIds(gw.reactor, gw.operatorAuthor);
  // And the door remembers what is being STAGED for removal (SPEC §29.3): a slate closing `cite`
  // refuses a delta that names one of its frozen members, so the DEPENDENT set cannot grow and no
  // new orphans exist at cut time. Here the refusal is INFORMATIVE and names the container — the
  // only parties who can trigger it are parties who could already read the target, so telling them
  // IS the notice; the mechanism and the warning turn out to be the same thing. The federation door
  // shares this ONE predicate and differs only in disclosure (see federateImpl).
  const slates = readSlates(gw.reactor, gw.validityNow(at), gw.operatorAuthor, at);
  for (const d of batch) {
    if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified") {
      throw new Error(
        `append rejected: delta ${d.id} is unsigned or not what it claims to be — ` +
          `the gateway accepts only verified authorship`,
      );
    }
    if (dead.has(d.id)) {
      throw new Error(
        `append rejected: delta ${d.id} was erased — an erasure at ${ERASE_ENTITY} refuses ` +
          `its return, and an erasure is permanent`,
      );
    }
    const cited = slateRefusal(slates, d);
    if (cited !== undefined) {
      throw new Error(
        `append rejected: delta ${d.id} names ${cited.member}, which is SLATED FOR ERASURE by the ` +
          `container "${cited.container}" — that slate closes \`cite\`, so the set of deltas ` +
          `depending on it cannot grow before the cut. This refusal is the notice. The citation may ` +
          `be resubmitted after the cut, where it will land as a dangling reference (§11's ` +
          `citations manifest exists because surviving deltas legitimately cite erased ids).`,
      );
    }
    // Governance begins with the operator: a gateway holding no operator identity is an
    // ungoverned local store (any verified delta is welcome); one holding an operator
    // enforces capabilities on everyone but the operator. Deployed gateways (step 6) are
    // always governed.
    if (gw.operatorAuthor !== undefined) {
      const verdict = authorize(
        gw.reactor,
        gw.validityNow(at),
        d,
        gw.operatorAuthor,
        batch,
        gw.lawAuthors("grants"),
      );
      if (!verdict.ok) {
        throw new Error(`append rejected: ${verdict.refusal}`);
      }
    }
  }
  // Recovery barrier (recovery-history.md), read under the admission lock so nothing lands between
  // the check and the commit. A record that retires a key commits only behind its barrier: a cut
  // manifest ahead of it in this append, naming a live cut in this store and in every declared pool,
  // and naming nothing else. A name for a cut not yet written could be filled in later by a writer
  // that never saw the record.
  if (gw.operatorAuthor !== undefined) {
    const op = gw.operatorAuthor;
    const refused = refusedIds(gw.reactor, op);
    const defect =
      lateCutDefect(gw.reactor, op, batch, refused) ??
      manifestDefect(gw.reactor, op, batch, (id) =>
        declaredInboxes(readContainerTable(gw.reactor, gw.validityNow(at), op)).some(
          (pool) => attachedPool(gw, pool)?.reactor.get(id) !== undefined,
        ),
      );
    if (defect !== undefined) throw new Error(`append rejected: ${defect}`);
    for (const d of batch) {
      const defect = recordBarrierDefect(gw, op, d, batch, refused, at);
      if (defect !== undefined) throw new Error(`append rejected: ${defect}`);
    }
  }
  // Door resource budgets (SPEC §25): a granted author the operator has metered may not append
  // past their volume quota — deployment config, re-resolved live from `loam:budget`, layered
  // above §12's stranger floor. Absent a budget the author is unmetered (today's behavior); the
  // operator sets budgets and is never metered. Checked once for the whole batch, on the state
  // as it stands before it — the same discipline authorize() reads under.
  if (gw.operatorAuthor !== undefined) {
    const overBudget = budgetRefusal(gw.reactor, gw.validityNow(at), gw.operatorAuthor, batch);
    if (overBudget !== undefined) {
      throw new Error(`append rejected: ${overBudget}`);
    }
  }
  // Every member is valid now, so an erasure in the batch binds, and its target in the same batch
  // is refused. Append is atomic, so the whole batch is refused.
  const erasureErasers = erasuresOfErasures(batch);
  const erasesErasure = batch.find((d) => erasureErasers.has(d.id));
  if (erasesErasure !== undefined) {
    throw new Error(
      `append rejected: erasure ${erasesErasure.id} erases another erasure in the same ` +
        `batch, and an erasure cannot itself be erased`,
    );
  }
  const erasedHere = erasedInBatch(batch, gw.operatorAuthor);
  const alsoErased = batch.find((d) => erasedHere.has(d.id));
  if (alsoErased !== undefined) {
    throw new Error(
      `append rejected: delta ${alsoErased.id} is erased by an erasure in the same batch, ` +
        `and an erasure is permanent`,
    );
  }
}

async function appendAdmitted(
  gw: Gateway,
  deltas: Iterable<Delta>,
  clock: ArrivalClock,
): Promise<{ receipt: AppendReceipt; fresh: Delta[] }> {
  const batch = [...deltas];
  const at = (clock.at ??= gw.now());
  preflightAppend(gw, batch, at);
  // A throw here means NOTHING was ingested or served.
  if (gw.peer === undefined) await gw.backend.append(batch);
  else await admitToJournal(gw, batch, at);
  let accepted = 0;
  let duplicates = 0;
  const fresh: Delta[] = [];
  gw.advanceToNow(); // views must stand at the present, or this batch is not yet valid there
  for (const d of batch) gw.justPersisted.add(d.id);
  try {
    for (const d of batch) {
      const result = gw.ingestVia(d);
      gw.noteAuthorTime(d);
      gw.noteRegistrationTime(d);
      if (result.status === "accepted") {
        accepted += 1;
        fresh.push(d);
      } else duplicates += 1; // "rejected" is unreachable: the batch was validated above
    }
  } finally {
    // Always cleared — duplicates never hit the raw stream, and a mid-ingest throw must not
    // leave stale ids silently exempting future raw-stream writes.
    for (const d of batch) gw.justPersisted.delete(d.id);
    gw.armValidityTimer(); // the batch may name the next boundary
    if (accepted > 0) gw.notifyUserDependents(); // pools read this ground's users
  }
  return { receipt: { accepted, duplicates }, fresh };
}

// The admission function the store's own TRUST POLICY dictates (the body of `Gateway.admitFor`),
// resolved fresh from the live deltas at loam:trust each call (trust is data — see trust.ts): open
// admits every verified delta, roster admits the operator and the named authors, closed admits
// nothing. `federate` and `pullFrom` use this when no explicit admit is given; an explicit
// predicate always wins.
//
// ROSTER IS AUTHORSHIP-SCOPED, and a negation's author is incidental to the claim it strikes: the
// operator rosters an author to receive THEIR data, not to filter out corrections to it. So the door
// closes the offered batch over what this predicate admits (see `federateImpl`) — otherwise a
// rostered pull takes a post and refuses the off-roster retraction that withdrew it.
export function admitForImpl(gw: Gateway): (d: Delta) => boolean {
  // The nearest key in the chain (own first, then selected hosts) that declares a policy governs.
  const now = gw.validityNow();
  const authors = gw.lawAuthors("trust");
  const governor = authors.find((a) => declaresTrust(gw.reactor, now, a)) ?? authors[0];
  const policy = readTrustPolicy(gw.reactor, now, governor);
  if (policy.mode === "open") return () => true;
  if (policy.mode === "closed") return () => false;
  // A roster passes the keys selected for trust: the child's own and, where it selects them, its
  // hosts' seeded copies. An inbox selects none, so only its own key passes.
  const trusted = new Set(authors);
  return (d) => trusted.has(d.claims.author) || policy.roster.has(d.claims.author);
}

// The same closure over a BATCH that is not local yet — the inbound federation door's remedy. A
// peer's offer carries its own negations, so the ground to close over is the offer itself: no store
// scan, no index, cost bounded by the batch's pointers rather than by the store.
//
// Direction is identical and non-negotiable: from an admitted delta to the negations OF it,
// transitively, never the reverse. Walking backward would admit a delta the door refused because
// something in the batch happens to strike it — a trust boundary turned into a leak.
export function withBatchNegationClosure(
  batch: readonly Delta[],
  admitted: readonly Delta[],
): Delta[] {
  const strikesOf = new Map<string, Delta[]>();
  for (const d of batch) {
    for (const p of d.claims.pointers) {
      if (p.role !== "negates" || p.target.kind !== "delta") continue;
      const bucket = strikesOf.get(p.target.deltaRef.delta);
      if (bucket === undefined) strikesOf.set(p.target.deltaRef.delta, [d]);
      else bucket.push(d);
    }
  }
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const strike of strikesOf.get(id) ?? []) {
      if (out.has(strike.id)) continue;
      out.set(strike.id, strike);
      pending.push(strike.id);
    }
  }
  return [...out.values()];
}

const NO_DEAD: ReadonlySet<string> = new Set();

// The ids this store has been ordered to forget, for a caller that runs PER PULSE. `refusedIds`
// costs two full-ground passes (a lawful-negation materialization, then a walk), and a store that
// holds no removal order at all can answer without paying either: an ungoverned store honors no
// erasure (§11), and an erasure must BE in the ground to bind. The existence probe is exact rather
// than heuristic, and it deliberately decides nothing else — which erasures SURVIVE, and whose
// author confirms them, stays the one place that owns those rules (H8: the cheap answer must not
// become a second implementation of the expensive one).
function deadSet(gw: Gateway): ReadonlySet<string> {
  if (gw.operatorAuthor === undefined) return NO_DEAD;
  for (const d of gw.reactor.snapshot()) {
    if (isErasure(d.claims)) return refusedIds(gw.reactor, gw.operatorAuthor);
  }
  return NO_DEAD;
}

// Drops what the store has been ORDERED to forget (SPEC §11) from a set a door is about to serve:
// every id a surviving erasure names, whether or not its bytes are still held. An erasure is
// ground before its target is purged, and a purge fault leaves it standing over retained bytes, so
// a door that trusted byte presence would serve a condemned delta for as long as that lasts.
//
// Dropping a condemned delta can revive what it was HOLDING DOWN: a retraction is a member like any
// other, and once it is withheld, its target would read live in this set while the store still
// holds the strike. So the target goes with it, transitively, since a target may be the strike that
// was keeping something else down. The invariant: no delta is served whose strike the store holds
// and this set does not carry. A purged strike is not one of those (it is gone, and the revival is
// what erasing a retraction MEANS); a condemned one is. Withholding more can only disclose less,
// which is the single direction a serving door may err in.
//
// For SERVING doors only. `select` and `freeze` stay raw: the erasure and container machinery
// must see every byte it has to account for (see `readGround` in slate.ts for the same split).
//
// "Erased" means a STANDING erasure names the id. A negated erasure stops refusing its id here,
// so a delta whose bytes survived could be served again. Closing that needs a store-level list of
// refused ids that outlives negation.
export function withoutErased(gw: Gateway, deltas: readonly Delta[]): Delta[] {
  const dead = deadSet(gw);
  if (dead.size === 0) return [...deltas];
  const kept = new Map(deltas.filter((d) => !dead.has(d.id)).map((d) => [d.id, d]));
  for (let moved = true; moved;) {
    moved = false;
    for (const id of [...kept.keys()]) {
      const stranded = gw.reactor
        .negationsOf(id)
        .some((s) => !kept.has(s) && gw.reactor.get(s) !== undefined);
      if (!stranded) continue;
      kept.delete(id);
      moved = true;
    }
  }
  return [...kept.values()];
}

// The surviving deltas this store offers a peer — everything, or what the offered lens selects,
// plus whatever struck it (above): offering a claim while withholding its retraction would
// republish something the operator had struck.
//
// THEN the EGRESS closure's subtraction (SPEC §29.3), and this is the ONE site — a separate-store
// container's reseed seeds from `gw.offeredDeltas()`, so one attached DURING the window would
// otherwise be born holding a condemned delta. One site closes both doors, and it is the right place
// on the merits: a container that never receives a condemned delta is one fewer copy for the cut to
// sweep, which is §24.8's recursion warning answered rather than restated. Deliberately NOT in
// `selectImpl` — see `readGround` for why that choke point is a deadlock rather than a refactor.
//
// The withheld set is NEGATION-CLOSED TRANSITIVELY, and the order is the inverse of the closure above
// it: `withNegationClosure` deliberately ENLARGED this set so a peer never receives a claim without
// its retraction, so a naive subtraction of a slated NEGATION would re-open the exact leak that
// closure exists to seal. Withholding a strike therefore withholds its target too. That
// UNDER-represents the post-cut world for exactly the resurfacing set — after the cut the target
// REVIVES and the peer would see it — and that is the correct direction: the operative promise is
// "the holder set cannot grow", un-slating is FREE (§29.8), and a revocable act must not have an
// irrevocable effect. The peer converges at the cut rather than during the window.
export function offeredDeltasImpl(gw: Gateway): Delta[] {
  const lens = gw.options.offeredLens;
  const offered =
    lens === undefined
      ? [...gw.reactor.snapshot()]
      : (() => {
          const result = evalRawGoverned(gw, lens, gw.reactor.snapshot());
          if (result.sort !== "dset") throw new Error("an offered lens must select a delta set");
          return withNegationClosure(gw, [...result.set]);
        })();
  const withheld = egressWithheld(gw, Date.now());
  // A store's own incarnation marker, cuts and outcomes are facts about this store only.
  const served = withoutErased(gw, offered).filter((d) => !isStoreLocal(d));
  return withheld.size === 0 ? served : served.filter((d) => !withheld.has(d.id));
}

// Raw membership machinery runs the LOWERED program too (governed-trust.ts), in raw mode: a
// governed trust policy trusts the keys its grants name, never the text of a `user:` subject.
function evalRawGoverned(gw: Gateway, term: Term, input: DeltaSet): EvalResult {
  const program = governedProgram(term, undefined, input, { raw: true }, userGroundOf(gw.reactor));
  return evalTermRaw(program.term, input);
}

// A membership naming a user (`loam.memberOf`) lowered to the authors acting for that user now.
function lowerMembership(gw: Gateway, term: unknown, now: number = gw.validityNow()): unknown {
  return lowerMembershipJson(
    term,
    gw.reactor,
    now,
    gw.operatorAuthor,
    refusedIds(gw.reactor, gw.operatorAuthor),
  );
}

// Membership is a query, first-class (SPEC §27.6, the body of `Gateway.select`): evaluate a
// rhizomatic Term — the JSON `op` profile — over this store's SURVIVING ground, once. The Term
// must select a DELTA SET (`difference`/`intersect` compose here, at the Term layer, to any
// depth — never inside `inView` predicates, whose depth-1 stratification §24.10 pins); anything
// else is refused loudly at the door. This is `offeredDeltas` parameterized IN ITS SCOPE — the same
// Term evaluation under a scope the caller names — and NOT the same reading: `offeredDeltas` adds
// the negation closure a peer must not be denied (H1), and `watch` additionally withholds what a
// surviving erasure has condemned (§11), as does the offer (`withoutErased`). A `select` caller
// gets neither, by design: `select` is membership machinery, and the erasure cut reads through it,
// so it hands back exactly what the Term selected, no more.
export function selectImpl(gw: Gateway, term: unknown, now?: number): Delta[] {
  const parsed = parseTerm(lowerMembership(gw, term, now));
  const result = evalRawGoverned(gw, parsed, gw.reactor.snapshot());
  if (result.sort !== "dset") {
    throw new Error(
      `select: the membership term must evaluate to a delta set (dset), not a ${result.sort} — ` +
        `a container's membership is a set of deltas, whatever shape a reader later lifts it into`,
    );
  }
  return [...result.set];
}

// The same Term, LIVE (the body of `Gateway.watch`): the current members, then a fresh evaluation
// whenever the ground moves and the membership actually changed. Built on the same Channel the
// entity streams ride — leaving the stream detaches immediately, a slow reader coalesces to the
// newest membership. §27.6's "nearly free": every pulse re-evaluates the one Term.
export function watchImpl(gw: Gateway, term: unknown): AsyncGenerator<Delta[], void, unknown> {
  if (gw.reseating !== undefined)
    return streamAfter(gw.reseating, () => watchImpl(gw, term), gw.channels);
  // Lowered again on every pulse: a membership naming a user moves when the user's keys do.
  const program = () => parseTerm(lowerMembership(gw, term));
  const parsed = program();
  const initial = evalRawGoverned(gw, parsed, gw.reactor.snapshot());
  if (initial.sort !== "dset") {
    throw new Error(
      `watch: the membership term must evaluate to a delta set (dset), not a ${initial.sort}`,
    );
  }
  // A frame is a NARROWED delta set, so it owes the negation closure (hazard H1): suppression is a
  // property of the operand set, and an entity- or context-scoped Term structurally CANNOT select
  // the retraction of a claim it selects — a negation carries only its `negates` pointer, no entity
  // and no context. Without the closure a reader lifting a frame into a View resolves a retracted
  // claim as LIVE, which is the same bug three narrowing doors already paid for.
  //
  // Then, and only then, drop what the store has been ORDERED to forget (SPEC §11): the erasure
  // is ground BEFORE its target is purged — erase sequences it that way on purpose — so the pulse
  // that fires in that window is the erasure's own, carrying a member whose bytes are going away.
  //
  // ORDER IS LOAD-BEARING, and it is the mirror of `containerScopeImpl`'s "subtract, THEN close":
  // there, closing last stops a narrowing from REVIVING a claim. Here the closure runs first and the
  // forgetting has the last word, so a strike survives unless the strike ITSELF was erased — and
  // erasing a retraction genuinely does revive its target, which is exactly what the reader's own
  // ground will say once the purge lands. Closing last would instead re-admit a negation the
  // operator ordered erased, defeating the drop.
  //
  // The federation offer applies the same drop. `select` and `freeze` do not, by design: they are
  // the membership machinery, and the erasure cut reads through them.
  const live = (members: readonly Delta[]): Delta[] =>
    withoutErased(gw, withNegationClosure(gw, members));
  let closed = false;
  const initialMembers = live([...initial.set]);
  let lastIds = new Set(initialMembers.map((d) => d.id));
  const channel: Channel<Delta[]> = new Channel<Delta[]>(
    () => {
      closed = true;
      gw.channels.delete(channel);
      gw.userPulses.delete(pulse);
    },
    (_pending, incoming) => incoming, // a slow reader gets the newest membership, nothing stale
  );
  // The reactor has no unsubscribe; the closed flag makes a detached watcher inert (the same
  // discipline the entity-stream sinks run). A governed Term also reads the users this ground reads,
  // which a pool's host can move with nothing arriving here, so the gateway pulses it then too.
  const pulse = (): void => {
    if (closed) return;
    const next = evalRawGoverned(gw, program(), gw.reactor.snapshot());
    if (next.sort !== "dset") return; // the term's sort is content-independent; unreachable
    const members = live([...next.set]);
    const ids = new Set(members.map((d) => d.id));
    if (ids.size === lastIds.size && [...ids].every((id) => lastIds.has(id))) return;
    lastIds = ids;
    channel.push(members);
  };
  gw.reactor.subscribeRaw(pulse);
  if (needsLowering(parsed, undefined) || hasMemberOf(term)) gw.userPulses.add(pulse);
  // Registered where teardown can reach it: this subscription is bound to TODAY's reactor, and an
  // erase replaces that reactor — unregistered, the watcher would neither be woken nor ever fire
  // again, freezing on its pre-erase membership with no `done` to notice by.
  gw.channels.add(channel);
  channel.push(initialMembers);
  return channel;
}

// Admit a batch of peer deltas (the body of `Gateway.federate`): verify each (a forgery or an
// unsigned delta is refused, and one bad delta does not spoil the rest), apply the admission
// predicate, then ingest + write through. Idempotent — union dedups, so re-pulling accepts nothing
// new.
//
// A DOOR THAT NARROWS BY AUTHORSHIP OWES THE NEGATION CLOSURE (H1), and here it must be drawn from
// the OFFERED BATCH: the negations are not local yet, so `withNegationClosure`'s local index knows
// nothing about them. Admission is decided in two passes for that reason — first what is LAWFUL at
// this door, then what the predicate admits, then the closure over the batch, which widens ONLY by
// the negations of already-admitted deltas and only among deltas that were lawful anyway. A forged,
// erased, or malformed negation is refused exactly as before; the widening is of the admission
// PREDICATE, nothing else.
//
// AND ONLY WHERE ADMISSION WAS POLICY-DRIVEN. An explicit `admit` is the caller's own trust boundary
// and may be filtering negations deliberately (refusing a stranger's strike is the interim answer to
// the heckler's veto, pinned in test/federation/federate.test.ts) — the door must not overrule that
// judgment by importing what the caller refused. Such a caller owns the closure, like every other
// holder of a raw delta set; `PullOptions.admit` says so where a caller will read it. Closing that
// asymmetry needs read-time authority-scoped suppression, which is substrate work (rhizomatic#2).
// Why a retiring operator record `d` may not land here, or undefined. It commits only behind a HELD
// manifest that names a live cut in this store and in every declared pool, and names no cut that is
// not live. Both doors ask it: a record that skipped the barrier would move a user's root with no
// history line drawn. `batch` holds cuts arriving beside the record in this store's own append.
function recordBarrierDefect(
  gw: Gateway,
  op: string,
  d: Delta,
  batch: readonly Delta[],
  refused: ReadonlySet<string>,
  at = gw.now(),
): string | undefined {
  const previous = d.claims.author === op ? recordPrevious(d) : undefined;
  if (previous === undefined) return undefined;
  const manifests = manifestsFor(gw.reactor, op, d, refused);
  if (manifests.length === 0) {
    return (
      `recovery ${d.id} retires ${previous} and no cut manifest for it is held. ` +
      "`loam user recover` writes the cuts and the manifest in an earlier append."
    );
  }
  const stores = [
    { name: "this store", ground: gw as Gateway | undefined, batch },
    ...declaredInboxes(readContainerTable(gw.reactor, gw.validityNow(at), op)).map((pool) => ({
      name: pool,
      ground: attachedPool(gw, pool),
      batch: [] as readonly Delta[],
    })),
  ];
  // A cut is its ground's own law: each store's cuts are read with that store's own key.
  const liveBy = stores.map((s) => {
    const law = s.ground?.operatorAuthor;
    return s.ground === undefined || law === undefined
      ? new Set<string>()
      : liveCutIds(
          s.ground.reactor,
          law,
          s.batch,
          d.id,
          previous,
          refusedIds(s.ground.reactor, law),
        );
  });
  const live = new Set(liveBy.flatMap((ids) => [...ids]));
  let first: string | undefined;
  for (const named of manifests) {
    const uncut = stores.filter((_, i) => ![...liveBy[i]!].some((id) => named.has(id)));
    const unwritten = [...named].filter((id) => !live.has(id));
    if (uncut.length === 0 && unwritten.length === 0) return undefined;
    first ??=
      uncut.length > 0
        ? `recovery ${d.id} retires ${previous}, and ${uncut.map((s) => s.name).join(", ")} ` +
          `holds no live cut for it in its manifest (or is not attached), so ${previous} could ` +
          "write there unseen. `loam user recover` writes the cuts first."
        : `the cut manifest for ${d.id} names ${unwritten.join(", ")}, which no store here ` +
          "holds as a live cut";
  }
  return first;
}

// The local door on the journal path: one atomic transfer. Ordinary deltas alone go through
// `admit`; an append carrying erasure orders goes through the mixed transfer, orders first.
async function admitToJournal(gw: Gateway, batch: readonly Delta[], at: number): Promise<void> {
  const orders = batch.filter((d) => isErasure(d.claims));
  if (orders.length === 0) return admitLocal(gw.peer!, batch, at, () => false);
  const ordinary = batch.filter((d) => !isErasure(d.claims));
  await admitErasureOrders(gw.peer!, await ordersFor(gw, orders), "local", at, ordinary);
}

// Federation on the journal path: one transfer. Ordinary deltas alone go through `admit`; a pull
// that carries erasure orders goes through the mixed transfer, orders first.
async function receiveIntoJournal(
  gw: Gateway,
  admitted: readonly Delta[],
  at: number,
): Promise<Delta[]> {
  const ordinary = admitted.filter((d) => !isErasure(d.claims));
  const orders = admitted.filter((d) => isErasure(d.claims));
  const ok =
    orders.length === 0
      ? await admitReceived(gw.peer!, ordinary, at, () => false)
      : await admitErasureOrders(
          gw.peer!,
          await ordersFor(gw, orders),
          "unattributed",
          at,
          ordinary,
        );
  return admitted.filter((d) => ok.has(d.id));
}

async function ordersFor(gw: Gateway, erasures: readonly Delta[]) {
  return Promise.all(
    erasures.map(async (d) => {
      const targetId = erasureTarget(d.claims)!;
      // Conservative: a store that may hold the bytes records a purge obligation.
      return { delta: d, targetId, surfaceHoldsBytes: await gw.backend.holds(targetId) };
    }),
  );
}

export async function federateImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  opts: { admit?: (d: Delta) => boolean; ids?: boolean; admittedIds?: boolean } = {},
): Promise<FederationReport> {
  const offered = [...deltas];
  const { all, now, admitted, rejected, acceptedIds, admittedIds } = await admitting(gw, () =>
    retrying(gw, (clock) => federateAdmitted(gw, offered, opts, clock)),
  );
  // An erasure order that crossed owes its target's purge here, as at append.
  if (admitted.some((d) => isErasure(d.claims))) await settleOwedPurges(gw);
  // As at append: a batch that closes reads (a slate record or an erasure) touches no watched
  // entity, so open streams end and readers resubscribe into the narrowed reading.
  const freshIds = new Set(acceptedIds);
  if (
    freshIds.size > 0 &&
    landsReadClosure(
      gw,
      admitted.filter((d) => freshIds.has(d.id)),
      now,
    )
  ) {
    for (const channel of [...gw.channels]) await channel.return();
  }
  const accepted = acceptedIds.length;
  const crossedIds = new Set(admitted.map((d) => d.id));
  // "accepted" counts deltas NEWLY ingested — a duplicate verified but merged into what was
  // already there, so a re-pull accepts nothing (union is idempotent). "held" is the unique-id
  // remainder: offered ids neither newly ingested nor refused. Occurrences and unique ids are
  // different dimensions (a refused delta offered twice counts twice in `rejected` and once in
  // `held`'s complement), so the two are never subtracted from each other.
  const notCrossedIds = new Set(all.filter((d) => !crossedIds.has(d.id)).map((d) => d.id));
  const held = new Set(all.map((d) => d.id)).size - accepted - notCrossedIds.size;
  const counts = { offered: all.length, accepted, rejected, held };
  // The ids ride only when asked (see FederationReport): the counts are what every other caller
  // reads, and the report keeps exactly the shape they compare.
  return opts.ids === true
    ? {
        ...counts,
        acceptedIds,
        ...(opts.admittedIds === true ? { admittedIds: [...admittedIds].sort() } : {}),
      }
    : counts;
}

async function federateAdmitted(
  gw: Gateway,
  deltas: Iterable<Delta>,
  opts: { admit?: (d: Delta) => boolean; ids?: boolean; admittedIds?: boolean },
  clock: ArrivalClock,
): Promise<{
  all: Delta[];
  now: number;
  admitted: Delta[];
  rejected: number;
  acceptedIds: string[];
  admittedIds: Set<string>;
}> {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  if (opts.admittedIds === true && opts.ids !== true)
    throw new Error("admittedIds requires ids: true");
  const all = [...deltas];
  const protectedIds = protectedIngressIds(gw.reactor, all);
  const byPolicy = opts.admit === undefined; // whose boundary this is, and so who owns the closure
  const admit = opts.admit ?? admitForImpl(gw); // the store's trust policy, unless overridden
  // An erased id is refused re-entry forever (SPEC §11), even past an explicit admit override, even
  // after its erasure is negated. An erasure in this same offer binds once it is admitted, below.
  const dead = refusedIds(gw.reactor, gw.operatorAuthor);
  const paused = pausedKeys(gw.reactor, gw.operatorAuthor, dead);
  // The SAME cite predicate the append door runs (SPEC §29.3) — one rule, two sites, because all
  // seven findings of 2026-07-21 were one-rule-N-sites-one-drifts with the federation site as the
  // one that drifted. Here the disclosure discipline INVERTS: a peer pushing a citation may have no
  // read access to the target, so a distinguishable refusal would announce that something exists and
  // is on its way out. It costs nothing to be uniform — this door already returns counts and no
  // message, so a slate refusal is indistinguishable from any other rejection.
  const now = (clock.at ??= Date.now()); // one moment for the slate check, the stream closure and the journal
  const slates = readSlates(gw.reactor, gw.validityNow(), gw.operatorAuthor, now);
  const lawful: Delta[] = [];
  let admitted: Delta[] = [];
  for (const d of all) {
    // An erasure is a removal-order, not an inert claim — so it faces the same validator at
    // this door as at the append door (eraseDefect), and an unauthorized or malformed one is
    // refused rather than stored. Likewise a public-read declaration: it OPENS a door, so a
    // malformed one is refused here exactly as at append (publicDefect), and an artifact
    // declaration alongside it (artifactDefect) — the two doors must
    // not disagree about what lawful loam:public data is. Everything the readers trust
    // downstream passed a door here.
    if (
      protectedIds.has(d.id) ||
      !verifiesAgainstHeld(gw.reactor, d) ||
      dead.has(d.id) ||
      publicDefect(d.claims) !== undefined ||
      artifactDefect(d.claims) !== undefined ||
      (isErasure(d.claims) && eraseDefect(d, gw.reactor, gw.operatorAuthor, all) !== undefined) ||
      slateDefect(d, gw.reactor, gw.validityNow(), gw.operatorAuthor) !== undefined ||
      recoveryDefect(d, gw.reactor, gw.operatorAuthor, all) !== undefined ||
      (gw.operatorAuthor !== undefined &&
        recordBarrierDefect(gw, gw.operatorAuthor, d, [], dead) !== undefined) ||
      paused.has(d.claims.author) ||
      // A cut for this store is written by this store's own append, before its record; one that
      // arrives by federation could come after the record and count what came between.
      cutForHere(gw.reactor, gw.operatorAuthor, d, dead) ||
      isCutManifest(d) ||
      // A cite refusal belongs with the UNLAWFUL group and not with the un-admitted one: the
      // batch-scoped closure below deliberately readmits negations of what crossed, and a delta this
      // store is staging a removal over must never come back through it. Safe by construction with
      // the per-pointer `negates` exemption — a strike of a member is never refused here in the first
      // place, so nothing that closure needs is ever in this bucket.
      slateRefusal(slates, d) !== undefined
    ) {
      continue; // unlawful at this door: no predicate and no closure can readmit it
    }
    lawful.push(d);
    if (admit(d)) admitted.push(d);
  }
  // The strikes of what crossed cross too, from within the offer. Skipped when the predicate
  // admitted everything lawful (nothing left to close over) and when the caller brought their own.
  if (byPolicy && admitted.length < lawful.length) {
    admitted = withBatchNegationClosure(lawful, admitted);
  }
  // An erasure admitted in this offer refuses its target in the same offer. Only ADMITTED
  // erasures count: one this path refused, or the caller's predicate turned away, never bound.
  // An erasure that erases another erasure is dropped first: an erasure is never erased.
  const erasesErasure = erasuresOfErasures(admitted);
  if (erasesErasure.size > 0) admitted = admitted.filter((d) => !erasesErasure.has(d.id));
  const erasedHere = erasedInBatch(admitted, gw.operatorAuthor);
  if (erasedHere.size > 0) admitted = admitted.filter((d) => !erasedHere.has(d.id));
  // Recovery evidence is judged against what actually lands: a record or lineage claim whose
  // predecessor the predicate turned away (or this door refused) would persist as an orphan and
  // break the user's chain. So is an erasure: one that is lawful only beside its partner (a cut and
  // its outcome) must not land alone. Repeat until nothing more drops, since a dropped record
  // strands its own successors.
  for (;;) {
    const gone = new Set([
      ...userGroundOf(gw.reactor).erased(),
      ...erasedInBatch(admitted, gw.operatorAuthor),
    ]);
    const kept = admitted.filter(
      (d) =>
        recoveryDefect(d, gw.reactor, gw.operatorAuthor, admitted, () => gone) === undefined &&
        (!isErasure(d.claims) ||
          eraseDefect(d, gw.reactor, gw.operatorAuthor, admitted) === undefined),
    );
    if (kept.length === admitted.length) break;
    admitted = kept;
  }
  // Counted per offered delta rather than inferred from set sizes: the closure keys by id, so a peer
  // that offers the same delta twice would otherwise be reported as one refusal that never happened.
  // On the journal path the journal decides last: what it does not admit is not stored or served.
  const landed =
    gw.peer === undefined || admitted.length === 0
      ? admitted
      : await receiveIntoJournal(gw, admitted, now);
  const crossed = new Set(landed.map((d) => d.id));
  const rejected = all.reduce((n, d) => (crossed.has(d.id) ? n : n + 1), 0);
  // The ids are collected in THIS loop, from the same verdict that increments the count — so
  // `acceptedIds` and `accepted` cannot disagree about which deltas newly landed. Anything that
  // recovered the set afterwards would be answering a different question a moment later.
  const acceptedIds: string[] = [];
  const admittedIds = new Set<string>();
  if (landed.length > 0) {
    if (gw.peer === undefined) await gw.backend.append(landed);
    gw.advanceToNow(); // as at append
    for (const d of landed) gw.justPersisted.add(d.id);
    try {
      for (const d of landed) {
        const result = gw.ingestVia(d);
        if (result.status !== "rejected") {
          gw.noteAuthorTime(d);
          gw.noteRegistrationTime(d);
        }
        if (result.status === "accepted") {
          acceptedIds.push(d.id);
          admittedIds.add(d.id);
        } else if (result.status === "duplicate" && sameVerifiedDelta(gw.reactor.get(d.id), d))
          admittedIds.add(d.id);
      }
    } finally {
      for (const d of landed) gw.justPersisted.delete(d.id);
      gw.armValidityTimer(); // as at append
      if (acceptedIds.length > 0) gw.notifyUserDependents(); // as at append
    }
  }
  return { all, now, admitted: landed, rejected, acceptedIds, admittedIds };
}
