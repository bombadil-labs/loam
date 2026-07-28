# §36 phase 3/15 — The bootstrap, the role commands and per-operator keys (T124)

**Ticket.** T124. **Status.** Working spec, build-stage. Myk reads and merges this PR (plan §9c) —
it is the trust surface and the largest phase. Implements decisions Myk already settled: role
assignment is CLI-only (plan §9), every operator is equivalent (plan §9a), roles are a SET.

**One sentence.** `loam user create/assign-role/remove-role` prove operatorship by reading
`<home>/operator.seed` — home access, nothing remote — and a role of `operator` additionally mints
the user their own signing key and trusts it through the existing `loam.grants` vocabulary, never a
widened role read.

**The three commands, in full — the one canonical signature, so no other section's shorthand is
read as a second one (adversarial review, round 3):**

    loam user create <name> [--operator] --home <dir>
    loam user assign-role <name> --role=<operator|actor> --home <dir>
    loam user remove-role <name> --role=<operator|actor> --home <dir>

`<name>` and `--role` are always both required on `assign-role`/`remove-role`; `--role` is never
positional. Elsewhere in this document, "`remove-role operator`" is shorthand for "`remove-role
<name> --role=operator`" — the name is whichever user the surrounding sentence names.

## 36.3.1 The model

1. **Home access is the only proof of operatorship these commands need.** They sign every delta
   with `<home>/operator.seed`, exactly as `loam init`/`loam serve` do. There is no remote path that
   mints a role. A session, however privileged once phase 8 lands, cannot call these commands.
2. **A role binding says what a user may DO. A grant says whose SIGNATURE counts.** These are
   different questions and different deltas. `assign-role --role=operator` files a `roleClaims`
   binding (phase 2's shape, unchanged) and, only for `operator`, a `grantClaims` entry at
   `loam:store` whose `subject` is the user's own fresh public key. `lawfulStrikersJson`
   (`src/gateway/accounts.ts`, unmodified) already extracts exactly that shape and already admits it
   only when its author is the store's own seed — so a delegated operator's own grant for a third
   party never widens the trusted set (plan §9, closing finding 8.1/8.2 the same way phase 2 did).
3. **The user's own seed never enters the ground.** It is written to `<home>/user.<name>.seed`,
   mode 0600, beside `operator.seed` — the same reason a credential does not enter the ground: the
   ground replicates under federation, a local secret must not. **`<name>` is checked against
   `userNameDefect` (`src/server/users.ts`, unchanged) BEFORE any path is built from it** — the same
   guard `create` already runs before touching `credentials.json`. Its charset
   (`^[a-z0-9][a-z0-9._-]{0,63}$`) admits no `/`, so a name can never walk the seed path outside
   `<home>`; a name is a single path component, never a traversal (adversarial review, round 1).
   **Writing this file always OVERWRITES whatever is already at that path, unconditionally.** The
   seed file is not itself a source of truth — the GRANT is. A leftover file at that path is either
   an orphan from a run that crashed before its grant landed (nothing depends on it) or the OLD
   file from a role that `remove-role` already struck (its grant is already dead, so the bytes hold
   no live authority). Neither case has anything worth preserving (adversarial review, round 1).
   **THE ORDER IS FIXED, and it is what makes the overwrite safe (adversarial review, round 2): the
   fresh keypair is minted IN MEMORY, the ground append (role + grant, naming the NEW public key)
   runs FIRST, and the seed file on disk is written ONLY AFTER that append succeeds.** If the
   append fails, the disk file is untouched — no old key is destroyed for a grant that never landed.
   This is the same "deltas land first" ordering `create` already uses for the credential file
   (phase-1 precedent), applied to the seed file instead.
   **REVISED, round 4 — no rollback; fold the failure into the recovery path §36.3.1.7 already
   covers.** Round 3's answer here was a same-command rollback (negate the just-landed deltas). Round
   4 found it incomplete two ways at once: `create --operator` lands a USER claim too, which that
   rollback forgot, and a rollback that itself needs to write to the ground can fail for the SAME
   reason the seed write just did (a full disk is a full disk). Chasing "what if the rollback also
   fails" is a hole with no bottom. So: **there is no rollback.** If the ground append (user, role,
   and for `operator` the grant — one call, so it lands whole or not at all) succeeds and the LOCAL
   write after it (the credential entry, or the seed file) then fails, the command reports the local
   failure and stops. The ground already holds a live grant with no local seed file backing it —
   which is EXACTLY the state §36.3.1.7 already names and already gives a recovery path for: run
   `remove-role` (strikes the role; the grant is left live, and `remove-role` says so) then
   `assign-role` again (mints a fresh key, files a fresh grant). One recovery story instead of two,
   and it was already designed and already tested. `test/cli/user-roles.test.ts` forces the
   seed-file write to fail (an unwritable target) and asserts the command reports the failure
   honestly (never claims the role took effect for signing purposes) while the documented recovery
   path is exercised as its own case (§36.3.1.7).
   **Named residual risk, for Myk's read (adversarial review, rounds 2 and 5 — same residual, two
   routes to it).** However a user's key is copied off the box while still on disk — theft, a
   logged value, or (round 5) the local seed-file write itself failing right after a ground append
   already landed the grant for it — `remove-role` cannot find and strike that grant once the local
   file is gone or never existed (§36.3.1.7). The copied-off key stays trusted; running the
   documented recovery (`remove-role` then `assign-role`) mints a working NEW key but does not
   revoke the old one. This is not a NEW hole T124 opens: it is the SAME trust model plan §9 already
   accepts for `operator.seed` itself, which has no revocation path at all if copied off the box
   today. T124 applies that identical, already-accepted model to a second kind of seed file rather
   than inventing a weaker one. Closing it for real needs a way to find a grant by its own public key
   without the local file — a `loam grant list`/`revoke`-shaped command over `loam.grants`,
   independent of any seed file. That is follow-up work, not this ticket: naming it here rather than
   quietly building a partial version limits scope creep on the ticket Myk is already reading for
   its trust-surface decisions.
4. **DESIGN DECISION — the grant's verb is `admin`, not `write`.** Verb only changes two things in
   `accounts.ts`, both unmodified by this ticket: whether the grantee's OWN negations bind
   constitutionally (`standsFor`/`grantHeld(..., "admin", ...)`), and whether `tenantSchemaFor`'s
   admin-only audit counts them. Per §9a an operator holds "total authority over the whole store,
   unscoped" — the same standing the store's own seed has, which needs no grant at all because
   `standsFor` special-cases `author === operator`. `admin` is the closest existing verb to that
   equivalence; `write` would leave a second operator's own strikes not binding constitutionally,
   which is a narrower privilege than §9a describes. Neither verb changes anything OBSERVABLE until
   phase 8 wires a session to sign with this key — this bit is laid down now because the grant is
   filed now. Flagged here for review because it is a judgment call, not dictated by the ticket text.
5. **DESIGN DECISION — refining the ticket's delta counts by role.** Ticket criterion 1 says
   `create` "appends exactly two deltas"; criterion 8 says `assign-role` "appends ONE...  It appends
   nothing else." Both predate the per-operator-keys section, which then adds a THIRD (resp. SECOND)
   delta — the grant — specifically for `operator`. Read literally, "exactly two" and "appends
   nothing else" would forbid the very grant criterion A requires. This spec resolves it as: the
   counts in criteria 1 and 8 hold for `actor`; `operator` adds exactly one delta (the grant) to
   each. Rails pin both counts explicitly, by role, so this reading is checked rather than assumed.
6. **DESIGN DECISION — ticket criterion 6 (`loam user unlock --all`) is deferred whole to phase 9.**
   `login-locks.ts` does not exist on `main` — the plan's own table (§3) assigns that file to phase
   9 exclusively. There is nothing for `unlock` to read or clear yet, and inventing a locks file here
   would collide with phase 9's ownership of that source file. Named rather than silently dropped,
   per CLAUDE.md's "name the gap" convention (as the ticket text itself does for criterion 15's door
   half). No rail in this ticket; phase 9's `test/server/login-delay.test.ts` carries it.
7. **Recovery, stated in the command's own help text (criterion I).** Losing `<home>/user.<name>.seed`
   is not losing the role: the OLD key's grant stays live (still trusted) until an operator strikes
   it. Recovery is `remove-role` (strikes the role binding, and the grant WHEN the seed file can
   name it) then `assign-role` again (mints a fresh key, files a fresh grant) — never a bare re-run
   of `assign-role`, which criterion 11 refuses while the role is still held.
   **CORRECTED after adversarial review, round 1 — the seed-file-lost case.** `remove-role` reads
   `<home>/user.<name>.seed` to learn WHICH public key's grant to strike (§36.3.1.2's design; a
   grant's `subject` carries only a raw key, never a name). If that very file is what was lost — the
   scenario recovery exists for — `remove-role` cannot name that grant. It does not fail: **the role
   binding strike never depends on the seed file** (it is found by entity + context + role value
   alone), so `rolesOf` always loses the role. The grant strike is attempted only when the seed file
   is confirmed ABSENT (`ENOENT` — "not there"), and only then does `remove-role` proceed on the
   role alone and name the residue: the lost key's grant stays live and, so far as this ticket can
   verify, inert — nobody who can no longer produce that file holds the private key it named.
   **A read failure that is NOT `ENOENT` (`EACCES`, `EIO`, a permission fault) is NOT treated as
   "absent" (adversarial review, round 4).** "Cannot determine" is not "safe to guess," the same
   discipline `credentials.ts` already states for a damaged credential file (H9): a permissions
   fault or an I/O error means the file may well still be THERE and readable by someone else, so
   `remove-role` refuses the WHOLE command — strikes nothing, role included — and reports which
   fault blocked it, rather than quietly leaving a possibly-live key trusted while claiming the role
   was removed. Only a genuinely missing file authorizes the role-only partial strike.
   `assign-role` afterward still mints a working fresh key regardless of this residue, once the
   fault clears and `remove-role` can actually confirm absence. Stated in `remove-role --help` and
   rated a named limitation, not silently patched over: there is no stored link from a user's name
   to every public key ever granted for them, only to the CURRENT one on disk.
8. **The unusable-home check names the fault, not just "cannot proceed."** `homeDefect` (new,
   `src/cli/config.ts`) distinguishes four shapes — missing, a dangling symlink, a file, a sealed
   directory — because `lstat` alone cannot see a dangling target and `lstat` + `isDirectory` would
   wrongly condemn a healthy symlinked home (ticket criterion 7). `create` allows "missing" (it
   bootstraps via `initHome`, as `serve`/`register` already do); `assign-role`/`remove-role` do not
   — they must not create a home, or a user, as a side effect of failing to find one.

## 36.3.2 What this phase does NOT do

It adds no door — no HTTP route, no GraphQL field. It does not make any session sign as anyone; that
is phase 8. It does not widen the role read past the store's seed (unchanged from phase 2). It adds
no on-wire migration: every delta here is a NEW instance of an EXISTING shape (`roleClaims`,
`grantClaims`, both landed already), so no delta's bytes change (criterion F). The DOOR half of
"does a struck role stop a live session" is phase 5's, not this phase's — it has no door to test
against yet (ticket criterion 15). `loam user unlock` is deferred whole to phase 9 (§36.3.1.6 above).

## Acceptance criteria

Verified in `test/cli/user-roles.test.ts` (the CLI surface: `create`, `assign-role`, `remove-role`,
end to end through `run()`) and `test/server/operator-keys.test.ts` (the ground/grant mechanics:
trust closure, shape stability, recovery) unless a bare command is named. Rails are declared at P3,
once these tests exist and are red. Numbers follow the ticket's own numbering for traceability;
letters A–I are the ticket's "per-operator keys" section.

1. `create <name>` (actor) writes one credential entry at 0600 and appends exactly two deltas (user,
   role). `create <name> --operator` additionally mints `<home>/user.<name>.seed` at 0600 and
   appends a third delta (the grant) — three total. Counted before and after in both cases.
   `test/cli/user-roles.test.ts`.
2. A second `create` for the same name and role, once a CREDENTIAL already exists, refuses by name
   and appends nothing (delta count unchanged) — the ordinary "already provisioned" case.
   **REFINED, round 5: a second `create` for the same name and role that has NO credential yet
   (ground already holds the user+role, e.g. the first run's credential write failed after its
   ground append landed) instead REPAIRS — it writes the missing credential and appends nothing,
   succeeding rather than refusing.** This is salvaged unchanged from `create`'s existing precedent
   (the credential-existence check gates on the CREDENTIAL FILE, never on the ground record) and is
   what closes the round-3/round-5 finding that a credential-write failure would otherwise strand a
   name forever (Criterion 2 without this note would say "refuses," full stop, which is only true
   once a credential exists). A ROLE MISMATCH (ground says `actor`, this run asks `--operator`)
   still refuses outright and changes nothing — repair never changes what was asked for.
   **Repair mode never mints a fresh seed/grant for an already-operator user, and it never reports
   success while leaving one silently missing (round 5).** If the ground already holds the
   `operator` role for this name and `<home>/user.<name>.seed` is ALSO missing, repair mode refuses
   — it does not write the credential and call it done while the user still cannot sign anything —
   and its message names the fix: run `remove-role` then `assign-role` (the SAME lost-key path
   §36.3.1.7 already covers), never a repeated `create`. Repair only ever proceeds silently when the
   one and only missing piece is the credential. `test/cli/user-roles.test.ts`.
3. Every refusal path that runs after the ground check (an already-known user, a role mismatch)
   reports what actually happened — it never claims deltas landed when the count didn't move.
   `test/cli/user-roles.test.ts` asserts the delta count directly alongside the message.
4. No delta anywhere in the store contains the credential's salt or hash hex. Scanned over every
   claim's JSON after a `create --operator` run. A planted delta carrying a fabricated hex string is
   asserted to be CAUGHT by the same scan first, so the scan is proven capable of failing.
   `test/cli/user-roles.test.ts`.
4b. **A name is checked against `userNameDefect` before any path is built from it** (adversarial
   review, round 1: closing a path-traversal concern). `create --operator` and
   `assign-role --role=operator` with a name carrying `/` (e.g. `../operator`) refuse before writing
   any seed file or touching the ground, and no file appears outside `<home>`. `test/cli/user-roles.test.ts`.
5. `--operator=true` (or any `--operator=<value>` form) REFUSES with a usage error and creates
   nothing — a boolean flag given a value is a malformed invocation, never silently coerced to
   "absent" (T117). Fixed in `parseArgs` (`src/cli/args.ts`): a `--name=value` token whose name is a
   declared boolean flag throws `UsageError` rather than routing into `flags`. `test/cli/user-roles.test.ts`
   and `test/cli/cli.test.ts` (a `--http=1` style probe on an existing boolean flag, proving the fix
   is general and not special-cased to `--operator`).
6. Deferred whole to phase 9 (§36.3.1.6): no rail in this ticket. Verification lives in phase 9's
   `test/server/login-delay.test.ts`, once `src/server/login-locks.ts` exists.
7. `homeDefect` (`src/cli/config.ts`) names, with a distinct cure each: a missing home (when not
   allowed), a home that is a dangling symlink, a home that is a plain file, and a sealed (no
   read/write/traverse) directory. `test/cli/user-roles.test.ts` drives all four through `create`
   (`allowMissing`) and `assign-role` (not allowed).
8. `assign-role <name> --role=actor` appends exactly one delta (the role binding) and nothing else.
   `assign-role <name> --role=operator` appends exactly two (role binding + grant), and mints the
   seed file. Counted before and after, both roles. `test/cli/user-roles.test.ts`.
9. `assign-role` on a name the ground does not know refuses and creates no user record.
   `test/cli/user-roles.test.ts`.
10. `assign-role --role=admin` (or any name outside `operator`/`actor`) refuses via
    `userRoleDefect`, never guesses. `test/cli/user-roles.test.ts`.
11. `assign-role` on a user who already holds the named role appends nothing and says so (delta
    count unchanged). `test/cli/user-roles.test.ts`.
11b. **NEW, round 5 (a gap the review found unspecified): `remove-role` on a user who does NOT hold
    the named role is an idempotent no-op — it appends nothing and says the role was never held,
    never an error and never a guessed negation.** Symmetric with criterion 11. `test/cli/user-roles.test.ts`.
12. `remove-role` appends an operator-signed NEGATION of the role claim — never deletes a delta.
    `test/cli/user-roles.test.ts` asserts the negation exists via `reactor.negationsOf`.
13. Double-grant case: a second `operator` role claim for the same user is appended DIRECTLY to the
    ground (operator-signed — `assign-role` cannot be called twice, since criterion 11 refuses the
    second call, so the fixture stands in for a federated pull delivering the second claim). One
    `remove-role operator` call strikes BOTH surviving role claims, and `rolesOf` no longer contains
    `operator`. `test/cli/user-roles.test.ts`.
13b. `remove-role operator` also strikes the surviving grant(s) whose subject is the user's own
    current key (read from `<home>/user.<name>.seed` before the strike). Two-sided at the ground
    level: `rolesOf` loses `operator`, AND a fresh delta signed by that user's key no longer
    resolves for a governed reader (`test/server/operator-keys.test.ts`, via `dataStruck`/
    `governedGatherBody`), while a DIFFERENT operator's key still resolves.
    **The seed-file-absent case (§36.3.1.7): when `<home>/user.<name>.seed` is confirmed MISSING
    (`ENOENT`), the role binding is still struck (`rolesOf` still loses the role) but the grant is
    NOT — `remove-role` says so in its output rather than silently skipping it or failing the whole
    command.** `test/cli/user-roles.test.ts` deletes the seed file before calling `remove-role` and
    asserts both halves: the role is gone, and the output names the un-struck grant.
    **The seed-file-UNREADABLE case is different and refuses whole (round 4): a permission fault
    (`EACCES`) on an otherwise-present seed file strikes NOTHING — not the role, not the grant — and
    reports the fault.** `test/cli/user-roles.test.ts` (POSIX-only, `it.skipIf(process.platform ===
    "win32")`) chmods the seed file unreadable and asserts zero deltas appended and `rolesOf`
    unchanged.
14. Removing one role leaves the user's other roles intact (`operator` + `actor`, remove `operator`,
    `actor` survives). Removing every role leaves an empty set and `resolveUserView` still defined
    (a readable user, never a deleted one). `test/cli/user-roles.test.ts`.
15. Ground/`rolesOf` half only (the door half is phase 5's — named, not built): after
    `remove-role operator`, the negation(s) are in the store and `rolesOf` no longer contains the
    role. Asserted by the same `test/cli/user-roles.test.ts` cases as criteria 12–14 — no separate
    test, since the assertion is identical; the door half has no rail until phase 5 ships a door.
16. The last operator may remove their own role via `remove-role`, and `assign-role` immediately
    after restores it — both need only home access, no session, no live operator-role user in the
    ground at any point in between. Stated in `assign-role`/`remove-role`'s own `--help` text.
    `test/cli/user-roles.test.ts`.

**Per-operator keys (A–I).**

A. `create --operator` and `assign-role --role=operator` each mint a fresh keypair, written to
   `<home>/user.<name>.seed` at 0600, never appended to the ground. `test/cli/user-roles.test.ts`.
B. A grant authored by anyone OTHER than the store's seed never widens the trusted set: alice (an
   operator-role user with her own grant) hand-signs a grant for bob's key; bob's key is asserted
   NOT trusted (a fresh delta signed by bob does not resolve for a governed reader).
   `test/server/operator-keys.test.ts`.
C. Two operator-role users' deltas carry DIFFERENT authors, each equal to that user's own derived
   public key (`authorForSeed` of their seed file) — not merely both non-empty.
   `test/server/operator-keys.test.ts`.
D. Two-sided: a delta signed by a granted user's key resolves for a governed reader (its negation of
   an otherwise-live claim binds under `governedGatherBody`/`dataStruck`); a delta signed by an
   ungranted key's negation does not bind. `test/server/operator-keys.test.ts`.
E. The store's own seed stays trusted exactly as before: a store built with genesis alone, then with
   a second operator-role user added, resolves the FIRST operator's own strikes identically before
   and after. `test/server/operator-keys.test.ts`.
F. No on-wire migration is owed. `roleClaims`/`grantClaims` (both unmodified, phase 2 and pre-existing
   respectively) produce byte-identical output for fixed inputs, pinned against a literal id computed
   once and hard-coded (never against the function's own answer — H10). `test/server/operator-keys.test.ts`.
G. `create <name>` (no `--operator`) and `assign-role <name> --role=actor` mint no seed file and
   append no grant. `test/cli/user-roles.test.ts`.
H. The seed file's mode is asserted 0600 on POSIX only (`it.skipIf(process.platform === "win32")`,
   phase 1's own pattern — there is no shared helper to import, `credentials.test.ts` inlines the
   same skip). The Windows gap is named in the test file. `test/cli/user-roles.test.ts`.
I. Recovery: `remove-role` then `assign-role` again mints a fresh key/grant even when the lost seed
   file left an un-struck grant behind (13b's named residue) — `assign-role` never depends on the
   OLD file, only on the role being absent. The user's past deltas (signed by the old key) keep
   their old author — resolving them is unaffected by the new grant. Stated in `assign-role --help`
   and `remove-role --help`. `test/cli/user-roles.test.ts`.

## Design questions carried forward (not "(Myk)" — reasoned recommendations above, open to review)

- The grant verb (`admin` vs `write`) — §36.3.1.4. No observable effect until phase 8; flagged for
  the independent spec review rather than blocked on it.
- The seed file naming convention `user.<name>.seed` — not specified by the ticket; chosen for
  symmetry with `operator.seed` and to keep every per-home secret file matching `*.seed`.
