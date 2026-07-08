# Loam

**The substrate where the rhizome becomes the tree.**

Loam is a general database: a **reflective, homoiconic, content-addressed, signed, temporal,
CRDT graph-substrate** whose queryable state is the memoized present tense of an ongoing
distributed computation. A database is a fold over an event log with a queryable accumulator;
Loam puts the reducers — schemas _and_ functions — into the log (everything above the raw delta
stream is itself data in the same store), and makes the log a CRDT (the fold is distributed and
mergeable). So the system can evolve its own types and behavior by writing claims, and every step
of that evolution is a signed, replayable delta.

It is the general layer beneath [Chorus](https://github.com/bombadil-labs/chorus) — Chorus is one
_application_ of Loam (a bundle of schemas + a skill). Loam does not know what a "belief" is.

## Status

**Greenfield, in design.** This repo currently holds the design papers; the implementation is
being built from them. Start with the spec.

- **[claude_notes/DATABASE-SPEC.md](claude_notes/DATABASE-SPEC.md)** — the full design specification
  (the _what_): object model, resolution, the gateway, self-hosting/bootstrap, the function
  substrate, object-capability, persistence/federation, invariants, sequencing, glossary.
- **[claude_notes/DECOMPOSITION.md](claude_notes/DECOMPOSITION.md)** — the brief (the _why_ + the
  assignment + open decisions + the spike-first sequencing).

## The three layers

1. **[rhizomatic](https://github.com/bombadil-labs/rhizomatic)** (`@bombadil/rhizomatic`, frozen /
   normative) — the format: signed content-addressed deltas, the delta-set CRDT (merge = union), the
   evaluator + resolution policies, the reactor, `Peer`/federation.
2. **Loam** (this repo) — the typed, self-hosting, reactive, capability-secured layer: hyperschemas
   → GraphQL, resolution-policy-as-schema, the self-hosting schema-schema, the function substrate,
   accounts/capabilities, federation.
3. **applications** (e.g. [Chorus](https://github.com/bombadil-labs/chorus)) — a genesis-extending
   bootstrap delta-set + client ergonomics. No application ships its own server; apps and runners
   are peer clients of Loam, coordinating only through the store.

## Name

**Loam** (internal codename: Ithaca). The soil in which both the root network
([rhizomatic](https://github.com/bombadil-labs/rhizomatic)) and the arborescent structures
(hyperviews, views) grow, and through which the one becomes the other. Related to
[Chorus](https://github.com/bombadil-labs/chorus) as the ground is related to what grows in it.
