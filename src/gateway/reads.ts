// The read side (ticket T19: the Gateway's resolution and subscription bodies, in their own module).
// Reading is the whole point of the lens ladder: GATHER the hyperview (warm materialization when one
// watches, batch eval otherwise, the honest as-of path when T is named), RESOLVE it through the
// Schema, apply the lens's §22 resolvers as the final step, and ANNOTATE an as-of node with the §26
// erasure marks. The live seam rides the same machinery: a watch captures its shape at subscribe
// time and streams patches whose hex chain is as real as any query's.
//
// These are the implementations behind `Gateway.resolvePinned` / `query`'s resolution / the private
// watchEntity/subscribeVia hooks — thin delegating methods on the class, bodies here. They reach the
// gateway only through its declared internals seam (the `@internal` members on the class — see the
// seam note in gateway.ts).

import { parse, subscribe, type ExecutionResult, type GraphQLSchema } from "graphql";
import {
  contentAddress,
  DeltaSet,
  evalTerm,
  hviewCanonicalHex,
  resolveView,
  viewCanonicalHex,
  type HView,
  type MaterializationChange,
  type View,
} from "@bombadil/rhizomatic";
import { Channel } from "./channel.js";
// NOT `./channel.js` above it — that is the gateway's own Channel. The federation module is where a
// channel POOL's naming lives, and `prefixOfChannelName` is the structural identity both readers
// need when a record's own `prefix` primitive is condemned.
import { prefixOfChannelName } from "../federation/channel.js";
import { forgottenSince } from "./erase.js";
import { readClosedIds, readGround, requireMoment } from "./slate.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import type { PatchNode, ResolvedNode } from "./gql.js";
import type { Registered } from "./gql.js";
import { lensOf, type ResolverSpecs } from "./registration.js";
import { applyResolvers, decorateChildren } from "./resolvers.js";

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

// `hex`/`hviewHex` are DIGESTS of the canonical bytes (SPEC §17, T107): `contentAddress` over the
// CBOR canonical form — the same fixed-width multihash form as a delta id. Digest equality ⇔ byte
// equality, so every equality consumer keeps its semantics, while the field stops growing with the
// answer (`_hviewHex` used to serialize the whole gathered bucket into the response) and stops
// re-disclosing the view's values legibly. These three helpers are the ONLY producers; every door
// (`_hex`, `_hviewHex`, `_fromHex`, REST, the renderer floor) carries them downstream. The hex
// round-trip is because rhizomatic (frozen) exposes the canonical form only hex-encoded.
const bytesOf = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const viewDigest = (v: View): string => contentAddress(bytesOf(viewCanonicalHex(v)));
const hviewDigest = (h: HView): string => contentAddress(bytesOf(hviewCanonicalHex(h)));

// The resolvers a named READING carries (SPEC §22.7, ticket T26) — for decorating expanded children
// through their own reading's resolvers. A reading's name IS its lens name, so this is the live
// binding whose lens matches. Children resolve through the LIVE reading even under a pinned parent:
// a version pins the lens the door asked for, not the whole world's readings.
const readingResolversOf =
  (gw: Gateway) =>
  (name: string): ResolverSpecs | undefined =>
    gw.registered.find((r) => lensOf(r) === name)?.resolvers;

// The moment as a delta set (SPEC §26): the surviving snapshot filtered to the deltas IN FORCE
// at T — author-timestamp `≤ T`, and a negation counts only if ITS OWN timestamp is `≤ T` (a
// fact un-negated at T reads present; a retraction not yet spoken at T leaves the fact
// standing). Because negations are themselves timestamped deltas, one filter — `timestamp ≤ T`
// — is exactly both rules. It reads the SURVIVING ground, so purged content can never reappear,
// no matter how far back T points: erasure is the stronger promise (§11).
export function groundAsOfImpl(gw: Gateway, asOf: number): DeltaSet {
  return DeltaSet.from([...gw.reactor.snapshot()].filter((d) => d.claims.timestamp <= asOf));
}

// Ride the erasure annotation on an as-of node, beside the view (like `_hex`), never inside the
// resolved data. A present read (no `asOf`) carries neither pin nor mark.
//
// AS-OF IS THE SITE THAT WOULD HAVE BEEN MISSED (SPEC §29.3): §26 reconstructs the surviving ground
// at a moment T, and a moment BEFORE a slate would happily serve the condemned delta — so the
// narrowing is applied AFTER the reconstruction, and the temporal door confesses a slate-suppression
// count in the same register `forgottenSince` already uses. Absent when nothing is suppressed, so a
// read over a store with no slate is byte-identical to what §26 always answered.
// The count is REQUIRED, with no default. A default of 0 would read "assume nothing was suppressed",
// which is the fail-open direction on a confession — the same reason `now` is required on the read
// seam it is computed from.
export function annotateImpl(
  gw: Gateway,
  node: ResolvedNode,
  asOf: number | undefined,
  suppressed: number,
): ResolvedNode {
  if (asOf === undefined) return node;
  return {
    ...node,
    asOf,
    forgotten: forgottenSince(gw.reactor, gw.operatorAuthor, asOf),
    ...(suppressed > 0 ? { suppressed } : {}),
  };
}

// Gather the HView for (schema, entity): the live materialization when one is watching —
// registered root or lazy — and batch evaluation otherwise (the spike proved them identical).
// An `asOf` read (SPEC §26) can use NEITHER warm path — the materialization IS the present by
// construction — so it takes the one honest path: evaluate the same body over the ground as it
// stood at T (groundAsOf). Same gather, a narrower ground; nothing about resolution is time-cased.
// READ CLOSURE IS A GATHER-LEVEL NARROWING, and this is one of its five named sites (SPEC §29.3).
// The `now` is REQUIRED here, not optional: a lapse computed at the door means every door that
// honours `read` needs the moment, and an optional one defaulting to anything at all would serve a
// condemned member past a lapsed deadline and look healthy doing it.
export function gatherImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): HView {
  requireMoment(now, `gather ${name}`);

  // A BOUND CONNECTION READS ITS OWN SCOPE (SPEC §58): the container its consent named, with the
  // inbox pools composed into it — never the primary's materialization, which is maintained over
  // the whole ground and would answer with everything the store holds. It runs before every other
  // branch for the reason the channel branch does: a materialization keyed by program name is not
  // the connection's to read. A channel's lens is refused outright — its pool is not in the scope,
  // and resolving the peer's reading over the connection's ground would answer a question nobody
  // asked.
  if (binding !== undefined) {
    if (channelLens(gw, name)) {
      throw new Error(
        `${name} arrived through a federation channel, and a bound connection reads only the ` +
          `container its consent named — that channel's pool is outside its scope`,
      );
    }
    const result = evalTerm(
      gw.def(name).hyperschema.body,
      boundGroundFor(gw, binding, now, asOf),
      entity,
      gw.registry,
    );
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  const closed = readClosedIds(gw, now);

  // A lens that arrived through a federation channel resolves over THAT CHANNEL'S POOL, not over
  // this store's primary ground — the peer's deltas live in the pool by design (§46), so a lens
  // gathering the primary ground binds correctly and then answers null (T189, measured).
  //
  // THIS RUNS BEFORE THE WARM BRANCH, and that ordering is the bug this cost. Materializations are
  // keyed by the hyperschema's PROGRAM name (§21.7), so a peer's `Plant` and a local `Plant` share
  // one — the warm lookup returned a view computed over the primary ground and the scoped path was
  // never reached. A channel lens must never read a materialization it does not own.
  //
  // The scope is derived from data already in the ground: the living name carries the prefix the
  // receiver assigned, and the channel record maps that prefix to its pool. No new vocabulary.
  // Deliberately the POOL and not the receiving container — two channels into one container resolve
  // over their OWN pools, or one peer's claims would answer another peer's lens. Every other lens is
  // untouched, which is the decision Myk settled: a container shows its own contents, and descent is
  // explicit (T190).
  const scoped = channelGroundFor(gw, name, now, asOf);
  if (scoped !== undefined) {
    const result = evalTerm(gw.def(name).hyperschema.body, scoped, entity, gw.registry);
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  if (asOf !== undefined) {
    const def = gw.def(name);
    const ground = asOfGroundImpl(gw, asOf, closed);
    const result = evalTerm(def.hyperschema.body, ground, entity, gw.registry);
    if (result.sort !== "hview") {
      throw new Error(`schema ${name} does not evaluate to a hyperview`);
    }
    return result.hview;
  }
  // THE WARM BRANCH IS DEMOTED while a read-closing slate stands, and this is the site that defeats
  // the naive "resolve against `snapshot ∖ readClosed`" reading outright: a materialization is
  // maintained INCREMENTALLY from ingest events, so it is not an operand set anything can subtract
  // from, and a read-closed member would keep being served through the default path for every
  // registered root. So while `readGround` differs from the snapshot the gather ignores the
  // materialization and takes the cold branch over the narrowed ground. The cost is that reads lose
  // their warm path for the life of the slate — a bounded, visible price a compliance window can
  // pay. A RE-SEAT IS NOT THE FIX and must not be mistaken for one: `reseat()` replays the backend
  // into a fresh reactor, so the rebuilt materialization holds the members again.
  if (closed.size === 0) {
    // Sibling lenses share ONE materialization per PROGRAM (§21.7): the mat is keyed by the
    // hyperschema's name, while `name` here is the LENS the door asked for.
    const program = gw.def(name).hyperschema.name;
    const live =
      gw.reactor.materializedView(gw.matName(program), entity) ??
      gw.reactor.materializedView(gw.lazyMatName(program, entity), entity);
    if (live !== undefined) return live;
  }
  const def = gw.def(name);
  const result =
    closed.size === 0
      ? gw.reactor.eval(def.hyperschema.body, entity, gw.registry)
      : evalTerm(def.hyperschema.body, readGround(gw, now), entity, gw.registry);
  if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
  return result.hview;
}

/**
 * The ground a channel-bound lens resolves over, or undefined for an ordinary lens.
 *
 * Read closure still applies: a read-closed delta must not reappear through a channel's pool, so the
 * narrowed set is subtracted here exactly as the primary path narrows its own.
 */
function channelGroundFor(
  gw: Gateway,
  lens: string,
  now: number,
  asOf?: number,
): DeltaSet | undefined {
  const cut = lens.indexOf(":");
  if (cut <= 0) return undefined;
  const prefix = lens.slice(0, cut);
  const channel = gw.channelStatus().find((c) => c.prefix === prefix);
  if (channel === undefined) {
    // A SEVERED channel's lens must not fall back to this store's own ground. Measured before this
    // guard: after `dropChannel`, `alice_Plant` answered 999 — the receiver's own private claim —
    // where it had answered the peer's 11. On the ordinary query door, after an act the operator
    // chose, looking like it worked (T199).
    const severed = gw.channelsEver().find((c) => c.prefix === prefix);
    if (severed !== undefined) {
      throw new Error(
        `${lens} was served by the federation channel "${severed.name}", which has been severed. ` +
          `Its pool is purged, so this reading has no ground — it must not fall back to this ` +
          `store's own deltas. Re-open the channel, or retire the lens.`,
      );
    }
    // THE SAME FALL-THROUGH, REACHED BY ILLEGIBILITY INSTEAD OF BY A SEVER. A channel whose record
    // does not carry a legible `prefix` matches no prefix at all, so the lookup above misses it and
    // the return below would resolve the peer's lens over the RECEIVER's own ground. The channel's
    // NAME still carries the prefix structurally, which is what makes the match possible when the
    // record's own primitive is condemned.
    const illegible = gw
      .channelsEver()
      .find((c) => c.unreadable.includes("prefix") && prefixOfChannelName(c.name) === prefix);
    if (illegible !== undefined) {
      throw new Error(
        `${lens} is served by the federation channel "${illegible.name}", whose record does not ` +
          `carry its prefix in the shape a channel record is written in. This reading cannot be ` +
          `scoped to that peer's pool, and it must not fall back to this store's own deltas. ` +
          `\`loam federate list\` names what the record cannot say.`,
      );
    }
    return undefined;
  }
  const closed = readClosedIds(gw, now);
  // A time pin rides the READ (§26), so it must reach the pool as well — a scoped lens that
  // silently ignored `asOf` would answer the present while the caller believes it answered the past.
  //
  // AND THE RECEIVER'S OWN STRIKES APPLY. containerScope closes negations over whoever CONTRIBUTED
  // deltas, and requesting one pool makes that pool the only ground — so a strike living HERE was
  // left behind and the reader saw a retracted claim as live (H1, the store lying upward). Reachable
  // whenever a receiver both channels a peer and federates with them directly: the retraction lands
  // in this ground while the channel is frozen or has not polled.
  //
  // `struck` rather than `negationsOf(...).length > 0`: a struck strike stops binding, and its
  // target revives. Presence is not survival.
  const deltas = gw
    .containerScope({ containers: [channel.name] })
    .filter(
      (d) =>
        (asOf === undefined || d.claims.timestamp <= asOf) &&
        !closed.has(d.id) &&
        !negatedInGround(gw, d.id, new Set()),
    );
  return DeltaSet.from(deltas);
}

/**
 * The ground a BOUND CONNECTION resolves over (SPEC §58): `connectionScope` at the bound container —
 * its own members, its subtree's, and every inbox pool composed into it — narrowed by read closure
 * and by this store's own surviving strikes, exactly as the channel path narrows a pool (H1: a
 * strike living in the primary must bind on a claim that lives in a pool). A time pin rides the
 * read here too. `connectionScope` refuses an undeclared container or an unattached pool: a scope
 * must never resolve as if a container were empty (H9).
 */
export function boundGroundFor(
  gw: Gateway,
  binding: ConnectionBinding,
  now: number,
  asOf?: number,
): DeltaSet {
  const closed = readClosedIds(gw, now);
  return DeltaSet.from(
    gw
      .connectionScope({ bound: binding.container })
      .filter(
        (d) =>
          (asOf === undefined || d.claims.timestamp <= asOf) &&
          !closed.has(d.id) &&
          !negatedInGround(gw, d.id, new Set()),
      ),
  );
}

/**
 * Is `id` negated, by the substrate's own recursive definition? A strike binds unless it is itself
 * struck — and THAT strike binds unless it is struck, all the way down (rhizomatic's
 * `computeNegated`; Loam's `struck` agrees). A one-link test is right for two links and wrong for
 * four: with d struck by n1, n1 by n2 and n2 by n3, n1 binds again and d must stay suppressed, but
 * one link sees `negationsOf(n1)` non-empty and revives d. `seen` closes the walk over a cycle,
 * which binds nothing.
 */
const negatedInGround = (gw: Gateway, id: string, seen: ReadonlySet<string>): boolean => {
  if (seen.has(id)) return false;
  const next = new Set(seen).add(id);
  return gw.reactor.negationsOf(id).some((n) => !negatedInGround(gw, n, next));
};

const asOfGroundImpl = (gw: Gateway, asOf: number, closed: ReadonlySet<string>): DeltaSet =>
  closed.size === 0
    ? groundAsOfImpl(gw, asOf)
    : DeltaSet.from([...groundAsOfImpl(gw, asOf)].filter((d) => !closed.has(d.id)));

/**
 * The gather a §14 RETRACTION reads, over the UNNARROWED ground (SPEC §29.3's invariant list).
 *
 * Read closure is a property of doors serving READINGS. A retraction is a WRITE that must see what it
 * is retracting, and narrowing it turns a caller's own strike into a SILENT NO-OP: the member is
 * absent from the hview, so it is never a target, no negation is ever signed, and the door answers 200
 * with the field reading absent — which is exactly what read closure was already showing. Un-slate (or
 * let the slate go unresolved) and the claim returns LIVE and UN-RETRACTED at every door, including the
 * anonymous one. H1 crossed with H7, and reachable with no `read` ever declared, because a lapsed
 * deadline adds it (§29.4).
 *
 * It discloses nothing: the negations only ever target the caller's OWN claims, which the caller wrote,
 * and the node returned afterwards goes back through the ordinary narrowed read.
 */
export function gatherForRetractionImpl(
  gw: Gateway,
  name: string,
  entity: string,
  binding?: ConnectionBinding,
): HView {
  const def = gw.def(name);
  // A bound connection's own claims live in its pool, so its retraction gathers ITS scope — the
  // whole of it, unnarrowed by read closure, for the same reason as the primary path.
  const result =
    binding === undefined
      ? gw.reactor.eval(def.hyperschema.body, entity, gw.registry)
      : evalTerm(
          def.hyperschema.body,
          DeltaSet.from(gw.connectionScope({ bound: binding.container })),
          entity,
          gw.registry,
        );
  if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
  return result.hview;
}

// Resolve (schema, entity) to its node: gather, resolve through the Schema, decorate expanded children
// through their OWN readings (§22.7), then apply THIS lens's §22 resolvers as the final step — the
// Policy computes the value, the child decoration fills in nested views, and a resolver the lens
// declares on a field has the last word over both. Finally, annotate an as-of read.
export function resolvedNodeImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): ResolvedNode {
  const def = gw.def(name);
  const hview = gatherImpl(gw, name, entity, now, asOf, binding);
  const view = applyResolvers(
    def.resolvers,
    decorateChildren(
      resolveView(def.schema, hview) as Record<string, View>,
      hview,
      def.schema,
      readingResolversOf(gw),
      gw.resolverMemo,
    ),
    hview,
    entity,
    gw.resolverMemo,
    lensOf(def),
  );
  return annotateImpl(
    gw,
    {
      entity,
      view,
      hex: viewDigest(view),
      hviewHex: hviewDigest(hview),
    },
    asOf,
    readClosedIds(gw, now).size,
  );
}

// Pinned resolution (the body of `Gateway.resolvePinned`, SPEC §17 versioning): answer under an
// ARBITRARY registration — an old version's policy over TODAY's ground — through the same gather the
// live lens uses when no materialization is warm (reactor.eval). The _hex of a pinned view is as
// real as the live one's: same ground, an older lens, an honest content address. Cross-schema refs
// resolve via the live registry (a version pins the named lens, not the whole world's).
//
// The two pins are orthogonal (SPEC §26): with an `asOf`, this becomes an OLD lens over an OLD
// ground — full time travel — resolving the pinned body against the ground as it stood at T
// (the same gather the live as-of read uses, only the schema is pinned rather than the latest).

/**
 * Is this lens served from a federation channel's pool?
 *
 * A channel lens is scoped in `gatherImpl` and NOWHERE ELSE. Two sibling doors resolve their own
 * ground — the pinned §17 ladder and the live subscription — and both would answer a channel lens
 * from the RECEIVER's ground through the PEER's gather body. Measured, before this guard existed:
 *
 *   query      { alice_Plant(entity: FERN) { height } }  ->  11   (alice's, correct)
 *   subscription { alice_Plant(entity: FERN) { height } } -> 999  (the receiver's own claim)
 *
 * With the lens declared public that is an operator's private data streamed to a stranger. So these
 * doors REFUSE a channel lens rather than serve it from the wrong ground: a refusal is always
 * available, and a disclosure is not recoverable. T193 carries the real fix, which is a per-pool
 * materialization rather than one keyed by the program name.
 */
export function channelLens(gw: Gateway, lens: string): boolean {
  const cut = lens.indexOf(":");
  if (cut <= 0) return false;
  const prefix = lens.slice(0, cut);
  // A standing channel whose record cannot say its prefix is STILL a channel lens. Answering
  // `false` would stop these doors refusing, and the refusal is the whole point of the function.
  // Scoped to STANDING channels, exactly as before — a severed channel's lens is `channelGroundFor`'s
  // refusal to make, and widening this reading is not this question's to decide.
  return gw
    .channelStatus()
    .some(
      (c) =>
        c.prefix === prefix ||
        (c.unreadable.includes("prefix") && prefixOfChannelName(c.name) === prefix),
    );
}

export function resolvePinnedImpl(
  gw: Gateway,
  reg: Registered,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): ResolvedNode {
  requireMoment(now, `resolvePinned ${reg.hyperschema.name}`);
  if (channelLens(gw, lensOf(reg))) {
    throw new Error(
      `${lensOf(reg)} arrived through a federation channel, and the pinned door resolves this ` +
        `store's own ground rather than that channel's pool — it would answer the peer's reading ` +
        `over your deltas. Read it through the ordinary query door, which scopes correctly (T193).`,
    );
  }
  // An OLD LENS OVER TODAY'S GROUND IS STILL A READ DOOR (SPEC §29.3): the live branch takes the
  // same `readGround` substitution the cold gather takes, and the as-of branch narrows after the
  // reconstruction. A pinned version freezes the lens, never the store's obligations.
  const closed = readClosedIds(gw, now);
  // A bound connection's pinned read takes the same scoped ground its live read takes (§58): an
  // old lens over the connection's scope, never over the store's own ground.
  const result =
    binding !== undefined
      ? evalTerm(reg.hyperschema.body, boundGroundFor(gw, binding, now, asOf), entity, gw.registry)
      : asOf === undefined
        ? closed.size === 0
          ? gw.reactor.eval(reg.hyperschema.body, entity, gw.registry)
          : evalTerm(reg.hyperschema.body, readGround(gw, now), entity, gw.registry)
        : evalTerm(reg.hyperschema.body, asOfGroundImpl(gw, asOf, closed), entity, gw.registry);
  if (result.sort !== "hview") {
    throw new Error(`schema ${reg.hyperschema.name} does not evaluate to a hyperview`);
  }
  // The pinned version's OWN resolvers apply (SPEC §22) — a version freezes its resolver with its
  // schema, so an old lens keeps computing exactly as it did. Pre-loaded across all versions at bind.
  const view = applyResolvers(
    reg.resolvers,
    decorateChildren(
      resolveView(reg.schema, result.hview) as Record<string, View>,
      result.hview,
      reg.schema,
      readingResolversOf(gw),
      gw.resolverMemo,
    ),
    result.hview,
    entity,
    gw.resolverMemo,
    lensOf(reg),
  );
  return annotateImpl(
    gw,
    {
      entity,
      view,
      hex: viewDigest(view),
      hviewHex: hviewDigest(result.hview),
    },
    asOf,
    closed.size,
  );
}

// A dynamic view of (schema, entity) — the body of the private `Gateway.watchEntity` hook: an
// initial snapshot, then a patch per relevant change. Built on a Channel, so leaving the stream
// (return/throw) detaches immediately — even while the reader is parked waiting for an event that
// never comes. A slow reader coalesces: at most one pending patch, its hex chain and changed-set
// kept honest by the merge. A sink that cannot re-resolve fails ITS OWN stream and detaches — it
// never aborts the fan-out or the writer whose ingest triggered it. A change that leaves the
// resolved view identical (same hex) is no patch at all.
//
// The stream CAPTURES its shape at subscribe time — the policy and the materialization it
// was born watching. An evolution rebinds the query surface, but this stream keeps resolving
// the shape it promised its reader (triggered by, and reading from, the same superseded
// materialization) until the reader resubscribes. Trigger and resolution must agree: the
// current def would re-resolve through the NEW materialization while the OLD one decides
// when to fire — silently missing what only the new shape gathers.
export function watchEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  door: "full" | "public" = "full",
  nowAt: () => number = () => Date.now(),
): AsyncGenerator<PatchNode, void, unknown> {
  const bound = gw.def(name);
  if (channelLens(gw, name)) {
    throw new Error(
      `${name} arrived through a federation channel, and a live subscription resolves this store's ` +
        `own ground rather than that channel's pool — it would stream the peer's reading over your ` +
        `deltas, to whoever is subscribed. Read it through the ordinary query door, which scopes ` +
        `correctly (T193).`,
    );
  }
  const matName = gw.matFor(name, entity, door);
  const resolveCaptured = (): ResolvedNode => {
    // A LIVE SUBSCRIPTION IS A READ DOOR (SPEC §29.3), and here the materialization keeps its real
    // job and loses the other one: THE MAT IS THE TRIGGER; `readGround` IS THE RESOLUTION. A stream
    // resolves off its captured materialization, so without this every already-open subscription
    // keeps pushing patches computed from a set nothing narrowed. A SUPERSET trigger is safe — a
    // change to a read-closed member fires, the narrowed re-resolve yields the same hex, and the
    // `node.hex === lastHex` check below swallows it as silence rather than a no-op patch. A subset
    // trigger would not be, which is what this file's "trigger and resolution must agree" note is
    // about: it warns against a NARROWER trigger, not a wider one.
    const now = nowAt();
    const closed = readClosedIds(gw, now);
    const hview =
      closed.size === 0
        ? gw.reactor.materializedView(matName, entity)
        : (() => {
            const result = evalTerm(
              bound.hyperschema.body,
              readGround(gw, now),
              entity,
              gw.registry,
            );
            return result.sort === "hview" ? result.hview : undefined;
          })();
    if (hview === undefined) {
      throw new Error(`the materialization backing this stream is gone — resubscribe`);
    }
    // Resolvers apply on the stream too (SPEC §22), so a live frame reads exactly as a query does —
    // including the child-reading resolvers on expanded children (§22.7).
    const view = applyResolvers(
      bound.resolvers,
      decorateChildren(
        resolveView(bound.schema, hview) as Record<string, View>,
        hview,
        bound.schema,
        readingResolversOf(gw),
        gw.resolverMemo,
      ),
      hview,
      entity,
      gw.resolverMemo,
      lensOf(bound),
    );
    return {
      entity,
      view,
      hex: viewDigest(view),
      hviewHex: hviewDigest(hview),
    };
  };
  let sinks = gw.sinks.get(matName);
  if (sinks === undefined) {
    const set = new Set<(c: MaterializationChange) => void>();
    gw.sinks.set(matName, set);
    gw.reactor.subscribe(matName, (c) => {
      for (const sink of [...set]) sink(c);
    });
    sinks = set;
  }

  const liveSinks = sinks;
  const sink = (c: MaterializationChange): void => {
    if (c.root !== entity) return;
    try {
      const node = resolveCaptured();
      if (node.hex === lastHex) return; // the view did not move: silence, not a no-op patch
      channel.push({ ...node, fromHex: lastHex, changed: [...c.changedProps] });
      lastHex = node.hex;
    } catch (err) {
      channel.fail(toError(err)); // onClose detaches this sink; others are untouched
    }
  };
  const channel = new Channel<PatchNode>(
    () => {
      liveSinks.delete(sink);
      gw.channels.delete(channel);
    },
    (pending, incoming) =>
      pending.fromHex === null && pending.changed === null
        ? { ...incoming, fromHex: null, changed: null } // still the snapshot — just a newer one
        : {
            ...incoming,
            fromHex: pending.fromHex,
            changed: [...new Set([...(pending.changed ?? []), ...(incoming.changed ?? [])])],
          },
  );

  const initial = resolveCaptured();
  let lastHex = initial.hex;
  liveSinks.add(sink);
  gw.channels.add(channel);
  channel.push({ ...initial, fromHex: null, changed: null });
  return channel;
}

// Run a GraphQL subscription over a given schema (the body of the private `Gateway.subscribeVia`):
// an async stream of data payloads. Errors inside the stream surface as thrown errors; returning
// the iterator ends the underlying watch.
export async function subscribeViaImpl(
  schema: GraphQLSchema,
  source: string,
  variables?: Record<string, unknown>,
): Promise<AsyncGenerator<Record<string, unknown>>> {
  const result = await subscribe({
    schema,
    document: parse(source),
    ...(variables === undefined ? {} : { variableValues: variables }),
  });
  if (!(Symbol.asyncIterator in result)) {
    throw new Error(
      `subscription failed: ${(result.errors ?? []).map((e) => e.message).join("; ") || "unknown"}`,
    );
  }
  // A pass-through, not a generator: return() must reach the source immediately, even while
  // a read is parked (a suspended generator would hold the return until the next event).
  const upstream = result as AsyncGenerator<ExecutionResult, void, unknown>;
  const mapped: AsyncGenerator<Record<string, unknown>, void, unknown> = {
    async next() {
      const item = await upstream.next();
      if (item.done === true) return { value: undefined, done: true };
      const ev = item.value;
      if (ev.errors !== undefined && ev.errors.length > 0) {
        await upstream.return(undefined);
        throw new Error(ev.errors.map((e) => e.message).join("; "));
      }
      return { value: ev.data as Record<string, unknown>, done: false };
    },
    async return() {
      await upstream.return(undefined);
      return { value: undefined, done: true };
    },
    async throw(error?: unknown) {
      await upstream.return(undefined);
      throw error instanceof Error ? error : new Error(String(error));
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return mapped;
}
