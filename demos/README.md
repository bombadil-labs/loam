# Demos — Loam, running

Two living demonstrations, two audiences:

- **[`village/`](village/README.md)** — the internal proving ground: five federated stores, a
  cast of villagers, an adversary, a browser dashboard that is secretly a village game. Every
  behavior Loam claims is exercised here end-to-end over real HTTP, and every PR that adds a
  behavior adds an act (the ledger in its README maps each act to the machinery it proves).
  Start it with `node demos/village/phase0.mjs`, then `node demos/village/village.mjs`.
- **[`tutorial/`](tutorial/README.md)** — the public door: the interactive tutorial deployed at
  <https://bombadil-labs.github.io/loam/>. A stranger boots a REAL governed store in their
  browser and learns Loam by growing one — eleven lessons, every completion verified by a real
  read of their store, ending with the store walking out of the tab onto their machine. The
  whole arc runs headless in CI (`test/site/arc.test.ts`), so the tutorial can never rot ahead
  of the library it teaches.

**Evaluating this repo?** These are the fastest honest look at what Loam does: the tutorial if
you want to touch it, the village ledger if you want to read what has been proven. The design
is [SPEC.md](../SPEC.md); the manual is the root [README.md](../README.md); the working record
is [JOURNAL.md](../JOURNAL.md).
