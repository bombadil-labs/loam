// The browser peer (SPEC §15) — `@bombadil/loam/browser`. A complete Loam in the page:
// gateway, genesis, law, lenses, erasure, trust, federation — booting in a tab, persisting in
// localStorage, needing no server anywhere. Not a lite mode and not a fork: §8 made "where the
// deltas sleep" a driver's business, and this is the same Gateway on a different driver.
//
// A curated barrel, because the root barrel re-exports serve, sqlite, the archive, and the
// CLI — a browser entry must CHOOSE, not filter. Deliberately absent: `serve` (there is no
// port), `SqliteBackend` / `ArchiveBackend` / `MirrorBackend` (there is no fs), the CLI.
// What a browser store cannot be: a place the network calls — it can pull and push, never
// listen. A leaf or an aggregator, never a hub.

// The gateway, whole: boot / query / subscribe / append / federate / publishRegistration / erase.
export {
  Gateway,
  NothingPublic,
  type AppendReceipt,
  type FederationReport,
  type GatewayOptions,
  type QueryResult,
  type RequestContext,
} from "../gateway/gateway.js";

// Genesis: a store born governed and registered.
export {
  assembleGenesis,
  operatorMarkerClaims,
  CTX_OPERATOR,
  STORE_ENTITY,
  type Genesis,
  type GenesisSpec,
} from "../gateway/genesis.js";

// The drivers a page can stand on. localStorage persists; memory is the scratch tier.
export { LocalStorageBackend, type StorageLike } from "../store/local-storage.js";
export { MemoryBackend } from "../store/memory.js";
export type { StoreBackend } from "../store/backend.js";

// The claim constructors and readers — the law, writable and readable from the page.
export {
  grantClaims,
  holdsGrant,
  membershipClaims,
  revocationClaims,
  type Verb,
} from "../gateway/accounts.js";
export { publicClaims } from "../gateway/public.js";
export { eraseClaims, readTombstones } from "../gateway/erase.js";
export {
  readTrustPolicy,
  trustClaims,
  type TrustMode,
  type TrustPolicy,
} from "../gateway/trust.js";
export {
  readRegistrations,
  registrationClaims,
  type Registration,
} from "../gateway/registration.js";
export {
  translationClaims,
  translate,
  readTranslations,
  type Translation,
  type TranslateReport,
} from "../federation/translate.js";

// Federation: a tab can pull the network and push to any served door. And walk out entirely:
// exportOffer freezes the store as the exact bytes /federate would serve — `loam pull` on any
// machine lands it, and under the same operator seed the law binds on arrival (SPEC §15).
export { pullFrom, type PullOptions } from "../federation/pull.js";
export { exportOffer, parseOffer } from "../federation/offer.js";
export { toWire, fromWire, type WireDelta } from "../federation/wire.js";

// An animate tab is a deploy choice too (§6): bless a derived function, attach a Runner, and
// the tab grinds the ground into derived facts — durable after the runner detaches.
export {
  Runner,
  bindingDefinitionClaims,
  readBindingDefinitions,
  type RunnerOptions,
} from "../runner/runner.js";

// Key custody, page-side: mint where the seed will live; show the author around instead.
export { mintSeed } from "../client/index.js";

// The substrate primitives the surface above is spoken in — without these, a page could hold
// a schema but never say one: terms and policies parse from JSON, claims sign with the seed.
export {
  authorForSeed,
  makeNegationClaims,
  parsePolicy,
  parseTerm,
  signClaims,
  type Delta,
  type HyperSchema,
  type Policy,
  type Primitive,
  type Term,
} from "@bombadil/rhizomatic";
