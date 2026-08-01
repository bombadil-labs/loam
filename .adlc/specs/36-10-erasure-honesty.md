# §36 phase 10 — Erasure honesty (T131)

**Revision 2.** An independent premortem read revision 1 and named four ways it could fail. Two
sharpened the spec: the disclosure must state its own SCOPING PRINCIPLE or it recreates the very H7 it
cures (finding A, now the "Delivers" scoping paragraph and criterion 7), and the two surfaces must be
PROVEN to share one text or they drift (finding B, now folded into criteria 1 and 2). The other two
were already answered — the claim is scoped to `postLogin` and does not touch an open session
(finding D), and the frozen-rail check is criterion 6's sibling (finding C, a P4 verification). The
folded causes are recorded under "## Premortem — what revision 2 answers".

**Working spec.** P1's gateable instrument for ONE phase of the fifteen-phase plan at
`.adlc/specs/users-oauth-phasing-plan.md`. It becomes prose in `spec/36-users-and-sessions.md` only
at landing. Every criterion below names its verification — a test title in
`test/server/users-erasure.test.ts`, or a backtick command — or `spec-lint` fails it as a wish.

## What this phase delivers

The **unswept-surface disclosure**. §36 keeps two pieces of user data OUTSIDE the delta store, in
the home: password hashes in `credentials.json` (§36.1) and per-username failure records in
`login-locks.json` (§36.9). Erasure purges DELTAS from every tier; it never touches a home file. So
an erasure report that reads as exhaustive is dishonest by omission — the H7 shape, on the one
surface whose report is a legal claim.

This phase makes the report NAME those two files as surfaces erasure does not sweep. The disclosure
reaches BOTH the live health report (`gateway.health()`, served at `/health`) and the re-issuable
compliance receipt (`gateway.receipt()`), because the receipt is the document a reader treats as
proof and its list must read as exhaustive.

**It changes NO purge.** Not one delta is removed that was not removed before. The diff changes only
what the report SAYS. Per the standing erasure rule, a change that makes a report more honest
self-merges; a change that widens what gets purged is Myk's merge. This is the first kind.

**Why this is safe by construction.** You cannot overclaim by claiming less. The disclosure adds
sentences that say "erasure did NOT reach here". It removes no guarantee and deletes no byte.

**The scoping principle, so the disclosure is not the next H7.** A disclosure that itself omits a home
surface recreates the exact hazard it cures, one layer up. So the list is defined by a RULE, not by a
guess: it names every home file that holds a DATA SUBJECT's per-user data — keyed by the human's user
name — outside the ground. That rule resolves to exactly two: `credentials.json` and
`login-locks.json`. Seed files in the home hold the store's own signing keys, not a subject's data, so
they are not on this list. `oauth.json` is a home file too and erasure does not sweep it either, but it
is keyed by CONNECTOR (`clientId`) — its grants and token digests are a connector's identity, not a
human user's record — so erasing a user's record leaves no subject-keyed bytes there and it is off THIS
list. If a later surface ever holds subject per-user data, that phase OWES this list an entry — stated
here so the obligation is not lost. The list is a shared constant read by both surfaces, so "complete"
is checked in one place.

## The one behaviour this phase also rails (it does not add it)

Forgetting a user's RECORD DELTA already shuts the login door, and this phase pins that in a rail
rather than building it. `resolveUserView` returns undefined when the ground no longer names the user
(`session.ts` reads `rolesOf`, which is then empty), so `postLogin` refuses with its ordinary 401
even when the user's `credentials.json` entry still stands. This is the security counterpart of the
honesty: `credentials.json` is unswept, so the GROUND — not the credential file — must be the
authority the door trusts. Phase 5 shipped the login door and phase 8 the ground read; this phase
adds no precondition to that door, it proves the door already fails closed.

## Out of scope, stated as a boundary

**Erasing a credential entry is OUT OF SCOPE and stays a separate ticket.** `src/server/credentials.ts`
exposes no remove-entry function, and this phase adds none. The disclosure names that boundary
plainly so a reader does not mistake an unswept file for a bug: removing a `credentials.json` entry
is a separate operation, not part of erasure. Clearing a `login-locks.json` record is likewise a
separate operation (a record decays on its own; `loam user unlock` is its cure).

## Must not

- It must not WIDEN what gets purged — no new tier, no bigger condemned set, no more aggressive
  fan-out. Verified by `grep`-diffing the purge paths (criterion 6).
- It must not add a precondition to the login door. Phase 5's and phase 8's rail files are untouched.
- It must not name a home PATH in any caller-facing string — the disclosure names the file
  BASENAMES only, never `<home>/...`, keeping the receipt free of the leak §29.7 forbids.

## Acceptance criteria

Each criterion is proved by the named `it(...)` in `test/server/users-erasure.test.ts`, except
criterion 6, which is a `grep` command. The disclosure text is a single shared constant
(`UNSWEPT_AUTH_SURFACES` in `src/gateway/erase.ts`) read by both surfaces, so the two can never drift.

1. **The health report NAMES both files as surfaces it does not sweep.** `gateway.health()` returns a
   top-level `nonSwept` list, and that list contains one entry naming `credentials.json` and one
   naming `login-locks.json`, each stating erasure does not reach it. The expected file names are
   hand-written in the assertion, not read from the report (H10). Positive control: the same entries
   state that erasure DOES purge deltas, so "unswept" is a claim about these two files and not a
   blanket disclaimer that would be satisfied by any prose. Verified by
   `it("health() names credentials.json and login-locks.json as surfaces erasure does not sweep")`.

2. **The disclosure reaches the RECEIPT, not only `health()`.** A re-issued `gateway.receipt()` for a
   real graveyard carries the SAME two named entries in its `nonClaim` list. The two files are named
   by hand in the assertion. This is the exhaustiveness fix: a receipt whose `nonClaim` omitted the
   two home files would read as complete while a forgotten user's hash sat in `credentials.json`.
   Verified by
   `it("the receipt's nonClaim names credentials.json and login-locks.json")`.

3. **A login for a user whose RECORD DELTA is absent is refused — asserted at BOTH levels.** Erase a
   user's record delta while a valid `credentials.json` entry for that user still stands. Verified by
   `it("refuses a login whose user record delta was erased, at the delta and the door levels")`.
   - Delta level: `gateway.reactor.get(recordId)` is `undefined` after the erase, and
     `resolveUserView`/`rolesOf` for that user resolve to undefined/empty; a live bystander user's
     record delta is still present and `rolesOf` still holds its role. Verified by the same
     `it(...)` in `test/server/users-erasure.test.ts`.
   - Door level: `POST /login` with that user's correct password answers the login refusal
     (401, body byte-identical to a wrong-password refusal) and sets no session cookie; the bystander
     user logs in over the same door and receives a session cookie.
   Verified by
   `it("refuses a login whose user record delta was erased, at the delta and the door levels")`.

4. **The credential entry SURVIVES the record-delta erasure — the boundary, two-sided.** After
   criterion 3's erase, `readCredentials(home)` still holds the erased user's entry (erasure did not
   sweep `credentials.json`), AND the bystander's entry is intact. This is the object-level proof that
   the file is unswept and the concrete meaning of criterion 5's boundary: the door is shut by the
   ground, not by any change to the credential file. Verified by
   `it("erasing a user record leaves credentials.json untouched, for the erased user and a bystander")`.

5. **The disclosure survives every erasure path**, so it cannot become conditional on outcome —
   verified by `it("the unswept disclosure is present on a zero-erasure, a partial, and a refused path")`.
   The two named entries are present on the report after each of four distinct paths:
   - a **zero-erasure** store (`health().nonSwept` names both files with `promised === 0`);
   - a **partial / unproven** erasure (a tier that cannot be proven clean leaves `health().status`
     `settling` or `unproven`, and `nonSwept` still names both files);
   - a **refused** erasure (an `erase` that throws leaves the store unchanged, and a following
     `health()` still names both files);
   - the **two-phase cut** (the receipt derived from a graveyard names both files, criterion 2).
   Verified by
   `it("the unswept disclosure is present on a zero-erasure, a partial, and a refused path")`
   and criterion 2 for the cut.

6. **No purge widened.** The set of ids handed to any `.purge(...)` / `backend.purge` call, and the
   condemned-set construction in the cut, are byte-unchanged from `main`. Verified by
   `git diff main -- src/gateway/erase.ts src/gateway/slate.ts | grep -E '^[-+].*purge\(' ` returning
   no line that adds an id to a purge, and by review of the diff confirming every `+` line is a
   disclosure string, a `nonSwept` field, or a shared constant — never a removal.

7. **The two surfaces read from ONE source, so they cannot drift, and the source is exactly the two
   scoped files.** The `nonSwept` list from `health()` and the two named entries in the receipt's
   `nonClaim` are the SAME strings, and there are exactly two of them, each naming one file. A third
   entry, or a mismatch between the surfaces, fails the rail — this is the completeness guard for
   finding A, so the disclosure cannot silently grow a guess or drop a file. Verified by
   `it("both surfaces disclose the same two named files, and only those two")`.

## Premortem — what revision 2 answers

- **A — the disclosure is the next H7.** A report that reads exhaustive while omitting a home surface
  is the hazard this phase exists to cure; a disclosure that omits one recreates it. Answered by the
  scoping principle (a RULE, not a guess), by the single shared constant, and by criterion 7, which
  pins the list to exactly the two scoped files so a later drift or omission goes red.
- **B — health() and the receipt drift.** Two hand-written copies would disagree after one edit.
  Answered by the shared `UNSWEPT_AUTH_SURFACES` constant and criterion 7's "same strings" assertion.
- **C — a frozen equality rail breaks.** T70's `store-health.test.ts` pins `health.erasure` with
  `toEqual`, so the new field is a TOP-LEVEL `nonSwept`, never a field of `ErasureHealth`. A P4 check
  confirms no whole-`StoreHealth` or whole-`nonClaim` equality rail exists to break.
- **D — "shuts the door" overclaims.** The claim is scoped to `postLogin`: a NEW login is refused. An
  already-open session is severed by `getLogin`'s re-read of `rolesOf` (phase 5), which this phase
  neither changes nor asserts. Criterion 3 asserts only the login refusal, not session severance.

## What this phase deliberately does NOT assert, and which rail covers each gap

- **No timing or flood assertion on the login door** — phase 5 and phase 9 own those. Criterion 3
  drives a real server only to prove the ground-shut refusal, using the same fixture shape as
  `test/server/login-door.test.ts`.
- **No assertion that `credentials.json` or `login-locks.json` is ever cleared** — that is the
  out-of-scope boundary (criterion 5's prose), not a promise this phase makes.
- **No new erasure behaviour** — criterion 6 is the guard that this phase is disclosure-only.
