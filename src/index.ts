// Loam grows from here. The substrate is @bombadil/rhizomatic (frozen, normative); what this
// package exports is the wrapper planted above it, step by step.

export { Gateway, type AppendReceipt, type QueryResult } from "./gateway/gateway.js";
export { buildGqlSchema, type Registered } from "./gateway/gql.js";
export type { StoreBackend } from "./store/backend.js";
export { canonicalDelta } from "./store/canon.js";
export { MemoryBackend } from "./store/memory.js";
export { SqliteBackend } from "./store/sqlite.js";
