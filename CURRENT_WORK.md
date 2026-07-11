# Current work — Sprint 2: continuity (SPEC §15 — the store walks out of the browser)

_Cycle stage: 1 (plan). Sprint 1 (the browser store, PR #51) is merged; its journal entry,
village act (phase17 — the tab, 5/5), and SPEC §15 surface addendum ride the aftermath PR._

**Success criteria.** An export is a frozen federation offer — `{ deltas: WireDelta[] }`,
byte-identical to a `GET /federate` body — and landing it is one command, one door, two
sources: `loam pull <url|file>`, through `Gateway.federate`. Same operator → the law BINDS on
arrival (the CLI store IS the browser store, operator marker identical by content address);
foreign operator → the deltas cross, the law stays inert. Tombstones bar the door; re-pulling
is idempotent.

## Checklist

- [ ] **Plan details** (this step):
  - `exportOffer(gateway)` in the browser barrel — the frozen offer, byte-compatible with the
    served `/federate` body (`{ deltas: WireDelta[] }` over `offeredDeltas()`).
  - `loam pull <url|file>` in `src/cli/cli.ts` — boot/close discipline from `cmdRegister`;
    a URL pulls via `pullFrom`; a file is a frozen offer landed via `Gateway.federate`.
  - `test/cli/pull.test.ts` — same-operator law-binds (registration answers, grants gate);
    foreign law-inert; tombstone refused; URL idempotency (second pull accepts 0); the
    round-trip `_hex` match (browser store → export → CLI store answers hash-for-hash).
- [ ] **Tests first** — write `test/cli/pull.test.ts` + an `exportOffer` byte-compat test.
- [ ] **Implement** — barrel + CLI verb + help text (the poetry is first-class).
- [ ] **Green** — `npm run check`, counts read.
- [ ] **PR → review (one careful agent) → resolve → merge.**
- [ ] **Journal.**
- [ ] **Village** — the take-home act completes: a tab's store exported and replanted as a
      served store, same operator, law binding on arrival (extends phase17 or a phase18).
- [ ] **Re-plan** — then sprint 3 (the tutorial, SPEC §16).

**Left off here:** sprint 2 opened at stage 1; aftermath PR for sprint 1 in flight.
