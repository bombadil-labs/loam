## 2026-07-16 — T16: the fan-out re-derives its own reach

Audit 2's HIGH and its two MEDs, fixed as the one unit they always were
([#120](https://github.com/bombadil-labs/loam/pull/120)). Every finding was the same mistake wearing a
different face: the §24.8 erasure fan-out **trusted a condition instead of re-deriving it** — trusted the
pool's trust policy to admit the operator's tombstone (a `closed` pool deliberately doesn't), trusted the
attached-pools set to be the whole tree (a pool of a pool isn't in it), trusted the seeding filter to pass
the holes along with the ground (a domain-shaped `admit` sees a tombstone as just another delta).

The fix runs on one doctrine, now stated in the code where the next reader needs it: **a fan-out must
re-derive its own reach.** `eraseReplica` checks authorization (`eraseDefect`) first, explicitly, and
refuses a forged order loudly *without purging*; crosses the federation door with an explicit admit —
trust is admission **configuration** (whose data do I want), erasure is **law** (§11 through the one-way
glass unconditionally, and the pool is the operator's own replica, §24.1); recurses into its own pools,
cycle-guarded; and if the lawful tombstone still did not land, **throws**, because the only remaining
cause is the store itself failing and the operator must learn the erasure did not complete. The seeding
edge passes operator tombstones unconditionally — a membership filter narrows what a pool *sees*, never
what it must *forget*.

Two things worth keeping from the build:

- **The layering the ticket predicted held up under verification.** The safety of the admit override
  rests entirely on `admit` (trust) and `eraseDefect` (authorization) being separate gates inside
  `federate` — and they are, checked independently, defect before admit. The forged-tombstone rail from
  slice 1 survived verbatim in its byte assertion (the fix removed a trust filter, never a check), gaining
  only a loudness assertion: the refusal now throws instead of silently no-opping, which is better manners
  toward a caller who handed over a forgery.
- **The rails came first and failed one-per-finding.** (a) closed-trust byte-at-rest, (d) transitive
  P→Q→R, (e) pre-attachment erasure through a filtered seed — each red on the pre-fix code, exactly the
  audit's three findings. (b) loud-failure and (f) knob-still-narrows passed from the start, as contract
  guards should. An honest construction note on (b): a `FailingBackend` whose `append` throws — a real IO
  death at the pool's door, not a mock of the guard under test.

The village now exercises the law where it was silently broken: the almanac closes its trust door, nests a
pool inside a pool, erases once — and the byte is gone from every tier, content-string-at-rest.
`phase-quarantine.mjs` 6/6. spec/24 §24.8 carries the corrected contract in place (the rare
edit-a-built-section case), 628 tests green. Erasure surface → Myk's merge.
