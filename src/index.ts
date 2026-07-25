// Loam grows from here. The substrate is @bombadil/rhizomatic (frozen, normative); what this
// package exports is the wrapper planted above it, step by step.

export {
  TENANT,
  TENANT_POLICY,
  authorize,
  governedGatherBody,
  grantClaims,
  holdsGrant,
  membershipClaims,
  revocationClaims,
  tenantOf,
  tenantSchemaFor,
  type Verb,
} from "./gateway/accounts.js";
// The gather, named: the hyperschema body every plain entity wants, and the edge-field shape over
// it. Public because the alternative is what the tree did for a year — retype a five-level Term
// literal per schema, in two dialects, and hope the copies stay the same program.
export {
  entityGatherBody,
  entityGatherJson,
  expandedGatherBody,
  expandedGatherJson,
  type ExpandedGatherSpec,
  type GatherMask,
  type GatherSpec,
} from "./gateway/gather.js";
export {
  Gateway,
  NothingPublic,
  type AppendReceipt,
  type FederationReport,
  type GatewayOptions,
  type QueryResult,
  type RequestContext,
} from "./gateway/gateway.js";
export {
  CTX_PUBLIC,
  PUBLIC_ENTITY,
  publicClaims,
  publicDefect,
  readPublicSchemas,
} from "./gateway/public.js";
export { pullFrom, type PullOptions } from "./federation/pull.js";
export { exportOffer, parseOffer } from "./federation/offer.js";
export { toWire, fromWire, type WireDelta } from "./federation/wire.js";
export {
  CTX_ERASE,
  ERASE_ENTITY,
  eraseClaims,
  eraseDefect,
  isTombstone,
  readTombstones,
  sealCommitment,
  tombstonesIn,
} from "./gateway/erase.js";
export {
  CTX_TRUST,
  TRUST_ENTITY,
  readTrustPolicy,
  trustClaims,
  trustRosterPred,
  type TrustMode,
  type TrustPolicy,
} from "./gateway/trust.js";
// The DOOR and its vocabulary, never the plumbing behind it. `Gateway.openContainer` /
// `.containers` / `.adoptLaw` / `.blessAll` / `.lawFrom` are the reachable surface (SPEC §27); what
// follows is what a caller needs to DESCRIBE, SIGN, and READ what those doors answer. A `*Impl`
// body takes a `Gateway` because two modules in this package share one implementation, and
// `withLivingNames` writes an `@internal` seam field — publishing either would freeze a seam as
// API, so neither appears here however public the compiler thinks it is.
export {
  CONTAINER_CONTEXTS,
  CTX_CONTAINER,
  CTX_CONTAINER_DETACHED,
  CTX_CONTAINER_EXCLUDED,
  containerAdmission,
  containerClaims,
  containerDefect,
  detachClaims,
  exclusionClaims,
  readContainerTable,
  termClaims,
  type Container,
  type ContainerOptions,
  type ContainerPosture,
  type ContainerSpec,
  type ContainerTable,
  type ContainerTrust,
  type DetachRecord,
  type ResolvedContainer,
} from "./gateway/container.js";
export { freezeMembers, type ModuleVersion } from "./gateway/container-identity.js";
export {
  CTX_MANIFEST,
  MANIFEST_ENTITY,
  manifestExportClaims,
  readLawAdoptions,
  readManifest,
  type AdoptLawOptions,
  type AdoptionOutcome,
  type BlessAllOptions,
  type BlessAllReport,
  type LawAdoption,
  type LawFromRow,
  type ManifestExport,
  type ManifestRow,
} from "./gateway/adopt-law.js";
export {
  CTX_TRANSLATION,
  parseEmitTemplate,
  readTranslations,
  translate,
  translationClaims,
  type EmitPointerTemplate,
  type EmitTemplate,
  type TranslateReport,
  type Translation,
} from "./federation/translate.js";
export {
  assembleGenesis,
  operatorMarkerClaims,
  CTX_OPERATOR,
  STORE_ENTITY,
  type Genesis,
  type GenesisSpec,
} from "./gateway/genesis.js";
export { buildGqlSchema, graphqlSurface, type Registered } from "./gateway/gql.js";
export type {
  ClaimPointerSpec,
  PatchNode,
  ResolvedNode,
  SurfaceGenerator,
  SurfaceHooks,
  SurfaceProjection,
} from "./surface/surface.js";
export {
  lawfulNegated,
  lawfulSnapshot,
  parseClaimTemplates,
  parseRegistrationInput,
  parseResolvers,
  readRegistrations,
  registrationClaims,
  registrationDeltaClaims,
  schemaEntityFor,
  schemaLivingEntityFor,
  versionedSchemaEntityFor,
  versionedSchemaHash,
  type ClaimPointerTemplate,
  type ClaimTemplate,
  type ClaimTemplates,
  type Registration,
  type RegistrationDeltaClaims,
  type RegistrationInput,
  type ResolverOutputType,
  type ResolverRung,
  type ResolverSpec,
  type ResolverSpecs,
} from "./gateway/registration.js";
export {
  CTX_RENDERER,
  parseRendererInput,
  readRenderers,
  rendererBindingClaims,
  type RenderNode,
  type RendererBinding,
  type RendererSpec,
  type RenderFn,
} from "./gateway/renderers.js";
export {
  Runner,
  bindingDefinitionClaims,
  readBindingDefinitions,
  type RunnerOptions,
} from "./runner/runner.js";
export { migrate, MIGRATIONS, type Migration, type MigrationReport } from "./migrate/migrate.js";
export { run, main, type IO, type RunOptions } from "./cli/cli.js";
export { archivePath, initHome, readConfig, storePath, type LoamConfig } from "./cli/config.js";
export { serve, type ServeOptions, type ServerHandle, type TokenIdentity } from "./server/http.js";
export type { StoreBackend } from "./store/backend.js";
export { canonicalDelta } from "./store/canon.js";
export { ArchiveBackend } from "./store/archive.js";
export { LocalStorageBackend, type StorageLike } from "./store/local-storage.js";
export { MemoryBackend } from "./store/memory.js";
export { MirrorBackend, type HealReport, type MirrorOptions } from "./store/mirror.js";
export { SqliteBackend } from "./store/sqlite.js";
