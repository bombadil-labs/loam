## 2026-07-12 — The register-payload probe: schema identity jumps the queue

Myk poked at the README's `loam register` sample — "are hyperschema, schema and roots tightly
coupled, or is this shorthand?" — and the answer, read straight from the internals, reordered the
backlog. What the probe established: (1) **roots are a liveness declaration, not a scope** — any
entity resolves under any registered schema (`matFor`: registered root → standing materialization,
anything else → lazy mat or batch eval, the spike proved them identical), so minting a new entity
mutates no roots array anywhere; (2) **`{ var: "root" }` is an ambient binding** a gather body may
freely ignore — root-free corpus lenses, per-entity lenses born on demand, and one-entity lenses
are all already expressible; (3) **the registration is a reference on the hyperschema side but a
CARRIER on the Schema side** — the definition lives at its own entity, the Schema is inline JSON;
(4) the bind is **1:1:1 by construction** — registrations key by `registration:<schemaEntity>`,
latest WINS, so a second lens over the same hyperschema silently replaces the first ("ruh-roh" —
Myk); and (5) a **naming conflation survives** in Loam's own ids and prose: the hyperschema
definition entity defaults to `schema:<Name>` and the comments call it the "schema entity" — the
0.3.0 expunge reached the delta vocabulary but not Loam's ids.

Out of it came a new TODO item that GATES the other two: **Reserved §21 — schema identity &
versioning**, around Myk's ladder — HyperSchema —many→ Schema —many→ VersionedSchema —many→ API. A
Schema is a living domain node until snapshotted into a fixed, content-addressed VersionedSchema;
doors serve VersionedSchemas. Half of it already exists (`readRegistrationVersions` pins Schema +
roots by delta content address — a proto-VersionedSchema that snapshots the wrong thing, the
registration, because that is the only identity a Schema has today). Resolvers slid to §22,
renderers to §23, cross-references updated — both need a lens identity that can be named,
multiplied, and pinned, and §21 is where it gets one. CURRENT_WORK reframed: tomorrow's design
stage opens at §21.

Learning: the README sample was honest about the DOOR (a registration genuinely needs all three
parts) but silent about the ONTOLOGY — and a reader as close as Myk read the bundle as the model.
When the convenient shape and the conceptual shape differ, the doc must show both or the
convenient one becomes the truth.
