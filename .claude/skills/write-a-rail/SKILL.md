---
name: write-a-rail
description: Use when you write, change or repair a Loam test (a rail), when a test is flaky, or when you must prove that a new test fails without the change. Gives the both-levels rule, erasure test shape, fixtures, the red measurement, the revert probe, and the flaky-test method.
---

# Write a rail

A rail is a test that pins one behavior. A rail that can pass without the behavior is a bug.

## Assert at both levels

Ask two questions in each rail:

- Delta level: what is in the store, in bytes or in deltas?
- Object level: what does a reader see through a Schema, a View, or an endpoint?

A structural read such as `reactor.negationsOf(...)` is still delta level. One level alone misses
real bugs:

- Object level alone: the API said "forgotten", and the plaintext stayed in the sqlite file.
- Delta level alone: the right deltas arrived, and a reader still saw a retracted claim as live.

When the two levels disagree, that is usually the bug. If one level is out of scope, name the gap
in the test title: `it("... [gap: no endpoint assertion]")`. Say which test would close it.

## Erasure rails

- Every erasure rail is two-sided. The target is gone, and a named live bystander survives.
- Check the bytes on disk, not only a count or an API answer.
- Use only the test's own `mkdtempSync` dir. Never `~/.loam`. Never `demos/village/homes/`.

## Fixtures

- A server test that needs a login imports `test/helpers/session-fixture.ts`.
- It gives `signIn`, `cookiesOf`, `valueOf`, `formTokenOf` and `SAME_ORIGIN`. Write no new copy.
- Other shared helpers live in `test/helpers/`. Look there first.
- A user-facing change earns one end-to-end test of the real surface. Drive the CLI, the endpoint,
  or a real browser.
- Unit tests prove the mechanism. The end-to-end test proves a person can reach it.

## Prove the rail is red

Measure. Do not reason about it.

1. Make a worktree at the base: `git worktree add <dir> origin/main`.
2. Copy the new test files into it.
3. Run `npx vitest run <files>` there. Every new case must fail.
4. A case that passes on the base is a control. Say so in its title, or fix it.

Then run a revert probe on the branch:

1. Snapshot the guarded file: `cp <file> <scratch>/`.
2. Delete or break the guard.
3. Run the named test. It must go red.
4. Restore the file from your snapshot. Never use `git checkout` to restore it.

## A flaky test

A flaky test is fixed now (Myk, 2026-07-23). It outranks the task in hand.

1. Measure both directions: under load and in isolation, on the branch and on `origin/main`.
2. Decide which bug it is:
   - A test bug: the fixture does not force the behavior.
   - A spec bug: the promise is weaker than the test states.
3. Fix that bug.
- Never widen the assertion. Never add a retry loop.
- If you cannot fix it the same day, use `it.skip`. Put the reason and a tracking id (an issue or PR
  number) in the title.

## Periodic writers

A periodic writer either replaces one standing record or writes nothing on a no-op cycle
(SPEC §49.1). Give each one a quiet-cycle test. `test/federation/pulse-law-audit.test.ts` is the
shape.
