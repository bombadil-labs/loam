## 1. The three layers

1. **[rhizomatic](https://github.com/bombadil-labs/rhizomatic)** (`@bombadil/rhizomatic`, **frozen /
   normative**) — the format _and_ the typed reactive core (see §2). Never changed from here; a
   genuine substrate need is a PR there (conformance vectors + version bump) and a conversation with
   Myk.
2. **Loam** (this repo) — the wrapper (see §3): GraphQL interface, durable/pluggable persistence,
   accounts & capabilities, the gateway transport, deployment, and the genesis assembly.
3. **applications** (e.g. Chorus) — a genesis-extending bootstrap delta-set + client ergonomics. No
   app ships its own server. Apps and runners are **peer clients** of Loam, coordinating only through
   the store (stigmergy).

**Provenance.** Foundational framing — no single landing PR; the three-layer split is the invariant
every later section obeys, realized across the whole build (steps 0–9, PRs [#1](https://github.com/bombadil-labs/loam/pull/1)–[#10](https://github.com/bombadil-labs/loam/pull/10)). Full narrative in the [Journal](JOURNAL.md).
