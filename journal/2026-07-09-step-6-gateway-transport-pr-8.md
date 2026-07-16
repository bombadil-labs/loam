## 2026-07-09 — Step 6: Gateway transport (PR #8)

One `node:http` server, no framework: bearer tokens map onto step 5's actor-per-request seam,
mounts are separate worlds, GraphQL rides POST, subscriptions ride SSE, and a minimal MCP
surface (initialize / tools/list / tools/call over JSON-RPC) speaks the same two verbs. 118/118,
every transport test against a real listening server with real `fetch`.

Learnings worth keeping:

- **The network surface is a security surface.** The single review found eight real issues on a
  step that looked done: a caller-controlled mount name resolving `Object.prototype`
  (`__proto__`, `constructor`) into a phantom gateway (now a `Map`); a mount-name oracle from
  checking the mount before the token (now auth-first — an unauthenticated caller can't tell a
  real mount from a missing one); unbounded `readBody` (now a 4 MiB cap → 413, bytes buffered so
  a chunk boundary can't split a multibyte char); unbounded SSE streams (now capped → 503); a
  `gateway.query` throw leaking through the outer catch as a 500 (now structured `{ errors }`
  everywhere, matching the MCP path); JSON-RPC notifications getting spurious replies (now
  silence, per spec) and batch requests cleanly refused.
- **Name the custody honestly.** A token maps to an actor *seed*, so the server holds signing
  keys — a real limitation, now stated in the module header. The non-custodial path is the
  CRDT's own (a client signs its own deltas; `Gateway.append` authorizes by verified author);
  a raw-append HTTP endpoint to expose it is noted for a later slice.
- **Denial tests must check state, not just the error string** — every "not permitted" case now
  re-queries to confirm the refused write did not land.
