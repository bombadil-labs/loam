// The ingest doors (ticket T19: the Gateway's two entry points for deltas, in their own module).
// APPEND is the governed door: the batch is validated whole (verified signatures, the erasure
// holes, capability standing, resource budgets), persisted BEFORE it is served, refused loudly.
// FEDERATE is the union door: a peer's deltas cross by VERIFICATION alone plus an admission
// predicate — never authorize() — because federation is union at the substrate, not a governed
// mutation ("no authority deciding whose truth survives", SPEC §8); whether a peer's facts shape a
// local view is a read-time TRUST choice. Both doors remember the hole (§11): a tombstoned id is
// refused re-entry until its tombstone is lawfully struck.
//
// Foreign law stays inert by the SAME operator-rooting the local store uses: a federated grant /
// membership / registration / binding-definition authored by anyone but this store's operator binds
// nothing (grantHeld / readRegistrations / readBindingDefinitions all filter on the operator). This
// rests on one invariant the federation must keep: DISTINCT OPERATOR SEEDS ACROSS INSTANCES — two
// stores sharing an operator seed trust each other's constitution completely. Give every instance
// its own operator identity. (The §24.1 quarantine pool is the one sanctioned shared-seed case.)
//
// These are the implementations behind `Gateway.append` / `federate` / `admitFor` / `offeredDeltas`
// — thin delegating methods on the class, bodies here. They reach the gateway only through its
// declared internals seam (the `@internal` members on the class — see the seam note in gateway.ts).

import {
  computeId,
  evalTerm,
  parseTerm,
  verifyDelta,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { authorize } from "./accounts.js";
import { budgetRefusal } from "./budget.js";
import { ERASE_ENTITY, eraseDefect, isTombstone, readTombstones } from "./erase.js";
import { Channel } from "./channel.js";
import type { AppendReceipt, FederationReport, Gateway } from "./gateway.js";
import { publicDefect } from "./public.js";
import { artifactDefect } from "./artifact.js";
import {
  egressWithheld,
  landsReadClosure,
  readSlates,
  slateDefect,
  slateRefusal,
} from "./slate.js";
import { readTrustPolicy } from "./trust.js";

// Persist a batch, THEN serve it (the body of `Gateway.append`). The batch is validated whole (one
// bad delta refuses the lot); it lands in the backend before the reactor sees it, so nothing a
// query or a subscriber can observe is ever less durable than the ground — a failed write means
// nothing happened, and the caller may simply retry. Only verified signatures pass: the substrate
// accepts unsigned deltas, the gateway does not (authority is always attested here). And each
// delta's author must hold STANDING — the operator, or a surviving operator-rooted write grant on
// this store; what the delta points at is not authorization's business (entities are unowned —
// trust is the reader's). Authorization reads the state as it stands before the batch — a batch
// cannot bootstrap its own permissions.
export async function appendImpl(gw: Gateway, deltas: Iterable<Delta>): Promise<AppendReceipt> {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  const batch = [...deltas];
  // The door remembers the hole (SPEC §11): an erased id is refused re-entry — through
  // append as through federation — until its tombstone is lawfully struck (forgiveness).
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  // And the door remembers what is being STAGED for removal (SPEC §29.3): a slate closing `cite`
  // refuses a delta that names one of its frozen members, so the DEPENDENT set cannot grow and no
  // new orphans exist at cut time. Here the refusal is INFORMATIVE and names the container — the
  // only parties who can trigger it are parties who could already read the target, so telling them
  // IS the notice; the mechanism and the warning turn out to be the same thing. The federation door
  // shares this ONE predicate and differs only in disclosure (see federateImpl).
  const slates = readSlates(gw.reactor, gw.operatorAuthor, Date.now());
  for (const d of batch) {
    if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified") {
      throw new Error(
        `append rejected: delta ${d.id} is unsigned or not what it claims to be — ` +
          `the gateway accepts only verified authorship`,
      );
    }
    if (dead.has(d.id)) {
      throw new Error(
        `append rejected: delta ${d.id} was erased — a tombstone at ${ERASE_ENTITY} refuses ` +
          `its return (strike the tombstone to forgive it)`,
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
      const verdict = authorize(gw.reactor, d, gw.operatorAuthor);
      if (!verdict.ok) {
        throw new Error(`append rejected: ${verdict.refusal}`);
      }
    }
  }
  // Door resource budgets (SPEC §25): a granted author the operator has metered may not append
  // past their volume quota — deployment config, re-resolved live from `loam:budget`, layered
  // above §12's stranger floor. Absent a budget the author is unmetered (today's behavior); the
  // operator sets budgets and is never metered. Checked once for the whole batch, on the state
  // as it stands before it — the same discipline authorize() reads under.
  if (gw.operatorAuthor !== undefined) {
    const overBudget = budgetRefusal(gw.reactor, gw.operatorAuthor, batch);
    if (overBudget !== undefined) {
      throw new Error(`append rejected: ${overBudget}`);
    }
  }
  await gw.backend.append(batch); // a throw here means NOTHING was ingested or served
  let accepted = 0;
  let duplicates = 0;
  for (const d of batch) gw.justPersisted.add(d.id);
  try {
    for (const d of batch) {
      const result = gw.ingestVia(d);
      if (result.status === "accepted") accepted += 1;
      else duplicates += 1; // "rejected" is unreachable: the batch was validated above
    }
  } finally {
    // Always cleared — duplicates never hit the raw stream, and a mid-ingest throw must not
    // leave stale ids silently exempting future raw-stream writes.
    for (const d of batch) gw.justPersisted.delete(d.id);
  }
  // A landing slate that closes `read` ends live subscriptions the way an erase does (SPEC §29.3).
  // `reseat()` already solves precisely this one phase later — "a parked reader must not keep serving
  // a view built on the pre-erase ground" — and the reason is identical here: nothing in the slate's
  // own deltas moves the watched entity's materialization, so no sink fires and no open stream would
  // ever narrow. Readers wake with `done` and resubscribe into the narrowed gather. Already-delivered
  // frames are not recalled; nothing can recall them, and §29.3's asymmetry already says so.
  if (landsReadClosure(gw, batch, Date.now())) {
    for (const channel of [...gw.channels]) await channel.return();
  }
  return { accepted, duplicates };
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
  const policy = readTrustPolicy(gw.reactor, gw.operatorAuthor);
  if (policy.mode === "open") return () => true;
  if (policy.mode === "closed") return () => false;
  return (d) => d.claims.author === gw.operatorAuthor || policy.roster.has(d.claims.author);
}

// A filter narrows what you SEE; it must never resurrect what was STRUCK (SPEC §28.4, ticket T38).
//
// rhizomatic's `negated(d, D)` ranges over the OPERAND SET (SPEC-2 §4.3): suppression is a property
// of the set being evaluated, not of the delta. So filtering a delta-set and keeping a claim while
// dropping the negation that struck it hands the reader a claim that reads as LIVE — the substrate's
// own `select-then-mask-scopes-to-operand` vector, correct behavior punishing a careless filter.
// Loam had exactly that hole in both of its filters (the membership seeding edge inward, the offered
// lens outward) until T38.
//
// The remedy is a closure, and its DIRECTION is the whole of its safety: from an admitted delta to
// the negations OF it, transitively — never the reverse. Following negations forward preserves what
// survives; following them backward would drag in targets the filter deliberately excluded, turning
// a scope into a leak. Transitive because a struck strike REVIVES: carrying one link would leave a
// revived claim wrongly suppressed, which is the same failure mirrored.
//
// Terminates because the output set only grows and is bounded by the store (and the chain is
// acyclic anyway — content addressing means a negation cannot precede its target).
//
// It asks the ground exactly two questions, both answered from the reactor's INDEXES: who negates
// this id, and is that negation still held? Materializing the store into a private id→delta map
// instead would cost a pass over every delta plus a content re-address of each (`snapshot()` is
// `DeltaSet.from`) — per call, on a path six callers share, one of which runs it per accepted delta
// per watcher (H8: the affordance that avoids the scan must itself be correct; here the index IS the
// affordance, and `get` returning undefined for a purged negation is the same answer the map gave).
//
// THE CLOSURE IS DRAWN FROM THE LOCAL GROUND. A caller handing it deltas that are not in this store
// would silently under-close — the negations it needs are not local yet. That is the inbound
// federation case, and it has its own batch-scoped closure below.
// Typed on the REACTOR rather than the Gateway (structurally satisfied by one) so the readers that
// must compute a §27.2 freeze WITHOUT a gateway — and therefore without any chance of a read-door
// narrowing reaching the membership machinery (SPEC §29.3) — share this one closure instead of
// growing a second copy of it.
export function withNegationClosure(
  gw: { readonly reactor: Reactor },
  admitted: readonly Delta[],
): Delta[] {
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const negationId of gw.reactor.negationsOf(id)) {
      if (out.has(negationId)) continue;
      const negation = gw.reactor.get(negationId);
      if (negation === undefined) continue; // purged (§11) — the hole is the point
      out.set(negationId, negation);
      pending.push(negationId);
    }
  }
  return [...out.values()];
}

// The same closure, but over SEVERAL grounds at once (SPEC §39): a container's gather may compose
// deltas from more than one store — a parent's own ground plus each of its inbox pools — and a
// strike of an admitted delta can live in ANY of them. A per-ground closure treats each store as a
// closure boundary, so it returns a claim from one ground while its strike sits in another. This one
// asks EVERY ground `negationsOf`/`get`, so a strand across the pool boundary cannot survive.
//
// Direction and monotonicity are identical to `withNegationClosure`: it only ADDS negations of what
// is already admitted, never drops a member and never revives a struck claim (more strikes in play
// means more suppression). Terminates for the same reason — the output set only grows and is bounded
// by the union of the grounds.
export function withNegationClosureAcross(
  grounds: readonly { readonly reactor: Reactor }[],
  admitted: readonly Delta[],
): Delta[] {
  const out = new Map(admitted.map((d) => [d.id, d]));
  const pending = [...out.keys()];
  while (pending.length > 0) {
    const id = pending.pop() as string;
    for (const g of grounds) {
      for (const negId of g.reactor.negationsOf(id)) {
        if (out.has(negId)) continue;
        const neg = g.reactor.get(negId);
        if (neg === undefined) continue; // purged (§11) — the hole is the point
        out.set(negId, neg);
        pending.push(negId);
      }
    }
  }
  return [...out.values()];
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

// The ids this store has been ordered to forget, for a caller that runs PER PULSE. `readTombstones`
// costs two full-ground passes (a lawful-negation materialization, then a walk), and a store that
// holds no removal order at all can answer without paying either: an ungoverned store honors no
// erasure (§11), and a tombstone must BE in the ground to bind. The existence probe is exact rather
// than heuristic, and it deliberately decides nothing else — which tombstones SURVIVE, and whose
// author confirms them, stays the one place that owns those rules (H8: the cheap answer must not
// become a second implementation of the expensive one).
function deadSet(gw: Gateway): ReadonlySet<string> {
  if (gw.operatorAuthor === undefined) return NO_DEAD;
  for (const d of gw.reactor.snapshot()) {
    if (isTombstone(d.claims)) return readTombstones(gw.reactor, gw.operatorAuthor);
  }
  return NO_DEAD;
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
          const result = evalTerm(lens, gw.reactor.snapshot());
          if (result.sort !== "dset") throw new Error("an offered lens must select a delta set");
          return withNegationClosure(gw, [...result.set]);
        })();
  const withheld = egressWithheld(gw, Date.now());
  return withheld.size === 0 ? offered : offered.filter((d) => !withheld.has(d.id));
}

// Membership is a query, first-class (SPEC §27.6, the body of `Gateway.select`): evaluate a
// rhizomatic Term — the JSON `op` profile — over this store's SURVIVING ground, once. The Term
// must select a DELTA SET (`difference`/`intersect` compose here, at the Term layer, to any
// depth — never inside `inView` predicates, whose depth-1 stratification §24.10 pins); anything
// else is refused loudly at the door. This is `offeredDeltas` parameterized IN ITS SCOPE — the same
// Term evaluation under a scope the caller names — and NOT the same reading: `offeredDeltas` adds
// the negation closure a peer must not be denied (H1), and `watch` additionally withholds what a
// surviving tombstone has condemned (§11). A `select` caller gets neither. Aligning the three doors
// is T90's business; until then this one hands back exactly what the Term selected, no more.
export function selectImpl(gw: Gateway, term: unknown): Delta[] {
  const parsed = parseTerm(term);
  const result = evalTerm(parsed, gw.reactor.snapshot());
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
  const parsed = parseTerm(term);
  const initial = evalTerm(parsed, gw.reactor.snapshot());
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
  // Then, and only then, drop what the store has been ORDERED to forget (SPEC §11): the tombstone
  // is ground BEFORE its target is purged — erase sequences it that way on purpose — so the pulse
  // that fires in that window is the tombstone's own, carrying a member whose bytes are going away.
  //
  // ORDER IS LOAD-BEARING, and it is the mirror of `containerScopeImpl`'s "subtract, THEN close":
  // there, closing last stops a narrowing from REVIVING a claim. Here the closure runs first and the
  // forgetting has the last word, so a strike survives unless the strike ITSELF was erased — and
  // erasing a retraction genuinely does revive its target, which is exactly what the reader's own
  // ground will say once the purge lands. Closing last would instead re-admit a negation the
  // operator ordered erased, defeating the drop.
  //
  // HONEST SCOPE OF THE DROP: it makes THIS door honor a removal order the point-read doors do not
  // yet honor — `select`, `freeze` and `offeredDeltas` apply no dead-set filter (tracked as T90),
  // and the inbound doors' `dead.has(d.id)` check is a different question (refusing re-entry, not
  // withholding a reading). The states where the divergence shows are not only intra-erase, and not
  // only transient: a tombstone appended directly never purges anything, and a purge fault is
  // COLLECTED rather than unwound — the tombstone then stands over retained bytes indefinitely, so
  // this door hides the delta for good while the point-read doors keep serving and republishing it.
  const live = (members: readonly Delta[]): Delta[] => {
    const withStrikes = withNegationClosure(gw, members);
    const dead = deadSet(gw);
    if (dead.size === 0) return withStrikes;
    const kept = new Map(withStrikes.filter((d) => !dead.has(d.id)).map((d) => [d.id, d]));
    // Dropping a condemned delta can revive what it was HOLDING DOWN: a retraction is a member like
    // any other, and once §11 withholds it, its target would read live in this frame while the store
    // still holds the strike. So the target goes with it — and transitively, since a target may be
    // the strike that was keeping something else down. The invariant this settles on: no delta is
    // served whose strike the store holds and this frame does not carry. A purged strike is not one
    // of those (it is gone, and the revival is what erasing a retraction MEANS); a condemned one is.
    // Withholding more can only disclose less, which is the single direction this door may err in.
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
  };
  let closed = false;
  const initialMembers = live([...initial.set]);
  let lastIds = new Set(initialMembers.map((d) => d.id));
  const channel: Channel<Delta[]> = new Channel<Delta[]>(
    () => {
      closed = true;
      gw.channels.delete(channel);
    },
    (_pending, incoming) => incoming, // a slow reader gets the newest membership, nothing stale
  );
  // The reactor has no unsubscribe; the closed flag makes a detached watcher inert (the same
  // discipline the entity-stream sinks run).
  gw.reactor.subscribeRaw(() => {
    if (closed) return;
    const next = evalTerm(parsed, gw.reactor.snapshot());
    if (next.sort !== "dset") return; // the term's sort is content-independent; unreachable
    const members = live([...next.set]);
    const ids = new Set(members.map((d) => d.id));
    if (ids.size === lastIds.size && [...ids].every((id) => lastIds.has(id))) return;
    lastIds = ids;
    channel.push(members);
  });
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
// tombstoned, or malformed negation is refused exactly as before; the widening is of the admission
// PREDICATE, nothing else.
//
// AND ONLY WHERE ADMISSION WAS POLICY-DRIVEN. An explicit `admit` is the caller's own trust boundary
// and may be filtering negations deliberately (refusing a stranger's strike is the interim answer to
// the heckler's veto, pinned in test/federation/federate.test.ts) — the door must not overrule that
// judgment by importing what the caller refused. Such a caller owns the closure, like every other
// holder of a raw delta set; `PullOptions.admit` says so where a caller will read it. Closing that
// asymmetry needs read-time authority-scoped suppression, which is substrate work (rhizomatic#2).
export async function federateImpl(
  gw: Gateway,
  deltas: Iterable<Delta>,
  opts: { admit?: (d: Delta) => boolean; ids?: boolean } = {},
): Promise<FederationReport> {
  if (gw.writeFailure !== undefined) {
    throw new Error(`this gateway can no longer persist: ${gw.writeFailure.message}`);
  }
  const all = [...deltas];
  const byPolicy = opts.admit === undefined; // whose boundary this is, and so who owns the closure
  const admit = opts.admit ?? admitForImpl(gw); // the store's trust policy, unless overridden
  // The door remembers the hole (SPEC §11): a tombstoned id is refused re-entry even past an
  // explicit admit override — un-erasure is striking the tombstone, never a lucky re-send.
  const dead = readTombstones(gw.reactor, gw.operatorAuthor);
  // The SAME cite predicate the append door runs (SPEC §29.3) — one rule, two sites, because all
  // seven findings of 2026-07-21 were one-rule-N-sites-one-drifts with the federation site as the
  // one that drifted. Here the disclosure discipline INVERTS: a peer pushing a citation may have no
  // read access to the target, so a distinguishable refusal would announce that something exists and
  // is on its way out. It costs nothing to be uniform — this door already returns counts and no
  // message, so a slate refusal is indistinguishable from any other rejection.
  const slates = readSlates(gw.reactor, gw.operatorAuthor, Date.now());
  const lawful: Delta[] = [];
  let admitted: Delta[] = [];
  for (const d of all) {
    // A tombstone is a removal-order, not an inert claim — so it faces the same validator at
    // this door as at the append door (eraseDefect), and an unauthorized or malformed one is
    // refused rather than stored. Likewise a public-read declaration: it OPENS a door, so a
    // malformed one is refused here exactly as at append (publicDefect), and an artifact
    // declaration alongside it (artifactDefect) — the two doors must
    // not disagree about what lawful loam:public data is. Everything the readers trust
    // downstream passed a door here.
    if (
      computeId(d.claims) !== d.id ||
      verifyDelta(d) !== "verified" ||
      dead.has(d.id) ||
      publicDefect(d.claims) !== undefined ||
      artifactDefect(d.claims) !== undefined ||
      (isTombstone(d.claims) && eraseDefect(d, gw.reactor, gw.operatorAuthor) !== undefined) ||
      slateDefect(d, gw.reactor, gw.operatorAuthor) !== undefined ||
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
  // Counted per offered delta rather than inferred from set sizes: the closure keys by id, so a peer
  // that offers the same delta twice would otherwise be reported as one refusal that never happened.
  const crossed = new Set(admitted.map((d) => d.id));
  const rejected = all.reduce((n, d) => (crossed.has(d.id) ? n : n + 1), 0);
  // The ids are collected in THIS loop, from the same verdict that increments the count — so
  // `acceptedIds` and `accepted` cannot disagree about which deltas newly landed. Anything that
  // recovered the set afterwards would be answering a different question a moment later.
  const acceptedIds: string[] = [];
  if (admitted.length > 0) {
    await gw.backend.append(admitted);
    for (const d of admitted) gw.justPersisted.add(d.id);
    try {
      for (const d of admitted) {
        if (gw.ingestVia(d).status === "accepted") acceptedIds.push(d.id);
      }
    } finally {
      for (const d of admitted) gw.justPersisted.delete(d.id);
    }
  }
  const accepted = acceptedIds.length;
  // "accepted" counts deltas NEWLY ingested — a duplicate verified but merged into what was
  // already there, so a re-pull accepts nothing (union is idempotent). "held" is the unique-id
  // remainder: offered ids neither newly ingested nor refused. Occurrences and unique ids are
  // different dimensions (a refused delta offered twice counts twice in `rejected` and once in
  // `held`'s complement), so the two are never subtracted from each other.
  const refusedIds = new Set(all.filter((d) => !crossed.has(d.id)).map((d) => d.id));
  const held = new Set(all.map((d) => d.id)).size - accepted - refusedIds.size;
  const counts = { offered: all.length, accepted, rejected, held };
  // The ids ride only when asked (see FederationReport): the counts are what every other caller
  // reads, and the report keeps exactly the shape they compare.
  return opts.ids === true ? { ...counts, acceptedIds } : counts;
}
