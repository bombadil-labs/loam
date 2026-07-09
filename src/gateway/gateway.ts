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
  DeltaSet,
  Reactor,
  SchemaRegistry,
  authorForSeed,
  computeId,
  evalTerm,
  hviewCanonicalHex,
  loadSchema,
  makeDelta,
  policyToJson,
  publishSchemaClaims,
  resolveView,
  signClaims,
  termHash,
  verifyDelta,
  viewCanonicalHex,
  type Delta,
  type HView,
  type HyperSchema,
  type IngestResult,
  type MaterializationChange,
  type Policy,
  type Primitive,
  type Term,
  type View,
} from "@bombadil/rhizomatic";
import { graphql, parse, subscribe, type ExecutionResult, type GraphQLSchema } from "graphql";
import type { StoreBackend } from "../store/backend.js";
import { authorize } from "./accounts.js";
import { Channel } from "./channel.js";
import type { Genesis } from "./genesis.js";
import {
  buildGqlSchema,
  type ClaimPointerSpec,
  type GqlHooks,
  type PatchNode,
  type ResolvedNode,
} from "./gql.js";
import {
  lawfulSnapshot,
  parseClaimTemplates,
  readRegistrations,
  registrationClaims,
  schemaEntityFor,
  type ClaimTemplates,
  type Registration,
} from "./registration.js";

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

// The gateway's own alphabet: NUL separates the segments of internal materialization names and
// comparison keys, and register() refuses it in schema names, so nothing user-supplied collides.
const NUL = "\u0000";

// What the gateway holds bound: a registration plus where it came from. Manual registrations
// (register()) live only in this process; store-derived ones are re-generated from deltas on
// every replay — so a store one can evolve or retire underneath us, and a manual one cannot.
interface Bound extends Registration {
  readonly origin: "manual" | "store";
}

export class Gateway {
  private registered: Bound[] = [];
  private registry = SchemaRegistry.build([]);
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
    // Fail fast on a mis-shaped offered lens: a term that does not select a delta set would only
    // blow up when a peer first pulls, in production. Trial-eval it now (empty store → empty
    // dset; the SORT is what we're checking, and that is content-independent).
    if (options.offeredLens !== undefined) {
      const trial = evalTerm(options.offeredLens, reactor.snapshot());
      if (trial.sort !== "dset") {
        throw new Error("offeredLens must select a delta set (a mask/select term, not a group)");
      }
    }
    reactor.subscribeRaw((d) => {
      // Every accepted delta — appends AND a runner's derived emissions — is written through
      // here. Derived emissions do not pass authorize(): a governed store runs only the
      // operator's blessed binding definitions (readBindingDefinitions gates on the operator),
      // so a firing binding is the operator's own delegated authority. Confining UNTRUSTED
      // (federated) function bodies is a runner-runtime concern SPEC §6 reserves for later.
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
    return gateway;
  }

  // The seams gql.ts resolves through — one object, shared by every (re)build of the surface.
  private gqlHooks(): GqlHooks {
    return {
      resolve: (name, entity) => this.resolvedNode(name, entity),
      mutate: (name, entity, props, actorSeed) => this.mutateEntity(name, entity, props, actorSeed),
      watch: (name, entity) => this.watchEntity(name, entity),
      claim: (pointers, actorSeed) => this.claimEntity(pointers, actorSeed),
    };
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
  // refuse a dset-sort body before it can persist, half-bind, or poison a boot.
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
      r.schema.name,
      termHash(r.schema.body),
      JSON.stringify(policyToJson(r.policy)),
      JSON.stringify(r.roots),
      JSON.stringify(r.mutations ?? null),
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
  private replayRegistrations(): void {
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
            const registry = SchemaRegistry.build(trial.map((r) => r.schema)); // dups, refs, cycles
            Gateway.assertMaterializable(candidate.schema, registry); // reactor.register would throw
            Gateway.assertTemplatesVisible(
              candidate.schema,
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
          schema: reg.schema,
          policy: reg.policy,
          roots: reg.roots,
          origin: reg.origin,
          ...(reg.entity === undefined ? {} : { entity: reg.entity }),
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
      const registry = SchemaRegistry.build(accepted.map((r) => r.schema));
      const gql = buildGqlSchema(accepted, this.gqlHooks());
      for (const reg of additions) {
        this.reactor.register(this.matName(reg.schema.name), reg.schema.body, reg.roots, registry);
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
    const registry = SchemaRegistry.build(next.map((r) => r.schema));
    const gql = buildGqlSchema(next, this.gqlHooks());
    this.generation += 1;
    for (const reg of next) {
      this.reactor.register(this.matName(reg.schema.name), reg.schema.body, reg.roots, registry);
    }
    this.lazyMats.clear(); // generation-stale by construction — new watches re-create their own
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
  // deltas are known to define what the caller says they define. The trial reads the LAWFUL
  // slice (the operator's, in a governed store): a federated foreign definition at the same
  // entity — newer, or malformed — must not shadow what the operator is proving.
  async loadSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    const batch = [...deltas];
    const trial = lawfulSnapshot(this.reactor, this.operatorAuthor);
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
  register(
    schema: HyperSchema,
    policy: Policy,
    roots: readonly string[],
    mutations?: ClaimTemplates,
  ): void {
    if (schema.name.includes(NUL)) {
      throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
    }
    // Normalize through the parser so every invariant the wire form promises (usable names,
    // contexts present, each on entities only) holds for hand-built templates too.
    const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
    const next: Bound[] = [
      ...this.registered,
      { schema, policy, roots, origin: "manual", ...(templates ? { mutations: templates } : {}) },
    ];
    const registry = SchemaRegistry.build(next.map((r) => r.schema)); // refuses dups + bad refs
    Gateway.assertMaterializable(schema, registry); // refuses a body that yields no hyperview
    Gateway.assertTemplatesVisible(
      schema,
      templates,
      registry,
      this.operatorAuthor ?? "loam:specimen",
    ); // refuses invisible writes
    const gql = buildGqlSchema(next, this.gqlHooks()); // refuses collisions
    // Incremental: only the NEW materialization registers, under the current generation.
    this.reactor.register(this.matName(schema.name), schema.body, roots, registry);
    this.registered = next;
    this.registry = registry;
    this.gql = gql;
  }

  // Publish a schema and its registration as data, then bind them, so the surface survives
  // reopen with no code. Two deltas: the DEFINITION (schema-schema claims at the schema
  // entity — proven by loadSchema before anything lands) and the REFERENCE that registers it.
  // Republishing at the same entity is evolution: the running surface rebinds to the latest
  // surviving definition. Any granted author could APPEND such deltas (writes are open), but
  // only the operator's ever bind — so this method refuses non-operators up front rather than
  // persist deltas that would look registered while shaping nothing.
  async publishRegistration(
    schema: HyperSchema,
    policy: Policy,
    roots: readonly string[],
    context?: RequestContext,
    entity?: string,
    mutations?: ClaimTemplates,
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
    if (schema.name.includes(NUL)) {
      throw new Error("a schema name may not contain NUL — that alphabet is the gateway's own");
    }
    // Prove the WHOLE registration before anything persists — the refs must resolve against
    // what is bound (minus the same name, which this publish may be evolving), the body must
    // materialize, the templates must be well-formed AND visible AND buildable into a GraphQL
    // surface. Loud here, quiet on replay: a poisoned delta on append-only ground cannot be
    // taken back, and "registered" must never mean "silently missing its mutations".
    const templates = mutations === undefined ? undefined : parseClaimTemplates(mutations);
    const survivors = this.registered.filter((r) => r.schema.name !== schema.name);
    const trialRegistry = SchemaRegistry.build([...survivors.map((r) => r.schema), schema]);
    Gateway.assertMaterializable(schema, trialRegistry);
    Gateway.assertTemplatesVisible(
      schema,
      templates,
      trialRegistry,
      this.operatorAuthor ?? authorForSeed(seed),
    );
    buildGqlSchema(
      [...survivors, { schema, policy, roots, ...(templates ? { mutations: templates } : {}) }],
      this.gqlHooks(),
    ); // arg names, field collisions — everything the replay would trip on, tripped NOW

    const author = authorForSeed(seed);
    const schemaEntity = schemaEntityFor(schema, entity);
    const definition = signClaims(
      publishSchemaClaims(schema, schemaEntity, author, this.nextTimestamp()),
      seed,
    );
    await this.loadSchema([definition], schemaEntity); // proves, then persists the definition
    const reference = signClaims(
      registrationClaims(schemaEntity, policy, roots, author, this.nextTimestamp(), templates),
      seed,
    );
    await this.append([reference]);
    this.replayRegistrations();
    // Success must mean BOUND. The deltas are down either way (append-only ground), but a
    // publish the replay could not bind — a name already answered for by another entity, a
    // collision with a manual registration — is not to be reported as a served surface.
    if (!this.registered.some((r) => r.origin === "store" && r.entity === schemaEntity)) {
      throw new Error(
        `the registration persisted but did not bind: another schema already answers to ` +
          `"${schema.name}" — negate the old definition first, or choose a different name`,
      );
    }
  }

  // Animate the gateway: route ingest through a runner's DerivationHost so bindings fire.
  animate(host: { ingest: (d: Delta) => IngestResult }): void {
    this.ingestVia = (d) => host.ingest(d);
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

  // The surviving deltas this store offers a peer — everything, or what the offered lens selects.
  offeredDeltas(): Delta[] {
    const lens = this.options.offeredLens;
    if (lens === undefined) return [...this.reactor.snapshot()];
    const result = evalTerm(lens, this.reactor.snapshot());
    if (result.sort !== "dset") throw new Error("an offered lens must select a delta set");
    return [...result.set];
  }

  // Admit a batch of peer deltas: verify each (a forgery or an unsigned delta is refused, and
  // one bad delta does not poison the rest), apply the admission predicate, then ingest + write
  // through. Idempotent — union dedups, so re-pulling accepts nothing new.
  async federate(
    deltas: Iterable<Delta>,
    opts: { admit?: (d: Delta) => boolean } = {},
  ): Promise<FederationReport> {
    if (this.writeFailure !== undefined) {
      throw new Error(`this gateway can no longer persist: ${this.writeFailure.message}`);
    }
    const all = [...deltas];
    const admit = opts.admit ?? (() => true);
    const admitted: Delta[] = [];
    let rejected = 0;
    for (const d of all) {
      if (computeId(d.claims) !== d.id || verifyDelta(d) !== "verified" || !admit(d)) {
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
    return this.registered.some((r) => r.schema.name === name) ? this.matName(name) : name;
  }

  private nextTimestamp(): number {
    this.lastMutationTs = Math.max(Date.now(), this.lastMutationTs + 1);
    return this.lastMutationTs;
  }

  // --- the read seam ---------------------------------------------------------------------------

  private def(name: string): Bound {
    const def = this.registered.find((r) => r.schema.name === name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    return def;
  }

  // The materialization watching (schema, entity) — the schema's own when the entity is a
  // registered root, a lazily-created cached one otherwise. Lazy names live in a NUL-separated
  // namespace no schema name can enter (register() refuses NUL), so they can never collide.
  // Generation-qualified (see the class note): an evolved schema binds a fresh materialization
  // under the bumped generation; a superseded one is left behind, and a stream still attached
  // to it keeps watching the old shape until it resubscribes.
  private matName(name: string): string {
    return ["", `g${this.generation}`, name].join(NUL);
  }

  private lazyMatName(name: string, entity: string): string {
    return [this.matName(name), entity].join(NUL);
  }

  private static readonly MAX_LAZY_MATS = 1024;

  private matFor(name: string, entity: string): string {
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
      this.reactor.register(matName, def.schema.body, [entity], this.registry);
      this.lazyMats.add(matName);
    }
    return matName;
  }

  // Gather the HView for (schema, entity): the live materialization when one is watching —
  // registered root or lazy — and batch evaluation otherwise (the spike proved them identical).
  private gather(name: string, entity: string): HView {
    const live =
      this.reactor.materializedView(this.matName(name), entity) ??
      this.reactor.materializedView(this.lazyMatName(name, entity), entity);
    if (live !== undefined) return live;
    const def = this.def(name);
    const result = this.reactor.eval(def.schema.body, entity, this.registry);
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  private resolvedNode(name: string, entity: string): ResolvedNode {
    const hview = this.gather(name, entity);
    const view = resolveView(this.def(name).policy, hview) as Record<string, View>;
    return {
      entity,
      view,
      hex: viewCanonicalHex(view),
      hviewHex: hviewCanonicalHex(hview),
    };
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

  // One signed MULTI-POINTER delta from an explicit pointer list — what every claim template
  // is sugar for. The actor signs (or the operator, when none is named); standing is asked by
  // append like everywhere else. Returns the receipt: the delta id.
  private async claimEntity(
    pointers: readonly ClaimPointerSpec[],
    actorSeed?: string,
  ): Promise<{ delta: string }> {
    const seed = actorSeed ?? this.options.seed;
    if (seed === undefined) {
      throw new Error("this gateway holds no signing seed and cannot write");
    }
    if (pointers.length === 0) {
      throw new Error("a claim carries at least one pointer");
    }
    const mapped = pointers.map((p, i) => {
      if (typeof p.role !== "string" || p.role === "") {
        throw new Error(`claim pointer ${i}: a pointer names a role`);
      }
      const hasAt = p.at !== undefined;
      const hasValue = p.value !== undefined;
      if (hasAt === hasValue) {
        throw new Error(`claim pointer ${i} ("${p.role}"): exactly one of at/value`);
      }
      if (hasAt) {
        if (p.at === "") {
          throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants an id`);
        }
        if (p.context === undefined || p.context === "") {
          throw new Error(`claim pointer ${i} ("${p.role}"): an entity pointer wants a context`);
        }
        return {
          role: p.role,
          target: { kind: "entity" as const, entity: { id: p.at, context: p.context } },
        };
      }
      return { role: p.role, target: { kind: "primitive" as const, value: p.value as Primitive } };
    });
    const delta = signClaims(
      { timestamp: this.nextTimestamp(), author: authorForSeed(seed), pointers: mapped },
      seed,
    );
    await this.append([delta]);
    return { delta: delta.id };
  }

  // --- the live seam ---------------------------------------------------------------------------

  // A dynamic view of (schema, entity): an initial snapshot, then a patch per relevant change.
  // Built on a Channel, so leaving the stream (return/throw) detaches immediately — even while
  // the reader is parked waiting for an event that never comes. A slow reader coalesces: at
  // most one pending patch, its hex chain and changed-set kept honest by the merge. A sink that
  // cannot re-resolve fails ITS OWN stream and detaches — it never aborts the fan-out or the
  // writer whose ingest triggered it. A change that leaves the resolved view identical (same
  // hex) is no patch at all.
  //
  // The stream CAPTURES its shape at subscribe time — the policy and the materialization it
  // was born watching. An evolution rebinds the query surface, but this stream keeps resolving
  // the shape it promised its reader (triggered by, and reading from, the same superseded
  // materialization) until the reader resubscribes. Trigger and resolution must agree: the
  // current def would re-resolve through the NEW materialization while the OLD one decides
  // when to fire — silently missing what only the new shape gathers.
  private watchEntity(name: string, entity: string): AsyncGenerator<PatchNode, void, unknown> {
    const bound = this.def(name);
    const matName = this.matFor(name, entity);
    const resolveCaptured = (): ResolvedNode => {
      const hview = this.reactor.materializedView(matName, entity);
      if (hview === undefined) {
        throw new Error(`the materialization backing this stream is gone — resubscribe`);
      }
      const view = resolveView(bound.policy, hview) as Record<string, View>;
      return {
        entity,
        view,
        hex: viewCanonicalHex(view),
        hviewHex: hviewCanonicalHex(hview),
      };
    };
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

    const initial = resolveCaptured();
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
