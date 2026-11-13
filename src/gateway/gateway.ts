import type { Peer, UserGround } from "./peer.js";
import {
  signClaims,
  Reactor,
  SchemaRegistry,
  authorForSeed,
  computeId,
  evalTermRaw,
  makeNegationClaims,
  type Delta,
  type HView,
  type HyperSchema,
  type IngestResult,
  type MaterializationChange,
  type Schema,
  type Primitive,
  type Term,
  type DurableOrdinaryJournalStore,
} from "@bombadil/rhizomatic";
import { graphql, type GraphQLSchema } from "graphql";
import type { StoreBackend } from "../store/backend.js";
import { isRepairable } from "../store/quarantine.js";
import { holdsJournals, holdsPoolKeys } from "../store/peer-image.js";
import { memoryPoolKeysFor, PoolKeyMissing, type PoolKeySource } from "./pool-keys.js";
import {
  admitLocal,
  JournalConflict,
  openHostPeer,
  peerIdOf,
  rereadHostPeer,
  type HostPeer,
} from "./peer-admission.js";
import { stampOn, withStamp, type Stamp } from "./stamp.js";
import { manifestExportClaims, type ManifestExport } from "./adopt-vocab.js";
import { probePhysicalRetention, storeHoldsAny, storeInventory } from "./custody.js";

type ProbeQuestion =
  { readonly holds: string } | { readonly retention: readonly string[] } | "any" | "inventory";
import { claimGatewayMarker } from "./gateway-brand.js";
import { Store } from "./store.js";
import { NUL } from "./alphabet.js";
import { declarePrincipalScope } from "./principal.js";
import { declareUserGround, userGroundOf } from "./user-root.js";
import { promoteImpl, readAdoptions, type Adoption } from "./adopt.js";
import {
  arrivalClaims,
  blessChannelAppImpl,
  attachChannelPool,
  blessChannelResolversImpl,
  withheldLenses,
  channelAppsImpl,
  channelStatusImpl,
  channelsEverImpl,
  resumeChannelImpl,
  curseChannelLawImpl,
  dropChannelImpl,
  keepSyncingImpl,
  openChannelImpl,
  setChannelImpl,
  type ArrivedApp,
  type Channel,
  type ChannelStatus,
  type OpenChannelOptions,
  type StandingSync,
} from "../federation/channel.js";
import {
  adoptLawImpl,
  blessAllImpl,
  lawFromImpl,
  readLawAdoptions,
  withLivingNames,
  type AdoptLawOptions,
  type AdoptionOutcome,
  type BlessAllOptions,
  type BlessAllReport,
  type LawAdoption,
  type LawFromRow,
} from "./adopt-law.js";
import { eraseImpl, eraseReplicaImpl, healthImpl, type StoreHealth } from "./erase.js";
import { pinErasureGovernors, erasedFromReading } from "./erase-law.js";
import { seatDeclarations, type GroundDeclarations } from "./ground-declarations.js";
import { continueGroundRevision, groundRevision } from "./ground-revision.js";
import type { LiveStream } from "./channel.js";
import { STORE_ENTITY, operatorMarkerClaims, type Genesis } from "./genesis.js";
import { grantClaims, revocationClaims } from "./accounts.js";
import type { Verb } from "./grants-law.js";
import {
  admitForImpl,
  appendImpl,
  catchUp,
  refreshImpl,
  federateImpl,
  offeredDeltasImpl,
  selectImpl,
  watchImpl,
  ingestTogether,
} from "./ingest.js";
import { withNegationClosure } from "./negation-closure.js";
import { freezeMembers, type ModuleVersion } from "./container-identity.js";
import {
  boundKey,
  contestedNamesImpl,
  type ContestedNameReport,
  lazyMatNameImpl,
  loadHyperSchemaImpl,
  matForImpl,
  matNameImpl,
  preloadResolversImpl,
  publishRegistrationImpl,
  type PublishOutcome,
  rebindImpl,
  registerImpl,
  boundBindingsImpl,
  replayRegistrationsImpl,
  type BoundFold,
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
  envelopeReportsImpl,
  type EnvelopeReport,
  type PoolEnvelope,
  type QuarantineEnvelope,
} from "./envelope.js";
import {
  cutImpl,
  deriveReceiptImpl,
  slateReportsImpl,
  type CutReport,
  type Receipt,
  type SlateReport,
} from "./slate.js";
import type { CitationTier } from "./tiers.js";
import {
  isRetiredSlateFormat,
  readClosedIds,
  readGraveyards,
  type GraveyardRecord,
} from "./slate-law.js";
import {
  lensOf,
  programOf,
  readRegistrationVersions,
  readWithdrawnRegistrations,
  type RefSpecs,
  type ResolverSpecs,
  type ClaimTemplates,
  type Registration,
  type RegistrationVersion,
  type WithdrawnRegistration,
  type LensName,
} from "./registration.js";
import { byLens, CTX_REGISTRATION, readRegistrations } from "./registration.js";
import { newResolverMemo, type ResolverMemo } from "./resolvers.js";
import {
  openQuarantineImpl,
  type QuarantineOptions,
  type QuarantinePool,
} from "./quarantine-pool.js";
import {
  bindConnectionImpl,
  poolForBindingImpl,
  resumeInboxesImpl,
  connectionScopeImpl,
  containerScopeImpl,
  openContainerImpl,
  revokeConnectionImpl,
  type BindConnectionOptions,
  type Container,
  type ContainerOptions,
} from "./container.js";
import { readContainerTable, type ContainerTable } from "./container-law.js";
import { readContributionImpl } from "./read-contribution.js";
import type { Probation } from "./probation.js";
import {
  declareArtifactImpl,
  packArtifactImpl,
  readArtifactRoutes,
  type PackArtifactOptions,
  type PackedArtifact,
} from "./artifact.js";
import {
  prepareRouteImpl,
  publishRendererImpl,
  readRenderers,
  serveBytesImpl,
  serveRouteImpl,
  writeRouteImpl,
  type ReadGesture,
  type RendererBinding,
} from "./renderers.js";
import {
  claimEntityImpl,
  clearEntityImpl,
  linkEntityImpl,
  linkRefEntityImpl,
  mutateEntityImpl,
  removeEntityImpl,
  severEntityImpl,
  unlinkRefEntityImpl,
} from "./mutate.js";
import {
  assertChannelSourceLegible,
  gatherForRetractionImpl,
  gatherImpl,
  resolvedNodeImpl,
  resolvePinnedImpl,
  subscribeViaImpl,
  watchEntityImpl,
} from "./reads.js";
import { readNodeImpl } from "./portable-door.js";
import { listImpl, type ListOptions } from "./listing.js";
import { declareReadHidden, governedProgram, needsLowering } from "./governed-trust.js";
import { activeIncarnation, incarnationClaims, mintIncarnation } from "./recovery-cut.js";
import { seedSigner, type Signer } from "./signer.js";
import { lawAuthors, localAuthors, type ChildLaw, type LawContext } from "./child-law.js";

export interface AppendReceipt {
  readonly accepted: number;
  readonly duplicates: number;
}

export interface QueryResult {
  data?: Record<string, unknown> | null;
  errors?: string[];
}

const WRITE_THROUGH_RETRIES = 8;

export interface GatewayOptions {
  readonly portableReads?: boolean;
  readonly onReadRoute?: (read: {
    readonly lens: string;
    readonly entity: string;
    readonly route: "portable" | "native";
    readonly reason?: string;
  }) => void;

  readonly peerStore?: DurableOrdinaryJournalStore;

  readonly poolKeys?: PoolKeySource;

  readonly channelBackend?: (pool: string) => StoreBackend;

  readonly channelToken?: (channel: string) => string | undefined;
  readonly seed?: string;
  readonly offeredLens?: Term;
  readonly maxPublicWatches?: number;
  readonly pens?: Readonly<Record<string, string>>;
  readonly maxPublicRenders?: number;
  readonly renderTimeoutMs?: number;
  readonly renderSpawnTimeoutMs?: number;
}

export interface FederationReport {
  readonly offered: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly held: number;

  readonly acceptedIds?: readonly string[];
  readonly admittedIds?: readonly string[];
}

export interface ConnectionBinding {
  readonly container: string;
  readonly inbox: string;
}

export interface RequestContext {
  readonly actor?: string;
  readonly binding?: ConnectionBinding;
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export class NothingPublic extends Error {
  constructor() {
    super(
      "nothing here is public: no surviving operator declaration at loam:public opens a schema",
    );
  }
}

export { NUL } from "./alphabet.js";

export interface Bound extends Registration {
  readonly origin: "manual" | "store";

  readonly channel?: string;
}

const bindableNames = (r: Bound): string[] => [lensOf(r), programOf(r)];

const EMPTY_PUBLIC: ReadonlySet<string> = new Set<string>();
const MAX_TIMER_DELAY = 2 ** 31 - 1;

export const unreadableStoreMessage = (rows: number): string =>
  `this store holds ${rows} rows and none of them is readable, so it was not booted. ` +
  `A store written before rhizomatic 0.11 reads this way: its deltas carry no \`validFrom\`, ` +
  `and there is no migration. Open it with the Loam release that wrote it, or start a new ` +
  `store. \`loam repair\` lists the rows.`;

const markGateway = claimGatewayMarker();

export class Gateway {
  registered: Bound[] = [];
  publicRendersInFlight = 0;
  envelope: PoolEnvelope | undefined = undefined;
  envelopeCeiling: (() => QuarantineEnvelope) | undefined = undefined;
  envelopeGround: ((subject?: string) => QuarantineEnvelope) | undefined = undefined;
  poolHandle: string | undefined = undefined;
  private readonly declarations: GroundDeclarations = {};
  private userHost: UserGround | undefined = undefined;
  readonly resolverMemo: ResolverMemo = newResolverMemo();
  registry = SchemaRegistry.build([]);
  gql: GraphQLSchema | undefined;

  private readonly boundCache = new Map<
    string,
    { key: string; fold: BoundFold; schema: GraphQLSchema }
  >();
  generation = 0;
  private writes: Promise<void> = Promise.resolve();
  writeFailure: Error | undefined;
  readonly sinks = new Map<string, Set<(c: MaterializationChange) => void>>();
  readonly lazyMats = new Set<string>();
  readonly publicLazyMats = new Set<string>();
  readonly channels = new Set<LiveStream>();
  readonly justPersisted = new Set<string>();
  peer: HostPeer | undefined = undefined;
  needsJournalRefresh = false;
  reseating: Promise<void> | undefined;
  poolKeys: PoolKeySource = memoryPoolKeysFor(this);
  rowsOutsideJournal = 0;

  durableRevision: string | undefined;
  private unreadableRows = 0;
  readonly operatorAuthor: string | undefined;

  readonly signer: Signer | undefined;

  childLaw: ChildLaw | undefined = undefined;
  pinErasureGovernors(keys: readonly string[]): void {
    pinErasureGovernors(this._reactor, keys);
  }
  lawAuthors(context: LawContext): string[] {
    return lawAuthors(this.operatorAuthor, this.childLaw, context);
  }
  localAuthors(): string[] {
    return localAuthors(this.operatorAuthor, this.childLaw);
  }
  ingestVia: (d: Delta) => IngestResult = (d) => this.reactor.ingest(d);

  ingestAllVia: (ds: readonly Delta[]) => IngestResult[] = (ds) => ingestTogether(this.reactor, ds);

  private _reactor: Reactor;
  get reactor(): Reactor {
    return this._reactor;
  }

  get revision(): number {
    return groundRevision(this._reactor);
  }

  readonly options: Readonly<Omit<GatewayOptions, "seed">>;

  private constructor(
    readonly backend: StoreBackend,
    reactor: Reactor,
    options: GatewayOptions,
  ) {
    markGateway(this);
    this._reactor = reactor;
    const { seed, ...kept } = options;
    this.options = kept;
    this.signer = seed === undefined ? undefined : seedSigner(seed);
    this.operatorAuthor = this.signer?.author;
    seatDeclarations(reactor, this.declarations);
    this.declareUsers(reactor);
    if (options.offeredLens !== undefined) {
      const ground = reactor.snapshot();
      const lens = governedProgram(
        options.offeredLens,
        undefined,
        ground,
        { raw: true },
        userGroundOf(reactor),
      );
      const trial = evalTermRaw(lens.term, ground);
      if (trial.sort !== "dset") {
        throw new Error("offeredLens must select a delta set (a mask/select term, not a group)");
      }
    }
    this.attachPersistence(reactor);
  }

  private attachPersistence(reactor: Reactor): void {
    reactor.subscribeRaw((d) => {
      groundRevision(reactor);
      if (this.justPersisted.delete(d.id)) return;
      const peer = this.peer;
      this.writes = this.writes
        .then(async () => {
          if (peer === undefined) return void (await this.backend.append([d]));
          const at = this.now();
          for (let attempt = 0; ; attempt += 1) {
            try {
              await admitLocal(peer, [d], at, () => false);
              if (this.reactor.get(d.id) === undefined) {
                this.justPersisted.add(d.id);
                try {
                  this.ingestVia(d);
                } finally {
                  this.justPersisted.delete(d.id);
                }
              }
              return;
            } catch (err) {
              if (!(err instanceof JournalConflict) || attempt >= WRITE_THROUGH_RETRIES) throw err;
              await catchUp(this);
              if (peer.journal.availableDeltas().has(d.id)) return;
            }
          }
        })
        .then(
          () => {},
          (err: unknown) => {
            this.writeFailure ??= toError(err);
          },
        );
    });
  }

  async openChild(backend: StoreBackend, options: GatewayOptions): Promise<Gateway> {
    const child = await Gateway.open(backend, options);
    child.store = this.store;
    return child;
  }

  static async open(backend: StoreBackend, options: GatewayOptions = {}): Promise<Gateway> {
    const seed = options.seed;
    const reactor = new Reactor();
    let peer: HostPeer | undefined;
    let replayed: Delta[];
    let outsideJournal = 0;
    let peerStore = options.peerStore;
    let peerId = seed === undefined ? undefined : peerIdOf(authorForSeed(seed));
    if (holdsJournals(backend)) {
      const journals = await backend.journalPeers();
      if (peerId !== undefined && journals.length > 0 && !journals.includes(peerId)) {
        throw new Error(
          `peer journal: this store belongs to ${journals.join(", ")}, and the key given ` +
            `(${peerId}) names no journal here. Open it with its own operator seed.`,
        );
      }
      if (peerStore === undefined && journals.length === 0 && peerId !== undefined) {
        peerStore = backend.journalStore();
      } else if (peerStore === undefined && journals.length > 0) {
        if (peerId === undefined) {
          if (journals.length > 1) {
            throw new Error(
              "peer journal: this store holds several peer journals; open it with the operator " +
                "seed that names one",
            );
          }
          peerId = journals[0]!;
        }
        peerStore = backend.journalStore();
      }
    }
    const revision = await backend.revision?.();
    if (peerStore === undefined) {
      replayed = await backend.deltasSince(new Set());
    } else {
      const opened = await openHostPeer(peerStore, peerId!);
      peer = opened.peer;
      replayed = opened.rows;
      if (opened.unavailable.length > 0 && holdsJournals(backend)) {
        backend.setAside?.(opened.unavailable);
      }
      if (holdsJournals(backend)) {
        const admitted = new Set(replayed.map((d) => d.id));
        const rows = await (backend.journalRowIds?.() ?? backend.ids());
        outsideJournal = [...rows].filter((id) => !admitted.has(id)).length;
      }
    }
    for (const d of replayed) {
      if (isRetiredSlateFormat(d.claims)) {
        throw new Error(
          `slate format: this store holds ${d.id}, a slate or graveyard record in the retired ` +
            `format, and no reader honors it. Loam does not migrate it: start a new store.`,
        );
      }
      const result = reactor.ingest(d);
      if (result.status === "rejected") {
        throw new Error(`replay: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    const unreadableRows =
      replayed.length === 0 && isRepairable(backend) ? (await backend.quarantine()).length : 0;
    if (seed !== undefined && isRepairable(backend)) {
      const markerId = computeId(operatorMarkerClaims(authorForSeed(seed)));
      const quarantined = await backend.quarantine();
      if (quarantined.some((row) => row.key === markerId || row.key.endsWith(markerId))) {
        throw new Error(
          `constitutional core unreadable: the operator marker at ${STORE_ENTITY} was set aside ` +
            `by boot — the store cannot know who governs it. Resolve it with \`loam repair\` ` +
            `(re-admit if transient, else this store's genesis must be replanted).`,
        );
      }
    }
    let pendingMarker: Delta | undefined;
    if (
      seed !== undefined &&
      unreadableRows === 0 &&
      activeIncarnation(reactor, authorForSeed(seed), new Set()) === undefined
    ) {
      const operator = authorForSeed(seed);
      const t = Math.max(1, ...replayed.map((d) => d.claims.timestamp + 1));
      const marker = signClaims(incarnationClaims(mintIncarnation(), operator, t), seed);
      if (peer === undefined) {
        await backend.append([marker]);
        reactor.ingest(marker);
      } else pendingMarker = marker;
    }
    const gateway = new Gateway(backend, reactor, options);
    gateway.peer = peer;
    gateway.rowsOutsideJournal = outsideJournal;
    gateway.durableRevision = revision;
    gateway.poolKeys =
      options.poolKeys ??
      (holdsPoolKeys(backend) ? backend.poolKeys() : undefined) ??
      memoryPoolKeysFor(backend);
    if (peer !== undefined && pendingMarker !== undefined) {
      await admitLocal(peer, [pendingMarker], gateway.now(), () => false);
      gateway.justPersisted.add(pendingMarker.id);
      reactor.ingest(pendingMarker);
      gateway.justPersisted.delete(pendingMarker.id);
    }
    gateway.unreadableRows = unreadableRows;
    gateway.seedAuthorClocks(replayed);
    gateway.replayRegistrations();
    gateway.advanceToNow();
    await gateway.preloadResolvers();
    return gateway;
  }

  async preloadResolvers(): Promise<void> {
    return preloadResolversImpl(this);
  }

  async durableCurrent(): Promise<boolean> {
    const revision = await this.backend.revision?.();
    return revision !== undefined && revision === this.durableRevision;
  }

  static async boot(
    backend: StoreBackend,
    genesis: Genesis,
    options: Omit<GatewayOptions, "seed"> = {},
  ): Promise<Gateway> {
    const journal =
      options.peerStore === undefined && holdsJournals(backend)
        ? { peerStore: backend.journalStore() }
        : {};
    const gateway = await Gateway.open(backend, {
      ...options,
      ...journal,
      seed: genesis.operatorSeed,
    });
    if (gateway.unreadableRows > 0) {
      await gateway.close();
      throw new Error(unreadableStoreMessage(gateway.unreadableRows));
    }
    if (genesis.deltas.length > 0) await gateway.append(genesis.deltas);
    gateway.replayRegistrations();
    await gateway.preloadResolvers();
    await gateway.resumeChannels();
    await gateway.resumeInboxes();
    return gateway;
  }

  gqlHooks(door: "full" | "public" = "full"): GqlHooks {
    return {
      assertSource: (name, binding) => assertChannelSourceLegible(this, name, binding),
      resolve: (name, entity, asOf, binding) =>
        this.resolvedNode(name, entity, asOf, undefined, binding),
      resolveRead: (name, entity, asOf, binding) =>
        this.readNode(name, entity, asOf, undefined, binding),
      mutate: (name, entity, props, actorSeed, binding) =>
        this.mutateEntity(name, entity, props, actorSeed, binding),
      clear: (name, entity, fields, actorSeed, binding) =>
        this.clearEntity(name, entity, fields, actorSeed, binding),
      remove: (name, entity, field, values, actorSeed, binding) =>
        this.removeEntity(name, entity, field, values, actorSeed, binding),
      link: (name, entity, field, target, context, actorSeed, binding) =>
        this.linkEntity(name, entity, field, target, context, actorSeed, binding),
      sever: (name, entity, field, targets, actorSeed, binding) =>
        this.severEntity(name, entity, field, targets, actorSeed, binding),
      linkRef: (name, entity, prop, target, actorSeed, binding) =>
        this.linkRefEntity(name, entity, prop, target, actorSeed, binding),
      unlinkRef: (name, entity, prop, target, actorSeed, binding) =>
        this.unlinkRefEntity(name, entity, prop, target, actorSeed, binding),
      watch: (name, entity) => this.watchEntity(name, entity, door),
      claim: (pointers, actorSeed, binding) => this.claimEntity(pointers, actorSeed, binding),
      list: (name, opts, binding) => this.list(name, opts, binding),
    };
  }

  surface(
    door: "full" | "public" = "full",
  ): { registered: readonly Registered[]; hooks: GqlHooks } | undefined {
    if (door === "public") {
      const declared = this.openNames();
      const defs = this.registered.filter((r) => declared.has(lensOf(r)));
      if (defs.length === 0) return undefined;
      return { registered: defs, hooks: this.gqlHooks("public") };
    }
    return { registered: this.registered, hooks: this.gqlHooks() };
  }

  isPublicLatest(name: string): boolean {
    return this.openNames().has(name);
  }
  isPublicPin(name: string, deltaId: string): boolean {
    return this.openNames().has(`${name}@${deltaId}`);
  }

  registrationVersions(): RegistrationVersion[] {
    return readRegistrationVersions(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  contestedNames(): Map<string, ContestedNameReport> {
    return contestedNamesImpl(this);
  }

  withdrawnRegistrations(): WithdrawnRegistration[] {
    return readWithdrawnRegistrations(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  resolvePinned(
    reg: Registered,
    entity: string,
    asOf?: number,
    now?: number,
    binding?: ConnectionBinding,
  ): ResolvedNode {
    return resolvePinnedImpl(this, reg, entity, now ?? this.now(), asOf, binding);
  }

  replayRegistrations(): void {
    return replayRegistrationsImpl(this);
  }

  async append(deltas: Iterable<Delta>): Promise<AppendReceipt> {
    return appendImpl(this, deltas);
  }

  async loadHyperSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    return loadHyperSchemaImpl(this, deltas, entity);
  }

  register(
    hyperschema: HyperSchema,
    schema: Schema,
    roots: readonly string[],
    mutations?: ClaimTemplates,
    writable?: readonly string[],
    refs?: RefSpecs,
  ): void {
    return registerImpl(this, hyperschema, schema, roots, mutations, writable, refs);
  }

  async publishRegistration(
    hyperschema: HyperSchema,
    schema: Schema,
    roots: readonly string[],
    context?: RequestContext,
    entity?: string,
    mutations?: ClaimTemplates,
    writable?: readonly string[],
    resolvers?: ResolverSpecs,
    refs?: RefSpecs,
  ): Promise<PublishOutcome> {
    return withLivingNames(this, () =>
      publishRegistrationImpl(
        this,
        hyperschema,
        schema,
        roots,
        context,
        entity,
        mutations,
        writable,
        resolvers,
        refs,
      ),
    );
  }

  renderers(): RendererBinding[] {
    return readRenderers(this.reactor, this.validityNow(), this.lawAuthors("renderers"));
  }

  async declarePublic(entries: readonly string[], context?: RequestContext): Promise<void> {
    return declarePublicImpl(this, entries, context);
  }

  async declareArtifact(routes: readonly string[], context?: RequestContext): Promise<void> {
    return declareArtifactImpl(this, routes, context);
  }

  artifactRoutes(): ReadonlySet<string> {
    return readArtifactRoutes(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  packArtifact(route: string, entity: string, opts: PackArtifactOptions): PackedArtifact {
    return packArtifactImpl(this, route, entity, opts);
  }

  async publishRenderer(input: unknown, context?: RequestContext): Promise<void> {
    return withLivingNames(this, () => publishRendererImpl(this, input, context));
  }

  async prepareRoute(route: string, door: "full" | "public" = "full"): Promise<void> {
    await this.prepareRead();
    return prepareRouteImpl(this, route, door);
  }

  async serveRoute(
    route: string,
    entity: string,
    door: "full" | "public",
    gesture?: { readonly reads: readonly ReadGesture[]; readonly state: Record<string, string> },
    asOf?: number,
  ): Promise<{ status: number; contentType: string; body: string }> {
    return serveRouteImpl(this, route, entity, door, gesture, asOf);
  }

  async writeRoute(
    route: string,
    entity: string,
    fields: Record<string, Primitive>,
    door: "full" | "public",
  ): Promise<{ status: number; contentType: string; body: string }> {
    return writeRouteImpl(this, route, entity, fields, door);
  }

  serveBytes(
    ref: string,
    fromLens: LensName,
    fromEntity: string,
    door: "full" | "public",
  ): { status: number; contentType: string; body: Uint8Array } {
    return serveBytesImpl(this, ref, fromLens, fromEntity, door);
  }

  animate(host: { ingest: (d: Delta) => IngestResult }): void {
    this.ingestVia = (d) => host.ingest(d);
    this.ingestAllVia = (ds) => ds.map((d) => host.ingest(d));
  }

  async erase(
    id: string,
    opts: { reason?: string; slate?: string } = {},
  ): Promise<{
    erased: string;
    citations: string[];
    citationTiers: CitationTier[];
    kept: string[];
    erasure: string;
    minted: boolean;
    reasons: string[];
    spokenBy?: string;
  }> {
    return eraseImpl(this, id, opts);
  }

  async health(now?: number): Promise<StoreHealth> {
    return healthImpl(this, now ?? this.now());
  }

  slates(now?: number): SlateReport[] {
    return slateReportsImpl(this, now ?? this.now());
  }

  graveyards(): GraveyardRecord[] {
    return readGraveyards(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  async cut(slate: string, opts: { now?: number } = {}): Promise<CutReport> {
    return cutImpl(this, slate, opts);
  }

  async receipt(graveyard: string, opts: { now?: number } = {}): Promise<Receipt> {
    return deriveReceiptImpl(this, graveyard, opts);
  }

  cutHold: (() => Promise<void>) | undefined = undefined;

  get quarantinePools(): Set<Gateway> {
    return this.store.tableOf(this).pools;
  }

  get attachedContainers(): Map<string, Gateway> {
    return this.store.tableOf(this).named;
  }

  get connectionInboxes(): Map<string, Container> {
    return this.store.tableOf(this).inboxes;
  }

  get channelPools(): Map<string, Container> {
    return this.store.tableOf(this).channels;
  }

  probation: Probation | undefined = undefined;

  store = new Store();

  readonly federationChannels = new Map<string, Channel>();

  channelPool?: true;

  envelopeReports(): EnvelopeReport[] {
    return envelopeReportsImpl(this);
  }

  async openQuarantine(opts: QuarantineOptions = {}): Promise<QuarantinePool> {
    return openQuarantineImpl(this, opts);
  }

  containers(): ContainerTable {
    return readContainerTable(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  readonly channelAttachFaults = new Map<string, { message: string; keyMissing: boolean }>();

  async resumeChannels(): Promise<void> {
    for (const standing of this.channelStatus()) {
      if (this.federationChannels.has(standing.name)) continue;
      const token = this.options.channelToken?.(standing.name);
      try {
        this.store.setChannel(this, standing.name, await attachChannelPool(this, standing.name));
        this.channelAttachFaults.delete(standing.name);
      } catch (err) {
        this.channelAttachFaults.set(standing.name, {
          message: err instanceof Error ? err.message : String(err),
          keyMissing: err instanceof PoolKeyMissing,
        });
        continue;
      }
      if (standing.from !== "" && token !== undefined) {
        this.federationChannels.set(standing.name, resumeChannelImpl(this, standing, token));
      }
    }
    if (this.store.channels(this).size > 0) this.replayRegistrations();
  }

  keepSyncing(opts: { everyMs?: number } = {}): StandingSync {
    return keepSyncingImpl(this, opts);
  }

  async curseChannelLaw(
    channel: string,
    living: string,
    opts: { lift?: boolean } = {},
  ): Promise<void> {
    return curseChannelLawImpl(this, channel, living, opts);
  }

  async setChannel(
    name: string,
    next: { receiving?: boolean; blessing?: boolean },
  ): Promise<ChannelStatus> {
    return setChannelImpl(this, name, next);
  }

  channelsEver(name?: string): ChannelStatus[] {
    return channelsEverImpl(this, name);
  }

  channelStatus(name?: string): ChannelStatus[] {
    return channelStatusImpl(this, name);
  }

  channelApps(channel?: string): ArrivedApp[] {
    return channelAppsImpl(this, channel);
  }

  async blessChannelApp(
    channel: string,
    route: string,
    opts: { pen?: boolean; supersede?: boolean; expect?: string } = {},
  ): Promise<void> {
    return blessChannelAppImpl(this, channel, route, opts);
  }

  async blessChannelResolvers(channel: string, lens: string): Promise<string> {
    return blessChannelResolversImpl(this, channel, lens);
  }

  withheldOn(channel: string): string[] {
    const status = channelStatusImpl(this, channel)[0];
    const ground = this.store.channels(this).get(channel)?.gateway;
    if (status === undefined || ground === undefined) return [];
    return withheldLenses(this, ground, status.prefix);
  }

  async dropChannel(name: string): Promise<void> {
    return dropChannelImpl(this, name);
  }

  async openChannel(opts: OpenChannelOptions): Promise<Channel> {
    return openChannelImpl(this, opts);
  }

  async openContainer(opts: ContainerOptions = {}): Promise<Container> {
    return openContainerImpl(this, opts);
  }

  containerScope(opts: { containers?: readonly string[] } = {}): Delta[] {
    return containerScopeImpl(this, opts);
  }

  servingScope(
    now: number,
    opts: { containers?: readonly string[]; bound?: string; asOf?: number } = {},
  ): Delta[] {
    const moment = { now, ...(opts.asOf === undefined ? {} : { asOf: opts.asOf }) };
    return opts.bound === undefined
      ? containerScopeImpl(this, opts, moment)
      : connectionScopeImpl(this, { bound: opts.bound, ...opts }, moment);
  }

  async prepareRead(options: { reconcileLaw?: boolean } = {}): Promise<void> {
    await this.refresh();
    let children = false;
    for (const child of this.store.pools(this)) {
      await child.prepareRead();
      children = true;
    }
    if (children || options.reconcileLaw) this.replayRegistrations();
    if (options.reconcileLaw) await this.preloadResolvers();
  }

  readContribution(now: number, options: { inbox?: string; asOf?: number } = {}) {
    return readContributionImpl(this, now, options);
  }

  async list(
    name: string,
    opts: ListOptions = {},
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode[]> {
    return listImpl(this, name, opts, binding);
  }

  async bindConnection(opts: BindConnectionOptions): Promise<Container> {
    return bindConnectionImpl(this, opts);
  }

  poolForBinding(binding: ConnectionBinding): Gateway {
    return poolForBindingImpl(this, binding);
  }

  async resumeInboxes(): Promise<void> {
    return resumeInboxesImpl(this);
  }

  connectionScope(opts: { bound: string; containers?: readonly string[] }): Delta[] {
    return connectionScopeImpl(this, opts);
  }

  async revokeConnection(opts: {
    inbox: Container;
    connectionKey: string;
    ownerSeed?: string;
    asPool?: boolean;
  }): Promise<void> {
    return revokeConnectionImpl(opts);
  }

  async promote(
    source: Gateway,
    deltaId: string,
    opts: { from?: string } = {},
  ): Promise<{ promoted: string }> {
    return promoteImpl(this, source, deltaId, opts);
  }

  adoptions(): Adoption[] {
    if (this.operatorAuthor === undefined) return [];
    return readAdoptions(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  async strike(ids: readonly string[], by: Signer | undefined = this.signer): Promise<void> {
    if (by === undefined) throw new Error("strike: this container has no governing key");
    const stamp = this.stamp(by.author);
    await this.append(
      ids.map((id) => by.sign(withStamp(stamp, (t) => makeNegationClaims(by.author, t, id)))),
    );
  }

  async issueGrant(subject: string, verb: Verb): Promise<void> {
    const signer = this.signer;
    if (signer === undefined) throw new Error("issueGrant: this container has no governing key");
    await this.append([
      signer.sign(
        withStamp(this.stamp(signer.author), (t) =>
          grantClaims(STORE_ENTITY, subject, verb, signer.author, t),
        ),
      ),
    ]);
  }

  revocations(ids: readonly string[]): Delta[] {
    const signer = this.signer;
    if (signer === undefined) throw new Error("revocations: this container has no governing key");
    return ids.map((id) =>
      signer.sign(
        withStamp(this.stamp(signer.author), (t) => revocationClaims(id, signer.author, t)),
      ),
    );
  }

  probe(q: { readonly holds: string }): Promise<boolean>;
  probe(q: {
    readonly retention: readonly string[];
  }): Promise<{ held: Set<string>; unasked: Set<string> }>;
  probe(q: "any"): Promise<boolean>;
  probe(q: "inventory"): Promise<Set<string> | string>;
  probe(q: ProbeQuestion): Promise<unknown> {
    if (q === "any") return storeHoldsAny(this.backend);
    if (q === "inventory") return storeInventory(this.backend);
    if ("holds" in q) return this.backend.holds(q.holds);
    return probePhysicalRetention(this.backend, q.retention);
  }

  async exportManifestRows(rows: readonly ManifestExport[]): Promise<void> {
    const signer = this.signer;
    if (signer === undefined) {
      throw new Error("exportManifestRows: this container has no governing key");
    }
    await this.federate(
      rows.map((row) =>
        signer.sign(
          withStamp(this.stamp(signer.author), (t) => manifestExportClaims(row, signer.author, t)),
        ),
      ),
    );
  }

  arrivalStamps(channel: string, from: string, chunks: readonly (readonly string[])[]): Delta[] {
    const signer = this.signer;
    if (signer === undefined) throw new Error("arrivalStamps: this container has no governing key");
    const at = this.stamp(signer.author);
    return chunks.map((arrived) =>
      signer.sign(
        withStamp(at, (t) => arrivalClaims({ channel, from, arrived }, signer.author, t)),
      ),
    );
  }

  async adoptLaw(
    version: ModuleVersion,
    alias: string,
    opts: AdoptLawOptions = {},
  ): Promise<AdoptionOutcome> {
    return adoptLawImpl(this, version, alias, opts);
  }

  async blessAll(version: ModuleVersion, opts: BlessAllOptions = {}): Promise<BlessAllReport> {
    return blessAllImpl(this, version, opts);
  }

  lawFrom(versions: readonly ModuleVersion[]): LawFromRow[] {
    return lawFromImpl(this, versions);
  }

  lawAdoptions(): LawAdoption[] {
    if (this.operatorAuthor === undefined) return [];
    return readLawAdoptions(this.reactor, this.validityNow(), this.operatorAuthor);
  }

  adoptionHold: (() => Promise<void>) | undefined = undefined;

  livingNames: Promise<void> = Promise.resolve();

  async eraseReplica(erasure: Delta, id: string, seen: Set<Peer> = new Set()): Promise<void> {
    return eraseReplicaImpl(this, erasure, id, seen);
  }

  reseat(): Promise<void> {
    if (this.reseating !== undefined) return this.reseating;
    this.needsJournalRefresh = true;
    const run = this.reseatGround();
    this.reseating = run;
    void run.then(
      () => {
        this.reseating = undefined;
        this.needsJournalRefresh = false;
      },
      () => {
        this.reseating = undefined;
      },
    );
    return run;
  }

  private async reseatGround(): Promise<void> {
    let reactor = new Reactor();
    const readAll = async (): Promise<Delta[]> => {
      if (this.peer === undefined) return this.backend.deltasSince(new Set());
      return rereadHostPeer(this.peer);
    };
    let revision = await this.backend.revision?.();
    let rows = await readAll();
    for (const d of rows) {
      if (reactor.ingest(d).status === "rejected") {
        throw new Error(`reseat: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    for (const channel of [...this.channels]) await channel.return();
    this.sinks.clear();
    this.lazyMats.clear();
    this.publicLazyMats.clear();
    this.resolverMemo.clear();
    for (let round = 0; ; round += 1) {
      const known = new Set(rows.map((d) => d.id));
      revision = await this.backend.revision?.();
      rows = await readAll();
      if (rows.length === known.size && rows.every((d) => known.has(d.id))) break;
      if (round >= 10) {
        throw new Error("reseat: the store will not quiesce — its admitted set keeps changing");
      }
      reactor = new Reactor();
      for (const d of rows) {
        if (reactor.ingest(d).status === "rejected") {
          throw new Error(`reseat: the store handed back an unacceptable delta ${d.id}`);
        }
      }
    }
    seatDeclarations(reactor, this.declarations);
    continueGroundRevision(this._reactor, reactor);
    this._reactor = reactor;
    this.durableRevision = revision;
    this.ingestVia = (d) => this.reactor.ingest(d);
    this.ingestAllVia = (ds) => ingestTogether(this.reactor, ds);
    this.attachPersistence(reactor);
    if (this.registered.length > 0) rebindImpl(this, this.registered);
    this.advanceToNow();
    this.replayRegistrations();
    this.armValidityTimer();
    this.notifyUserDependents();
  }

  admitFor(): (d: Delta) => boolean {
    return admitForImpl(this);
  }

  offeredDeltas(): Delta[] {
    return offeredDeltasImpl(this);
  }

  select(term: unknown, now?: number): Delta[] {
    return selectImpl(this, term, now);
  }

  watch(term: unknown): AsyncGenerator<Delta[], void, unknown> {
    return watchImpl(this, term);
  }

  freeze(term: unknown): ModuleVersion {
    const members = withNegationClosure(this, selectImpl(this, term));
    const hidden = erasedFromReading(this.reactor, this.operatorAuthor);
    const erased = members.find((d) => hidden.has(d.id));
    if (erased !== undefined) {
      throw new Error(
        `freeze refused: the Term selects ${erased.id}, which is erased or held down by an erased ` +
          `negation. A version must never commit to erased content. Narrow the Term to exclude it.`,
      );
    }
    return freezeMembers(members);
  }

  async federate(
    deltas: Iterable<Delta>,
    opts: { admit?: (d: Delta) => boolean; ids?: boolean; admittedIds?: boolean } = {},
  ): Promise<FederationReport> {
    return federateImpl(this, deltas, opts);
  }

  get operator(): string | undefined {
    return this.operatorAuthor;
  }

  materializationFor(name: string): string {
    const hit = this.registered.find((r) => bindableNames(r).includes(name));
    return hit !== undefined ? this.matName(hit.hyperschema.name) : name;
  }

  materializationNames(): string[] {
    return [...new Set(this.registered.flatMap(bindableNames))].sort();
  }

  now(): number {
    return Date.now();
  }

  validityNow(now: number = this.now()): number {
    return now;
  }

  private validityTimer: ReturnType<typeof setTimeout> | undefined;

  advanceToNow(): void {
    this.reactor.advanceTime(this.validityNow());
    this.armValidityTimer();
  }

  armValidityTimer(): void {
    if (this.validityTimer !== undefined) clearTimeout(this.validityTimer);
    this.validityTimer = undefined;
    const now = this.validityNow();
    const next = [this.reactor.nextValidityBoundary(now), this.registrationBoundary]
      .filter((t): t is number => t !== undefined)
      .reduce((a, b) => Math.min(a, b), Infinity);
    if (next === Infinity) return;
    const delay = Math.min(Math.max(0, next - now), MAX_TIMER_DELAY);
    this.validityTimer = setTimeout(() => this.onValidityBoundary(), delay);
    this.validityTimer.unref?.();
  }

  registrationBoundary: number | undefined;

  private onValidityBoundary(): void {
    const crossed =
      this.registrationBoundary !== undefined && this.validityNow() >= this.registrationBoundary;
    this.reactor.advanceTime(this.validityNow());
    if (crossed) this.replayRegistrations();
    this.armValidityTimer();
    for (const pulse of [...this.userPulses]) pulse();
    this.notifyUserDependents();
  }

  private readonly authorClocks = new Map<string, number>();

  noteRegistrationTime(d: Delta): void {
    const now = this.validityNow();
    const note = (x: Delta): void => {
      for (const t of [x.claims.validFrom, x.claims.validUntil]) {
        if (t === undefined || t <= now) continue;
        if (this.registrationBoundary === undefined || t < this.registrationBoundary) {
          this.registrationBoundary = t;
        }
      }
    };
    const down = new Set<string>();
    const walkDown = (x: Delta): void => {
      if (down.has(x.id)) return;
      down.add(x.id);
      note(x);
      for (const id of this.reactor.negationsOf(x.id)) {
        const n = this.reactor.get(id);
        if (n !== undefined) walkDown(n);
      }
    };
    const up = new Set<string>();
    const walkUp = (x: Delta): void => {
      if (up.has(x.id)) return;
      up.add(x.id);
      for (const p of x.claims.pointers) {
        if (p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION) walkDown(x);
        if (p.role === "negates" && p.target.kind === "delta") {
          const target = this.reactor.get(p.target.deltaRef.delta);
          if (target !== undefined) walkUp(target);
        }
      }
    };
    walkUp(d);
  }

  noteAuthorTime(d: Delta): void {
    this.raiseAuthorClock(d.claims.author, d.claims.timestamp);
  }

  private raiseAuthorClock(author: string, t: number): void {
    if (t <= Number.MAX_SAFE_INTEGER && t > (this.authorClocks.get(author) ?? -Infinity)) {
      this.authorClocks.set(author, t);
    }
  }

  private seedAuthorClocks(deltas: Iterable<Delta>): void {
    for (const d of deltas) this.noteAuthorTime(d);
  }

  readUsersFrom(host: UserGround): void {
    if (this.userHost === host) return;
    this.releaseUsers?.();
    this.releaseUsers = undefined;
    this.userHost = host;
    if (host !== this) this.releaseUsers = host.watchUsers(() => this.onUsersMoved());
    this.onUsersMoved();
  }

  watchUsers(onMoved: () => void): () => void {
    this.userWatchers.add(onMoved);
    return () => {
      this.userWatchers.delete(onMoved);
    };
  }

  private readonly userWatchers = new Set<() => void>();
  private releaseUsers: (() => void) | undefined = undefined;

  usersEpoch = 0;

  notifyUserDependents(): void {
    for (const onMoved of this.userWatchers) onMoved();
  }

  readonly userPulses = new Set<() => void>();

  private onUsersMoved(): void {
    for (const pulse of [...this.userPulses]) pulse();
    if (this.governedRegistered !== this.registered) {
      this.governedRegistered = this.registered;
      this.governsUsers = this.registered.some((r) =>
        needsLowering(r.hyperschema.body, this.registry),
      );
    }
    if (!this.governsUsers) return;
    this.usersEpoch += 1;
    this.reactor.refreshAll(this.validityNow());
  }
  private governedRegistered: Bound[] | undefined;
  private governsUsers = false;

  private declareUsers(reactor: Reactor): void {
    declareReadHidden(reactor, (now) => readClosedIds(this, now));
    declareUserGround(reactor, () => {
      const host = this.userHost ?? this;
      return {
        reactor: host.reactor,
        erased: () => erasedFromReading(host.reactor, host.operatorAuthor),
        ...(host.operatorAuthor === undefined ? {} : { governor: host.operatorAuthor }),
      };
    });
  }

  userGroundHost(): UserGround {
    return this.userHost ?? this;
  }

  honorDelegationsAt(scope: string): void {
    declarePrincipalScope(this._reactor, scope);
  }

  stamp(author: string | undefined = this.operatorAuthor): Stamp {
    return stampOn(this, author, this.now());
  }

  nextTimestamp(author: string | undefined = this.operatorAuthor): number {
    this.lastIssued = Math.max(this.now(), this.lastIssued + 1);
    if (author === undefined) return this.lastIssued;
    const floor = this.authorClocks.get(author) ?? -Infinity;
    const timestamp =
      floor < Number.MAX_SAFE_INTEGER ? Math.max(this.lastIssued, floor + 1) : this.lastIssued;
    this.raiseAuthorClock(author, timestamp);
    return timestamp;
  }
  private lastIssued = 0;

  def(name: string, binding?: ConnectionBinding): Bound {
    const rows = binding === undefined ? this.registered : this.boundSurface(binding).registered;
    const def = byLens(rows, name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    return def;
  }

  boundSurface(binding: ConnectionBinding): {
    readonly registered: readonly Bound[];
    readonly registry: SchemaRegistry;
    readonly refused: ReadonlyMap<string, string>;
    readonly schema: GraphQLSchema;
  } {
    const held = this.boundCache.get(binding.container);
    const fold = boundBindingsImpl(this, binding.container, held);
    if (held !== undefined && fold === held.fold) return { ...held.fold, schema: held.schema };
    const schema = buildGqlSchema(fold.registered, this.gqlHooks());
    this.boundCache.set(binding.container, { key: fold.key, fold, schema });
    return { ...fold, schema };
  }

  matName(name: string): string {
    return matNameImpl(this, name);
  }

  lazyMatName(name: string, entity: string): string {
    return lazyMatNameImpl(this, name, entity);
  }

  matFor(name: string, entity: string, door: "full" | "public" = "full"): string {
    return matForImpl(this, name, entity, door);
  }

  gather(
    name: string,
    entity: string,
    asOf?: number,
    now?: number,
    binding?: ConnectionBinding,
  ): HView {
    return gatherImpl(this, name, entity, now ?? this.now(), asOf, binding);
  }

  gatherForRetraction(name: string, entity: string, binding?: ConnectionBinding): HView {
    return gatherForRetractionImpl(this, name, entity, binding);
  }

  resolvedNode(
    name: string,
    entity: string,
    asOf?: number,
    now?: number,
    binding?: ConnectionBinding,
  ): ResolvedNode {
    return resolvedNodeImpl(this, name, entity, now ?? this.now(), asOf, binding);
  }

  readNode(
    name: string,
    entity: string,
    asOf?: number,
    now?: number,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return readNodeImpl(this, name, entity, now ?? this.now(), asOf, binding);
  }

  async mutateEntity(
    name: string,
    entity: string,
    props: Record<string, Primitive>,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return mutateEntityImpl(this, name, entity, props, actorSeed, binding);
  }

  private clearEntity(
    name: string,
    entity: string,
    fields: readonly string[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return clearEntityImpl(this, name, entity, fields, actorSeed, binding);
  }

  private removeEntity(
    name: string,
    entity: string,
    field: string,
    values: readonly Primitive[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return removeEntityImpl(this, name, entity, field, values, actorSeed, binding);
  }

  private async linkEntity(
    name: string,
    entity: string,
    field: string,
    target: string,
    context: string | undefined,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return linkEntityImpl(this, name, entity, field, target, context, actorSeed, binding);
  }

  private severEntity(
    name: string,
    entity: string,
    field: string,
    targets: readonly string[] | undefined,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return severEntityImpl(this, name, entity, field, targets, actorSeed, binding);
  }

  private linkRefEntity(
    name: string,
    entity: string,
    prop: string,
    target: string,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return linkRefEntityImpl(this, name, entity, prop, target, actorSeed, binding);
  }

  private unlinkRefEntity(
    name: string,
    entity: string,
    prop: string,
    target: string,
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<ResolvedNode> {
    return unlinkRefEntityImpl(this, name, entity, prop, target, actorSeed, binding);
  }

  private async claimEntity(
    pointers: readonly ClaimPointerSpec[],
    actorSeed?: string,
    binding?: ConnectionBinding,
  ): Promise<{ delta: string }> {
    return claimEntityImpl(this, pointers, actorSeed, binding);
  }

  private watchEntity(
    name: string,
    entity: string,
    door: "full" | "public" = "full",
    now?: number,
  ): AsyncGenerator<PatchNode, void, unknown> {
    return watchEntityImpl(this, name, entity, door, now === undefined ? undefined : () => now);
  }

  private schemaOrThrow(): GraphQLSchema {
    if (this.gql === undefined) {
      throw new Error(this.emptySurfaceMessage());
    }
    return this.gql;
  }

  private emptySurfaceMessage(): string {
    let inert = "";
    if (readRegistrations(this.reactor, this.validityNow(), undefined).length > 0) {
      inert =
        this.operatorAuthor !== undefined
          ? " the store holds registrations that do not bind (foreign law is inert on a governed " +
            "store; an own definition that does not resolve binds nothing either);"
          : " the store holds registrations that do not bind (they conflict or one does not resolve);";
    }
    return (
      "nothing is registered: the gateway has no queryable surface yet —" +
      `${inert} \`loam register <file> --home ...\` or POST /:mount/register grows one`
    );
  }

  private publicCache: { key: string; schema: GraphQLSchema } | undefined;
  private publicOpen:
    | {
        readonly open: ReadonlySet<string>;
        readonly revision: number;
        readonly from: number;
        readonly until: number;
      }
    | undefined;

  private openNames(): ReadonlySet<string> {
    if (this.channelPool === true) return EMPTY_PUBLIC;
    const now = this.validityNow();
    const revision = this.revision;
    if (
      this.publicOpen === undefined ||
      this.publicOpen.revision !== revision ||
      now < this.publicOpen.from ||
      now >= this.publicOpen.until
    ) {
      this.publicOpen = {
        open: readPublicSchemas(this.reactor, now, this.lawAuthors("public")),
        revision,
        from: now,
        until: this.reactor.nextValidityBoundary(now) ?? Infinity,
      };
    }
    return this.publicOpen.open;
  }
  private publicSurface(): GraphQLSchema | undefined {
    const open = this.openNames();
    if (open.size === 0) return undefined;
    const defs = this.registered.filter((r) => open.has(lensOf(r)));
    if (defs.length === 0) return undefined;
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

  hasPublicSurface(): boolean {
    if (this.publicSurface() !== undefined) return true;
    for (const entry of this.openNames()) if (entry.includes("@")) return true;
    return false;
  }

  async queryPublic(source: string, variables?: Record<string, unknown>): Promise<QueryResult> {
    await this.prepareRead();
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

  async subscribePublic(
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    await this.prepareRead();
    return this.subscribeVia(this.publicSurfaceOrThrow(), source, variables);
  }

  refresh(): Promise<void> {
    return refreshImpl(this);
  }

  async query(
    source: string,
    variables?: Record<string, unknown>,
    context?: RequestContext,
  ): Promise<QueryResult> {
    await this.prepareRead();
    const result = await graphql({
      schema:
        context?.binding === undefined
          ? this.schemaOrThrow()
          : this.boundSurface(context.binding).schema,
      source,
      contextValue: context,
      ...(variables === undefined ? {} : { variableValues: variables }),
    });
    return {
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.errors === undefined ? {} : { errors: result.errors.map((e) => e.message) }),
    };
  }

  async subscribe(
    source: string,
    variables?: Record<string, unknown>,
    context?: RequestContext,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    if (context?.binding !== undefined) {
      throw new Error(
        `a bound connection cannot subscribe: a live stream resolves over this store's ` +
          `materialization, which does not see the scope of ${context.binding.container} — ` +
          `poll the query door instead`,
      );
    }
    await this.prepareRead();
    return this.subscribeVia(this.schemaOrThrow(), source, variables);
  }

  private async subscribeVia(
    schema: GraphQLSchema,
    source: string,
    variables?: Record<string, unknown>,
  ): Promise<AsyncGenerator<Record<string, unknown>>> {
    return subscribeViaImpl(schema, source, variables);
  }

  async flush(): Promise<void> {
    await this.writes;
    if (this.writeFailure !== undefined) {
      throw new Error(`write-through failed: ${this.writeFailure.message}`);
    }
  }

  async close(): Promise<void> {
    this.releaseUsers?.();
    this.releaseUsers = undefined;
    this.userWatchers.clear();
    if (this.validityTimer !== undefined) clearTimeout(this.validityTimer);
    this.validityTimer = undefined;
    for (const channel of [...this.channels]) await channel.return();
    await this.store.closeChildren(this);
    this.federationChannels.clear();
    try {
      await this.flush();
    } finally {
      await this.backend.close();
    }
  }
}
