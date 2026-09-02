# Rails-red is a measurement, and it catches what the lenses miss

*2026-09-02, landing §58 S1 (T262).*

P3 says record `rails-red`. For most of this repo's history that record has been a sentence: *the
rails were written first, so of course they were red.* Landing T262 turned it into a measurement —
copy every new rail onto `main` and run it there — and the measurement disagreed with the sentence.

Fifteen rails went to `main`. Thirteen failed, which is what the sentence claimed. **Two passed.**

Both were in `test/server/read-scope.test.ts`, the file whose entire subject is that a bound
connection reads one container and not the store:

- The time-pin case wrote 31, pinned the moment, wrote 32, and asserted 32 now and 31 at the pin.
  Every one of those assertions holds when a connection reads the whole store, because nothing in
  the case was ever out of scope. It asserted a clock.
- The re-consent case asserted that after moving to a second container the read falls back to the
  person's own claim. It appended that claim *after* the connection's write, so the fallback was
  the newest delta by timestamp. It asserted a clock too.

Neither could tell scoping from its absence. Both had been read by five fresh-context lenses,
including one whose only job is asking *could this pass with the fix reverted?* The lenses found
three real defects in the same diff — a rail that could not see its own guard, a refusal with no
rail anywhere, and two doors that met a bound bearer unscoped — and did not find these two. A
model reading a test asks whether the assertions look right. It does not run them against a tree
where the feature is absent.

The repair, in both cases, was to put something out of scope that would win if scope were ignored:
a later claim from outside the container before the pin, and the person's own claim before the
connection's write rather than after. Then `main` fails all fifteen.

**So `rails-red` is cheap to measure and should be measured.** A worktree at the base, the new rail
files copied in, one `vitest` run. It costs under a minute and it is the only instrument that
answers the question the record claims to answer. A rail that passes on the base is not a rail
yet, however carefully it was reviewed — and it will keep passing forever, because that is exactly
what a hollow rail does.

The same run has a second use. It names which rails are *controls* rather than gates: a case that
legitimately passes on the base is asserting a bystander, and it should say so in its own text
rather than sit in the count.

Two smaller things this landing paid for, recorded so the next window does not:

- **A revert probe is worth its minute.** Deleting the strike filter in `boundGroundFor` left the
  whole suite green, because the fixture's container was `shared` and the scope's own negation
  closure carried the strike. The clause only binds for a `separate` container, and no fixture
  built one. Mutation testing did not reach it either; it takes a fixture that does not exist.
- **A test run beside a live `hollow-test` is not evidence.** One rail failed in a way that made no
  sense, and the cause was the mutation run editing the tree under it. The rule already written
  down is to serialize them; the tell is a failure you cannot explain from the diff.
