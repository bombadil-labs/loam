# §36 phase 9 — The login delay (T130)

**Revision 2.** An independent premortem read revision 1. It named nine ways this could fail in
production. Six were already answered by the salvage's ordering and this spec's criteria; three
sharpened a criterion. The folded causes are recorded under "## Premortem — what revision 2 answers"
and the sharpened criteria are 8, 13 and the new 16.

**Working spec.** P1's gateable instrument for ONE phase of the fifteen-phase plan at
`.adlc/specs/users-oauth-phasing-plan.md`. It becomes prose in `spec/36-users-and-sessions.md` only
at landing. Every criterion below names its verification — a test title in
`test/server/login-delay.test.ts`, or a backtick command — or `spec-lint` fails it as a wish.

## What this phase delivers

A per-username **delay** that replaces a lock. A wrong password makes the next attempt for that name
wait longer, up to a cap. There is no lock, no expiry to wait out, and nothing scarce for a flood to
steer. The state lives in the home, in `login-locks.json`, so `loam user unlock` — a separate
process — can clear it.

It **delays; it never denies and never locks.** A correct password is admitted after any number of
failures. That is the promise every criterion protects.

The state module is `src/server/login-locks.ts`. The wiring is `postLogin` in
`src/server/session.ts`: the wait is paid before the password comparison, the count grows on a
failed match, and a correct password clears it. This phase also makes `loam user unlock` meaningful —
it is the command that clears a record this phase writes.

**Two vocabularies live here, deliberately.** Anything naming the FILE keeps the lock word —
`login-locks.json`, `locksPath`, `readLocks`, `writeLocks` — because that name is on disk and in the
erasure report's unswept list. Anything naming the BEHAVIOUR uses the delay word — `FailureRecord`,
`delayFor`, `delayMs`, `clearRecord`. So `locks` in `login-locks.ts` means "the rows of
`login-locks.json`", never "a lock somebody holds"; there is no such thing here any more.

**Must not.** It must not refuse a correct password. It must not lock.

## Acceptance criteria

Each criterion is proved by the named `it(...)` in `test/server/login-delay.test.ts`. Where a
criterion is a property of a pure function, the test drives that function directly with an injected
clock; where it is a property of the door, the test drives a real login server with an injected wait
so no assertion sleeps.

1. **Twenty failures do not lock; a correct password is admitted after any number of failures.**
   Twenty wrong passwords in a row leave the door still opening for the right one.
   Verified by `it("twenty failures do not lock, and a correct password is still admitted")`.

2. **The wait grows with failures and is capped.** Pin the table against hand-written literals, not
   against the code's own answer: base, doubled once per failure after the first, never past the cap.
   Verified by `it("delayFor doubles per failure and caps, against pinned literals")`.

3. **The cost is paid BEFORE the password comparison.** A refusal after the compare leaks the answer
   through the status code exactly as a 401 would. So a correct password and a wrong password for a
   name with an accrued count both block on the same wait: neither response resolves while the wait
   gate is closed. Positive control: opening the gate resolves the correct one to 200 and the wrong
   one to 401, so the block was the wait and not a hang.
   Verified by `it("pays the wait before the compare, so a hit and a miss block alike")`.

4. **A waiting attempt spends no hash budget while it waits.** With `maxConcurrentHashes` of 1 and
   one name held in-flight inside its wait, a DIFFERENT name still completes a login. The witness:
   the first name's response is asserted unresolved at the moment the second resolves.
   Verified by `it("a waiting attempt holds no hash slot, so another name gets in")`.

5. **A flood against one name does not slow a different name.** A name with a large accrued count
   owes a large wait; a never-failed name owes zero on the same store and same clock.
   Verified by `it("a flood against one name leaves a different name at zero wait")`.

6. **Overlapping attempts each count.** `noteFailure` reads, increments and writes with no await
   between them, so two attempts arriving together each land a distinct increment rather than sharing
   one snapshot. A snapshot carried across the hash would make the limit `maxFailures × concurrency`.
   Verified by `it("two overlapping failures each increment the count")` (the count reads two, not
   one) and by `grep -n "readLocks(home)" src/server/login-locks.ts` proving `noteFailure` re-reads
   the file itself rather than accepting a table read before an await.

7. **Every concurrency fixture carries an in-flight witness.** A fixture that completed early leaves
   the rail green having tested nothing. Each door-level concurrency test asserts, at the decisive
   moment, that the attempt it claims is waiting has NOT resolved — a settled `Promise` sentinel
   checked before the gate opens.
   Verified by `it("the concurrency fixtures prove their held attempt is genuinely in flight")`.

8. **A wall-clock step backwards does not erase an accumulated wait, and the wait is a pure function
   of the count.** The record's decay reads a wall clock (it outlives the process and `loam user
   unlock` reads it from another one). A backward step leaves elapsed time negative, which is never
   past the forget window, so the wait stands. Crucially the applied wait is `delayFor(count)`
   measured from the count itself, NOT deadline arithmetic against `lastFailureAt` — so a clock
   moved forward OR backward changes the slept milliseconds by nothing. (Premortem cause: a
   deadline computed as `lastFailureAt + delayFor − now` would let an NTP forward step drive the
   remaining wait to zero mid-flood.)
   Verified by `it("a wall-clock step backwards leaves the accumulated wait in place")` at the unit
   level (`delayMsIn` with a `now` earlier than `lastFailureAt`), by
   `it("the applied wait equals delayFor(count) whichever way the clock steps")` (the injected
   `waitFor` is called with exactly `delayFor(count)` under a forward and a backward `limitNow`), and
   at the door level (a seeded row, `limitNow` stepped back, the attempt still waits, proven by the
   in-flight witness).

9. **Both writes fail OPEN, and the consequence is named: fail-open means no budget at all.** A write
   fault on the failure-recording path and on the clear-on-success path must not turn a correct
   password into an error with a session already seated. On an unwritable home a correct password is
   admitted 200, and a name with no row waits zero (the budget is gone) — never a 503.
   Verified by `it("a write fault on record still admits a correct password (fail-open, no budget)")`
   and `it("a write fault on the success-clear path still admits the correct password")`.

10. **The record table is bounded, and no eviction order is claimed as a defence.** Past `maxTracked`
    the weakest rows (fewest failures, oldest among equals) are evicted. State the two squat shapes
    and that the squat decays: a WIDE squat (`maxTracked` seatings per round) holds a chosen name at
    zero with no standing cost and does not decay; a NARROW squat (one seating per round plus
    `maxTracked − 1` refreshes per forget window) holds it at zero but decays after one idle window.
    Verified by `it("the table is bounded at maxTracked and evicts the weakest")`,
    `it("a wide squat holds a chosen name at zero and does not decay")`, and
    `it("a narrow squat holds zero until one idle window, then the charge returns")`.

11. **No guesses-per-second bound is stated.** Concurrent attempts read one count and pay one wait,
    so a caller buys `maxConcurrentHashes` guesses per wait, not one — a per-second figure would be
    wrong by orders of magnitude against a caller who opens more than one socket. The observable: N
    concurrent attempts against one accrued name pay ONE wait, not N serialized waits.
    Verified by `it("N concurrent attempts pay one wait, not N (no rate bound is sound)")` and by
    `grep -niE "per second|guesses/s|/sec" src/server/login-locks.ts` returning no rate claim.

12. **The delay keys on the USERNAME, never on the client address.** A rotated `X-Forwarded-For` must
    not reset the count — the header is the caller's to write, so an IP-keyed limiter would defend
    nothing. Twenty failures against one name from twenty distinct forwarded addresses still
    accumulate one wait.
    Verified by `it("twenty failures from twenty forwarded addresses accumulate one wait on the name")`.

13. **There is a global cap on unauthenticated hash work, and the delay rides it.** The cap
    (`maxConcurrentHashes`, already shipped in phase 5) refuses the surplus attempt with a 503 rather
    than queueing it unboundedly, and a correct password for a name already seated in the hash budget
    is still admitted. A waiting attempt does not occupy the cap (criterion 4), so the two limits
    compose rather than deadlock. **The cap is re-read AFTER the wait, in the same synchronous span as
    the increment** — checking it before an unbounded wait would let every waiting attempt pass a
    stale free-budget snapshot and then all hash at once when their waits elapse. (Premortem cause:
    an `await` between the cap check and the increment defeats the cap under a flood.)
    Verified by `it("the hash cap refuses the surplus attempt rather than queueing it")`,
    `it("the cap is re-checked after the wait, so a second released waiter draws the 503")` (two
    accrued-name waiters released together with `maxConcurrentHashes` 1: the first hashes, the second
    reads the cap AFTER its wait and gets 503 — proving the check follows the wait, not precedes it),
    and `it("a correct password is still admitted while the hash cap is saturated by other names")`.

14. **A forgotten record does not resurrect an old wait.** The forget window is `forgetMs` of silence,
    measured from the last failure. Rail both sides: inside the window the wait persists; past it the
    name starts clean at zero.
    Verified by `it("inside the forget window the wait persists")` and
    `it("past the forget window the name starts clean")`.

15. **The record file's faults are named per fault, and a non-regular-file path is refused (T120).**
    A FIFO at `login-locks.json` blocks the login door forever, because `readLocks` has no
    non-blocking read. This phase owns the file, so T120 folds in here: refuse a record path that is
    not a regular file rather than opening it, and bound the test with a real timeout so a regression
    hangs the suite visibly. A damaged file reads as no records (fail-open); an unreadable file names
    its own fault to `onFault`; a non-regular-file path is refused before any blocking read.
    Verified by `it("a FIFO at the record path is refused, not opened", { timeout: 4000 })`,
    `it("a damaged record file reads as no records")`, and
    `it("a directory at the record path is refused by name")`.

16. **The failure key is byte-identical to the credential-lookup key.** `noteFailure`/`delayMs`
    receive the SAME `user` string that `entryFor(credentials, user)` looks the credential up with.
    No normalization sits between them, so two surface forms that resolve to one credential cannot
    accumulate two separate rows — which would leave the attacked account paying near-zero forever
    while the table fills with near-duplicates. (This phase adds no case-folding; `userNameDefect`
    already fixes the admissible byte set at phase 5.)
    Verified by `it("the failure count keys on the same string the credential lookup uses")` — twenty
    failures against one name grow one row to twenty, and the door reads that count through the same
    key it hands `verifyPassword`.

## What this phase deliberately does not assert, and which rail closes each gap

- **No timing floor anywhere.** A timing rail is a flake by construction. The wait is proven by an
  injected `waitFor` whose gate the test controls, and the delay TABLE is proven by `delayFor`'s
  return value against pinned literals — never by a stopwatch.
- **The squat is not claimed to be defended.** Criterion 10 states the squat's cost and that the
  narrow shape decays; it does not rail eviction order as a defence, because it is not one.
- **`loam user unlock`'s CLI surface** is phase 3's file (`test/cli/user-roles.test.ts` shipped the
  command); this phase makes the record it clears real. The clear path itself (`clearRecord`,
  `clearAllRecords`) is unit-tested here where it is defined.

## Premortem — what revision 2 answers

An independent read named nine failure causes. The load-bearing ones and where each is closed:

- **The cap check drifts before the wait.** An `await waitFor(...)` between `hashesInFlight >=
  maxHashes` and `hashesInFlight += 1` defeats the cap under a flood. Closed by the fixed ordering
  (wait → cap check → increment, no await between the last two) and railed by criterion 13's second
  test.
- **A waiting attempt holds a hash slot.** If the increment sits before the wait, a flood of wrong
  passwords against one name squats the whole budget and 503s that name's own correct password — the
  lock this design forbids. Closed by incrementing only immediately before the hash; railed by
  criteria 4 and 13.
- **A write fault reaches the outer 503 guard.** `noteFailure` and `forgetFailures` throw on an
  unwritable home or a non-file path; unwrapped, that throw becomes a 503 over a correct password.
  Closed by wrapping both in fail-open helpers that report to `onFault` and proceed; railed by
  criterion 9, both paths.
- **`readLocks` blocks forever on a FIFO (T120).** The salvage's `readLocks` calls `readFileSync`
  with no stat guard. Closed by refusing a non-regular-file path before any read; railed by
  criterion 15 under a real timeout.
- **The applied wait is deadline arithmetic.** `lastFailureAt + delayFor − now` lets a clock step
  erase or inflate a wait. Closed by making the wait a pure `delayFor(count)`; railed by criterion 8.
- **A concurrency witness that never proves in-flight.** Closed by a settled-`Promise` sentinel
  checked after a microtask boundary, with a positive control (criterion 7), and re-checked by
  `hollow-test` on the await-ordering line at P5.

Two causes are accepted, not closed, and stated so no operator over-trusts the delay: the WIDE squat
holds a chosen name at zero wait with no standing cost and no decay (criterion 10 — the delay is a
serial-guesser tax, never the brute-force control; the hash cap and any account-level control are
separate), and the delay never claims a guesses-per-second bound (criterion 11).

## Provenance note for the landing

At landing this phase EDITS `spec/36-users-and-sessions.md` to add its §36.9 subsection (the arc's
ninth phase, per plan §9d), removes the phase-9 `notYet` item from
`demos/capabilities/chapters.mjs`, and adds one `{says, spec, proof}` claim citing
`test/server/login-delay.test.ts`. It archives T120 (folded in here) and T130.
