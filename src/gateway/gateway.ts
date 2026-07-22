// The Gateway: one live front over one StoreBackend. It boots by replaying the store into a
// Reactor, writes every accepted delta through to the backend by way of the raw stream (so a
// future DerivationHost's emissions persist by the same path as appends), meta-resolves
// schema-defining deltas via HYPER_SCHEMA_SCHEMA, and serves GraphQL derived from what is registered:
// query (resolve once → snapshot), mutate (args → signed deltas → append → the re-resolved
// view), and subscribe (a snapshot, then a patch per relevant change).
//
// The reactor is the living present tense; the backend is the ground it grows from and settles
// back into. Nothing is reachable except through what a registered (HyperSchema, Schema) pair
// exposes.

import {
  Reactor,
  SchemaRegistry,
  authorForSeed,
  computeId,
  evalTerm,
  type Delta,
  type HView,
  type HyperSchema,
  type IngestResult,
  type MaterializationChange,
  type Schema,
  type Primitive,
  type Term,
} from "@bombadil/rhizomatic";
import { graphql, type GraphQLSchema } from "graphql";
import type { StoreBackend } from "../store/backend.js";
import { isRepairable } from "../store/quarantine.js";
import { promoteImpl, readAdoptions, type Adoption } from "./adopt.js";
import { eraseImpl, eraseReplicaImpl } from "./erase.js";
import { Channel } from "./channel.js";
import { STORE_ENTITY, operatorMarkerClaims, type Genesis } from "./genesis.js";
import {
  admitForImpl,
  appendImpl,
  federateImpl,
  offeredDeltasImpl,
  selectImpl,
  watchImpl,
  withNegationClosure,
} from "./ingest.js";
import { freezeMembers, type ModuleVersion } from "./container-identity.js";
import {
  boundKey,
  lazyMatNameImpl,
  loadHyperSchemaImpl,
  matForImpl,
  matNameImpl,
  preloadResolversImpl,
  publishRegistrationImpl,
  type PublishOutcome,
  rebindImpl,
  registerImpl,
  replayRegistrationsImpl,
} from "./lifecycle.js";
import {
  buildGqlSchema,
  type ClaimPointerSpec,
  type GqlHooks,
  type PatchNode,
  type Registered,
  type ResolvedNode,
} from "./gql.js";
import { declarePublicImpl, readPublicSchemas } from "./public.js";
import {
  lensOf,
  programOf,
  readRegistrationVersions,
  readWithdrawnRegistrations,
  type ResolverSpecs,
  type ClaimTemplates,
  type Registration,
  type RegistrationVersion,
  type WithdrawnRegistration,
  type LensName,
} from "./registration.js";
import { newResolverMemo, type ResolverMemo } from "./resolvers.js";
import {
  openQuarantineImpl,
  type QuarantineOptions,
  type QuarantinePool,
} from "./quarantine-pool.js";
import {
  prepareRouteImpl,
  publishRendererImpl,
  readRenderers,
  serveBytesImpl,
  serveRouteImpl,
  writeRouteImpl,
  type RendererBinding,
} from "./renderers.js";
import {
  claimEntityImpl,
  clearEntityImpl,
  linkEntityImpl,
  mutateEntityImpl,
  removeEntityImpl,
  severEntityImpl,
} from "./mutate.js";
import {
  gatherImpl,
  resolvedNodeImpl,
  resolvePinnedImpl,
  subscribeViaImpl,
  watchEntityImpl,
} from "./reads.js";

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
  // What this store OFFERS to federation peers: a term selecting the surviving deltas a puller
  // may see. Default: everything. Trust is the peer's read lens, not this gateway's to decide;
  // the offered lens is only what this store is willing to publish.
  readonly offeredLens?: Term;
  // How many UNREGISTERED entities the public door may hold live (lazy materializations first
  // created by tokenless subscriptions). A separate, smaller budget than MAX_LAZY_MATS, so a
  // stranger can exhaust the stranger's allowance and never the authenticated surface's.
  readonly maxPublicWatches?: number;
  // Provisioned renderer-pen SEEDS (SPEC §23.3), keyed by the pen identity a renderer binding names. This
  // is CUSTODY: a pen's seed lives in config (the store's home), never on the ground — a write-enabled
  // renderer signs its form-submits AS this seed's author. Provisioning the seed is NOT authorization; the
  // pen still needs an operator GRANT of write standing (§6's two keys), and revocation strikes that grant.
  // A store that compromises this config can sign as the pen — the same trust as the operator seed here.
  readonly pens?: Readonly<Record<string, string>>;
  // The in-flight cap on ANONYMOUS renders (SPEC §23.9, ticket T18) — the same discipline as
  // maxPublicStreams, on a strictly more expensive resource: every render spawns a worker thread
  // with a ~160MB memory ceiling for up to its 500ms timeout. Default 16: bounds the anonymous
  // door's worst case at a few transient GB while serving heavy legitimate load; raising it is a
  // deploy decision, not a default. Public-door-scoped, following the SSE precedent — the threat
  // is the anonymous fan; the token door is the operator's own. Over the cap the door refuses a
  // clean 503 that leaks nothing, never queues unboundedly.
  readonly maxPublicRenders?: number;
}

export interface FederationReport {
  readonly offered: number;
  readonly accepted: number;
  readonly rejected: number; // failed verification or admission
}

export interface RequestContext {
  // The acting identity for this request: mutations are signed as this seed's author and
  // authorized as them. Absent, the operator acts.
  readonly actor?: string;
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

// The typed refusal for a tokenless request where no public surface stands — the transport
// matches on the CLASS (not a message) to keep its anonymous refusals uniform, even when a
// revocation lands between its check and the execution.
export class NothingPublic extends Error {
  constructor() {
    super(
      "nothing here is public: no surviving operator declaration at loam:public opens a schema",
    );
  }
}

// The gateway's own alphabet: NUL separates the segments of internal materialization names and
// comparison keys, and register() refuses it in schema names, so nothing user-supplied collides.
/** @internal - T19 seam (lifecycle.ts) */
export const NUL = "\u0000";

// What the gateway holds bound: a registration plus where it came from. Manual registrations
// (register()) live only in this process; store-derived ones are re-generated from deltas on
// every replay — so a store one can evolve or retire underneath us, and a manual one cannot.
/** @internal - T19 seam (lifecycle.ts) */
export interface Bound extends Registration {
  readonly origin: "manual" | "store";
}

// ── The internals seam (ticket T19) ─────────────────────────────────────────────────────────────
// The Gateway's behaviors are decomposed into concern modules (erase.ts, quarantine-pool.ts,
// adopt.ts, …): each public method stays on the class with its exact signature as a THIN DELEGATE,
// and its body lives in the module that owns the concern's vocabulary. A module function cannot use
// `private` fields from outside the class body, so the members those bodies reach are marked
// `/** @internal — T19 seam */` below: public to the compiler, internal by contract — not API, not
// for callers, pinned by no rail (test/cli/pack.test.ts pins what the PACKAGE exports; these ride
// no export). The seam is deliberately explicit: what a concern module touches is greppable as
// `gw.<member>` in its module, and a module needing a member NOT yet marked is a real finding about
// coupling — widen the seam loudly, here, or question the boundary.
export class Gateway {
  /** @internal — T19 seam (renderers.ts) */
  registered: Bound[] = [];
  /** @internal — T19 seam (renderers.ts: the §23.9 anonymous-render cap's in-flight count) */
  publicRendersInFlight = 0;
  // The resolver memo (SPEC §22.5): (resolver-content-address, bucket-delta-set) → value. Keyed on the
  // surviving bucket, so it invalidates by construction when the ground moves — an erased fact drops
  // from the bucket and its old value can never be served again. A pure cache; safe to clear anytime.
  /** @internal — T19 seam (reads.ts) */
  readonly resolverMemo: ResolverMemo = newResolverMemo();
  /** @internal — T19 seam (reads.ts) */
  registry = SchemaRegistry.build([]);
  /** @internal — T19 seam (lifecycle.ts) */
  gql: GraphQLSchema | undefined;
  // Materialization names are generation-qualified (see matName): the reactor has no
  // deregister, so an evolved schema binds a FRESH materialization under a bumped generation
  // and the superseded one is simply left behind (it costs memory and per-ingest CPU for the
  // process lifetime — registration is administrative and rare; a reopen starts clean).
  /** @internal — T19 seam (lifecycle.ts) */
  generation = 0;
  // The write-through queue: raw-stream deltas append to the backend in arrival order. The
  // chain itself always resolves (later writes are still attempted); the FIRST failure latches
  // in `writeFailure`, and from then on the gateway is degraded: append refuses new work
  // before ingesting it, and flush/close surface the failure. A gateway that cannot persist
  // must not quietly widen the gap between the live view and the ground.
  private writes: Promise<void> = Promise.resolve();
  /** @internal — T19 seam (ingest.ts: both doors refuse when the gateway can no longer persist) */
  writeFailure: Error | undefined;
  // Live subscriptions: one reactor subscription per materialization name, fanned out to any
  // number of sinks (the reactor has no unsubscribe; the fan-out set is ours, so leaving a
  // subscription only empties our set). Lazily-registered materializations — for entities not
  // in any registered root list — are cached and reused for the gateway's lifetime.
  /** @internal — T19 seam (reads.ts) */
  readonly sinks = new Map<string, Set<(c: MaterializationChange) => void>>();
  /** @internal — T19 seam (lifecycle.ts) */
  readonly lazyMats = new Set<string>();
  // Lazy materializations FIRST created through the public door — a stranger's subscriptions
  // draw on this smaller budget, so exhausting it degrades only the stranger's own door,
  // never the authenticated surface. Cleared wherever lazyMats is.
  /** @internal - T19 seam (lifecycle.ts) */
  readonly publicLazyMats = new Set<string>();
  /** @internal — T19 seam (reads.ts) */
  readonly channels = new Set<Channel<PatchNode>>();
  // Ids append() has already persisted this tick: the raw-stream subscriber skips them, so a
  // direct append is written exactly once (the raw stream still catches every OTHER emitter —
  // a future DerivationHost's emissions ride it into the ground).
  /** @internal — T19 seam (ingest.ts) */
  readonly justPersisted = new Set<string>();
  private lastMutationTs = 0;
  /** @internal — T19 seam (erase.ts, adopt.ts) */
  readonly operatorAuthor: string | undefined;
  // When a runner animates the gateway, ingest routes through its DerivationHost (ingest + drain
  // derivations); otherwise straight to the reactor. Passive vs animate is exactly this hook.
  /** @internal — T19 seam (ingest.ts: both doors write through it; animate/reseat re-point it) */
  ingestVia: (d: Delta) => IngestResult = (d) => this.reactor.ingest(d);

  // Mutable behind a getter: erase() re-seats the gateway on a fresh reactor replayed from the
  // post-purge backend (the substrate is grow-only; forgetting in-process is a rebuild).
  private _reactor: Reactor;
  get reactor(): Reactor {
    return this._reactor;
  }

  private constructor(
    /** @internal — T19 seam (erase.ts) */
    readonly backend: StoreBackend,
    reactor: Reactor,
    /** @internal — T19 seam (erase.ts, quarantine-pool.ts, adopt.ts) */
    readonly options: GatewayOptions,
  ) {
    this._reactor = reactor;
    this.operatorAuthor = options.seed === undefined ? undefined : authorForSeed(options.seed);
    // Fail fast on a mis-shaped offered lens: a term that does not select a delta set would only
    // blow up when a peer first pulls, in production. Trial-eval it now (empty store → empty
    // dset; the SORT is what we're checking, and that is content-independent).
    if (options.offeredLens !== undefined) {
      const trial = evalTerm(options.offeredLens, reactor.snapshot());
      if (trial.sort !== "dset") {
        throw new Error("offeredLens must select a delta set (a mask/select term, not a group)");
      }
    }
    this.attachPersistence(reactor);
  }

  // Every accepted delta — appends AND a runner's derived emissions — is written through here.
  // Derived emissions do not pass authorize(): a governed store runs only the operator's
  // blessed binding definitions (readBindingDefinitions gates on the operator), so a firing
  // binding is the operator's own delegated authority. Confining UNTRUSTED (federated)
  // function bodies is a runner-runtime concern SPEC §6 reserves for later. (Called once per
  // reactor: at construction, and again by reseat() after an erase.)
  private attachPersistence(reactor: Reactor): void {
    reactor.subscribeRaw((d) => {
      // Any accepted delta may move the open set (a declaration, a negation) — drop the
      // cached read; the next tokenless request recomputes. Once per WRITE, not per read.
      this.publicOpen = undefined;
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
  //
  // Boot DEGRADES, it does not abort (SPEC §25): a row the driver could not admit is quarantined
  // by the read, so replay only ever sees admissible deltas, and a store missing some rows is a
  // legal, younger store (union tolerates absence). The ONE loud exception is the constitutional
  // core — the operator marker at `loam:store`/`loam.operator` that says who governs this store.
  // If a governed store's own read quarantined that marker, the store cannot know its own
  // constitution, and that is a failure the operator must see, not one to boot past.
  static async open(backend: StoreBackend, options: GatewayOptions = {}): Promise<Gateway> {
    const reactor = new Reactor();
    for (const d of await backend.deltasSince(new Set())) {
      const result = reactor.ingest(d);
      if (result.status === "rejected") {
        throw new Error(`replay: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    if (options.seed !== undefined && isRepairable(backend)) {
      // The marker is a deterministic, content-addressed delta (genesis.ts), so its id is known
      // from the operator alone. Quarantined (present but unreadable) is the loud case; simply
      // ABSENT is fine — a fresh store has not been booted yet, and boot() will plant it.
      const markerId = computeId(operatorMarkerClaims(authorForSeed(options.seed)));
      const quarantined = await backend.quarantine();
      if (quarantined.some((row) => row.key === markerId || row.key.endsWith(markerId))) {
        throw new Error(
          `constitutional core unreadable: the operator marker at ${STORE_ENTITY} was set aside ` +
            `by boot — the store cannot know who governs it. Resolve it with \`loam repair\` ` +
            `(re-admit if transient, else this store's genesis must be replanted).`,
        );
      }
    }
    const gateway = new Gateway(backend, reactor, options);
    gateway.replayRegistrations();
    await gateway.preloadResolvers();
    return gateway;
  }

  // Load every resolver's ESM (SPEC §22) into the content-addressed cache — the live lenses AND every
  // answerable version's, so both the warm path and a pinned version-door read find their functions
  // synchronously. Async (a `data:` import); idempotent (the cache dedups by content address). Called
  // after every (re)bind and every publish, so a newly-arrived resolver is runnable by the next read.
  /** @internal — T19 seam (quarantine-pool.ts) */
  async preloadResolvers(): Promise<void> {
    return preloadResolversImpl(this);
  }

  // Boot a fresh (or existing) store from a genesis delta-set: open governed by the genesis
  // operator, land the bundle (idempotent — content-addressed deltas dedup), and register what
  // the genesis declares. The store is born answering and enforcing. Options beyond the seed
  // (an offeredLens, say) pass through to open().
  static async boot(
    backend: StoreBackend,
    genesis: Genesis,
    options: Omit<GatewayOptions, "seed"> = {},
  ): Promise<Gateway> {
    const gateway = await Gateway.open(backend, { ...options, seed: genesis.operatorSeed });
    if (genesis.deltas.length > 0) await gateway.append(genesis.deltas);
    gateway.replayRegistrations();
    await gateway.preloadResolvers();
    return gateway;
  }

  // The seams gql.ts resolves through — one object, shared by every (re)build of the surface.
  // The door rides the watch hook: lazy materializations first created through the public
  // surface draw on their own, smaller budget (see matFor). Stays on the class: it is pure
  // `this`-plumbing, the wiring loom between the class's delegates and the gql generator.
  /** @internal — T19 seam (lifecycle.ts: every surface (re)build threads the hooks through) */
  gqlHooks(door: "full" | "public" = "full"): GqlHooks {
    return {
      resolve: (name, entity, asOf) => this.resolvedNode(name, entity, asOf),
      mutate: (name, entity, props, actorSeed) => this.mutateEntity(name, entity, props, actorSeed),
      clear: (name, entity, fields, actorSeed) => this.clearEntity(name, entity, fields, actorSeed),
      remove: (name, entity, field, values, actorSeed) =>
        this.removeEntity(name, entity, field, values, actorSeed),
      link: (name, entity, field, target, context, actorSeed) =>
        this.linkEntity(name, entity, field, target, context, actorSeed),
      sever: (name, entity, field, targets, actorSeed) =>
        this.severEntity(name, entity, field, targets, actorSeed),
      watch: (name, entity) => this.watchEntity(name, entity, door),
      claim: (pointers, actorSeed) => this.claimEntity(pointers, actorSeed),
    };
  }

  // The door-neutral accessor (SPEC §17): what any surface generator needs — the registered
  // set and the hooks — through the same discipline GraphQL gets. "public" narrows the set to
  // the operator's declared-public lenses (and a generator given it must derive a READ door;
  // narrowing is a generator's right, widening never is). Returns undefined for a public door
  // with nothing public — the transport keeps its refusals uniform.
  surface(
    door: "full" | "public" = "full",
  ): { registered: readonly Registered[]; hooks: GqlHooks } | undefined {
    if (door === "public") {
      this.publicOpen ??= readPublicSchemas(this.reactor, this.operatorAuthor);
      const defs = this.registered.filter((r) => this.publicOpen!.has(lensOf(r)));
      if (defs.length === 0) return undefined;
      return { registered: defs, hooks: this.gqlHooks("public") };
    }
    return { registered: this.registered, hooks: this.gqlHooks() };
  }

  // The two shapes a `loam.public` declaration can take (SPEC §23.8): a BARE name means "the latest
  // version, served anonymously" (unchanged); a `Name@<deltaId>` pin means "exactly this version, served
  // anonymously — because the operator declared it." A declaration is publication, not a probe, so the
  // anonymous door may reveal exactly what the operator chose to name, and nothing else stays 404.
  isPublicLatest(name: string): boolean {
    this.publicOpen ??= readPublicSchemas(this.reactor, this.operatorAuthor);
    return this.publicOpen.has(name);
  }
  isPublicPin(name: string, deltaId: string): boolean {
    this.publicOpen ??= readPublicSchemas(this.reactor, this.operatorAuthor);
    return this.publicOpen.has(`${name}@${deltaId}`);
  }

  // Every answerable version of every registration (SPEC §17): the append-only publication
  // history, read live from the ground under this store's law.
  registrationVersions(): RegistrationVersion[] {
    return readRegistrationVersions(this.reactor, this.operatorAuthor);
  }

  // The versions the operator lawfully struck (SPEC §17): served no longer, remembered
  // forever — the 410 door's only witness.
  withdrawnRegistrations(): WithdrawnRegistration[] {
    return readWithdrawnRegistrations(this.reactor, this.operatorAuthor);
  }

  // Pinned resolution (SPEC §17 versioning × §26 as-of): the body lives in reads.ts.
  resolvePinned(reg: Registered, entity: string, asOf?: number): ResolvedNode {
    return resolvePinnedImpl(this, reg, entity, asOf);
  }

  // Re-derive the store's slice of the surface and follow it. The desired set is the manual
  // registrations (this process's own) plus every store registration whose schema GENERATES
  // from surviving definitions — so an evolved definition reshapes the surface, and a negated
  // one retires its type. Store registrations install in fixpoint rounds: a schema that refs
  // another must validate after it, and timestamp order is not enough (ties, same
  // millisecond). One that never resolves — or whose body cannot materialize — is left
  // unbound rather than crashing the boot. A purely-additive change binds incrementally under
  // the current generation; only a change or a retirement pays for a rebind.
  /** @internal — T19 seam (quarantine-pool.ts) */
  replayRegistrations(): void {
    return replayRegistrationsImpl(this);
  }

  // Persist a batch, THEN serve it. The batch is validated whole (one bad delta refuses the
  // lot); it lands in the backend before the reactor sees it, so nothing a query or a
  // subscriber can observe is ever less durable than the ground — a failed write means nothing
  // happened, and the caller may simply retry. Only verified signatures pass: the substrate
  // accepts unsigned deltas, the gateway does not (authority is always attested here). And each
  // delta's author must hold STANDING — the operator, or a surviving operator-rooted write
  // grant on this store; what the delta points at is not authorization's business (entities
  // are unowned — trust is the reader's). Authorization reads the state as it stands before
  // the batch — a batch cannot bootstrap its own permissions.
  async append(deltas: Iterable<Delta>): Promise<AppendReceipt> {
    return appendImpl(this, deltas);
  }

  // Meta-resolve schema-defining deltas via HYPER_SCHEMA_SCHEMA into a HyperSchema. The definition is
  // proven against a TRIAL set first — the store is append-only, so nothing lands until the
  // deltas are known to define what the caller says they define. The trial reads the LAWFUL
  // slice (the operator's, in a governed store): a federated foreign definition at the same
  // entity — newer, or malformed — must not shadow what the operator is proving.
  async loadHyperSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    return loadHyperSchemaImpl(this, deltas, entity);
  }

  // Register a (HyperSchema, Schema) pair over the given roots: a live materialization per
  // root, and a GraphQL surface rebuilt to include it. Everything that can refuse — duplicate
  // names, unresolved refs, GraphQL field collisions — refuses BEFORE any state changes, so a
  // failed registration leaves the gateway exactly as it was. Register dependencies first:
  // earlier schemas are visible to later refs.
  register(
    hyperschema: HyperSchema,
    schema: Schema,
    roots: readonly string[],
    mutations?: ClaimTemplates,
    writable?: readonly string[],
  ): void {
    return registerImpl(this, hyperschema, schema, roots, mutations, writable);
  }

  // Publish a schema and its registration as data, then bind them, so the surface survives
  // reopen with no code. Two deltas: the DEFINITION (schema-schema claims at the schema
  // entity — proven by loadHyperSchema before anything lands) and the REFERENCE that registers it.
  // Republishing at the same entity is evolution: the running surface rebinds to the latest
  // surviving definition. Any granted author could APPEND such deltas (writes are open), but
  // only the operator's ever bind — so this method refuses non-operators up front rather than
  // persist deltas that would look registered while shaping nothing.
  async publishRegistration(
    hyperschema: HyperSchema,
    schema: Schema,
    roots: readonly string[],
    context?: RequestContext,
    entity?: string,
    mutations?: ClaimTemplates,
    writable?: readonly string[],
    resolvers?: ResolverSpecs,
  ): Promise<PublishOutcome> {
    return publishRegistrationImpl(
      this,
      hyperschema,
      schema,
      roots,
      context,
      entity,
      mutations,
      writable,
      resolvers,
    );
  }

  // --- renderers (SPEC §23) ----------------------------------------------------------------------

  // Every surviving renderer binding, latest per route, read live under this store's law.
  renderers(): RendererBinding[] {
    return readRenderers(this.reactor, this.operatorAuthor);
  }

  // Declare lenses public (SPEC §12/§17/§23.8): the body — bare names pass, `Name@vN` freezes to the
  // version's content address — lives beside the loam.public vocabulary in public.ts.
  async declarePublic(entries: readonly string[], context?: RequestContext): Promise<void> {
    return declarePublicImpl(this, entries, context);
  }

  // Publish a renderer as data (SPEC §23): the body lives beside the binding vocabulary in renderers.ts.
  async publishRenderer(input: unknown, context?: RequestContext): Promise<void> {
    return publishRendererImpl(this, input, context);
  }

  // Ensure a route's bundle is loaded (SPEC §23): the body lives in renderers.ts.
  async prepareRoute(route: string): Promise<void> {
    return prepareRouteImpl(this, route);
  }

  // Serve a route (SPEC §23): the body — and the door-discipline doctrine — lives in renderers.ts.
  async serveRoute(
    route: string,
    entity: string,
    door: "full" | "public",
  ): Promise<{ status: number; contentType: string; body: string }> {
    return serveRouteImpl(this, route, entity, door);
  }

  // Write through a rendered route (SPEC §23.3): the body lives in renderers.ts.
  async writeRoute(
    route: string,
    entity: string,
    fields: Record<string, Primitive>,
    door: "full" | "public",
  ): Promise<{ status: number; contentType: string; body: string }> {
    return writeRouteImpl(this, route, entity, fields, door);
  }

  // The byte-door (SPEC §23.7): the body lives in renderers.ts.
  serveBytes(
    ref: string,
    fromLens: LensName,
    fromEntity: string,
    door: "full" | "public",
  ): { status: number; contentType: string; body: Uint8Array } {
    return serveBytesImpl(this, ref, fromLens, fromEntity, door);
  }

  // Animate the gateway: route ingest through a runner's DerivationHost so bindings fire.
  animate(host: { ingest: (d: Delta) => IngestResult }): void {
    this.ingestVia = (d) => host.ingest(d);
  }

  // --- erasure (SPEC §11) ------------------------------------------------------------------------

  // Erase one delta (SPEC §11): the body lives beside the tombstone vocabulary in erase.ts.
  async erase(
    id: string,
    opts: { reason?: string } = {},
  ): Promise<{ erased: string; citations: string[] }> {
    return eraseImpl(this, id, opts);
  }

  // The quarantine pools attached to this store (SPEC §24.8): the operator's own one-way replicas that an
  // erasure here must fan out to. Live Gateway handles registered by `openQuarantine`, dropped on `drop`.
  /** @internal — T19 seam (erase.ts, quarantine-pool.ts) */
  readonly quarantinePools = new Set<Gateway>();

  // Open a QUARANTINE POOL over this store (SPEC §24): the body lives in quarantine-pool.ts.
  async openQuarantine(opts: QuarantineOptions = {}): Promise<QuarantinePool> {
    return openQuarantineImpl(this, opts);
  }

  // Promote a delta a quarantine produced into THIS store (SPEC §24.3 — promote-outputs): the body
  // lives beside the loam.adoption vocabulary in adopt.ts.
  async promote(
    source: Gateway,
    deltaId: string,
    opts: { from?: string } = {},
  ): Promise<{ promoted: string }> {
    return promoteImpl(this, source, deltaId, opts);
  }

  // The adoptions this store's operator has made (SPEC §24.3) — the visible trail from a canonical value
  // back to the quarantine that produced it. The read side of promotion, for audit and review (§27).
  // An unoperated store has no operator and therefore no adoptions of its own.
  adoptions(): Adoption[] {
    if (this.operatorAuthor === undefined) return [];
    return readAdoptions(this.reactor, this.operatorAuthor);
  }

  // Honor an erasure DECIDED by the primary operator (SPEC §24.8), called on a pool by the primary's
  // fan-out: the body — and the fan-out's re-derive-its-own-reach doctrine — lives in erase.ts.
  async eraseReplica(tombstone: Delta, id: string, seen: Set<Gateway> = new Set()): Promise<void> {
    return eraseReplicaImpl(this, tombstone, id, seen);
  }

  // A fresh reactor replayed from the backend as it stands NOW — how open() built the first
  // one. Every registered schema rebinds under a new generation (rebind), persistence
  // re-attaches, and any animating host is detached (it watched the old reactor — the caller
  // re-attaches its runner, as the village does after the crash).
  /** @internal — T19 seam (erase.ts) */
  async reseat(): Promise<void> {
    // End live subscriptions first: a parked reader must not keep serving a view built on the
    // pre-erase ground (the removed record could still sit in its last snapshot). They wake
    // with `done` and resubscribe against the fresh reactor — the same reconnect a crash
    // reopen or a schema evolution asks of them. Their sinks watched the old reactor; drop them.
    for (const channel of [...this.channels]) await channel.return();
    this.sinks.clear();
    this.lazyMats.clear();
    this.publicLazyMats.clear();
    this.publicOpen = undefined; // the ground changed out from under the cached read
    // Drop the resolver memo (SPEC §22.5/§11): keying already forbids serving a value over erased
    // bytes, but a re-seat is exactly the moment the ground forgot — clear it so nothing lingers.
    this.resolverMemo.clear();
    const reactor = new Reactor();
    for (const d of await this.backend.deltasSince(new Set())) {
      if (reactor.ingest(d).status === "rejected") {
        throw new Error(`reseat: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    this._reactor = reactor;
    this.ingestVia = (d) => this.reactor.ingest(d);
    this.attachPersistence(reactor);
    if (this.registered.length > 0) rebindImpl(this, this.registered);
  }

  // --- federation ------------------------------------------------------------------------------
  //
  // Federation is union at the substrate, NOT a governed mutation. Capabilities gate who may
  // write via GraphQL; a peer's deltas cross by VERIFICATION alone (content address + a real
  // signature, then an optional admission predicate). Whether a peer's facts shape a local view
  // is a read-time TRUST choice (a policy's `byAuthorRank`), never a write denial here — "no
  // authority deciding whose truth survives" (SPEC §8). So `federate` bypasses `authorize`.
  //
  // Foreign law stays inert by the SAME operator-rooting the local store uses: a federated
  // grant / membership / registration / binding-definition authored by anyone but this store's
  // operator binds nothing (grantHeld / readRegistrations / readBindingDefinitions all filter on
  // the operator). This rests on one invariant the federation must keep: **distinct operator
  // seeds across instances.** Two stores sharing an operator seed trust each other's
  // constitution completely — a peer could then federate effective grants and code. Give every
  // instance its own operator identity.

  // The admission function the store's own TRUST POLICY dictates, resolved fresh from the
  // live deltas at loam:trust each call (trust is data — see trust.ts): open admits every
  // verified delta, roster admits the operator and the named authors, closed admits nothing.
  // `federate` and `pullFrom` use this when no explicit admit is given; an explicit predicate
  // always wins.
  admitFor(): (d: Delta) => boolean {
    return admitForImpl(this);
  }

  // The surviving deltas this store offers a peer — everything, or what the offered lens selects.
  offeredDeltas(): Delta[] {
    return offeredDeltasImpl(this);
  }

  // Membership is a query, first-class (SPEC §27.6): evaluate a membership Term over this
  // store's ground, once. The body lives in ingest.ts — select is offeredDeltas, parameterized.
  select(term: unknown): Delta[] {
    return selectImpl(this, term);
  }

  // The same Term, live: the current members, then a fresh evaluation whenever the membership
  // moves. The body lives in ingest.ts.
  watch(term: unknown): AsyncGenerator<Delta[], void, unknown> {
    return watchImpl(this, term);
  }

  // The same Term, FROZEN (SPEC §27.2): evaluate the membership once and name the result with a
  // content address over its members. `select` is the living reading, `watch` the live one, and
  // this is the third rung of the same ladder — the version you ship, pin, verify, and reproduce.
  // Order-free by construction, so two stores that froze the same members agree without
  // coordinating (container-identity.ts holds the address; the refusal voice stays in select).
  freeze(term: unknown): ModuleVersion {
    // ...plus the negation closure of what it selects (hazard H1, T38). A version exists to be
    // SHIPPED, so a version carrying a claim without the retraction that struck it would hand its
    // consumer a withdrawn claim reading as live. The address is over whatever the members ARE, so
    // two stores freezing the same Term where only one holds a retraction get DIFFERENT addresses —
    // correct, not a wart: they are genuinely different sets, and the address says so.
    return freezeMembers(withNegationClosure(this, selectImpl(this, term)));
  }

  // Admit a batch of peer deltas (SPEC §8): the body lives in ingest.ts.
  async federate(
    deltas: Iterable<Delta>,
    opts: { admit?: (d: Delta) => boolean } = {},
  ): Promise<FederationReport> {
    return federateImpl(this, deltas, opts);
  }

  // The operator's author, so a peer (the runner) can gate on it without holding the seed.
  get operator(): string | undefined {
    return this.operatorAuthor;
  }

  // The reactor materialization currently backing a registered schema — internal names are
  // generation-qualified, so anything that binds to a materialization by name (the runner's
  // BindingSpecs) resolves through here. An unregistered name passes through unchanged: it may
  // name a materialization registered outside the gateway, or an orphan that simply waits.
  // NOTE: the resolution is AS OF NOW — after an evolution, work bound to the superseded
  // generation keeps watching the old shape until it re-attaches.
  materializationFor(name: string): string {
    const hit = this.registered.find((r) => lensOf(r) === name || programOf(r) === name);
    return hit !== undefined ? this.matName(hit.hyperschema.name) : name;
  }

  /** @internal — T19 seam (erase.ts, adopt.ts) */
  nextTimestamp(): number {
    this.lastMutationTs = Math.max(Date.now(), this.lastMutationTs + 1);
    return this.lastMutationTs;
  }

  // --- the read seam ---------------------------------------------------------------------------

  /** @internal — T19 seam (mutate.ts) */
  def(name: string): Bound {
    const def = this.registered.find((r) => lensOf(r) === name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    return def;
  }

  // The materialization watching (schema, entity) — the schema's own when the entity is a
  // registered root, a lazily-created cached one otherwise. Lazy names live in a NUL-separated
  // namespace no schema name can enter (register() refuses NUL), so they can never collide.
  // Generation-qualified (see the class note): an evolved schema binds a fresh materialization
  // under the bumped generation; a superseded one is left behind, and a stream still attached
  // to it keeps watching the old shape until it resubscribes.
  /** @internal — T19 seam (reads.ts) */
  matName(name: string): string {
    return matNameImpl(this, name);
  }

  /** @internal - T19 seam (reads.ts) */
  lazyMatName(name: string, entity: string): string {
    return lazyMatNameImpl(this, name, entity);
  }

  /** @internal - T19 seam (reads.ts: a watch binds to the materialization this names) */
  matFor(name: string, entity: string, door: "full" | "public" = "full"): string {
    return matForImpl(this, name, entity, door);
  }

  // Gather the HView for (schema, entity): the body lives in reads.ts.
  /** @internal — T19 seam (mutate.ts: retraction reads the hview to find the caller's own claims) */
  gather(name: string, entity: string, asOf?: number): HView {
    return gatherImpl(this, name, entity, asOf);
  }

  /** @internal — T19 seam (mutate.ts: every write verb answers with the re-resolved node) */
  resolvedNode(name: string, entity: string, asOf?: number): ResolvedNode {
    return resolvedNodeImpl(this, name, entity, asOf);
  }

  // --- the write seam --------------------------------------------------------------------------

  // One signed property-claim delta per provided property (SPEC §14): the body lives in mutate.ts.
  /** @internal — T19 seam (renderers.ts: writeRoute signs as the pen through the normal §14 mutate) */
  async mutateEntity(
    name: string,
    entity: string,
    props: Record<string, Primitive>,
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    return mutateEntityImpl(this, name, entity, props, actorSeed);
  }

  // Clear whole fields (SPEC §14): the body lives in mutate.ts.
  private clearEntity(
    name: string,
    entity: string,
    fields: readonly string[],
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    return clearEntityImpl(this, name, entity, fields, actorSeed);
  }

  // Remove ONE value (SPEC §14 amendment): the body lives in mutate.ts.
  private removeEntity(
    name: string,
    entity: string,
    field: string,
    values: readonly Primitive[],
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    return removeEntityImpl(this, name, entity, field, values, actorSeed);
  }

  // Link an edge (SPEC §14 edge verbs): the body lives in mutate.ts.
  private async linkEntity(
    name: string,
    entity: string,
    field: string,
    target: string,
    context: string | undefined,
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    return linkEntityImpl(this, name, entity, field, target, context, actorSeed);
  }

  // Sever an edge (SPEC §14 edge verbs): the body lives in mutate.ts.
  private severEntity(
    name: string,
    entity: string,
    field: string,
    targets: readonly string[] | undefined,
    actorSeed?: string,
  ): Promise<ResolvedNode> {
    return severEntityImpl(this, name, entity, field, targets, actorSeed);
  }

  // One signed MULTI-POINTER delta from an explicit pointer list (SPEC §14): the body lives in mutate.ts.
  private async claimEntity(
    pointers: readonly ClaimPointerSpec[],
    actorSeed?: string,
  ): Promise<{ delta: string }> {
    return claimEntityImpl(this, pointers, actorSeed);
  }

  // --- the live seam ---------------------------------------------------------------------------

  // A dynamic view of (schema, entity) — snapshot, then patches: the body (and the
  // captured-shape doctrine) lives in reads.ts.
  private watchEntity(
    name: string,
    entity: string,
    door: "full" | "public" = "full",
  ): AsyncGenerator<PatchNode, void, unknown> {
    return watchEntityImpl(this, name, entity, door);
  }

  // --- the GraphQL surface ---------------------------------------------------------------------

  private schemaOrThrow(): GraphQLSchema {
    if (this.gql === undefined) {
      throw new Error("nothing is registered: the gateway has no queryable surface yet");
    }
    return this.gql;
  }

  // T19 NOTE (a boundary judged, not forced): the public-door READERS — surface, isPublicLatest,
  // isPublicPin, publicSurface, hasPublicSurface — stay on the class deliberately. They are thin
  // veneers over two caches (publicOpen, publicCache) whose INVALIDATION is wired into the write
  // path (attachPersistence drops publicOpen on any accepted delta) and the reseat cycle; moving
  // the veneers across the seam while the cache lifecycle stays here would be indirection, not
  // separation. The DECLARATION side (declarePublic) moved to public.ts, where the vocabulary is.
  //
  // The restricted schema the anonymous door serves (SPEC §12): the query + subscription
  // fields of every REGISTERED schema the operator's surviving `loam:public` declarations
  // open, and no Mutation type at all — a tokenless write is a validation impossibility, not
  // a policed string. Read fresh from the live deltas each call (the open set is data, like
  // trust) and cached by what actually shapes it, so one negation closes the door on the next
  // request without rebuilding on every read.
  private publicCache: { key: string; schema: GraphQLSchema } | undefined;
  // The open set, read once per WRITE rather than once per read: any accepted delta drops it
  // (attachPersistence), so a tokenless request costs O(registered), not O(store) — which
  // also keeps a nothing-public mount's refusal as cheap as an absent mount's (no timing
  // oracle where the status codes are uniform).
  private publicOpen: ReadonlySet<string> | undefined;
  private publicSurface(): GraphQLSchema | undefined {
    this.publicOpen ??= readPublicSchemas(this.reactor, this.operatorAuthor);
    const open = this.publicOpen;
    if (open.size === 0) return undefined;
    const defs = this.registered.filter((r) => open.has(lensOf(r)));
    if (defs.length === 0) return undefined; // declared but not (yet) registered: nothing binds
    const key = defs.map((r) => boundKey(r)).join(NUL);
    if (this.publicCache?.key !== key) {
      this.publicCache = { key, schema: buildGqlSchema(defs, this.gqlHooks("public"), "read") };
    }
    return this.publicCache.schema;
  }

  private publicSurfaceOrThrow(): GraphQLSchema {
    const surface = this.publicSurface();
    if (surface === undefined) throw new NothingPublic();
    return surface;
  }

  // Is there anything to serve a tokenless caller? The transport asks this to keep its
  // refusals uniform — a mount with nothing public must answer exactly like no mount at all.
  hasPublicSurface(): boolean {
    if (this.publicSurface() !== undefined) return true;
    // §23.8: a pinned-public declaration opens the anonymous door for its route (and its byte-door) even
    // when no BARE-name lens is public — publicSurface builds only the bare-latest GraphQL/REST surface.
    this.publicOpen ??= readPublicSchemas(this.reactor, this.operatorAuthor);
    for (const entry of this.publicOpen) if (entry.includes("@")) return true;
    return false;
  }

  // A tokenless query: the restricted surface, and NEVER an acting identity — there is no one
  // to sign as, and nothing to sign with.
  async queryPublic(source: string, variables?: Record<string, unknown>): Promise<QueryResult> {
    const result = await graphql({
      schema: this.publicSurfaceOrThrow(),
      source,
      ...(variables === undefined ? {} : { variableValues: variables }),
    });
    return {
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.errors === undefined ? {} : { errors: result.errors.map((e) => e.message) }),
    };
  }

  // A tokenless subscription over the same restricted surface.
  async subscribePublic(
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    return this.subscribeVia(this.publicSurfaceOrThrow(), source, variables);
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
    return this.subscribeVia(this.schemaOrThrow(), source, variables);
  }

  private async subscribeVia(
    schema: GraphQLSchema,
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    return subscribeViaImpl(schema, source, variables);
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
