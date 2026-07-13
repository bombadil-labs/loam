# Loam — Specification

**Loam is the substrate where the rhizome becomes the tree.** A general database: a reflective,
homoiconic, content-addressed, signed, temporal, CRDT graph-substrate whose queryable state is the
memoized present tense of an ongoing distributed computation. It is the general layer beneath
[Chorus](https://github.com/bombadil-labs/chorus) — Chorus is one _application_ of Loam (a bundle of
schemas + a skill). Loam does not know what a "belief" is.

Loam is built **on** [rhizomatic](https://github.com/bombadil-labs/rhizomatic)
(`@bombadil/rhizomatic`), and — this is the load-bearing fact — **rhizomatic already provides most of
what a naïve reading would call "the database": the object model, resolution, the self-hosting
hyperschema-schema, and the function substrate.** Loam is the _wrapper_ that makes that core a deployable,
GraphQL-fronted, persistent, multi-tenant, federatable server. Do not reinvent the core; build on it.

---

## How this spec is organized

**SPEC.md is the record of what IS** — one section per shipped capability, each closed by a
`**Provenance.**` footer linking the PR(s) that landed it and naming where it lives. The spec grows
**only when work lands**: a landing PR **adds a new `spec/NN-slug.md` file** (its whole section,
provenance footer and all) and adds one row to the table below. Editing an existing section file is
the rare exception — a bugfix or one-off correction — so two concurrent landings almost never touch
the same file. (This per-section layout replaced the former monolith so disjoint landings stop
colliding; see [JOURNAL.md](JOURNAL.md).)

Sections live in **[`spec/`](spec/)**, one file each, numbered. Cross-references throughout the docs
and code use the bare form **§N** (e.g. "§14"); resolve them via this table — §N is the file whose
name begins with that number.

| §   | Section |
| --- | ------- |
| §1 | [The three layers](spec/01-three-layers.md) |
| §2 | [The foundation — what rhizomatic already provides](spec/02-foundation.md) |
| §3 | [Loam's actual scope — what to build](spec/03-scope.md) |
| §4 | [The object model & flow](spec/04-object-model.md) |
| §5 | [The gateway (Loam's only surface)](spec/05-gateway.md) |
| §6 | [Functions & the runner (roles across a hub + a flat ring)](spec/06-functions-runner.md) |
| §7 | [Object-capability & accounts](spec/07-capabilities-accounts.md) |
| §8 | [Persistence, deployment, federation](spec/08-persistence-federation.md) |
| §9 | [Constraints & invariants](spec/09-constraints-invariants.md) |
| §10 | [Reference inventory — what to learn from Chorus](spec/10-reference-inventory.md) |
| §11 | [Erasure — degrees of forgetting](spec/11-erasure.md) |
| §12 | [The open door — public reads & the browser client](spec/12-open-door.md) |
| §13 | [Boundaries & posture — what Loam refuses to be](spec/13-boundaries-posture.md) |
| §14 | [Write semantics — mutation is the dual of resolution](spec/14-write-semantics.md) |
| §15 | [The browser peer — a full store in the page](spec/15-browser-peer.md) |
| §16 | [The interactive tutorial — learn Loam by growing one](spec/16-tutorial.md) |
| §17 | [Surfaces are materializations](spec/17-surfaces.md) |
| §18 | [Glossary](spec/18-glossary.md) |
| §19 | [Tutorial v2 — needs before doctrine](spec/19-tutorial-v2.md) |
| §20 | [Migration — old deltas in, new deltas out](spec/20-migration.md) |
| §21 | [Schema identity & versioning — the lens ladder](spec/21-schema-identity.md) |
| §22 | [Custom resolvers — the last step of the lens becomes programmable](spec/22-resolvers.md) |
| §25 | [Hardening — namespacing, entity-IDs, brick-proofing, repair](spec/25-hardening.md) |
| §26 | [As-of reads — the temporal promise, kept](spec/26-as-of-reads.md) |

_§21, §22, §25, and §26 are **design-landed** — the accepted design brief is recorded here, with
implementation pending (each section's Provenance footer says so). Reserved **§23** (renderers) and
**§24** (quarantine) are still in flight — see the backlog in `.adlc/tickets.json`. A reserved number
lands here as its own `spec/NN-*.md` file when its work merges._
