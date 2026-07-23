# Premortem — T67 (`.adlc/specs/11-erasure-tier-completeness.md`)

Answered in-session (`adlc premortem --prompt-only`; no provider key on this box). Per CLAUDE.md,
`premortem` judges the ARTIFACT and is self-answerable — unlike `adversarial-review`, whose whole
product is independence.

**The project shipped and FAILED. Here is how.**

## C1 — A test double taught to lie (HIGHEST probability, and it is the ticket's own hazard)

`test/store/mirror.test.ts` contains hand-rolled `StoreBackend` object literals — `unreachable()`
(line 29), `flaky()` (line 37), and a silently-retaining side at line 198. Adding a required `holds`
member breaks all three at compile time. The cheapest fix that makes TypeScript quiet is
`holds: () => Promise.resolve(false)`.

That single line converts the fix into the bug: `false` means *no bytes held*, so every erase test
riding that double reports a clean completion no matter what the tier retained. The rails go green,
the leak is untouched, and the green bar is now evidence FOR the leak. This is hazard H7 arriving
through the test suite instead of through the code — and it is exactly the shape (`removed === 0`
skipping the scan) the ticket exists to delete.

**Defense:** an explicit acceptance criterion. `unreachable()` REJECTS `holds` (a tier that cannot
be reached has not proven anything); `flaky()` delegates to its inner backend; the retaining double
at line 198 reports `holds === true`, because it is retaining. A double whose `holds` disagrees with
what it actually keeps is a defect, not a fixture.

## C2 — `hollow-test`'s "0 survivors" is redefined the moment it is inconvenient

`src/gateway/erase.ts` is 332 lines of tombstone vocabulary, readers, and two impls. Mutating the
WHOLE file will surface survivors that have nothing to do with T67 (prose in error strings, the
`forgottenSince` sort, the `seen` cycle guard). Faced with a criterion demanding zero, the
overwhelmingly likely move is to relax the criterion rather than the code — and the relaxation lands
in the same PR that claims the criterion was met.

**Defense:** scope the criterion to the lines this change touches, and require the FULL survivor
list in the PR body with a one-line disposition for each pre-existing one. A cap that is never
silent, per CLAUDE.md.

## C3 — `holds` inherits `purge`'s blindness because the same author wrote both

The invariant "`holds` sees at least what `purge` reaches" is satisfied trivially and uselessly if
`holds` is written by copying whatever the driver's `purge` already believes. The archive is the live
example: a `holds` "optimized" to consult `onDisk` returns false for a file this handle never wrote —
a crash-left `.tmp`, a misfiled copy — which is precisely the byte the probe exists to find (H8:
index the work you COMPLETED, never the data you expect to FIND).

**Defense:** the rail plants the straggler BEHIND the seam (a raw `writeFileSync`, never an
`append`), so a bookkeeping-based `holds` cannot see it and the rail goes red.

## C4 — Erasure becomes unavailable whenever the cold tier is offline

Today a mirror whose archive lives on an unmounted disk still lets `erase` return success (wrongly).
After the fix, `MirrorBackend.holds` rejects when a tier rejects, so `erase` rejects — every erasure
against a store with an offline mirror now fails, and the operator's only remedy is to bring the
tier back. That is *correct* (refusing beats a false completion) but it is a real availability
change on the compliance path, and if it is discovered in production rather than named here, the
fix-under-pressure will be to swallow the tier error — reintroducing the leak with a note saying
"best effort."

**Defense:** name it in the spec as an intended consequence with its remedy, and make the error
message say which tier could not be proven clean. Not a swallowed error, ever.

## C5 — The §24.8 pool fan-out keeps the leak and the ticket closes anyway

`eraseReplicaImpl` purges an attached quarantine pool and asserts NOTHING about the bytes. If open
question 2 is answered "later," T67 lands, the mirror leak closes, and the identical false
completion survives one call away — with a green P5 and a spec section saying completeness is
decided by byte-presence. The next reader will believe the spec.

**Defense:** either fix it in this PR or open its ticket in this PR. Not "later."

## C6 — P5 routes zero lenses and the clean result is read as a clean review

`npm run p5 -- --base main` reads the diff. A diff dominated by five small driver methods may route
as store plumbing and never name `loam-erasure`. A zero-lens routing is a legitimate output for a
docs diff; here it would be a triage miss, and the empty result reads identically to a pass.

**Defense:** check the routing NAMES `loam-erasure` and `loam-hollow-rail`. If it does not, that is
itself a finding about the triage script, recorded rather than shrugged at.

## C7 — The retaining-driver rails prove the verdict, not any real driver

The two tier-blindness rails require a driver that silently retains — no shipped driver does that
(sqlite throws, archive throws, memory cannot). So those rails exercise the CONTRACT through a fake.
That is legitimate (the seam admits third-party drivers) but insufficient alone: a fake-only rail
set would pass even if every real driver's `holds` were wrong.

**Defense:** the archive `.tmp` straggler criterion is the real-driver counterpart, and the contract
suite asserts `holds` against all six harnesses. Both, not either.
