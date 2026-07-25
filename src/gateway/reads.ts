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
import { forgottenSince } from "./erase.js";
import { readClosedIds, readGround, requireMoment } from "./slate.js";
import type { Gateway } from "./gateway.js";
import type { PatchNode, ResolvedNode } from "./gql.js";
import type { Registered } from "./gql.js";
import { lensOf, type ResolverSpecs } from "./registration.js";
import { applyResolvers, decorateChildren } from "./resolvers.js";

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

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
): HView {
  requireMoment(now, `gather ${name}`);
  const closed = readClosedIds(gw, now);
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
export function gatherForRetractionImpl(gw: Gateway, name: string, entity: string): HView {
  const def = gw.def(name);
  const result = gw.reactor.eval(def.hyperschema.body, entity, gw.registry);
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
): ResolvedNode {
  const def = gw.def(name);
  const hview = gatherImpl(gw, name, entity, now, asOf);
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
  );
  return annotateImpl(
    gw,
    {
      entity,
      view,
      hex: viewCanonicalHex(view),
      hviewHex: hviewCanonicalHex(hview),
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
export function resolvePinnedImpl(
  gw: Gateway,
  reg: Registered,
  entity: string,
  now: number,
  asOf?: number,
): ResolvedNode {
  requireMoment(now, `resolvePinned ${reg.hyperschema.name}`);
  // An OLD LENS OVER TODAY'S GROUND IS STILL A READ DOOR (SPEC §29.3): the live branch takes the
  // same `readGround` substitution the cold gather takes, and the as-of branch narrows after the
  // reconstruction. A pinned version freezes the lens, never the store's obligations.
  const closed = readClosedIds(gw, now);
  const result =
    asOf === undefined
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
  );
  return annotateImpl(
    gw,
    {
      entity,
      view,
      hex: viewCanonicalHex(view),
      hviewHex: hviewCanonicalHex(result.hview),
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
    );
    return {
      entity,
      view,
      hex: viewCanonicalHex(view),
      hviewHex: hviewCanonicalHex(hview),
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
