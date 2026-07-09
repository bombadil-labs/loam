# Current work — Step 9: Federation

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**The model (SPEC §8, rhizomatic §6):** merge is union; federation is SELECTION and TRUST, not
conscription. The load-bearing distinction — **federated deltas ingest via a distinct path, not
through the capability write-gate.** Capabilities govern who may WRITE via the GraphQL mutation
surface; federation is union at the substrate, admitting any delta that VERIFIES. Whether a
peer's deltas shape a local view is a read-time TRUST choice (`byAuthorRank`), never a write
denial — "no authority deciding whose truth survives."

**The pieces:**

- **`gateway.federate(deltas, { admit? })`** — verify each delta (content address + signature),
  apply an admission predicate (default: verified), then ingest + write-through. No capability
  authorization: this is peer sync, not a governed mutation. Idempotent (content-addressed,
  union).
- **A published lens** — `Gateway` option `offeredLens?: Term`; `gateway.offeredDeltas()` returns
  the surviving set the lens selects (default: all). A store offers only what its lens permits.
- **Transport** — `GET /:mount/federate` (token-gated) returns the offered deltas as wire JSON
  (claims via the JSON profile + id + sig).
- **`pullFrom(localGateway, peerUrl, peerToken)`** — fetch a peer's offer, `federate` it locally,
  return a report (offered / accepted / rejected). The "subscribe to instance X's published
  lens" declaration is this pull, repeatable.

**Success criteria (from CLAUDE.md):** two instances federate — a delta on A resolves on B;
union-merge holds (pull both ways, idempotent, order-blind, no conflict); a lens restricts what
crosses; a forged/unsigned delta is refused at the boundary; `npm run check` green.

**Sub-tasks:**

- [ ] `test/federation/federate.test.ts` — tests first: A→B a delta resolves; both-ways union;
      idempotent re-pull; lens restricts; forged refused; over real HTTP servers
- [ ] `src/federation/wire.ts` — delta wire format (toWire/fromWire, verify on the way in)
- [ ] `src/gateway/gateway.ts` — `federate`, `offeredDeltas`, `offeredLens` option
- [ ] `src/server/http.ts` — the `/federate` offer endpoint
- [ ] `src/federation/pull.ts` — `pullFrom`
- [ ] Gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
