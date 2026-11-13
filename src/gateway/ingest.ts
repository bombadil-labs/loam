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

import {
  computeId,
  evalTermRaw,
  parseTerm,
  verifyDelta,
  type Delta,
  type DeltaSet,
  type EvalResult,
  type IngestResult,
  type Reactor,
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

export async function appendLocalErasure(gw: Gateway, erasure: Delta): Promise<void> {
  if (localEraseTarget(erasure, gw.reactor, gw.operatorAuthor) === undefined)
    throw new Error("invalid local erasure control");
  await appendValidated(gw, [erasure], false);
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
  if (settle && fresh.some((d) => isErasure(d.claims))) await settleOwedPurges(gw);
  if (landsReadClosure(gw, fresh, Date.now())) {
    for (const channel of [...gw.channels]) await channel.return();
  }
  return receipt;
}

const admissions = new WeakMap<Gateway, Promise<unknown>>();
export function admitting<T>(gw: Gateway, fn: () => Promise<T>): Promise<T> {
  const run = (admissions.get(gw) ?? Promise.resolve()).then(fn);
  admissions.set(
    gw,
    run.catch(() => {}),
  );
  return run;
}

interface ArrivalClock {
  at?: number;
}

const CONFLICT_RETRIES = 3;

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

export async function catchUp(gw: Gateway): Promise<void> {
  const recovering = gw.needsJournalRefresh;
  gw.needsJournalRefresh = true;
  const admitted = await rereadHostPeer(gw.peer!);
  const ids = new Set(admitted.map((d) => d.id));
  if (recovering || [...gw.reactor.snapshot().ids()].some((id) => !ids.has(id))) {
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
    gw.ingestAllVia(rows);
    for (const d of rows) {
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

export function preflightAppend(gw: Gateway, batch: readonly Delta[], at: number): void {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  const dead = refusedIds(gw.reactor, gw.operatorAuthor);
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
  if (gw.operatorAuthor !== undefined) {
    const overBudget = budgetRefusal(gw.reactor, gw.validityNow(at), gw.operatorAuthor, batch);
    if (overBudget !== undefined) {
      throw new Error(`append rejected: ${overBudget}`);
    }
  }
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

export function ingestTogether(reactor: Reactor, batch: readonly Delta[]): IngestResult[] {
  const seen = new Set<string>();
  const verdicts = batch.map((d): IngestResult => {
    if (reactor.get(d.id) !== undefined || seen.has(d.id)) return { status: "duplicate" };
    seen.add(d.id);
    return { status: "accepted" };
  });
  const fresh = batch.filter((_, i) => verdicts[i]!.status === "accepted");
  if (fresh.length === 0 || reactor.ingestBatch(fresh).status === "accepted") return verdicts;
  return batch.map((d) => reactor.ingest(d));
}

async function appendAdmitted(
  gw: Gateway,
  deltas: Iterable<Delta>,
  clock: ArrivalClock,
): Promise<{ receipt: AppendReceipt; fresh: Delta[] }> {
  const batch = [...deltas];
  const at = (clock.at ??= gw.now());
  preflightAppend(gw, batch, at);
  if (gw.peer === undefined) await gw.backend.append(batch);
  else await admitToJournal(gw, batch, at);
  let accepted = 0;
  let duplicates = 0;
  const fresh: Delta[] = [];
  gw.advanceToNow();
  for (const d of batch) gw.justPersisted.add(d.id);
  try {
    const verdicts = gw.ingestAllVia(batch);
    for (const [i, d] of batch.entries()) {
      const result = verdicts[i]!;
      gw.noteAuthorTime(d);
      gw.noteRegistrationTime(d);
      if (result.status === "accepted") {
        accepted += 1;
        fresh.push(d);
      } else duplicates += 1;
    }
  } finally {
    for (const d of batch) gw.justPersisted.delete(d.id);
    gw.armValidityTimer();
    if (accepted > 0) gw.notifyUserDependents();
  }
  return { receipt: { accepted, duplicates }, fresh };
}

export function admitForImpl(gw: Gateway): (d: Delta) => boolean {
  const now = gw.validityNow();
  const authors = gw.lawAuthors("trust");
  const governor = authors.find((a) => declaresTrust(gw.reactor, now, a)) ?? authors[0];
  const policy = readTrustPolicy(gw.reactor, now, governor);
  if (policy.mode === "open") return () => true;
  if (policy.mode === "closed") return () => false;
  const trusted = new Set(authors);
  return (d) => trusted.has(d.claims.author) || policy.roster.has(d.claims.author);
}

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

function deadSet(gw: Gateway): ReadonlySet<string> {
  if (gw.operatorAuthor === undefined) return NO_DEAD;
  for (const id of gw.reactor.byTarget(ERASE_ENTITY)) {
    const d = gw.reactor.get(id);
    if (d === undefined || isErasure(d.claims)) return refusedIds(gw.reactor, gw.operatorAuthor);
  }
  return NO_DEAD;
}

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
  const served = withoutErased(gw, offered).filter((d) => !isStoreLocal(d));
  return withheld.size === 0 ? served : served.filter((d) => !withheld.has(d.id));
}

function evalRawGoverned(gw: Gateway, term: Term, input: DeltaSet): EvalResult {
  const program = governedProgram(term, undefined, input, { raw: true }, userGroundOf(gw.reactor));
  return evalTermRaw(program.term, input);
}

function lowerMembership(gw: Gateway, term: unknown, now: number = gw.validityNow()): unknown {
  return lowerMembershipJson(
    term,
    gw.reactor,
    now,
    gw.operatorAuthor,
    refusedIds(gw.reactor, gw.operatorAuthor),
  );
}

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

export function watchImpl(gw: Gateway, term: unknown): AsyncGenerator<Delta[], void, unknown> {
  if (gw.reseating !== undefined)
    return streamAfter(gw.reseating, () => watchImpl(gw, term), gw.channels);
  const program = () => parseTerm(lowerMembership(gw, term));
  const parsed = program();
  const initial = evalRawGoverned(gw, parsed, gw.reactor.snapshot());
  if (initial.sort !== "dset") {
    throw new Error(
      `watch: the membership term must evaluate to a delta set (dset), not a ${initial.sort}`,
    );
  }
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
    (_pending, incoming) => incoming,
  );
  const pulse = (): void => {
    if (closed) return;
    const next = evalRawGoverned(gw, program(), gw.reactor.snapshot());
    if (next.sort !== "dset") return;
    const members = live([...next.set]);
    const ids = new Set(members.map((d) => d.id));
    if (ids.size === lastIds.size && [...ids].every((id) => lastIds.has(id))) return;
    lastIds = ids;
    channel.push(members);
  };
  gw.reactor.subscribeRaw(pulse);
  if (needsLowering(parsed, undefined) || hasMemberOf(term)) gw.userPulses.add(pulse);
  gw.channels.add(channel);
  channel.push(initialMembers);
  return channel;
}

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

async function admitToJournal(gw: Gateway, batch: readonly Delta[], at: number): Promise<void> {
  const orders = batch.filter((d) => isErasure(d.claims));
  if (orders.length === 0) return admitLocal(gw.peer!, batch, at, () => false);
  const ordinary = batch.filter((d) => !isErasure(d.claims));
  await admitErasureOrders(gw.peer!, await ordersFor(gw, orders), "local", at, ordinary);
}

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
  if (admitted.some((d) => isErasure(d.claims))) await settleOwedPurges(gw);
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
  const notCrossedIds = new Set(all.filter((d) => !crossedIds.has(d.id)).map((d) => d.id));
  const held = new Set(all.map((d) => d.id)).size - accepted - notCrossedIds.size;
  const counts = { offered: all.length, accepted, rejected, held };
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
  const byPolicy = opts.admit === undefined;
  const admit = opts.admit ?? admitForImpl(gw);
  const dead = refusedIds(gw.reactor, gw.operatorAuthor);
  const paused = pausedKeys(gw.reactor, gw.operatorAuthor, dead);
  const now = (clock.at ??= Date.now());
  const slates = readSlates(gw.reactor, gw.validityNow(), gw.operatorAuthor, now);
  const lawful: Delta[] = [];
  let admitted: Delta[] = [];
  for (const d of all) {
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
      cutForHere(gw.reactor, gw.operatorAuthor, d, dead) ||
      isCutManifest(d) ||
      slateRefusal(slates, d) !== undefined
    ) {
      continue;
    }
    lawful.push(d);
    if (admit(d)) admitted.push(d);
  }
  if (byPolicy && admitted.length < lawful.length) {
    admitted = withBatchNegationClosure(lawful, admitted);
  }
  const erasesErasure = erasuresOfErasures(admitted);
  if (erasesErasure.size > 0) admitted = admitted.filter((d) => !erasesErasure.has(d.id));
  const erasedHere = erasedInBatch(admitted, gw.operatorAuthor);
  if (erasedHere.size > 0) admitted = admitted.filter((d) => !erasedHere.has(d.id));
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
  const landed =
    gw.peer === undefined || admitted.length === 0
      ? admitted
      : await receiveIntoJournal(gw, admitted, now);
  const crossed = new Set(landed.map((d) => d.id));
  const rejected = all.reduce((n, d) => (crossed.has(d.id) ? n : n + 1), 0);
  const acceptedIds: string[] = [];
  const admittedIds = new Set<string>();
  if (landed.length > 0) {
    if (gw.peer === undefined) await gw.backend.append(landed);
    gw.advanceToNow();
    for (const d of landed) gw.justPersisted.add(d.id);
    try {
      const verdicts = gw.ingestAllVia(landed);
      for (const [i, d] of landed.entries()) {
        const result = verdicts[i]!;
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
      gw.armValidityTimer();
      if (acceptedIds.length > 0) gw.notifyUserDependents();
    }
  }
  return { all, now, admitted: landed, rejected, acceptedIds, admittedIds };
}
