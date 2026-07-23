## 8. Persistence, deployment, federation

- **Store ⟂ app.** The running app (gateway + resolution) is separate from the store (persisted
  deltas). The store is a **pluggable persistence engine**; **N apps may front one store** (the
  CRDT's sweet spot). **One store = one isolated persistence unit** — never a shared `store_id`
  table.
- **Async.** A hosted/networked store is async ⇒ the read/resolution path is async (build it that way
  from the start). **Turso / libSQL** is the backend shaped right (it _is_ sqlite; hosted, replicated,
  multi-connection).
- **Passive or animate** — a deploy flag (§6), not an architecture.
- **Cloud turnkey** — fastest-secure-persistent path (a container + hosted persistence + a deploy
  button); replaces a tailscale-exposed box with a plain authed HTTPS endpoint. Implemented
  (step 8): a `Dockerfile` (node 24-slim, non-root, `loam serve --http`, store on a `/data`
  volume) and the `loam` CLI. **Hosted persistence is a driver, not an image change**: the
  `StoreBackend` seam (step 2) is satisfied by any async append/`deltasSince`/`purge`/`holds`/close
  (`holds` is §11's byte-presence verdict: does any tier still hold the id, seen at least as far
  as that driver's own `purge` reaches — landed by [#183](https://github.com/bombadil-labs/loam/pull/183)), so a libSQL
  driver (`@libsql/client` against a Turso URL) drops in beside `SqliteBackend` with no gateway,
  server, or CLI change — the same file format, hosted and replicated. (Not vendored here: it
  adds a dependency for a path that needs a live Turso account to exercise; the seam is the
  deliverable, the driver is a one-file addition when a deploy needs it.)
- **Federation** — rhizomatic's `Peer`/`syncBoth` over the authed HTTP surface + a "subscribe to
  instance X's published lens" declaration. `deltasSince` is one primitive at every scale.
- **Trust is data (decided 2026-07-09; LANDED as step 13).** What a store admits at federation is
  CONFIGURATION, and configuration — like everything else — is a derived view over deltas that
  are always updating. An operator-authored **trust policy** lives in the store under
  `loam.trust`: a mode (`open` — the aggregator welcoming the whole network; `roster` — named
  authors/peers; `closed`) plus optional shape requirements (deltas must satisfy a predicate —
  "conforms to the standard"). Every pull re-resolves the policy from the live store and builds
  its `admit` function from the RESULT — change the roster with a delta, and the next pulse
  behaves differently, no restart, no config file. (The same dynamic set reaching INSIDE
  eval-time negation masks awaits reflective predicates —
  [rhizomatic#2](https://github.com/bombadil-labs/rhizomatic/issues/2); admission is the
  application-layer half we can have today.)
- **Divergent dialects are normalized, never mutated (decided 2026-07-09; LANDED as step 14).**
  There are no global standards; a peer's deltas may express the same ideas in another shape.
  The wrong moves are rejection (union is union) and mutation (nothing is ever edited). The
  right move is MORE DELTAS: a **translation** is data — an operator-blessed spec pairing a
  recognizer (a predicate over foreign deltas) with an emit template (step 12's claim shapes,
  holes bound from the recognized delta's pointers) — executed by a generic translator running
  as a runner binding. Each emitted delta is canonical in the local dialect, signed by the
  translator identity, and CITES its source delta by id (a `translates` pointer — the §9
  provenance discipline). The foreign originals persist untouched beside their normalizations;
  the local standard views light up; a better translation later is just another pass over the
  same immortal sources.

**Provenance.** Landed — [#10](https://github.com/bombadil-labs/loam/pull/10) (CLI + deploy: the `loam` command, Dockerfile), [#11](https://github.com/bombadil-labs/loam/pull/11) (federation: union at the substrate), [#18](https://github.com/bombadil-labs/loam/pull/18) (trust is data), and [#19](https://github.com/bombadil-labs/loam/pull/19) (normalization/translation). Lives in `src/cli/` (`bin.ts`, `cli.ts`, `config.ts`), the `StoreBackend` seam (`src/store/backend.ts`, `src/store/sqlite.ts`), `src/federation/` (`offer.ts`, `pull.ts`, `wire.ts`, `translate.ts`), and `src/gateway/trust.ts` (`loam:trust`). Key decision: federation is union at the substrate, not a governed mutation — `gateway.federate` deliberately skips `authorize`, so whether a peer's facts shape a local view is a read-time trust choice, never a write denial.
