# §52 — The stock shelf learns refs (working spec, T246)

The shelf's three reference props stop teaching the fossil path. Phase A ships without touching a
frozen file; phase B evolves one frozen rail through the declared-substitution ceremony. Design
constraint settled with the stock-graph session (its collision report, 2026-08-27): the pin and
deps tables are the arc's intended growth path and are unfrozen; legacy primitive values must stay
visible, which §51's mixed-array behavior already guarantees and a compat rail must pin here.

## User stories

- A friend connects Claude to a fresh store, installs stock `person` and `event`, and links who is
  attending the picnic with one typed mutation the introspection taught them — no id-string ever
  works, so the fossil cannot happen.
- A store that wrote `attending: "person:bob"` last week upgrades the shelf and still sees bob in
  the list — legacy primitives keep resolving beside new nested views.
- The org fixture the repo already froze keeps passing: `linkOrg` still links members, with
  `members` no longer writable.

## Phase A (no frozen file touched)

1. **§14 `linkEntityImpl` becomes refs-aware**: a refs-declared field passes without `writable` —
   the refs declaration is the authorization, exactly as §51 rules for its own verbs. `writable`
   still authorizes non-refs edge fields (unchanged behavior for legacy schemas).
2. **org.members**: `refs { members: { role: "members", reciprocal: { role: "memberOf", context:
   "memberOf" } } }` — role MUST stay `members` so §14-written edges keep resolving through the
   existing expand. `members` leaves `writable`.
3. **event.attending**: `refs { attending: { role: "attending", reciprocal: { role: "attends",
   context: "attending" } } }` plus an `expand { role: "attending", schema: "ShallowPerson",
   reading: "ShallowPerson" }` so attendees read nested. `attending` leaves `writable`.
4. **person.follows: untouched** (a frozen rail owns its fossil path until phase B).
5. **Pin and deps tables updated in the same change** (stock-pin.test.ts, stock-deps.test.ts,
   graph tables — all unfrozen, the arc's growth path). A store that installed the OLD stock now
   draws the divergence warning on install comparison — by design, named in the PR.

## Phase B (the ceremony, two small PRs)

6. **Declaration PR** (Myk merges): `scripts/rail-renames.json` gains ONE substitution pair for
   `test/cli/stock-depth.test.ts` — the primitive write line
   `mutation { person(entity: "person:ada", follows: "person:bob") { name } }` becomes
   `mutation { linkperson_follows(entity: "person:ada", target: "person:bob") { name } }`.
   The read assertion `follows: ["person:bob"]` is NOT substituted, because:
7. **person.follows gets refs WITHOUT an expand**: `refs { follows: { role: "follows",
   reciprocal: { role: "followedBy", context: "followers" } } }`, off `writable`. VERIFY FIRST
   (before the declaration PR is drafted) that an entity pointer under `EVERY()` with no expand
   resolves to the bare id string — if it does, the frozen flat-read assertion stays true and the
   ceremony is one pair; if it does not, STOP and report the resolved shape before widening the
   substitution list. Nested follows reads are a later, unfrozen evolution.

## Acceptance criteria

New rails in `test/cli/stock-refs.test.ts` (a NEW file — the frozen pair stays byte-identical in
phase A) plus edits to the unfrozen pin/deps tables.

- (a) After phase A, `event.attending` and `org.members` serve their typed link/unlink pairs and
  offer NO primitive argument; `person.follows` still offers its primitive argument (phase A
  honesty). Verify: `test/cli/stock-refs.test.ts`.
- (b) `linkOrg(field: "members")` succeeds with `members` absent from `writable` — the refs-aware
  §14 verb — AND a non-refs, non-writable field still refuses (two-sided). Verify:
  `test/cli/stock-refs.test.ts`.
- (c) `linkevent_attending` authors the symmetric delta and the event reads its attendee as a
  nested ShallowPerson view (delta and object level both). Verify: `test/cli/stock-refs.test.ts`.
- (d) COMPAT: a primitive `attending` value written BEFORE the retrofit (fixture: write under the
  old registration, then republish the new one) keeps resolving in the mixed array beside a
  linked nested view — §51 criterion (g)'s behavior, pinned on the shelf. Two-sided: the legacy
  value AND the new edge both present. Verify: `test/cli/stock-refs.test.ts`.
- (e) A primitive write to `attending` post-retrofit refuses naming `linkevent_attending`; a
  primitive write to a plain prop (`title`) beside it succeeds. Verify:
  `test/cli/stock-refs.test.ts`.
- (f) `unlinkevent_attending` retracts the caller's own edge only; a second author's edge and the
  legacy primitive both survive; history is not purged. Verify: `test/cli/stock-refs.test.ts`.
- (g) The pin and deps tables match the retrofitted shelf exactly (the covers-checks in the
  unfrozen stock-pin/stock-deps files force completeness). Verify: `test/cli/stock-pin.test.ts`
  and `test/cli/stock-deps.test.ts` (unfrozen, edited).
- (h) `rails-guard-ci` passes with `test/cli/stock-depth.test.ts` and `stock-install.test.ts`
  byte-identical to base in phase A. Verify: `node scripts/rails-guard-ci.mjs origin/main`.
- (i) Phase B, after the declaration lands: the substituted line links instead of writing a
  primitive, the flat read assertion still passes (per the verified no-expand resolution), and
  `follows` serves its typed pair with no primitive argument. Verify: the evolved
  `test/cli/stock-depth.test.ts` under the declared substitution plus new cases in
  `test/cli/stock-refs.test.ts`.

## Provenance (working)
Myk's front-of-line order, 2026-08-27. Ticket T246. Coordinated with the stock-graph session
(T244's author): pin tables confirmed unfrozen growth path; its premortem's silent-emptying
concern is closed by criterion (d).
