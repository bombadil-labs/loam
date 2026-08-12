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
export { pullFrom, type PullOptions, type PullReport } from "./federation/pull.js";
export { exportOffer, parseOffer } from "./federation/offer.js";
export { toWire, fromWire, type WireDelta } from "./federation/wire.js";
// The health DOOR is `Gateway.health()` (SPEC §11, T70); `StoreHealth` and its component shapes
// (`ErasureHealth` here, `SlateHealth` / `ForgivenHealth` in the slate block below) are what a
// caller needs to READ what it answers. The bodies computing them (`healthImpl`, `slateHealth`,
// `forgivenHealth`) take a `Gateway` seam and stay out.
export {
  CTX_ERASE,
  ERASE_ENTITY,
  eraseClaims,
  eraseDefect,
  isTombstone,
  readTombstones,
  sealCommitment,
  tombstonesIn,
  type ErasureHealth,
  type StoreHealth,
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
// The slate DOORS are `Gateway.cut` / `.slates` / `.receipt` / `.graveyards` (SPEC §29); what
// follows is what a caller needs to DESCRIBE, SIGN, and READ what those doors answer — the
// vocabulary and claim builders that stand a slate, and every shape the reports are made of.
// The `*Impl` bodies and the closure wiring (`egressWithheld`, `readClosedIds`, `slateRefusal`,
// `slateHealth`, …) take a `Gateway` because ingest, reads, and erase share one implementation —
// publishing any of them would freeze a seam as API, so none appears here however public the
// compiler thinks it is.
export {
  CTX_GRAVEYARD,
  CTX_SLATE,
  RECEIPT_FIELDS,
  RECOMMENDED_CLOSES,
  SLATE_CONTEXTS,
  SLATE_ENTITY,
  enforcedBy,
  frozenMembershipTerm,
  graveyardClaims,
  graveyardCompleteness,
  isGraveyard,
  isSlateRecord,
  readGraveyards,
  readSlates,
  slateClaims,
  slateDefect,
  slatePointer,
  type ByteVerdict,
  type CompletenessCheck,
  type CutMemberReport,
  type CutReport,
  type Duplicate,
  type ForgivenHealth,
  type GraveyardRecord,
  type GraveyardSpec,
  type Receipt,
  type ReceiptMember,
  type Slate,
  type SlateClosure,
  type SlateHealth,
  type SlateReport,
  type SlateSpec,
  type TierVerdict,
} from "./gateway/slate.js";
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
  LISTING_DEFAULT_LIMIT,
  LISTING_MAX_LIMIT,
  listingContainerName,
  listingContexts,
  listingMembershipJson,
  programMaskJson,
  type ListOptions,
} from "./gateway/listing.js";
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
export { SEALED_CHANNELS, realmProgram, sealRealm } from "./gateway/artifact-realm.js";
export {
  ARTIFACT_ENTITY,
  CTX_ARTIFACT,
  MAX_CONNECTOR_NAME,
  artifactClaims,
  artifactDefect,
  capabilityStatement,
  readArtifactRoutes,
  type ArtifactCoordinates,
  type PackArtifactOptions,
  type PackedArtifact,
} from "./gateway/artifact.js";
export { artifactPage, bundleFromPage, coordinatesFromPage } from "./gateway/artifact-page.js";
export {
  CTX_RENDERER,
  parseReadGesture,
  parseRendererInput,
  readRenderers,
  rendererBindingClaims,
  type RenderNode,
  type RendererBinding,
  readKey,
  type ReadCode,
  type ReadGesture,
  type ReadResult,
  type RendererSpec,
  type RenderFn,
} from "./gateway/renderers.js";
export {
  Runner,
  bindingDefinitionClaims,
  readBindingDefinitions,
  type BindingDropSinks,
  type MalformedBinding,
  type RunnerOptions,
  type SupersededBinding,
  type UnboundBinding,
} from "./runner/runner.js";
export { migrate, MIGRATIONS, type Migration, type MigrationReport } from "./migrate/migrate.js";
export { run, main, type IO, type RunOptions } from "./cli/cli.js";
export { archivePath, initHome, readConfig, storePath, type LoamConfig } from "./cli/config.js";
export { legalNameFor, queryFieldFor } from "./gateway/gql.js";
export { HOST_GLOBALS, scanHostReferences, type HostReference } from "./gateway/artifact-scan.js";
export { serve, type ServeOptions, type ServerHandle, type TokenIdentity } from "./server/http.js";
export type { StoreBackend } from "./store/backend.js";
export { canonicalDelta } from "./store/canon.js";
export { ArchiveBackend } from "./store/archive.js";
export { LocalStorageBackend, type StorageLike } from "./store/local-storage.js";
export { MemoryBackend } from "./store/memory.js";
export { MirrorBackend, type HealReport, type MirrorOptions } from "./store/mirror.js";
export { SqliteBackend } from "./store/sqlite.js";
