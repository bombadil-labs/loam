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
  DeltaSet,
  Reactor,
  SchemaRegistry,
  authorForSeed,
  computeId,
  evalTerm,
  loadHyperSchema,
  makeDelta,
  schemaToJson,
  publishHyperSchemaClaims,
  signClaims,
  termHash,
  verifyDelta,
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
import { authorize } from "./accounts.js";
import { promoteImpl, readAdoptions, type Adoption } from "./adopt.js";
import {
  ERASE_ENTITY,
  eraseDefect,
  eraseImpl,
  eraseReplicaImpl,
  isTombstone,
  readTombstones,
} from "./erase.js";
import { Channel } from "./channel.js";
import { STORE_ENTITY, operatorMarkerClaims, type Genesis } from "./genesis.js";
import {
  buildGqlSchema,
  type ClaimPointerSpec,
  type GqlHooks,
  type PatchNode,
  type Registered,
  type ResolvedNode,
} from "./gql.js";
import { budgetRefusal } from "./budget.js";
import { declarePublicImpl, publicDefect, readPublicSchemas } from "./public.js";
import {
  lawfulSnapshot,
  parseClaimTemplates,
  readRegistrations,
  readRegistrationVersions,
  readWithdrawnRegistrations,
  registrationDeltaClaims,
  schemaEntityFor,
  type ResolverSpecs,
  type ClaimTemplates,
  type Registration,
  type RegistrationVersion,
  type WithdrawnRegistration,
} from "./registration.js";
import { loadResolvers, newResolverMemo, type ResolverMemo } from "./resolvers.js";
import {
  openQuarantineImpl,
  type QuarantineOptions,
  type QuarantinePool,
} from "./quarantine-pool.js";
import {
  loadRenderers,
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
import { readTrustPolicy } from "./trust.js";

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
const NUL = "\u0000";

// What the gateway holds bound: a registration plus where it came from. Manual registrations
// (register()) live only in this process; store-derived ones are re-generated from deltas on
// every replay — so a store one can evolve or retire underneath us, and a manual one cannot.
interface Bound extends Registration {
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
  // The resolver memo (SPEC §22.5): (resolver-content-address, bucket-delta-set) → value. Keyed on the
  // surviving bucket, so it invalidates by construction when the ground moves — an erased fact drops
  // from the bucket and its old value can never be served again. A pure cache; safe to clear anytime.
  /** @internal — T19 seam (reads.ts) */
  readonly resolverMemo: ResolverMemo = newResolverMemo();
  /** @internal — T19 seam (reads.ts) */
  registry = SchemaRegistry.build([]);
  private gql: GraphQLSchema | undefined;
  // Materialization names are generation-qualified (see matName): the reactor has no
  // deregister, so an evolved schema binds a FRESH materialization under a bumped generation
  // and the superseded one is simply left behind (it costs memory and per-ingest CPU for the
  // process lifetime — registration is administrative and rare; a reopen starts clean).
  private generation = 0;
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
  /** @internal — T19 seam (reads.ts) */
  readonly sinks = new Map<string, Set<(c: MaterializationChange) => void>>();
  private readonly lazyMats = new Set<string>();
  /** @internal — T19 seam (reads.ts) */
  readonly channels = new Set<Channel<PatchNode>>();
  // Ids append() has already persisted this tick: the raw-stream subscriber skips them, so a
  // direct append is written exactly once (the raw stream still catches every OTHER emitter —
  // a future DerivationHost's emissions ride it into the ground).
  private readonly justPersisted = new Set<string>();
  private lastMutationTs = 0;
  /** @internal — T19 seam (erase.ts, adopt.ts) */
  readonly operatorAuthor: string | undefined;
  // When a runner animates the gateway, ingest routes through its DerivationHost (ingest + drain
  // derivations); otherwise straight to the reactor. Passive vs animate is exactly this hook.
  private ingestVia: (d: Delta) => IngestResult = (d) => this.reactor.ingest(d);

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
    const specs: Array<ResolverSpecs | undefined> = [
      ...this.registered.map((r) => r.resolvers),
      ...this.registrationVersions().map((v) => v.resolvers),
    ];
    await loadResolvers(specs);
    // Renderer bundles ride the same content-addressed ESM loader (SPEC §23/§22.3), pre-loaded here so
    // the synchronous serve path always finds its function.
    await loadRenderers(readRenderers(this.reactor, this.operatorAuthor).map((r) => r.bundle));
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
  // surface draw on their own, smaller budget (see matFor).
  private gqlHooks(door: "full" | "public" = "full"): GqlHooks {
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
      const defs = this.registered.filter((r) => this.publicOpen!.has(r.hyperschema.name));
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

  // Every claim template must be VISIBLE to its own schema: substitute sentinels for the arg
  // holes, build the specimen delta, and require that at least one entity the template touches
  // can see it through this schema's gather. A mutation whose writes its own reads would never
  // show is refused before it can mislead anyone. Fidelity limits, stated plainly: the
  // specimen is authored as the OPERATOR (so governed-store author lenses judge it honestly)
  // with sentinel values — a body that predicates on facets the template cannot carry (exotic
  // value ranges, exact timestamps) is judged best-effort.
  private static assertTemplatesVisible(
    schema: HyperSchema,
    templates: ClaimTemplates | undefined,
    registry: SchemaRegistry,
    specimenAuthor: string,
  ): void {
    for (const [name, template] of Object.entries(templates ?? {})) {
      const pointers = template.pointers.map((p) => {
        if (p.at !== undefined) {
          return {
            role: p.role,
            target: {
              kind: "entity" as const,
              entity: { id: `loam:specimen:${p.at.arg}`, context: p.context ?? p.role },
            },
          };
        }
        const value =
          typeof p.value === "object" && p.value !== null
            ? "loam:specimen"
            : (p.value as Primitive);
        return { role: p.role, target: { kind: "primitive" as const, value } };
      });
      const specimen = makeDelta({ timestamp: 1, author: specimenAuthor, pointers });
      const ground = DeltaSet.from([specimen]);
      const sentinels = [
        ...new Set(
          pointers.flatMap((p) => (p.target.kind === "entity" ? [p.target.entity.id] : [])),
        ),
      ];
      const seen = sentinels.some((root) => {
        const result = evalTerm(schema.body, ground, root, registry);
        if (result.sort !== "hview") return false;
        for (const entries of result.hview.props.values()) {
          if (entries.some((e) => e.delta.id === specimen.id)) return true;
        }
        return false;
      });
      if (!seen) {
        throw new Error(
          `schema ${schema.name}: template "${name}" emits a delta this schema cannot see ` +
            `from any entity it touches — a write its own reads would never show`,
        );
      }
    }
  }

  // A body must MATERIALIZE (yield an HView): SchemaRegistry and buildGqlSchema never evaluate
  // it, and reactor.register throws for anything else — after state has begun to change. The
  // sort of a term is content-independent (the offeredLens trick), so trial-eval it empty and
  // refuse a dset-sort body before it can persist, half-bind, or corrupt a boot.
  private static assertMaterializable(schema: HyperSchema, registry: SchemaRegistry): void {
    const trial = evalTerm(schema.body, DeltaSet.from([]), "loam:trial", registry);
    if (trial.sort !== "hview") {
      throw new Error(
        `schema ${schema.name}: its body must yield a hyperview (a group over the gathered ` +
          `deltas), not a ${trial.sort}`,
      );
    }
  }

  // Everything that shapes the surface, as one comparable key.
  private static boundKey(r: Bound): string {
    return [
      r.hyperschema.name,
      termHash(r.hyperschema.body),
      JSON.stringify(schemaToJson(r.schema)),
      JSON.stringify(r.roots),
      JSON.stringify(r.mutations ?? null),
      JSON.stringify(r.writable ?? null),
      JSON.stringify(r.resolvers ?? null),
      r.entity ?? "",
      r.origin,
    ].join(NUL);
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
    const manual = this.registered.filter((r) => r.origin === "manual");
    const accepted: Bound[] = [...manual];
    let pending: Bound[] = readRegistrations(this.reactor, this.operatorAuthor).map((r) => ({
      ...r,
      origin: "store" as const,
    }));
    for (;;) {
      const stillPending: Bound[] = [];
      let progressed = false;
      for (const reg of pending) {
        const attempt = (candidate: Bound): boolean => {
          try {
            const trial = [...accepted, candidate];
            const registry = SchemaRegistry.build(trial.map((r) => r.hyperschema)); // dups, refs, cycles
            Gateway.assertMaterializable(candidate.hyperschema, registry); // reactor.register would throw
            Gateway.assertTemplatesVisible(
              candidate.hyperschema,
              candidate.mutations,
              registry,
              this.operatorAuthor ?? "loam:specimen",
            );
            buildGqlSchema(trial, this.gqlHooks()); // GraphQL name collisions
            accepted.push(candidate);
            return true;
          } catch {
            return false;
          }
        };
        // A stored registration whose TEMPLATES are the only problem binds without them —
        // the schema still serves; the surface just lacks the mutation.
        const templateless: Bound = {
          hyperschema: reg.hyperschema,
          schema: reg.schema,
          roots: reg.roots,
          origin: reg.origin,
          ...(reg.entity === undefined ? {} : { entity: reg.entity }),
          ...(reg.resolvers === undefined ? {} : { resolvers: reg.resolvers }),
        };
        if (attempt(reg) || (reg.mutations !== undefined && attempt(templateless))) {
          progressed = true;
        } else {
          stillPending.push(reg); // its refs are not registered yet — try again next round
        }
      }
      if (!progressed || stillPending.length === 0) break;
      pending = stillPending;
    }

    const currentKeys = new Set(this.registered.map((r) => Gateway.boundKey(r)));
    const acceptedKeys = new Set(accepted.map((r) => Gateway.boundKey(r)));
    if (
      acceptedKeys.size === currentKeys.size &&
      [...currentKeys].every((k) => acceptedKeys.has(k))
    ) {
      return; // nothing moved
    }
    if ([...currentKeys].every((k) => acceptedKeys.has(k))) {
      // Purely additive: bind just the newcomers under the current generation — no rebind, no
      // abandoned materializations. (The same registry-visibility semantics as register().)
      const additions = accepted.filter((r) => !currentKeys.has(Gateway.boundKey(r)));
      const registry = SchemaRegistry.build(accepted.map((r) => r.hyperschema));
      const gql = buildGqlSchema(accepted, this.gqlHooks());
      for (const reg of additions) {
        this.reactor.register(
          this.matName(reg.hyperschema.name),
          reg.hyperschema.body,
          reg.roots,
          registry,
        );
      }
      this.registered = accepted;
      this.registry = registry;
      this.gql = gql;
      return;
    }
    this.rebind(accepted);
  }

  // Bind a whole desired set at once, under a fresh generation of materializations. The set was
  // validated by the caller (the fixpoint), so nothing here can half-apply. Superseded
  // materializations stay behind (the reactor has no deregister); superseded lazy watches stop
  // counting against the cap.
  private rebind(next: Bound[]): void {
    const registry = SchemaRegistry.build(next.map((r) => r.hyperschema));
    const gql = buildGqlSchema(next, this.gqlHooks());
    this.generation += 1;
    for (const reg of next) {
      this.reactor.register(
        this.matName(reg.hyperschema.name),
        reg.hyperschema.body,
        reg.roots,
        registry,
      );
    }
    this.lazyMats.clear(); // generation-stale by construction — new watches re-create their own
    this.publicLazyMats.clear();
    this.registered = next;
    this.registry = registry;
    this.gql = gql;
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
    if (this.writeFailure !== undefined) {
      throw new Error(`this gateway can no longer persist: ${this.writeFailure.message}`);
    }
    const batch = [...deltas];
    // The door remembers the hole (SPEC §11): an erased id is refused re-entry — through
    // append as through federation — until its tombstone is lawfully struck (forgiveness).
    const dead = readTombstones(this.reactor, this.operatorAuthor);
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
    // Door resource budgets (SPEC §25): a granted author the operator has metered may not append
    // past their volume quota — deployment config, re-resolved live from `loam:budget`, layered
    // above §12's stranger floor. Absent a budget the author is unmetered (today's behavior); the
    // operator sets budgets and is never metered. Checked once for the whole batch, on the state
    // as it stands before it — the same discipline authorize() reads under.
    if (this.operatorAuthor !== undefined) {
      const overBudget = budgetRefusal(this.reactor, this.operatorAuthor, batch);
      if (overBudget !== undefined) {
        throw new Error(`append rejected: ${overBudget}`);
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

  // Meta-resolve schema-defining deltas via HYPER_SCHEMA_SCHEMA into a HyperSchema. The definition is
  // proven against a TRIAL set first — the store is append-only, so nothing lands until the
  // deltas are known to define what the caller says they define. The trial reads the LAWFUL
  // slice (the operator's, in a governed store): a federated foreign definition at the same
  // entity — newer, or malformed — must not shadow what the operator is proving.
  async loadHyperSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    const batch = [...deltas];
    const trial = lawfulSnapshot(this.reactor, this.operatorAuthor);
    for (const d of batch) trial.add(d);
    const schema = loadHyperSchema(trial, entity); // throws here → nothing was persisted
    await this.append(batch);
    return schema;
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
    if (hyperschema.name.includes(NUL)) {
      throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
    }
    // Normalize through the parser so every invariant the wire form promises (usable names,
    // contexts present, each on entities only) holds for hand-built templates too.
    const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
    const next: Bound[] = [
      ...this.registered,
      {
        hyperschema,
        schema,
        roots,
        origin: "manual",
        ...(templates ? { mutations: templates } : {}),
        ...(writable ? { writable } : {}),
      },
    ];
    const registry = SchemaRegistry.build(next.map((r) => r.hyperschema)); // refuses dups + bad refs
    Gateway.assertMaterializable(hyperschema, registry); // refuses a body that yields no hyperview
    Gateway.assertTemplatesVisible(
      hyperschema,
      templates,
      registry,
      this.operatorAuthor ?? "loam:specimen",
    ); // refuses invisible writes
    const gql = buildGqlSchema(next, this.gqlHooks()); // refuses collisions
    // Incremental: only the NEW materialization registers, under the current generation.
    this.reactor.register(this.matName(hyperschema.name), hyperschema.body, roots, registry);
    this.registered = next;
    this.registry = registry;
    this.gql = gql;
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
  ): Promise<void> {
    const seed = context?.actor ?? this.options.seed;
    if (seed === undefined) {
      throw new Error("this gateway holds no signing seed and cannot publish a registration");
    }
    // A governed store binds only the OPERATOR's law (readRegistrations filters on it), so
    // refuse a non-operator publish here rather than persist deltas that would look
    // registered but silently never shape the surface.
    if (this.operatorAuthor !== undefined && authorForSeed(seed) !== this.operatorAuthor) {
      throw new Error("append rejected: only the operator may publish a registration");
    }
    if (hyperschema.name.includes(NUL)) {
      throw new Error(
        "a hyperschema name may not contain NUL — that alphabet is the gateway's own",
      );
    }
    // Prove the WHOLE registration before anything persists — the refs must resolve against
    // what is bound (minus the same name, which this publish may be evolving), the body must
    // materialize, the templates must be well-formed AND visible AND buildable into a GraphQL
    // surface. Loud here, quiet on replay: a bad delta on append-only ground cannot be
    // taken back, and "registered" must never mean "silently missing its mutations".
    const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
    // A resolver may only name a field the schema HAS (SPEC §22) — a resolver over a phantom field
    // would advertise a door the lens can never fill. Loud here, at publish, where the schema is known
    // (parseResolvers checked shape/rung; this checks existence). Rung (e) synthetics — fields with no
    // Policy at all — are design-only in v1, so every resolved field must already be in the schema.
    if (resolvers !== undefined) {
      for (const field of Object.keys(resolvers)) {
        if (!schema.props.has(field)) {
          throw new Error(
            `resolver "${field}": no such field in the schema — a resolver rides an existing ` +
              `property (synthetic fields with no Policy are SPEC §22 rung (e), not built in v1)`,
          );
        }
      }
      // Prove the ESM actually loads to a function NOW, so "registered" never means "carries a
      // resolver the doors cannot run" — the same loud-here/quiet-on-replay discipline as templates.
      await loadResolvers([resolvers]);
    }
    const survivors = this.registered.filter((r) => r.hyperschema.name !== hyperschema.name);
    const trialRegistry = SchemaRegistry.build([
      ...survivors.map((r) => r.hyperschema),
      hyperschema,
    ]);
    Gateway.assertMaterializable(hyperschema, trialRegistry);
    Gateway.assertTemplatesVisible(
      hyperschema,
      templates,
      trialRegistry,
      this.operatorAuthor ?? authorForSeed(seed),
    );
    buildGqlSchema(
      [
        ...survivors,
        {
          hyperschema,
          schema,
          roots,
          ...(templates ? { mutations: templates } : {}),
          ...(writable ? { writable } : {}),
          ...(resolvers ? { resolvers } : {}),
        },
      ],
      this.gqlHooks(),
    ); // arg names, field collisions, resolver output types — everything the replay would trip on, NOW

    const author = authorForSeed(seed);
    const schemaEntity = schemaEntityFor(hyperschema, entity);
    const definition = signClaims(
      publishHyperSchemaClaims(hyperschema, schemaEntity, author, this.nextTimestamp()),
      seed,
    );
    await this.loadHyperSchema([definition], schemaEntity); // proves, then persists the definition
    // The Schema is lifted to a first-class entity (SPEC §21): publish it as the LIVING
    // `schema:<name>` (single-lens — its name is the hyperschema's) AND freeze a content-addressed
    // VersionedSchema snapshot, then file the binding that references both. All three ride down
    // together so `loadSchema` finds the entities the binding names.
    const { living, snapshot, binding } = registrationDeltaClaims(
      schemaEntity,
      hyperschema.name,
      schema,
      roots,
      author,
      () => this.nextTimestamp(),
      templates,
      writable,
      resolvers,
    );
    await this.append([
      signClaims(living, seed),
      signClaims(snapshot, seed),
      signClaims(binding, seed),
    ]);
    this.replayRegistrations();
    await this.preloadResolvers();
    // Success must mean BOUND. The deltas are down either way (append-only ground), but a
    // publish the replay could not bind — a name already answered for by another entity, a
    // collision with a manual registration — is not to be reported as a served surface.
    if (!this.registered.some((r) => r.origin === "store" && r.entity === schemaEntity)) {
      throw new Error(
        `the registration persisted but did not bind: another hyperschema already answers to ` +
          `"${hyperschema.name}" — negate the old definition first, or choose a different name`,
      );
    }
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
    fromLens: string,
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
    if (this.registered.length > 0) this.rebind(this.registered);
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
    const policy = readTrustPolicy(this.reactor, this.operatorAuthor);
    if (policy.mode === "open") return () => true;
    if (policy.mode === "closed") return () => false;
    return (d) => d.claims.author === this.operatorAuthor || policy.roster.has(d.claims.author);
  }

  // The surviving deltas this store offers a peer — everything, or what the offered lens selects.
  offeredDeltas(): Delta[] {
    const lens = this.options.offeredLens;
    if (lens === undefined) return [...this.reactor.snapshot()];
    const result = evalTerm(lens, this.reactor.snapshot());
    if (result.sort !== "dset") throw new Error("an offered lens must select a delta set");
    return [...result.set];
  }

  // Admit a batch of peer deltas: verify each (a forgery or an unsigned delta is refused, and
  // one bad delta does not spoil the rest), apply the admission predicate, then ingest + write
  // through. Idempotent — union dedups, so re-pulling accepts nothing new.
  async federate(
    deltas: Iterable<Delta>,
    opts: { admit?: (d: Delta) => boolean } = {},
  ): Promise<FederationReport> {
    if (this.writeFailure !== undefined) {
      throw new Error(`this gateway can no longer persist: ${this.writeFailure.message}`);
    }
    const all = [...deltas];
    const admit = opts.admit ?? this.admitFor(); // the store's trust policy, unless overridden
    // The door remembers the hole (SPEC §11): a tombstoned id is refused re-entry even past an
    // explicit admit override — un-erasure is striking the tombstone, never a lucky re-send.
    const dead = readTombstones(this.reactor, this.operatorAuthor);
    const admitted: Delta[] = [];
    let rejected = 0;
    for (const d of all) {
      // A tombstone is a removal-order, not an inert claim — so it faces the same validator at
      // this door as at the append door (eraseDefect), and an unauthorized or malformed one is
      // refused rather than stored. Likewise a public-read declaration: it OPENS a door, so a
      // malformed one is refused here exactly as at append (publicDefect) — the two doors must
      // not disagree about what lawful loam:public data is. Everything the readers trust
      // downstream passed a door here.
      if (
        computeId(d.claims) !== d.id ||
        verifyDelta(d) !== "verified" ||
        dead.has(d.id) ||
        publicDefect(d.claims) !== undefined ||
        (isTombstone(d.claims) &&
          eraseDefect(d, this.reactor, this.operatorAuthor) !== undefined) ||
        !admit(d)
      ) {
        rejected += 1;
        continue;
      }
      admitted.push(d);
    }
    let accepted = 0;
    if (admitted.length > 0) {
      await this.backend.append(admitted);
      for (const d of admitted) this.justPersisted.add(d.id);
      try {
        for (const d of admitted) {
          if (this.ingestVia(d).status === "accepted") accepted += 1;
        }
      } finally {
        for (const d of admitted) this.justPersisted.delete(d.id);
      }
    }
    // "accepted" counts deltas NEWLY ingested — a duplicate verified but merged into what was
    // already there, so a re-pull accepts nothing (union is idempotent).
    return { offered: all.length, accepted, rejected };
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
    return this.registered.some((r) => r.hyperschema.name === name) ? this.matName(name) : name;
  }

  /** @internal — T19 seam (erase.ts, adopt.ts) */
  nextTimestamp(): number {
    this.lastMutationTs = Math.max(Date.now(), this.lastMutationTs + 1);
    return this.lastMutationTs;
  }

  // --- the read seam ---------------------------------------------------------------------------

  /** @internal — T19 seam (mutate.ts) */
  def(name: string): Bound {
    const def = this.registered.find((r) => r.hyperschema.name === name);
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
    return ["", `g${this.generation}`, name].join(NUL);
  }

  /** @internal — T19 seam (reads.ts) */
  lazyMatName(name: string, entity: string): string {
    return [this.matName(name), entity].join(NUL);
  }

  private static readonly MAX_LAZY_MATS = 1024;
  private static readonly DEFAULT_MAX_PUBLIC_WATCHES = 256;
  // Lazy materializations FIRST created through the public door — a stranger's subscriptions
  // draw on this smaller budget, so exhausting it degrades only the stranger's own door,
  // never the authenticated surface. Cleared wherever lazyMats is.
  private readonly publicLazyMats = new Set<string>();

  /** @internal — T19 seam (reads.ts: a watch binds to the materialization this names) */
  matFor(name: string, entity: string, door: "full" | "public" = "full"): string {
    const def = this.def(name);
    if (def.roots.includes(entity)) return this.matName(name);
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
      if (door === "public") {
        const cap = this.options.maxPublicWatches ?? Gateway.DEFAULT_MAX_PUBLIC_WATCHES;
        if (this.publicLazyMats.size >= cap) {
          throw new Error(
            `the public door already holds ${cap} unregistered entities live — ` +
              `query instead, or ask the operator to register the roots that matter`,
          );
        }
        this.publicLazyMats.add(matName);
      }
      this.reactor.register(matName, def.hyperschema.body, [entity], this.registry);
      this.lazyMats.add(matName);
    }
    return matName;
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
    const defs = this.registered.filter((r) => open.has(r.hyperschema.name));
    if (defs.length === 0) return undefined; // declared but not (yet) registered: nothing binds
    const key = defs.map((r) => Gateway.boundKey(r)).join(NUL);
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
