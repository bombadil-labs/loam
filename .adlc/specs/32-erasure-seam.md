**The erasure level decision is CLOSED (Myk, 2026-07-25): Loam keeps full provable erasure. This section changes no promise — it names the principle every existing promise already obeys, and builds the fence that keeps new code obeying it.**

# T100 — §32 The erasure seam: one principle under every carve-out, and a manifest that makes it enforceable

DESIGN-STAGE (P6 is Myk's merge). Working spec for a future `spec/32-erasure-seam.md`. Section
number §32 is claimed by T100; never renumber.

## 32.1 The principle

The model's one deep guarantee is **monotonicity**: claims are the state, append is the only verb,
and readers are pure functions of the set. Everything Loam promises upward — content addressing,
suppression as a property of the operand set (H1), replayable provenance — leans on that guarantee,
which is why the substrate can be small and the readers can be honest.

**Erasure is the single anti-monotone operation, and it is EXTRA-MODEL.** The ground can record the
ORDER to forget — a tombstone is an ordinary signed claim, appendable like any other — but the
forgetting itself is a fact about BYTES: sqlite rows, WAL page images, fan files, localStorage
keys, a mirror's copy, a module loaded into a process. The model can point at those bytes; it
cannot contain them. So every place where bytes and claims meet is a place the seam surfaces, and
every erasure carve-out shipped to date is that one seam surfacing at another such place. **The
count of exceptions is the count of PLACES, not of principles** — there is exactly one principle,
and the census below shows every carve-out deriving from it.

**The seam's signature question is: _can this report be false?_** Purging is easy; every erasure
bug this repo has paid for lives in the claiming, not the forgetting (H7's two costs, H9's three
sites in one night, T40, T67). A change at the seam is judged by that question first, and the six
rules below are that question refracted through the six shapes the seam takes.

Two hazards are instances of this principle and cite it at landing: **H7** (a success report the
operation never earned) and **H9** (an absence report the probe never proved) are what the seam's
reports look like when they go wrong. This section cites them back; the pair of one-line
cross-references in `src/gateway/SUBSTRATE-HAZARDS.md` is part of the landing.

## 32.2 The six rules

- **R1 — VERIFY AT THE BYTES.** Every erasure-adjacent report is a claim ABOUT the world, never a
  fact IN the model, so it is earned only by examining the world: byte-presence (`holds`), re-read
  after write, live probes. A tier that cannot be asked reads as **held**; a probe that throws
  reads as **outstanding**; unverifiable reads as **not done**, never as clean.
- **R2 — THE ORDER AND THE ACT ARE SEPARATE RECORDS.** The order to forget is in-model: a
  tombstone, append-only, unerasable, struck only as explicit forgiveness. The act of forgetting is
  extra-model and only ever WITNESSED — a driver's return value is evidence, never proof, and the
  order must be durable before the act begins, so a crash leaves a standing order over retained
  bytes rather than removed bytes with no record.
- **R3 — FAIL CLOSED FEEDING A PURGE.** Any derivation whose output widens what gets destroyed —
  a condemned set, a replant filter, a fan-out target list — refuses on unreadable or unreachable
  input. An unreadable row might be the tombstone that condemns what you are about to restore; an
  unreachable store might hold the byte you are about to report gone. Refusing is recoverable;
  a wrong purge is not.
- **R4 — THE SEAM STOPS AT AUTHORITY BOUNDARIES.** Forgetting does not travel. Inside the
  operator's authority — tiers, mirrors, attached quarantine pools, transitively — the sweep
  reaches everything, unconditionally. Outside it — peers, the viewer's page, a caller's variable —
  parties are notified, never compelled: the request travels as data, and compliance is testable
  per store, never assumed. A removal-order signed by anyone but this store's operator is refused
  at every door.
- **R5 — TWO-SIDED RAILS, ALWAYS.** Every erasure rail proves the target is gone AND that a named
  live bystander survives. A rail that only proves removal cannot see over-purging, and over-purge
  is the unrecoverable direction — a wrong `>` costs a user their data with no way back.
- **R6 — READERS CONFESS ABSENCE.** A hole is shown as a hole: as-of reads annotate the moments of
  forgetting, reports carry `kept` / `outstanding` / `withheld` / `unproven` by name, boot logs
  print what heal declined to plant. A reader that smooths a hole over is a report that can be
  false; a field nobody reads is a swallowed confession (H9).

The rules are not independent inventions; each is R-for-a-place. R1 is the question asked of a
tier, R2 of the ledger, R3 of a derivation, R4 of a boundary, R5 of a test, R6 of a reader.

## 32.3 The census — every carve-out in the tree, tagged

Walked 2026-07-26 against HEAD (post posture-rename, post-T66). Every site below was read, not
recalled. A carve-out that fit no rule would be a bug or a missing rule; the walk found **one**
such entry, promoted to the finding in §32.3.1.

Line ranges below are for THIS working spec's review — they let a reviewer jump straight to each
site while the census is fresh. **The landed section cites file + symbol/rule, never line
numbers**: a line-anchored census rots with the next edit while its "read, not recalled" framing
keeps earning trust it no longer deserves, and the manifest (§32.4) is what keeps the module set
honest over time.

| # | rule | where | the carve-out |
|---|------|-------|---------------|
| 1 | R1 | `src/store/backend.ts:50-63` | The driver contract: the completeness verdict is `holds(id)` — byte-presence, defined to see at least everything `purge` reaches, including bytes reads skip. `heldAmong` is the batch form and keeps the same reach and the same fail-closed. |
| 2 | R1 | `src/gateway/erase.ts:287-297,323,370-398` | The purge count is evidence of work, never the verdict; the verdict is asked of the bytes after re-seat and fan-out, and a tier that cannot be asked is a fault beside the others (`incompleteErasureFaults`), never an escape hatch. |
| 3 | R1 | `src/gateway/erase.ts:348-365` | `erasureOutstanding`: a probe that throws reads as outstanding — "could not be proven clean" is treated as bytes held, never as done. |
| 4 | R1 | `src/store/archive.ts:75-77,311` | Only `ENOENT`/`ENOTDIR` may mean "no bytes here" (`holdsNothing`); every other error refuses rather than answering clean — the exact H9 site T67 paid for, inverted by name. |
| 5 | R1 | `src/store/sqlite.ts:58-68` | The WAL truncation debt: rows deleted under a WAL that could not be truncated keep their ids in a durable per-id debt set, and an unreadable debt row makes EVERY id unprovable until a checkpoint lands. |
| 6 | R1 | `src/store/mirror.ts:125-151` | `holds`/`heldAmong` compose across BOTH tiers — each side asked, answers unioned — so one tier cannot hide behind the other's absence. |
| 7 | R1 | `src/store/mirror.ts:337-341,386-389` | Heal's byte verdict: a driver's restore claim is evidence, so heal RE-READS the primary and believes its own read; an over-reporting driver is dropped from `restored`. |
| 8 | R1 | `src/gateway/erase.ts:479-571` | `health()` is computed live — surviving tombstones against a byte probe over the backend and every pool — with a tri-state verdict: `ok` / `settling` / `unproven`, and unproven never reads as ok. |
| 9 | R1 | `src/gateway/gateway.ts:747-801`, `src/gateway/resolvers.ts:230-244` | In-memory reach (T45): `reseat()` re-derives the reactor, the registered set, and the live channels from the post-purge bytes, and the resolver memo keys on the bucket's delta set — so an erased delta changes the key and a value distilled from purged bytes can never be served. |
| 10 | R2 | `src/gateway/erase.ts:283-286` | Order before act: "the tombstone must be ground before the target stops being ground" — the record of the removal is durable before any byte moves. |
| 11 | R2 | `src/gateway/erase.ts:243-270` | Retry anchors on the surviving tombstone (no second tombstone — a fresh timestamp would be a new content address), and the tombstone itself is unerasable: "the erasure log is append-only." |
| 12 | R2 | `src/gateway/erase.ts:129-160` | Forgiveness is a record, not an edit: a lawfully struck tombstone releases the id — un-erasure is striking the order, never rewriting it. |
| 13 | R2 | `src/gateway/ingest.ts:44-58,364-383` | Both doors remember the hole: a tombstoned id is refused re-entry — through append as through federation, even past an explicit admit override — until its tombstone is struck. The order binds until forgiven. |
| 14 | R3 | `src/gateway/erase.ts:226-241`, `src/gateway/container.ts:1145` | The pre-work completeness guard: a declared separate-posture container this sweep cannot reach refuses the erase UP FRONT — nothing half-done, no tombstone standing over an unreported gap; covered stores return in `kept`, on the record. |
| 15 | R3 | `src/store/mirror.ts:346-356,410-426` | Heal's withheld plant (T66/T57): an unreadable pen row could be a lawful tombstone nobody can read, so the condemned set may be incomplete — heal withholds the WHOLE plant rather than resurrect what was erased. Withholding is recoverable; resurrection is not. |
| 16 | R3 | `src/store/mirror.ts:358-365` | §11 re-asserted where the bytes are written, not trusted from the caller: `settleSquatters` filters the dead set again itself, so a future refactor handing it the unfiltered offer cannot plant an erased delta back. |
| 17 | R3 | `src/store/archive.ts:276-284` | The purge sweep refuses to delete THROUGH a suspicious directory entry: "widening the delete to reach here is a decision about what the store may destroy, not a repair of a false report" — it refuses to claim completeness and stops. |
| 18 | R4 | `src/gateway/erase.ts:102-125`, `spec/11-erasure.md:42-49` | One erasure authority: the instance operator, verified at every door (`eraseDefect`), so a peer's or forged removal-order is never even stored — federated forgetting is per-instance, notified as data, never compelled. |
| 19 | R4 | `src/gateway/erase.ts:400-477` | The contrast that proves the boundary is AUTHORITY, not topology: attached quarantine pools ARE swept, transitively and unconditionally (§24.8), because they are the operator's own replicas — and `eraseReplicaImpl` still re-derives lawfulness itself rather than trusting its caller. |
| 20 | R5 | `test/gateway/erase.test.ts`, `test/store/erasure-at-rest.test.ts`, `test/store/corrupt-row-recovery-safety.test.ts` | The two-sided discipline in force: erasure rails name a live bystander and prove its survival beside the target's removal (the standing CLAUDE.md rule, observed as practice in the erasure suites). |
| 21 | R6 | `src/gateway/erase.ts:162-179`, `src/gateway/reads.ts:54-62` | The as-of confession: an as-of read carries `forgotten` — the sorted MOMENTS erasures fell since T, never the content, because a tombstone keeps only THAT it forgot and WHEN. |
| 22 | R6 | `src/gateway/ingest.ts:255-296` | The watch door drops what the store was ordered to forget — including, transitively, what a condemned strike was holding down — and its own header confesses the doors that do not yet honor the order (`select`/`freeze`/`offeredDeltas`, tracked as T90) rather than implying a uniformity that does not exist. |
| 23 | R6 | `src/gateway/erase.ts:339-341` | `kept` on the erase result: the stores a surviving detach record deliberately holds outside this sweep, reported rather than silent. |
| 24 | R6 | `src/cli/cli.ts:298,310-316` | The confession has a READER: boot prints heal's `purgeFailures` and `replantWithheld` to stderr — a failure field nobody reads is a swallowed error with extra steps (H9). |

**Excluded as design-only, on the record:** the ticket's candidate list included the slate's
cite-closure exemptions and "erase refuses a pinned Term". Those carve-outs exist only in T64's
working spec (`.adlc/specs/29-slating-and-graveyards.md`, status `todo`) — there is no slate in the
tree today, so they are not census rows. They are listed here so the next walker does not re-search
for them, and so T64's landing knows it owes this census new rows (its working spec already writes
its carve-outs in these rules' vocabulary: frozen membership is R3, the graveyard is R2, asymmetric
disclosure is R4/R6).

### 32.3.1 The finding: one report in the tree can be false today

**The ESM residency residual is a census entry that fits no rule — it VIOLATES R1, knowingly, and
confesses in the wrong register.** `src/gateway/esm.ts:8-21` says it plainly: erasing a resolver-
or renderer-carrying delta cannot unload its code — the source rides a `data:` URL into Node's own
ESM registry, which offers no eviction — and `healthImpl` probes only the backend tiers and the
pools, so after such an erasure **the store reports a SETTLED, complete erasure while the source is
still resident and executable in this process**. The file's own header names this as §11's rule
"being contradicted", and `test/gateway/erase-inmemory-reach.test.ts:33-42` names the rail that
would close it. Both confessions live in comments — a register no reader of the REPORT can see.
R6 requires the confession in the report; R1 forbids `settled` over an unexamined place bytes
live. Mitigations are real (the cache is keyed by content address, so no door serves from it
without already holding the bytes; the byte is operator-published law, not a subject's record)
but a mitigation is not a true report. This census does not fix it — a fix must decide what the
verdict should SAY when eviction is unavailable to say it with, and per the standing erasure rule
the honest-direction change (health confessing a residual it cannot clear) self-merges while
anything wider does not. **It is recorded here as the seam's one open violation and must be
tracked as its own ticket at landing** (criterion 11).

## 32.4 The seam manifest — the enforcement half

Mechanism over lore: the census above is true today and will rot the day a new module touches
bytes at rest without reading this section. The fence is a **seam manifest**: one committed file,
`scripts/erasure-seam.json`, enumerating every module allowed to touch bytes at rest. Joining it is
a reviewed act — the PR that adds a module to the manifest is, by tooth (a) below, a PR that routes
the erasure lens.

**The members, enumerated from the code as it is today** (each holds a destructive call or the
contract for one; nothing else in `src/` does — verified by walking every `rmSync` / `unlink` /
`removeItem` / `DELETE FROM` / `truncate` / `.purge(` / `discardRow(` site):

- `src/store/backend.ts` — the contract: `purge`, `holds`, `heldAmong`.
- `src/store/memory.ts` — `purge` (Map delete).
- `src/store/sqlite.ts` — `DELETE FROM deltas`, WAL truncation and its debt ledger.
- `src/store/local-storage.ts` — `removeItem` (purge and the quota-rollback path).
- `src/store/archive.ts` — `rmSync` (fan files; the crash-left `.tmp` cleanup).
- `src/store/mirror.ts` — composes both tiers' purges; heal's straggler purge.
- `src/store/quarantine.ts` — the `discardRow` contract (repair removes a penned row's origin bytes).
- `src/gateway/erase.ts` — the orchestrator: the only gateway-side caller of `backend.purge`.
- `src/gateway/repair.ts` — drives `discardRow` (discarding a penned row is mechanical, not an erasure — the row was never a lawful fact — but it destroys bytes, so it is in the seam).

Deliberately NOT members: `src/gateway/quarantine-pool.ts` and `src/gateway/container.ts` reach
bytes only through `erase.ts`'s fan-out and hold no destructive call of their own; `src/store/canon.ts`
holds none at all.

**Tooth (a) — routing keys on the manifest.** `scripts/p5-triage.mjs` currently hard-codes the
`loam-erasure` lens's `paths` regex (`p5-triage.mjs:78-82`) — a list that already agrees with the
manifest above, by hand, which is exactly the agreement that drifts. The change: the lens derives
its `paths` from `scripts/erasure-seam.json`, so a module joining the seam routes the lens with no
triage edit; a diff touching the manifest FILE routes the lens too (joining is reviewed); and a
missing or unparseable manifest FAILS triage loudly — R3 at the process layer: unreadable input
must never narrow what gets reviewed. The `code` signal stays independent, as today, so a rename
cannot silently disarm the lens.

**Tooth (b) — a CI tripwire for byte-destroying calls outside the manifest.**
`scripts/erasure-seam-guard.mjs` scans `src/**/*.ts` for a hand-written token list — today:
`rmSync`, `rm(`, `rmdir`, `unlink`, `removeItem`, `DELETE FROM`, `truncate`, `.purge(`,
`discardRow(` — and exits 2 on any hit outside the manifest's modules. Wired into
`.github/workflows/ci.yml` beside the rails backstop, as a step whose failure fails the job — no
`continue-on-error`, no `|| true` — and that wiring is itself railed (criterion 9), because a
tripwire someone can disarm with a comment character is string-presence theater.

**The scan boundary is `src/` — deliberately, and the hole is named.** `src/` is the shipped
store: a destructive call there reaches a user's delta bytes through the published package, which
is what the seam governs. `scripts/` and `demos/` hold fifteen-plus legitimate deletions today
(build-output resets, demo temp homes, tutorial key cleanup), so fencing them with this guard
would mean a day-one allowlist longer than the manifest — a fence nobody reads. What backstops
them instead: the standing erasure rule (no agent erases data it did not create in its own temp
dir — never `demos/village/homes/`, never a real `~/.loam`) and ordinary review. Stated plainly:
a script deleting a real store path would NOT trip this guard; that class is out of the fence's
sight, held by rule rather than mechanism, and widening the fence there is a decision this
section leaves open rather than pretends to have made.

**What the detector can and cannot catch — stated per H10, because a lexical scan is a list that
only knows the names it knows.** It CATCHES the ordinary regression: a convenience deletion added
outside the seam using the vocabulary the tree already uses — which is every destructive call in
the tree today, and the likeliest shape of the next one. It CANNOT catch: a novel API name (a new
driver's own verb), SQL composed at runtime (`db.exec(sql)` where the string holds `DELETE`), a
spawned process (`execSync("rm …")`), rename-over-existing (destroys the target's bytes with no
delete token), a native module, or intent (it cannot tell a temp-file cleanup from a delta purge —
inside the manifest that distinction belongs to the lens and the review). So the guard is a
**tripwire, never a proof**: its green means "no known verb outside the fence", and its own output
says so, because a green read as proof would be H7 at the tooling layer. The layer that sees
intent and novel verbs remains the routed lens — a model reading the diff — which is why tooth (a)
is the load-bearing one and tooth (b) is the cheap floor under it.

**Both lists carry floors (H10):** the manifest rail covers a hand-written module list and a
minimum count, the guard rail covers a hand-written token list and a minimum count, and the
guard's red case is proven against a planted fixture inside its own rail — a detector never seen
red has proven nothing.

## 32.5 Shrink the seam

The manifest measures the seam; **T101 (crypto-shredding) is the standing direction for shrinking
it.** If every at-rest byte is ciphertext and erasure destroys a key instead of hunting bytes, the
byte-destroying set collapses toward one module — the key store — and rules R1–R3's hardest
instances (WAL page images, mirror lag, crash-left temp files) become unreachable by construction
rather than swept by discipline. The manifest is the progress meter: T101 succeeds exactly insofar
as the module list shrinks. Nothing about it is designed here.

## 32.6 Relations (deliberately not edges)

A bug family must not queue behind philosophy; these cite the section when built, and none blocks
on it. **T99** — condemned-set derivation, R3's largest open instance. **T90** — the point-read
doors (`select` / `freeze` / `offeredDeltas`) inside the erase window, R1/R6 territory, already
confessed at `ingest.ts:272-280`. **T44** — pool reach, likewise. **T64** — slates; its landing
owes this census new rows (§32.3). **T101** — §32.5. The ESM residency finding (§32.3.1) becomes
its own ticket at landing.

## Acceptance criteria (each names its verification)

Meta-rule, stated once and binding on every criterion: nothing below weakens a report or widens a
purge — the whole deliverable is process-layer (a manifest, routing, a CI tripwire, prose, two
cross-reference lines). Any criterion that would soften a claim or grow a condemned set has failed
before review.

1. **The manifest exists and is guarded against vacuity.** `scripts/erasure-seam.json` names the
   seam modules; its rail asserts a hand-written expected list (every module in §32.4) is covered
   AND a floor of at least 9 modules, so both emptying and silent narrowing go red (H10). —
   `test/scripts/erasure-seam.test.ts`
2. **The guard goes red on a planted violation.** `scripts/erasure-seam-guard.mjs` exits 2 when a
   byte-destroying token appears in a source file outside the manifest, proven inside the rail
   against a planted fixture file — the red case is demonstrated, never assumed. —
   `test/scripts/erasure-seam-guard.test.ts`
3. **The guard is green on today's tree**, which is the census made mechanical: every destructive
   call in `src/` today sits inside the manifest. — `node scripts/erasure-seam-guard.mjs`
4. **The guard confesses its blind spots in its own output.** Its report (and `--help`) states that
   it is a tripwire for known verbs — naming novel APIs, composed SQL, spawned processes, and
   rename-over as outside its sight — so a green cannot be read as proof (H7 at the tooling
   layer); the rail asserts the statement is present in the output. —
   `test/scripts/erasure-seam-guard.test.ts`
5. **The token list is hand-written with a floor** (at least 6 tokens) and a coverage rail, so
   narrowing the vocabulary goes red exactly like narrowing the manifest (H10). —
   `test/scripts/erasure-seam-guard.test.ts`
6. **Routing derives from the manifest.** With a module added to a copy of the manifest, triage
   routes `loam-erasure` for a diff touching that module, with no edit to `p5-triage.mjs`. —
   `test/scripts/p5-triage-seam.test.ts`
7. **A missing or unparseable manifest fails triage loudly** (non-zero exit naming the manifest),
   never a silent fallback to a narrower built-in list — R3 at the process layer. —
   `test/scripts/p5-triage-seam.test.ts`
8. **Editing the manifest routes the lens.** A diff whose only change is `scripts/erasure-seam.json`
   routes `loam-erasure` — joining the seam is a reviewed act. — `test/scripts/p5-triage-seam.test.ts`
9. **The guard is wired in CI as a step that can actually fail the job.** A rail parses
   `.github/workflows/ci.yml` and asserts the guard invocation exists, is not commented out,
   carries no `|| true`, and sits in no step marked `continue-on-error` — string presence alone is
   not wiring, and a tripwire disarmable with a comment character has proven nothing. —
   `test/scripts/erasure-seam-guard.test.ts`
10. **The cross-links land both ways, in the right places:** a rail asserts the §32 citation
    appears INSIDE the H7 entry (between the `## H7` and `## H8` headings) and INSIDE the H9 entry
    (between `## H9` and `## H10`) of `src/gateway/SUBSTRATE-HAZARDS.md` — a mention elsewhere in
    the file satisfies nothing — and the landed section cites H7 and H9 back. —
    `test/scripts/erasure-seam.test.ts` and `grep -n "H7\|H9" spec/32-erasure-seam.md`
11. **The finding is tracked, not absorbed:** before this section lands, the ESM residency
    violation (§32.3.1) has its own ticket — a shard whose TITLE names the ESM/health residual —
    and the landed §32.3.1 text cites that ticket by id, so the one disclosed live over-claim
    cannot ship without a tracked owner. Verified directly on the property, never by keyword:
    read the id out of the landed row with `grep -oE "T[0-9]+" spec/32-erasure-seam.md`, then
    `adlc ticket show <that-id>` names the residual in its title.
12. **The landing diff is process-layer ONLY.** Not a narrowed denylist but an allowlist: every
    changed path is under `spec/`, `SPEC.md`, `scripts/`, `test/scripts/`, `.github/`, `.adlc/`,
    `journal/`, `JOURNAL.md`, or is the cross-link edit to `src/gateway/SUBSTRATE-HAZARDS.md` —
    so no store driver and no gateway erasure path (ingest, reads, gateway, resolvers, container,
    repair, erase) can move under this ticket at all. —
    `git diff --name-only main | grep -vE '^(spec/|SPEC\.md|scripts/|test/scripts/|\.github/|\.adlc/|journal/|JOURNAL\.md|src/gateway/SUBSTRATE-HAZARDS\.md)'` (empty)
