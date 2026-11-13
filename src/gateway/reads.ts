import type { Peer } from "./peer.js";
import { parse, subscribe, type ExecutionResult, type GraphQLSchema } from "graphql";
import {
  anchorAnalysis,
  contentAddress,
  DeltaSet,
  evalTerm,
  hviewCanonicalHex,
  resolveView,
  viewCanonicalHex,
  type Admits,
  type EvalResult,
  type HView,
  type SchemaRegistry,
  type Term,
  type MaterializationChange,
  type View,
} from "@bombadil/rhizomatic";
import { Channel, streamAfter } from "./channel.js";
import { channelBindingPrefix } from "../federation/channel.js";
import { erasedInScope, forgottenSince } from "./erase.js";
import { readGround } from "./slate.js";
import { requireMoment, readClosedIds } from "./slate-law.js";
import type { ConnectionBinding, Gateway } from "./gateway.js";
import type { PatchNode, ResolvedNode } from "./gql.js";
import type { Registered } from "./gql.js";
import { byLens, lensOf, type ResolverSpecs } from "./registration.js";
import { applyResolvers, decorateChildren } from "./resolvers.js";
import { governedProgram, grantGround, needsLowering } from "./governed-trust.js";
import { userGroundOf } from "./user-root.js";

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

const bytesOf = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const viewDigest = (v: View): string => contentAddress(bytesOf(viewCanonicalHex(v)));
const hviewDigest = (h: HView): string => contentAddress(bytesOf(hviewCanonicalHex(h)));

const readingResolversOf = (gw: Gateway, binding?: ConnectionBinding) => {
  const registered = binding === undefined ? gw.registered : gw.boundSurface(binding).registered;
  return (name: string): ResolverSpecs | undefined => byLens(registered, name)?.resolvers;
};

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
    forgotten: forgottenSince(gw.reactor, gw.validityNow(), gw.operatorAuthor, asOf),
    ...(suppressed > 0 ? { suppressed } : {}),
  };
}

function evalGoverned(
  gw: Gateway,
  body: Term,
  input: DeltaSet,
  now: number,
  entity: string,
  registry: SchemaRegistry | undefined,
  cut?: number,
): EvalResult {
  const users = userGroundOf(gw.reactor);
  const program = governedProgram(
    body,
    registry,
    input,
    { now },
    cut === undefined ? users : { ...users, cut },
  );
  return evalTerm(program.term, input, now, entity, program.registry);
}

function primaryAdmits(closed: ReadonlySet<string>, asOf?: number): Admits | undefined {
  if (asOf === undefined) return closed.size === 0 ? undefined : (d) => !closed.has(d.id);
  return (d) => d.claims.timestamp <= asOf && !closed.has(d.id);
}

function evalPrimary(
  gw: Gateway,
  body: Term,
  at: number,
  entity: string,
  registry: SchemaRegistry | undefined,
  closed: ReadonlySet<string>,
  asOf?: number,
): EvalResult {
  const admits = primaryAdmits(closed, asOf);
  const users = userGroundOf(gw.reactor);
  const program = governedProgram(
    body,
    registry,
    needsLowering(body, registry) ? grantGround(gw.reactor, undefined, admits) : NO_GROUND,
    { now: at },
    asOf === undefined ? users : { ...users, cut: asOf },
  );
  if (anchorAnalysis(program.term, program.registry).anchored)
    return gw.reactor.evalAnchored(program.term, at, entity, program.registry, undefined, admits)
      .result;
  const ground = gw.reactor.snapshot();
  return evalTerm(
    program.term,
    admits === undefined ? ground : ground.filtered(admits),
    at,
    entity,
    program.registry,
  );
}

const NO_GROUND = new DeltaSet();
const NO_IDS: ReadonlySet<string> = new Set();

export function gatherImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): HView {
  requireMoment(now, `gather ${name}`);

  if (binding !== undefined) {
    const source = channelAssociation(gw, name, binding);
    if (source !== undefined && !source.scoped) {
      throw new Error(
        `${name} arrived through a federation channel, and a bound connection reads only the ` +
          `container its consent named — that channel's pool is outside its scope`,
      );
    }
    assertChannelSourceLegible(gw, name, binding);
    const surface = gw.boundSurface(binding);
    const result = evalGoverned(
      gw,
      gw.def(name, binding).hyperschema.body,
      boundGroundFor(gw, binding, now, asOf),
      asOf ?? gw.validityNow(now),
      entity,
      surface.registry,
      asOf,
    );
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  const closed = readClosedIds(gw, now);

  const scoped = channelGroundFor(gw, name, now, asOf);
  if (scoped !== undefined) {
    const result = evalGoverned(
      gw,
      gw.def(name).hyperschema.body,
      scoped,
      asOf ?? gw.validityNow(now),
      entity,
      gw.registry,
      asOf,
    );
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  if (asOf !== undefined) {
    const def = gw.def(name);
    const result = evalPrimary(gw, def.hyperschema.body, asOf, entity, gw.registry, closed, asOf);
    if (result.sort !== "hview") {
      throw new Error(`schema ${name} does not evaluate to a hyperview`);
    }
    return result.hview;
  }
  if (closed.size === 0) {
    const program = gw.def(name).hyperschema.name;
    const live =
      gw.reactor.materializedView(gw.matName(program), entity) ??
      gw.reactor.materializedView(gw.lazyMatName(program, entity), entity);
    if (live !== undefined) return live;
  }
  const def = gw.def(name);
  const result = evalPrimary(
    gw,
    def.hyperschema.body,
    gw.validityNow(now),
    entity,
    gw.registry,
    closed,
  );
  if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
  return result.hview;
}

function channelAssociation(gw: Gateway, lens: string, binding?: ConnectionBinding) {
  const rows = binding === undefined ? gw.registered : gw.boundSurface(binding).registered;
  const bound = byLens(rows, lens);
  if (bound !== undefined) {
    if (bound.channel === undefined) return undefined;
    if (gw.store.inboxes(gw).has(bound.channel)) {
      if (gw.store.channels(gw).has(bound.channel)) {
        throw new Error(`${lens} has an ambiguous attached peer source`);
      }
      return undefined;
    }
    return {
      name: bound.channel,
      scoped:
        binding !== undefined &&
        !gw.registered.some((r) => lensOf(r) === lens && r.channel === bound.channel),
    };
  }
  const channels = gw.channelsEver();
  const matches = channels
    .flatMap((status) => {
      const prefix = channelBindingPrefix(gw, status);
      return prefix !== undefined && lens.startsWith(`${prefix}:`) ? [{ prefix, status }] : [];
    })
    .sort((a, b) => b.prefix.length - a.prefix.length);
  const first = matches[0];
  if (first === undefined) return undefined;
  if (
    matches.some(
      (m) => m.prefix.length === first.prefix.length && m.status.name !== first.status.name,
    )
  ) {
    throw new Error(
      `${lens} has an ambiguous federation channel source; it must not fall back to this store's own deltas`,
    );
  }
  return { name: first.status.name, scoped: false };
}

export function channelUsesUnboundGround(
  gw: Gateway,
  lens: string,
  binding?: ConnectionBinding,
): boolean {
  const source = channelAssociation(gw, lens, binding);
  return source !== undefined && !source.scoped;
}

function channelSource(gw: Gateway, lens: string, binding?: ConnectionBinding) {
  const source = channelAssociation(gw, lens, binding);
  if (source === undefined) return undefined;
  const channel = gw.channelStatus().find((c) => c.name === source.name);
  if (channel === undefined) {
    throw new Error(
      `${lens} was served by the federation channel "${source.name}", which has been severed or is unavailable. ` +
        `Its pool cannot supply this reading — it must not fall back to this store's own deltas. Re-open the channel, or retire the lens.`,
    );
  }
  if (channel.unreadable.includes("prefix") || channelBindingPrefix(gw, channel) === undefined) {
    throw new Error(
      `${lens} is served by the federation channel "${channel.name}", whose record does not ` +
        `carry its prefix in the shape a channel record is written in. This reading cannot be ` +
        `scoped to that peer's pool, and it must not fall back to this store's own deltas. ` +
        `\`loam federate list\` names what the record cannot say.`,
    );
  }
  return channel;
}

export function assertChannelSourceLegible(
  gw: Gateway,
  lens: string,
  binding?: ConnectionBinding,
): void {
  if (binding !== undefined && channelUsesUnboundGround(gw, lens, binding)) {
    throw new Error(`${lens} is a federation channel source outside this bound connection's scope`);
  }
  channelSource(gw, lens, binding);
}

function channelGroundFor(
  gw: Gateway,
  lens: string,
  now: number,
  asOf?: number,
): DeltaSet | undefined {
  const channel = channelSource(gw, lens);
  if (channel === undefined) return undefined;
  const closed = readClosedIds(gw, now);
  const scope = gw.servingScope(now, {
    containers: [channel.name],
    ...(asOf === undefined ? {} : { asOf }),
  });
  const erased = erasedInScope(gw.reactor, gw.operatorAuthor, scope);
  const deltas = scope.filter(
    (d) =>
      (asOf === undefined || d.claims.timestamp <= asOf) &&
      !closed.has(d.id) &&
      !erased.has(d.id) &&
      !negatedInGround(gw, asOf ?? gw.validityNow(now), d.id, new Set()),
  );
  return DeltaSet.from(deltas);
}

export function boundGroundFor(
  gw: Gateway,
  binding: ConnectionBinding,
  now: number,
  asOf?: number,
): DeltaSet {
  const closed = readClosedIds(gw, now);
  const scope = gw.servingScope(now, {
    bound: binding.container,
    ...(asOf === undefined ? {} : { asOf }),
  });
  const erased = erasedInScope(gw.reactor, gw.operatorAuthor, scope);
  return DeltaSet.from(
    scope.filter(
      (d) =>
        (asOf === undefined || d.claims.timestamp <= asOf) &&
        !closed.has(d.id) &&
        !erased.has(d.id) &&
        !negatedInGround(gw, asOf ?? gw.validityNow(now), d.id, new Set()),
    ),
  );
}

const negatedInGround = (
  gw: Gateway,
  now: number,
  id: string,
  seen: ReadonlySet<string>,
): boolean => {
  if (seen.has(id)) return false;
  const next = new Set(seen).add(id);
  return gw.reactor.negationsOf(id).some((n) => {
    const strike = gw.reactor.get(n);
    return (
      strike !== undefined &&
      strike.claims.validFrom <= now &&
      (strike.claims.validUntil === undefined || now < strike.claims.validUntil) &&
      !negatedInGround(gw, now, n, next)
    );
  });
};

export function gatherForRetractionImpl(
  gw: Gateway,
  name: string,
  entity: string,
  binding?: ConnectionBinding,
  now: number = gw.validityNow(),
): HView {
  const def = gw.def(name, binding);
  const source = channelSource(gw, name, binding);
  if (
    source !== undefined &&
    binding !== undefined &&
    !channelAssociation(gw, name, binding)?.scoped
  ) {
    throw new Error(
      `${name} is a federation channel source outside this bound connection's retraction scope`,
    );
  }
  if (source !== undefined && binding === undefined) {
    const pool = gw.store.channels(gw).get(source.name)?.gateway;
    if (pool === undefined)
      throw new Error(`${name}: channel source ${source.name} cannot be read for retraction`);
    const result = evalGoverned(
      gw,
      def.hyperschema.body,
      DeltaSet.from(pool.reactor.arrivalLog()),
      gw.validityNow(now),
      entity,
      gw.registry,
    );
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }
  const result =
    binding === undefined
      ? evalPrimary(gw, def.hyperschema.body, gw.validityNow(now), entity, gw.registry, NO_IDS)
      : evalGoverned(
          gw,
          def.hyperschema.body,
          DeltaSet.from(gw.connectionScope({ bound: binding.container })),
          gw.validityNow(now),
          entity,
          gw.boundSurface(binding).registry,
        );
  if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
  return result.hview;
}

export function gatherPoolForRetraction(
  gw: Gateway,
  name: string,
  entity: string,
  binding: ConnectionBinding,
  pool: Peer,
  now: number = gw.validityNow(),
): HView {
  const def = gw.def(name, binding);
  if (channelUsesUnboundGround(gw, name, binding)) {
    throw new Error(
      `${name} is an unbound federation channel source, not this owner's inbox retraction ground`,
    );
  }
  const result = evalGoverned(
    gw,
    def.hyperschema.body,
    DeltaSet.from([...pool.reactor.arrivalLog()]),
    gw.validityNow(now),
    entity,
    gw.boundSurface(binding).registry,
  );
  if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
  return result.hview;
}

export function resolvedNodeImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  asOf?: number,
  binding?: ConnectionBinding,
): ResolvedNode {
  const def = gw.def(name, binding);
  const hview = gatherImpl(gw, name, entity, now, asOf, binding);
  return finishNodeImpl(
    gw,
    name,
    entity,
    now,
    hview,
    resolveView(def.schema, hview) as Record<string, View>,
    asOf,
    binding,
  );
}

export function finishNodeImpl(
  gw: Gateway,
  name: string,
  entity: string,
  now: number,
  hview: HView,
  resolved: Record<string, View>,
  asOf?: number,
  binding?: ConnectionBinding,
): ResolvedNode {
  const def = gw.def(name, binding);
  const view = applyResolvers(
    def.resolvers,
    decorateChildren(resolved, hview, def.schema, readingResolversOf(gw, binding), gw.resolverMemo),
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

export function channelLens(gw: Gateway, lens: string, binding?: ConnectionBinding): boolean {
  return channelAssociation(gw, lens, binding) !== undefined;
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
  const closed = readClosedIds(gw, now);
  const result =
    binding !== undefined
      ? evalGoverned(
          gw,
          reg.hyperschema.body,
          boundGroundFor(gw, binding, now, asOf),
          asOf ?? gw.validityNow(now),
          entity,
          gw.registry,
          asOf,
        )
      : evalPrimary(
          gw,
          reg.hyperschema.body,
          asOf ?? gw.validityNow(now),
          entity,
          gw.registry,
          closed,
          asOf,
        );
  if (result.sort !== "hview") {
    throw new Error(`schema ${reg.hyperschema.name} does not evaluate to a hyperview`);
  }
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

export function watchEntityImpl(
  gw: Gateway,
  name: string,
  entity: string,
  door: "full" | "public" = "full",
  nowAt: () => number = () => Date.now(),
): AsyncGenerator<PatchNode, void, unknown> {
  if (gw.reseating !== undefined)
    return streamAfter(
      gw.reseating,
      () => watchEntityImpl(gw, name, entity, door, nowAt),
      gw.channels,
    );
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
    const now = nowAt();
    const closed = readClosedIds(gw, now);
    const hview =
      closed.size === 0
        ? gw.reactor.materializedView(matName, entity)
        : (() => {
            const result = evalGoverned(
              gw,
              bound.hyperschema.body,
              readGround(gw, now),
              gw.validityNow(now),
              entity,
              gw.registry,
            );
            return result.sort === "hview" ? result.hview : undefined;
          })();
    if (hview === undefined) {
      throw new Error(`the materialization backing this stream is gone — resubscribe`);
    }
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
      if (node.hex === lastHex) return;
      channel.push({ ...node, fromHex: lastHex, changed: [...c.changedProps] });
      lastHex = node.hex;
    } catch (err) {
      channel.fail(toError(err));
    }
  };
  const channel = new Channel<PatchNode>(
    () => {
      liveSinks.delete(sink);
      gw.channels.delete(channel);
    },
    (pending, incoming) =>
      pending.fromHex === null && pending.changed === null
        ? { ...incoming, fromHex: null, changed: null }
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
