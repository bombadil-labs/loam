# claude_notes/ — the working papers

The root of this repo holds exactly [README.md](../README.md) (the product) and
[CLAUDE.md](../CLAUDE.md) (the working agreement). Everything else lives here.

## The design papers (seeded from the Chorus conversation, 2026-07-07)

- [RHIZOMATIC-SURFACE.md](RHIZOMATIC-SURFACE.md) — **read-first reality check.** A type-level
  map of what rhizomatic already provides (most of the core) vs. what Loam genuinely adds
  (GraphQL, persistence, accounts, gateway, deploy). The spec below is pending reconciliation
  with it.

- [DATABASE-SPEC.md](DATABASE-SPEC.md) — **the specification** (the _what_): the object model
  (Delta / Domain node / Hyperschema / Hyperview / Selector / Schema / View=Snapshot|Subscription),
  resolution, the gateway, self-hosting + the genesis bootstrap, the function substrate (core /
  runner / apps), object-capability & accounts, persistence / deployment / federation, invariants,
  the spike + sequencing, and a glossary. **Start here.**
- [DECOMPOSITION.md](DECOMPOSITION.md) — **the brief** (the _why_ + the assignment): the three-layer
  decomposition, the decided architecture, constraints, the spike-first sequencing, and the decisions
  still pending Myk.

## Where the fuller lineage lives

These papers were distilled from a long design conversation in the Chorus repo. The deeper design
history — federation, the belief-app arc, the origin story — lives in
[bombadil-labs/chorus/claude_notes/](https://github.com/bombadil-labs/chorus/tree/main/claude_notes)
(CONSTELLATION.md, EPISTEME.md, JOURNAL.md, …). The format Loam builds on is
[bombadil-labs/rhizomatic](https://github.com/bombadil-labs/rhizomatic).

As the build proceeds, this directory grows its own record — design notes as decisions land, and a
journal if the work warrants one. Keep the root to two documents; index new notes here.
