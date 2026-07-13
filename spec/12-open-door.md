## 12. The open door — public reads & the browser client

The aggregator dream needs a store a stranger's browser can simply read.

- **Anonymous read as data.** An operator-signed claim (context `loam.public`) names which
  registered schemas a mount serves WITHOUT a token — query + subscribe only; every write path
  stays gated. Consistent with trust-is-data: the open door is a delta, revocable by one
  negation, live on the next request. Serve adds CORS for public mounts.
- **The browser client.** A subpath export (`@bombadil/loam/client`), zero node-only deps:
  keygen in the page, claims signed locally, writes through `POST /append` (non-custodial —
  the token authenticates transport; the delta's own verified author is the authority, which
  is why this endpoint already exists), GraphQL query + SSE subscribe wrappers. **Spike done
  (2026-07-10, GREEN):** rhizomatic's signing and hashing are pure JS (`@noble/curves`,
  `@noble/hashes`) — browser-safe, no rhizomatic change needed. The one care point: bundle the
  crypto primitives without pulling rhizomatic's `node:http` peer transport (import
  `signClaims`/`makeDelta`/`authorForSeed`, not `Peer`/`servePeer`).
- **The notary pattern (optional, cheap).** An operator claim carrying the store's frontier
  hash may be anchored to any external notary (a chain, a newspaper, RFC 3161). The chain
  becomes a timestamp service for the vault; the world stays in Loam.

**Provenance.** Landed — [#43](https://github.com/bombadil-labs/loam/pull/43) (public reads as data, and the browser client; SPEC §12 landed whole). Lives in `src/gateway/public.ts` (`loam:public` declarations, `publicDefect` refused at both the append and federation doors) and `src/client/index.ts` (`@bombadil/loam/client`, non-custodial: keygen in-page, local signing, fetch-based SSE). Key decision: the anonymous GraphQL schema carries no Mutation type at all, so a tokenless write is a validation impossibility rather than a policed string; per-door budgets (`maxPublicWatches`, `maxPublicStreams`) confine a stranger's resource cost to the stranger's door.
