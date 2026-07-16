## 2026-07-14 — §21 slice 2: the Schema becomes a first-class entity (per-version snapshots)

Second §21 slice, and the one that finishes the decoupling slice 1 only paved half of. The resolution
Schema stops riding INLINE in the registration and becomes a domain node like any other: published as
the living `schema:<name>` entity through 0.5.0's `SCHEMA_SCHEMA` (`publishSchemaClaims`/`loadSchema`),
with an immutable, content-addressed VersionedSchema SNAPSHOT (`schema:<name>@<hash>`, the hash a
BLAKE3 `contentAddress` of the frozen `schemaCanonicalHex` bytes) minted beside it. The registration is
demoted to a BINDING that carries no definition, only three references — `hyperschema` (the gather),
`schema` (the living lens the LATEST reading resolves against), and `schemaVersion` (this version's
frozen snapshot). `readRegistrations` loads the living entity; `readRegistrationVersions` loads each
version's snapshot — which IS §17's per-version freezing, now standing on named, pinnable entities
instead of bytes buried in a delta. Co-landed on purpose (spec/21): lifting the Schema without the
snapshots would resolve every version against the latest, collapsing v1 into v2 and breaking freezing —
there is no coherent intermediate. Single-lens throughout (`Schema.name = hyperschema.name`);
coexistence stays a deferred design slice.

Ships one §20 migration, `inline-schema-to-entity`: it detects a legacy inline-`schema`-primitive
registration (shape-distinct from the entity-pointer new form), publishes the living + snapshot Schema
entities, re-signs the registration into a binding, and negates the old with `supersededBy` + a reason.
It reuses the LIVE planting path (`registrationDeltaClaims`) so a migrated binding is byte-identical to
a fresh publish, and re-signs at each registration's own timestamp so it is deterministic and idempotent.

Learning (the sharp one): rhizomatic 0.5.0 REUSED both the retired `rhizomatic.schema.*` role
vocabulary AND the `schema:` entity prefix for the new resolution Schema — the exact tokens Loam's two
EARLIER migration steps were written to rewrite. So introducing resolution Schemas into stores made the
0.3 role-realignment and the slice-1 entity-rename mis-fire on re-migration: the 0.3 step would rename a
Schema's `rhizomatic.schema.*` roles to `hyperschema.*` (corrupting it), and slice 1 would drag
`schema:<name>` into the `hyperschema:` namespace. Both are role-identical to their legacy targets, so
the fixes are (a) a store-level guard — the 0.3 step fires only where NO `rhizomatic.hyperschema.*`
exists yet (a genuinely pre-realignment store holds no resolution Schemas), and (b) role-scoping the
slice-1 rename to genuine hyperschema references. General lesson: when the substrate reuses a token for
a new meaning, every migration that ever rewrote that token gains a new false-positive surface — the
composability that makes the chain safe also makes vocabulary reuse a cross-step hazard, and each step's
shape-detector has to be re-audited against the newcomer, not just the newcomer given a distinct shape.

Second learning, caught in the self-review (P5): the design says "the latest binding resolves against
the living entity," but implementing it literally is a withdrawal bug. Striking the latest registration
does NOT negate its living-entity publish, so the live surface would keep serving the withdrawn shape
while the version door correctly recedes to the prior version — the two out of lockstep. Fix: the live
surface resolves the latest SURVIVING binding against its OWN snapshot, exactly as the version door
does; they agree in the common case and diverge only under withdrawal, where the snapshot is right. The
living entity stays first-class and directly loadable — it is just not the read path. General shape:
when two facts are kept in separate deltas (here a binding and its living-entity publish) but only one
carries the withdrawal signal, resolving the OTHER re-introduces the retracted state — read paths must
key off whichever delta the retraction actually strikes.

`npm run check` green — format, lint, typecheck, build, 537 tests (a focused
`test/gateway/schema-entity.test.ts` proves the living entity loads, evolving mints a coexisting
snapshot, and withdrawing the latest version reverts the live surface; the §17 freezing test in
`test/surface/rest.test.ts` still passes unchanged, now served by snapshots). Breaking on-wire → Myk's
merge (P6). On-wire decisions to flag at review: the snapshot entity id scheme
(`schema:<name>@<contentAddress>`) and the `schemaVersion` binding role.

Note for the demonstration ledger: village to be extended below in the same PR (the demonstrable §21
story — a first-class, versioned Schema — arrives here; coexisting lenses and the `name@hash` URL wait
for the coexistence slice).
