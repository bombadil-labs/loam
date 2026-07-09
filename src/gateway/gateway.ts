// The Gateway: one live front over one StoreBackend. It boots by replaying the store into a
// Reactor, writes every accepted delta through to the backend by way of the raw stream (so a
// future DerivationHost's emissions persist by the same path as appends), meta-resolves
// schema-defining deltas via SCHEMA_SCHEMA, and serves GraphQL derived from what is registered:
// query (resolve once → snapshot), mutate (args → signed deltas → append → the re-resolved
// view), and subscribe (a snapshot, then a patch per relevant change).
//
// The reactor is the living present tense; the backend is the ground it grows from and settles
// back into. Nothing is reachable except through what a registered (HyperSchema, Policy) pair
// exposes.

import {
  Reactor,
  SchemaRegistry,
  authorForSeed,
  computeId,
  loadSchema,
  resolveView,
  signClaims,
  verifyDelta,
  viewCanonicalHex,
  type Delta,
  type HView,
  type HyperSchema,
  type IngestResult,
  type MaterializationChange,
  type Policy,
  type Primitive,
  type View,
} from "@bombadil/rhizomatic";
import { graphql, parse, subscribe, type ExecutionResult, type GraphQLSchema } from "graphql";
import type { StoreBackend } from "../store/backend.js";
import { authorize } from "./accounts.js";
import { Channel } from "./channel.js";
import type { Genesis } from "./genesis.js";
import { buildGqlSchema, type PatchNode, type Registered, type ResolvedNode } from "./gql.js";
import { readRegistrations, registrationClaims, type Registration } from "./registration.js";

export interface AppendReceipt {
  readonly accepted: number;
  readonly duplicates: number;
}

export interface QueryResult {
  data?: Record<string, unknown> | null;
  errors?: string[];
}

export interface GatewayOptions {
  // The OPERATOR's signing identity — the root of the capability chain (SPEC §7). It needs no
  // grant, plants the first tenants and grants, and signs mutations that name no actor. Without
  // a seed the gateway is read-only — unsigned authority does not exist here.
  readonly seed?: string;
}

export interface RequestContext {
  // The acting identity for this request: mutations are signed as this seed's author and
  // authorized as them. Absent, the operator acts.
  readonly actor?: string;
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export class Gateway {
  private readonly registered: Registered[] = [];
  private registry = SchemaRegistry.build([]);
  private gql: GraphQLSchema | undefined;
  // The write-through queue: raw-stream deltas append to the backend in arrival order. The
  // chain itself always resolves (later writes are still attempted); the FIRST failure latches
  // in `writeFailure`, and from then on the gateway is degraded: append refuses new work
  // before ingesting it, and flush/close surface the failure. A gateway that cannot persist
  // must not quietly widen the gap between the live view and the ground.
  private writes: Promise<void> = Promise.resolve();
  private writeFailure: Error | undefined;
  // Live subscriptions: one reactor subscription per materialization name, fanned out to any
  // number of sinks (the reactor has no unsubscribe; the fan-out set is ours, so leaving a
  // subscription only empties our set). Lazily-registered materializations — for entities not
  // in any registered root list — are cached and reused for the gateway's lifetime.
  private readonly sinks = new Map<string, Set<(c: MaterializationChange) => void>>();
  private readonly lazyMats = new Set<string>();
  private readonly channels = new Set<Channel<PatchNode>>();
  // Ids append() has already persisted this tick: the raw-stream subscriber skips them, so a
  // direct append is written exactly once (the raw stream still catches every OTHER emitter —
  // a future DerivationHost's emissions ride it into the ground).
  private readonly justPersisted = new Set<string>();
  private lastMutationTs = 0;
  private readonly operatorAuthor: string | undefined;
  // When a runner animates the gateway, ingest routes through its DerivationHost (ingest + drain
  // derivations); otherwise straight to the reactor. Passive vs animate is exactly this hook.
  private ingestVia: (d: Delta) => IngestResult = (d) => this.reactor.ingest(d);

  private constructor(
    private readonly backend: StoreBackend,
    readonly reactor: Reactor,
    private readonly options: GatewayOptions,
  ) {
    this.operatorAuthor = options.seed === undefined ? undefined : authorForSeed(options.seed);
    reactor.subscribeRaw((d) => {
      if (this.justPersisted.delete(d.id)) return;
      this.writes = this.writes
        .then(() => this.backend.append([d]))
        .then(
          () => {},
          (err: unknown) => {
            this.writeFailure ??= toError(err);
          },
        );
    });
  }

  // Open a gateway over a backend: replay everything the store holds, then start listening.
  // The raw subscription attaches AFTER replay, so boot never writes the store back to itself.
  static async open(backend: StoreBackend, options: GatewayOptions = {}): Promise<Gateway> {
    const reactor = new Reactor();
    for (const d of await backend.deltasSince(new Set())) {
      const result = reactor.ingest(d);
      if (result.status === "rejected") {
        throw new Error(`replay: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    const gateway = new Gateway(backend, reactor, options);
    gateway.replayRegistrations();
    return gateway;
  }

  // Boot a fresh (or existing) store from a genesis delta-set: open governed by the genesis
  // operator, land the bundle (idempotent — content-addressed deltas dedup), and register what
  // the genesis declares. The store is born answering and enforcing.
  static async boot(backend: StoreBackend, genesis: Genesis): Promise<Gateway> {
    const gateway = await Gateway.open(backend, { seed: genesis.operatorSeed });
    if (genesis.deltas.length > 0) await gateway.append(genesis.deltas);
    gateway.replayRegistrations();
    return gateway;
  }

  // Re-register from the registrations the store holds — the surface as a function of the store.
  // In a governed store only the operator's registrations bind (a hostile one roots nowhere).
  private replayRegistrations(): void {
    const known = new Set(this.registered.map((r) => r.schema.name));
    for (const reg of readRegistrations(this.reactor, this.operatorAuthor)) {
      if (known.has(reg.schema.name)) continue;
      this.register(reg.schema, reg.policy, reg.roots);
      known.add(reg.schema.name);
    }
  }

  // Persist a batch, THEN serve it. The batch is validated whole (one bad delta refuses the
  // lot); it lands in the backend before the reactor sees it, so nothing a query or a
  // subscriber can observe is ever less durable than the ground — a failed write means nothing
  // happened, and the caller may simply retry. Only verified signatures pass: the substrate
  // accepts unsigned deltas, the gateway does not (authority is always attested here). And each
  // delta must be PERMITTED: its verified author holds a surviving grant covering everything
  // the delta touches, or is the operator. Authorization reads the state as it stands before
  // the batch — a batch cannot bootstrap its own permissions.
  async append(deltas: Iterable<Delta>): Promise<AppendReceipt> {
    if (this.writeFailure !== undefined) {
      throw new Error(`this gateway can no longer persist: ${this.writeFailure.message}`);
    }
    const batch = [...deltas];
    for (const d of batch) {
      if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified") {
        throw new Error(
          `append rejected: delta ${d.id} is unsigned or not what it claims to be — ` +
            `the gateway accepts only verified authorship`,
        );
      }
      // Governance begins with the operator: a gateway holding no operator identity is an
      // ungoverned local store (any verified delta is welcome); one holding an operator
      // enforces capabilities on everyone but the operator. Deployed gateways (step 6) are
      // always governed.
      if (this.operatorAuthor !== undefined) {
        const verdict = authorize(this.reactor, d, this.operatorAuthor);
        if (!verdict.ok) {
          throw new Error(`append rejected: ${verdict.refusal}`);
        }
      }
    }
    await this.backend.append(batch); // a throw here means NOTHING was ingested or served
    let accepted = 0;
    let duplicates = 0;
    for (const d of batch) this.justPersisted.add(d.id);
    try {
      for (const d of batch) {
        const result = this.ingestVia(d);
        if (result.status === "accepted") accepted += 1;
        else duplicates += 1; // "rejected" is unreachable: the batch was validated above
      }
    } finally {
      // Always cleared — duplicates never hit the raw stream, and a mid-ingest throw must not
      // leave stale ids silently exempting future raw-stream writes.
      for (const d of batch) this.justPersisted.delete(d.id);
    }
    return { accepted, duplicates };
  }

  // Meta-resolve schema-defining deltas via SCHEMA_SCHEMA into a HyperSchema. The definition is
  // proven against a TRIAL set first — the store is append-only, so nothing lands until the
  // deltas are known to define what the caller says they define.
  async loadSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    const batch = [...deltas];
    const trial = this.reactor.snapshot();
    for (const d of batch) trial.add(d);
    const schema = loadSchema(trial, entity); // throws here → nothing was persisted
    await this.append(batch);
    return schema;
  }

  // Register a (HyperSchema, Policy) pair over the given roots: a live materialization per
  // root, and a GraphQL surface rebuilt to include it. Everything that can refuse — duplicate
  // names, unresolved refs, GraphQL field collisions — refuses BEFORE any state changes, so a
  // failed registration leaves the gateway exactly as it was. Register dependencies first:
  // earlier schemas are visible to later refs.
  register(schema: HyperSchema, policy: Policy, roots: readonly string[]): void {
    if (schema.name.includes("\u0000")) {
      throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
    }
    const next = [...this.registered, { schema, policy, roots }];
    const registry = SchemaRegistry.build(next.map((r) => r.schema)); // refuses dups + bad refs
    const gql = buildGqlSchema(next, {
      resolve: (name, entity) => this.resolvedNode(name, entity),
      mutate: (name, entity, props, actorSeed) => this.mutateEntity(name, entity, props, actorSeed),
      watch: (name, entity) => this.watchEntity(name, entity),
    }); // refuses collisions
    this.reactor.register(schema.name, schema.body, roots, registry);
    this.registered.push({ schema, policy, roots });
    this.registry = registry;
    this.gql = gql;
  }

  // Persist a registration (schema + policy + roots) as data, then register it, so the surface
  // survives reopen with no code. A registration files under an ungoverned-tenant entity, so
  // append authorizes it for the operator only — it is the operator's to shape the store.
  async publishRegistration(
    schema: HyperSchema,
    policy: Policy,
    roots: readonly string[],
    context?: RequestContext,
  ): Promise<void> {
    const seed = context?.actor ?? this.options.seed;
    if (seed === undefined) {
      throw new Error("this gateway holds no signing seed and cannot publish a registration");
    }
    const reg: Registration = { schema, policy, roots };
    const claims = registrationClaims(reg, authorForSeed(seed), this.nextTimestamp());
    await this.append([signClaims(claims, seed)]);
    this.replayRegistrations();
  }

  // Animate the gateway: route ingest through a runner's DerivationHost so bindings fire.
  animate(host: { ingest: (d: Delta) => IngestResult }): void {
    this.ingestVia = (d) => host.ingest(d);
  }

  private nextTimestamp(): number {
    this.lastMutationTs = Math.max(Date.now(), this.lastMutationTs + 1);
    return this.lastMutationTs;
  }

  // --- the read seam ---------------------------------------------------------------------------

  private def(name: string): Registered {
    const def = this.registered.find((r) => r.schema.name === name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    return def;
  }

  // The materialization watching (schema, entity) — the schema's own when the entity is a
  // registered root, a lazily-created cached one otherwise. Lazy names live in a NUL-separated
  // namespace no schema name can enter (register() refuses NUL), so they can never collide.
  private lazyMatName(name: string, entity: string): string {
    return `\u0000${name}\u0000${entity}`;
  }

  private static readonly MAX_LAZY_MATS = 1024;

  private matFor(name: string, entity: string): string {
    const def = this.def(name);
    if (def.roots.includes(entity)) return name;
    const matName = this.lazyMatName(name, entity);
    if (!this.lazyMats.has(matName)) {
      // The reactor has no deregister, so every watched entity costs memory and per-ingest CPU
      // for the gateway's lifetime. The cap keeps an unauthenticated reader from growing the
      // reactor without bound; raising it is a deploy decision, not a default.
      if (this.lazyMats.size >= Gateway.MAX_LAZY_MATS) {
        throw new Error(
          `this gateway already watches ${Gateway.MAX_LAZY_MATS} unregistered entities — ` +
            `register the roots you mean to hold live`,
        );
      }
      this.reactor.register(matName, def.schema.body, [entity], this.registry);
      this.lazyMats.add(matName);
    }
    return matName;
  }

  // Gather the HView for (schema, entity): the live materialization when one is watching —
  // registered root or lazy — and batch evaluation otherwise (the spike proved them identical).
  private gather(name: string, entity: string): HView {
    const live =
      this.reactor.materializedView(name, entity) ??
      this.reactor.materializedView(this.lazyMatName(name, entity), entity);
    if (live !== undefined) return live;
    const def = this.def(name);
    const result = this.reactor.eval(def.schema.body, entity, this.registry);
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  private resolvedNode(name: string, entity: string): ResolvedNode {
    const view = resolveView(this.def(name).policy, this.gather(name, entity)) as Record<
      string,
      View
    >;
    return { entity, view, hex: viewCanonicalHex(view) };
  }

  // --- the write seam --------------------------------------------------------------------------

  // One signed property-claim delta per provided property, signed as the ACTOR (or the
  // operator when no actor is named), appended through the same validated, capability-enforced
  // path as everything else.
  private async mutateEntity(
    name: string,
    entity: string,
    props: Record<string, Primitive>,
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    const seed = actorSeed ?? this.options.seed;
    if (seed === undefined) {
      throw new Error("this gateway holds no signing seed and cannot write");
    }
    const entries = Object.entries(props);
    if (entries.length === 0) {
      throw new Error(`mutation of ${entity} names no properties to claim`);
    }
    const author = authorForSeed(seed);
    // Strictly monotonic WITHIN THIS INSTANCE: two mutations from one running gateway never tie
    // on timestamp, so pick-byTimestamp between them is an ordering, not a coin flip on
    // delta-id hashes. Across restarts (or gateways) the wall clock is the only witness.
    const timestamp = this.nextTimestamp();
    const deltas = entries.map(([prop, value]) =>
      signClaims(
        {
          timestamp,
          author,
          pointers: [
            { role: "subject", target: { kind: "entity", entity: { id: entity, context: prop } } },
            { role: "value", target: { kind: "primitive", value } },
          ],
        },
        seed,
      ),
    );
    await this.append(deltas);
    return this.resolvedNode(name, entity);
  }

  // --- the live seam ---------------------------------------------------------------------------

  // A dynamic view of (schema, entity): an initial snapshot, then a patch per relevant change.
  // Built on a Channel, so leaving the stream (return/throw) detaches immediately — even while
  // the reader is parked waiting for an event that never comes. A slow reader coalesces: at
  // most one pending patch, its hex chain and changed-set kept honest by the merge. A sink that
  // cannot re-resolve fails ITS OWN stream and detaches — it never aborts the fan-out or the
  // writer whose ingest triggered it. A change that leaves the resolved view identical (same
  // hex) is no patch at all.
  private watchEntity(name: string, entity: string): AsyncGenerator<PatchNode, void, unknown> {
    const matName = this.matFor(name, entity);
    let sinks = this.sinks.get(matName);
    if (sinks === undefined) {
      const set = new Set<(c: MaterializationChange) => void>();
      this.sinks.set(matName, set);
      this.reactor.subscribe(matName, (c) => {
        for (const sink of [...set]) sink(c);
      });
      sinks = set;
    }

    const liveSinks = sinks;
    const sink = (c: MaterializationChange): void => {
      if (c.root !== entity) return;
      try {
        const node = this.resolvedNode(name, entity);
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
        this.channels.delete(channel);
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

    const initial = this.resolvedNode(name, entity);
    let lastHex = initial.hex;
    liveSinks.add(sink);
    this.channels.add(channel);
    channel.push({ ...initial, fromHex: null, changed: null });
    return channel;
  }

  // --- the GraphQL surface ---------------------------------------------------------------------

  private schemaOrThrow(): GraphQLSchema {
    if (this.gql === undefined) {
      throw new Error("nothing is registered: the gateway has no queryable surface yet");
    }
    return this.gql;
  }

  async query(
    source: string,
    variables?: Record<string, unknown>,
    context?: RequestContext,
  ): Promise<QueryResult> {
    const result = await graphql({
      schema: this.schemaOrThrow(),
      source,
      contextValue: context,
      ...(variables === undefined ? {} : { variableValues: variables }),
    });
    return {
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.errors === undefined ? {} : { errors: result.errors.map((e) => e.message) }),
    };
  }

  // Run a GraphQL subscription: an async stream of data payloads. Errors inside the stream
  // surface as thrown errors; returning the iterator ends the underlying watch.
  async subscribe(
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    const result = await subscribe({
      schema: this.schemaOrThrow(),
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

  // Await every write the raw stream has queued; surface the first write-through failure.
  async flush(): Promise<void> {
    await this.writes;
    if (this.writeFailure !== undefined) {
      throw new Error(`write-through failed: ${this.writeFailure.message}`);
    }
  }

  // Close ends every live subscription (a parked reader wakes with done, never hangs), then
  // always releases the backend, even when a latched write failure has to be surfaced.
  async close(): Promise<void> {
    for (const channel of [...this.channels]) await channel.return();
    try {
      await this.flush();
    } finally {
      await this.backend.close();
    }
  }
}
