// Loam grows from here. The substrate is @bombadil/rhizomatic (frozen, normative); what this
// package exports is the wrapper planted above it, step by step.

export {
  TENANT,
  TENANT_POLICY,
  authorize,
  grantClaims,
  holdsGrant,
  membershipClaims,
  revocationClaims,
  tenantOf,
  type Verb,
} from "./gateway/accounts.js";
export {
  Gateway,
  type AppendReceipt,
  type GatewayOptions,
  type QueryResult,
  type RequestContext,
} from "./gateway/gateway.js";
export { buildGqlSchema, type Registered } from "./gateway/gql.js";
export type { StoreBackend } from "./store/backend.js";
export { canonicalDelta } from "./store/canon.js";
export { MemoryBackend } from "./store/memory.js";
export { SqliteBackend } from "./store/sqlite.js";
