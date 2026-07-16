## 2026-07-09 — Step 9: Federation (PR #11)

Two instances meet and merge over the authed HTTP surface: `GET /:mount/federate` offers a
store's published deltas as wire JSON; `pullFrom(local, peerUrl, token)` fetches, verifies, and
merges them. 148/148, the whole federation suite over real listening servers.

The load-bearing decision, and the last piece of the authority model:

- **Federation is union at the substrate, NOT a governed mutation.** Capabilities gate who may
  *write* via GraphQL; a peer's deltas cross by VERIFICATION alone (content address + a real
  signature + an optional admission predicate), through `gateway.federate` — which deliberately
  **skips `authorize` by design**. If federation ran writes through the capability gate, B would reject
  every delta whose author lacks a grant on B's tenants, and no two independently-governed
  stores could ever merge. Instead: whether a peer's facts shape a local view is a read-time
  TRUST choice (a policy's `byAuthorRank`), never a write denial — "no authority deciding whose
  truth survives" (SPEC §8). This is the model rhizomatic's `Peer` already embodies; Loam's
  contribution is stating the boundary between the write-gate and the merge-gate cleanly and
  proving both halves.
- **The published lens is what a store offers, not what a peer must trust.** `offeredLens` (a
  term) restricts what crosses the wire; the test confirms a heights-only lens keeps a store's
  tags home. Trust stays the puller's, via `admit`.
- Union proved end to end: a delta on A resolves on B after one pull; both-ways sync converges
  to the same `_hex`; a re-pull accepts nothing (idempotent); a delta whose id does not match its
  claims is refused at the boundary while honest deltas beside it land. `fromWire` recomputes
  every id and refuses a mismatch — a counterfeit cannot survive the crossing whatever id a peer
  stamps on it.

Review resolution (7 findings): the agent confirmed the security model is sound but the
load-bearing tests were missing, plus a real confidentiality default. Fixed:

- **Foreign law's inertness is now PROVEN, not just argued.** The single most important test of
  the step: a peer signs a grant naming itself admin of another store's tenant and federates it
  in — it verifies, so union admits it (accepted: 1), but that author still cannot write, because
  the grant roots in nobody the receiving store's operator blessed. The unsigned-refusal and
  id-mismatch branches are exercised too (the old test only altered the id, never the signature
  path).
- **The raw offer is operator-gated.** `/federate` handed the whole substrate — grants,
  memberships, registrations — to any authenticated token, past the GraphQL read gateway. It
  now requires an operator token (403 otherwise): federation is an operator-level trust
  relationship, not a scoped reader's licence.
- **The pull is bounded.** `pullFrom` read the peer's body with no cap (an unbounded response
  could exhaust the puller's memory) and threw a raw `SyntaxError` on non-JSON; now a 64 MiB cap
  and a clean error.
- **A mis-shaped `offeredLens` fails fast** at `Gateway.open` (trial-eval → "must select a delta
  set"), not as a 500 when a peer first pulls in production.
- **The shared-seed invariant is documented** at the `federate` seam: the whole trust boundary
  rests on distinct operator seeds across instances (two stores sharing one trust each other's
  constitution completely). Nothing can enforce cross-instance uniqueness in code; it is stated
  plainly instead.

**The plan's build steps are complete** (0–9 all merged). Next: the landing — strip the plan
section from CLAUDE.md, rewrite README as real documentation, and ready the npm ship.
