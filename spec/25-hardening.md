## 25. Hardening — namespacing, entity-IDs, brick-proofing, repair

A store that has run for a year is a different object from a store that has run for a minute:
it has met a stray key an old build left behind, a devtools edit, a half-written row from a
crash, a sync that arrived torn. The rest of the spec argues what Loam *is*; this section argues
what keeps it *standing* when the disk beneath it is not as clean as the model assumes. The
through-line is one refusal: **a single bad row must never brick the whole store.** In a
grow-only union store absence is already a legal, interpretable state (§13) — a delta not yet
present reads as not-yet-synced, never as a contradiction — so the honest response to a row the
store cannot read is to treat it as a row that is not (yet) there, isolate it, report it, and
keep going. The store that forgets one fact still knows all the others.

### Backend namespace marking

A driver that owns a whole key prefix reads *everything* under that prefix as a delta. The
`LocalStorageBackend` owns `loam:<store>:` and walks every key beneath it (all but the reserved
`loam:<store>:seed`), parsing each as a delta and recomputing its id (§15, §8). That is the
correct discipline while every key under the prefix *is* a delta — but the prefix is a shared
namespace on a shared origin, and nothing at the substrate stops an unrelated writer from
landing a key inside it. This is not hypothetical: an earlier tutorial build wrote UI pins to
`loam:tutorial:ui:pins`; the backend then tried to parse that string as a delta, refused it as
corruption, and **bricked boot before a single button could wire up** — the whole store dark
because of one key that was never ours to read. The tutorial's recovery, `healStrayKeys`, sweeps
the prefix before boot and purges any key whose suffix is not a delta id (hex) and is not the
seed, so a store poked by an old build heals on the next load (the current pins key now lives
*outside* the prefix entirely, so the sweep never touches live UI state).

`healStrayKeys` is the right instinct filed in the wrong place — an app patching a backend's
brittleness from outside. The hardening promotes it into the driver as a first-class discipline:

- **A key-owning backend distinguishes its own keys structurally, and treats everything else
  under the prefix as foreign — not as corruption.** The delta keys are exactly `prefix + <delta
  id>`, and a delta id is a fixed-shape hex content address; the seed is the one named exception
  (`prefix + "seed"`). A key under the prefix that matches neither shape was written by someone
  who is not this driver, and the driver's obligation is to *ignore* it on the read path, not to
  refuse the whole read. Absence of a delta is legal; the presence of a non-delta is simply not a
  delta.
- **A store name may not contain the key format's own separator.** `LocalStorageBackend` already
  refuses a store named `app:v2` at birth, because it would sit inside store `app`'s prefix and
  each would read the other's rows as corruption. That refusal stays — it is the namespace's
  integrity at the one point cheap enough to enforce absolutely: construction.
- **The mark is structural, not a stored flag.** We do not write a "this-is-loam" sentinel key
  the way some formats do; the delta-id shape *is* the mark, and it cannot be forged into by
  accident because a hex content address is not a name a UI writer reaches for. This keeps the
  §20 corollary satisfied — the version and identity of a row live in its own bytes, never in
  out-of-band metadata.

### Corrupt-row semantics — quarantine the ROW, never the store (DECIDED, Myk, 2026-07-12)

Today both durable drivers refuse *hard*. `deltasSince` recomputes each row's id from its claims
and verifies its signature, and on any mismatch it throws `store corruption: row <id> …
refusing to read` — which aborts the entire read, and therefore boot. That refusal is *correct
about the row* and *wrong about the store*: a delta whose bytes were edited in devtools, or a row
half-written when a crash cut a batch, or a foreign key swept up by the prefix, is genuinely not
a delta this store may hand onward as healthy data — but its badness is local to it, and nothing
in the union model makes the other ten thousand rows depend on it. The decision:

- **A row the store cannot admit is QUARANTINED, not fatal.** On the read path, a row that fails
  to parse, fails to recompute its id, or carries a signature that does not verify is set aside
  into a quarantine, recorded with the reason it was set aside (parse failure, id mismatch,
  invalid signature, non-delta key under the prefix), and **the read proceeds without it.** The
  store boots. Every readable fact resolves. The bad row contributes nothing to any view —
  exactly as if it had not yet synced, which in a grow-only union store is an ordinary,
  interpretable state (§13).
- **Quarantine is isolation plus a report, never a repair.** The store does not guess at the
  row's intent, does not attempt to "fix" bytes into a delta, and above all does not silently
  drop it — silent loss would launder corruption into absence. The row is held aside, and its
  existence and its reason are surfaced (below, `loam repair`). The operator decides its fate; the
  boot path only decides *not to die on it*.
- **The quarantine is not a lens input.** A quarantined row is not in the ground, is not offered
  to federation, and is never materialized. It sits in a side channel that only repair tooling
  reads. This is what makes "isolate" honest: the bad bytes touch nothing that computes an answer.
- **Naming caution — this is the ROW-corruption sense of "quarantine," distinct from §24's
  federation quarantine.** Same word, two mechanisms, and the spec must not blur them. §24's
  quarantine is a *sandbox for foreign law* — a separate store where untrusted remote-authored
  schemas and renderers actually run against your ground behind one-way glass, and promotion is a
  deliberate act. §25's quarantine is a *holding pen for unreadable bytes* — a row this store's
  own driver could not admit, set aside on boot so the store survives. §24 sequesters code you
  do not yet trust; §25 sequesters data you cannot read. Neither borrows the other's machinery;
  they share only the intuition that isolation beats both refusal and blind admission.

### Boot resilience

Boot is the moment every latent defect surfaces at once, because boot is the first full read.
The resilience discipline is a single principle applied consistently: **boot degrades, it does
not abort.**

- **A store opens as long as its constitutional core is readable.** The genesis marker and the
  operator identity that governs the store (§7, `loam:store` under `loam.operator`) are what make
  a store *this* store; if those specific rows are unreadable the store cannot know who governs
  it, and that is a real, loud failure the operator must see — not something to paper over. Every
  *other* unreadable row quarantines and boot continues. The blast radius of corruption is thus
  bounded to the corrupt rows themselves plus, at worst, the constitutional root — never the
  whole ground by default.
- **A partial store is a legal store.** Because union tolerates absence, a store missing some
  rows is not in an error state — it is in a *younger* state, indistinguishable at the read layer
  from a store that simply has not synced those deltas yet. This is the property that makes
  quarantine safe: the code path a quarantined row exercises is the same well-worn path a
  not-yet-arrived delta exercises, not a new special case bolted onto boot.
- **Recovery is a load-later, not a reformat.** A quarantined row that later turns out to be a
  legitimate delta the store *should* hold (say, a signature that failed to verify because a
  clock or a key-roster read was stale) can be re-admitted on a subsequent read without
  reconstructing anything — the bytes were never destroyed, only set aside. Nothing about boot
  resilience is lossy; it defers judgment, it does not pass sentence.

### Entity-ID reserved-vs-user convention

Constitutional machinery names entities by well-known ids: the store itself is `loam:store`, and
the constitutional contexts and claim families live under `loam.*` (`loam.operator`,
`loam.erasure`, `loam.public`, `loam.trust`). Entities are unowned (§7) — anyone with standing
may point at any id — so these are not *fences*, and the write gate never asks what an id
"means." But an *app* that mints an entity literally named `loam:store` would be pointing at the
constitutional store entity, and a reader's constitutional lenses (`grantHeld`,
`readRegistrations`, the operator-governed masks of §7) would gather that app claim alongside the
real genesis. That is not a security hole — the constitutional readers already honor only lawful,
operator-rooted authorship, so a stranger's claim at `loam:store` binds nothing — but it is a
*legibility* hole: constitutional and application facts sharing an id name is a needless source of
confusion in audits, exports, and devtools. The convention closes it by reservation, not by
enforcement:

- **The `loam:` id prefix and the `loam.` context prefix are RESERVED for constitutional
  entities and contexts.** Genesis, capabilities, erasure, public declarations, trust policy, and
  any future constitutional vocabulary name themselves there. Application and user ids live
  outside that prefix. This is the same reservation the key format already relies on — a store
  name may not contain `:` precisely so that `loam:<store>:` stays unambiguous — lifted to the
  entity-id layer.
- **The convention is documented and lint-able, not gate-enforced.** Because entities are unowned
  and Loam refuses ambient write-time invariants (§13), we do not add a door check that rejects an
  app delta pointing at a `loam:`-prefixed id — that would be exactly the write-time truth-gating
  §7 removed. Instead the reservation is a published naming rule that tooling (surface generation,
  schema authoring, `loam repair`'s report) can warn against, so a collision is caught as a
  *legibility warning* at authoring time rather than silently, and never mistaken for a bind.
- **The reservation is grow-only vocabulary, like everything else.** New constitutional entities
  claim new names under `loam:`; the prefix is the one coordination point, and it is a naming
  discipline the operator's own genesis already follows.

### Door resource budgets — per-author quotas are deployment config, not law (DECIDED, Myk, 2026-07-13)

§12 caps *strangers*. The public door meters an anonymous reader's cost with per-door budgets
(`maxPublicWatches`, `maxPublicStreams`), confining a tokenless visitor's resource footprint to
the tokenless visitor's door — a **safety law**, because a stranger is by definition
untrusted and the store must survive their arrival without anyone tuning anything. A *granted
author* is a different creature: an author the operator's chain granted `write` standing (§7) is
someone the operator has already decided to trust with the door. Their appends are unmetered
today, and the question the ticket poses is whether a per-author quota (rate, volume, storage
share) should be a constitutional invariant. The decision: **it should not.**

- **Metering a trusted author is operational policy, not constitutional invariant.** The line
  §12 draws is between *untrusted* and *trusted*, and it draws it at exactly the right place: the
  law caps the untrusted stranger because no operator judgment stands behind them, and it declines
  to cap the trusted author because an operator judgment already does. To bake a granted author's
  quota into the substrate would be to overrule that judgment from below — to say the operator may
  grant standing but the constitution will second-guess how much it is worth. That is the wrong
  layer. How much append volume a trusted publisher may spend is a property of a *deployment* — its
  disk, its cost model, its SLA, the relationship it has with that author — and it should be tuned
  there, by the operator, per deployment, not frozen for all Loam stores everywhere.
- **The mechanism is configuration the operator sets, and — being Loam — configuration is data.**
  Trust itself is already a live view over operator-authored deltas (§8, `loam.trust`); a
  per-author budget is the same kind of object — an operator-signed policy the door consults per
  request and re-resolves from the live store, so raising an author's quota is a delta, not a
  restart. This keeps the budget revocable, auditable, and time-traveled exactly like the grant
  it qualifies, without promoting it to an invariant the substrate enforces on every store whether
  its operator asked for it or not.
- **The safety floor stays law; the trusted ceiling stays config.** §12's stranger caps remain a
  constitutional invariant — the store must never depend on an operator remembering to configure
  them. Per-author quotas for granted authors are deployment config layered above that floor. The
  two are not in tension: one protects the store from people it does not trust and needs no
  tuning; the other lets an operator shape the cost of people it *does* trust and is theirs to
  tune. Naming them both "resource budgets" hid a real distinction; this section separates them.

### `loam repair` — listing and resolving the quarantine

Quarantine is only honest if the operator can see and settle what it holds; a holding pen with no
door out is just silent loss with extra steps. `loam repair` is the tool that reads the
quarantine side channel and lets the operator resolve it, and it is the natural sibling of the
erasure tooling (§11): where `loam` already has verbs for *forgetting* a fact on purpose, repair
has verbs for *deciding the fate of* a fact the store could not read.

- **`loam repair list` reports every quarantined row and why.** For each set-aside row it names
  the store, the key (or row id) as stored, the reason it was quarantined (unparseable, id
  mismatch, invalid signature, non-delta key under the prefix), and — where the bytes permit — a
  short, safe preview so the operator can recognize a devtools scribble from a torn sync. It also
  surfaces the entity-ID legibility warnings (an app delta pointing at a reserved `loam:` id),
  since those are the same "something here needs a human's eye" report.
- **Resolution is a deliberate operator act, in the vocabulary Loam already has.** A quarantined
  row has exactly three honest ends, and repair spells each:
  - **Discard** — the row is genuine garbage (a stray UI key, a corrupt fragment). Repair
    removes it from the origin, the same `removeItem`/purge primitive `healStrayKeys` used, now
    driven deliberately and logged rather than swept blindly on boot. Discarding a non-delta is
    not an erasure (there was no fact to forget); discarding what *was* a real delta the store no
    longer wishes to hold is erasure and routes through §11's tombstone discipline, so the store
    remembers THAT it forgot.
  - **Re-admit** — the row is a legitimate delta that was quarantined for a transient reason (a
    signature that failed against a stale roster, a read that raced a write). Repair re-runs the
    admission check and, if the row now verifies, returns it to the ground on the next read. No
    bytes are reconstructed; the row was only ever set aside.
  - **Leave** — inaction is a legal outcome. A row may stay quarantined indefinitely; the store
    runs fine around it, and repair is idempotent, so re-running `list` tomorrow shows the same
    pen. Quarantine is not a countdown.
- **Repair never fabricates a delta.** It may discard, re-admit, or leave — it may not *edit*
  bytes into validity, because a delta's id hashes its claims and its signature binds them (§11):
  an edited delta fails recomputation and is refused as corruption by every driver. Repair
  operates on whole rows as found; forging a row into readability would make repair a forgery
  tool, which is exactly the rigidity §11 forbids.
- **Repair is operator-authority, like erasure.** Only the instance operator resolves a
  quarantine — the same authority that alone may erase (§11). A quarantined row's fate can move
  the store's ground (re-admit adds a fact; discard-as-erasure removes one), so the act belongs to
  the controller, never to a grantee or a peer.

**Provenance.** Design-stage draft — pending Myk's review and the implementing PR. No code
landed; the mechanisms above (namespace marking, row quarantine on boot, the entity-ID
reservation, per-author budgets as deployment config, and `loam repair`) are argued here to be
reviewed, and the §25 section number is provisional (Myk may renumber). The two decisions folded
in — quarantine the row and never the store (Myk, 2026-07-12), and per-author quotas as
deployment config rather than constitutional law (Myk, 2026-07-13) — are settled; the section
that realizes them will carry the implementing PR link(s) and an implementation note in this
footer's place.
