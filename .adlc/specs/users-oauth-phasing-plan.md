# Users and connectors: a phased plan

**Status.** Revision 2. An independent review failed revision 1 on 2026-07-27; section 8 records the
ten findings. Myk settled the escalation on the same day: **role assignment is CLI-only.** Section 9
records that ruling and what it deletes. Revision 2 is a plan for review. It replaces the single change in
[#282](https://github.com/bombadil-labs/loam/pull/282). It creates no tickets yet. Myk approves the
plan first. Then the tickets replace T113, T114, T116, T117, T118, T119 and T121.

**What this plan is for.** #282 holds 13,299 lines. Myk cannot read a change that size. This plan
cuts the same work into fifteen phases. Each phase merges on its own. Each phase is useful on its own.

**Read this section first if you read nothing else.** The plan carries 41 findings from 20 review
rounds. Those findings are now ACCEPTANCE CRITERIA rather than discoveries. A builder reads the
criterion and writes the code once. It does not find the defect on round six.

---

## 1. Why #282 became one change

Two causes. One is real. One is mine.

**The real cause: a ticket declared a rail on a file another ticket's work had authored.** The CI
backstop reads the base tree and freezes every rail the base's tickets declare. T116 declares
`login-limit.test.ts`, and T113's work wrote the behaviour that file asserts. So the two could not
land independently, and I stacked them.

This is CLAUDE.md's own rule, broken: *"Declare `rails` when the tests EXIST, never in advance."* A
rail declared before its subject lands binds two tickets together.

**My cause: I integrated before I landed.** I merged all three pieces into one branch, then opened one
pull request. The standing rule is the opposite: land each decision alone, and land the mechanical bulk
last. The cost is real — the three readable pieces target the integration branch, so Myk can read them
but cannot approve them one at a time.

**THE RULE THIS PLAN OBEYS, IN TWO CLAUSES.** One clause is not enough, because `rails-guard` freezes
declared RAIL FILES and never guards SOURCE. So a later phase can change behaviour an earlier phase's
frozen rail asserts, and is then forced to edit a file it may not touch.

- **(i) Every phase owns its own rail FILES.** No two phases declare the same file.
- **(ii) No phase adds a PRECONDITION to a door an earlier phase railed.** A phase ships a door's whole
  request surface. A later phase may only change what that door REFUSES, and only where the earlier
  phase's rails already send the field.

A phase that must edit an earlier phase's rail is a phasing error. Fix the phasing, not the freeze.

---

## 2. What the review rounds taught

Twenty rounds ran. Thirty-five findings were confirmed. Two were auth bypasses. This section states
what the rounds taught. Section 4 turns each lesson into a criterion.

### 2.1 The defect sits in the adjacent line

Every behavioural defect a round found came from the previous round's fix. It sat next to the line
that had to change. Examples, all measured:

- A read moved out of a lock because it sat beside the thing that had to move.
- An error message was forwarded one line after the branch that built it.
- A comparator's secondary term was reversed.

**So: when you review a fix, read the lines it touched and their neighbours first. Ask what else
moved with the thing that had to move.**

### 2.2 A rail written from a model agrees with both versions

Three rails were deleted after measurement. Each asserted something the author already believed. So
each encoded a MODEL of the defect rather than the defect's observable signature. The model is what
both versions of the code share. That is why such a rail passes either way.

**So: revert the fix and watch the rail fail. That is the only test that separates a model from a
signature.**

### 2.3 A rail of only negatives passes on an unrelated answer

"The body does not contain the home path" is satisfied by a 400 from another branch. One rail needed
three generations to reach a positive control. The control names which branch answered.

**So: every negative assertion needs a positive control. Ask what answer would satisfy this that you
do not want.**

### 2.4 An instrument that cannot fail is worse than a rail that cannot fail

Everything downstream inherits its wrong answer. Three cases, all mine or a lane's:

- A probe harness guarded on `git diff`, which is never empty in a dirty tree.
- `npm run check | tail -3` returns the exit code of `tail`. A commit ran on a red bar.
- I ran a shipped binary instead of a lane's source. It showed the old behaviour.

**So: make a probe report a KNOWN-wrong answer before you trust it.**

### 2.5 The status report is the last unguarded layer

A lane reported three markers. A grep found zero. Nothing downstream of a report runs a test against
it. **So: grep-verify any claim that names a file, a marker, a count or a command output.**

### 2.6 A claim kept past its truth is the commonest defect

Most late findings were prose. A comment named a fault it never diagnosed. A number was wrong by four
times. A criterion promised what the code had stopped doing. **So: when you change code, read the
prose beside it. Fix the sentence or delete it.**

### 2.7 One part producing every finding is a scope boundary

Rounds 1 to 4 found real defects in the limiter. Rounds 5 to 10 found only message accuracy in one
150-line diagnostic. That diagnostic changed no door behaviour. It held the decision hostage. **So:
check which part produced the findings before you authorise another round.**

---

## 3. The twelve phases

Each row states the deliverable and the rail files it owns. No file appears twice.

| # | phase | owns these rail files | source | est. |
|---|---|---|---|---|
| 1 | Credentials at rest | `test/server/credentials.test.ts` | `credentials.ts` | ~450 |
| 2 | A user is a fact | `test/server/users-ground.test.ts` | `users.ts`, `gather.ts` | ~450 |
| 3 | Bootstrap, role commands, per-operator keys | `test/cli/user-roles.test.ts` + `test/server/operator-keys.test.ts` | `cli.ts`, `prompt.ts`, `users.ts`, `config.ts` | ~700 |
| 4 | The session table | `test/server/session-table.test.ts` | `session.ts` | ~400 |
| 5 | The login door | `test/server/login-door.test.ts` | `session.ts`, `http.ts` | ~500 |
| 6 | Cross-site defence | `test/server/login-csrf.test.ts` | `session.ts` | ~350 |
| 7 | The bearer bridge | `test/server/session-token.test.ts` | `session.ts`, `http.ts` | ~350 |
| 8 | A session signs as its user | `test/server/session-authorship.test.ts` | `session.ts`, `users.ts` | ~300 |
| 9 | The login delay | `test/server/login-delay.test.ts` | `login-locks.ts` | ~500 |
| 10 | Erasure honesty | `test/server/users-erasure.test.ts` | `erase.ts`, `slate.ts` | ~300 |
| 11 | Connector records at rest | `test/server/oauth-file.test.ts` + `test/server/oauth-lock-child.mts` | `oauth-file.ts` | ~600 |
| 12 | Discovery and the 401 | `test/server/oauth-discovery.test.ts` | `oauth.ts` | ~350 |
| 13 | Connector registration | `test/server/oauth-register.test.ts` | `oauth.ts` | ~350 |
| 14 | The consent page | `test/server/oauth-consent.test.ts` | `oauth.ts` | ~300 |
| 15 | The token exchange and revocation | `test/server/oauth-token.test.ts` + `test/server/oauth-revoke.test.ts` | `oauth.ts`, `cli.ts` | ~450 |

Fifteen phases. The estimates sum to about **6,350 lines** of source and rails. #282 holds 13,299
lines. The plan is smaller because 35 confirmed findings are criteria now, and because three deleted
rails do not return.

**The dependency spine.** Phases 1 and 2 are independent of each other. Phase 3 needs both. Phases 4
through 8 are a chain. Phase 8 needs 3 and 7. Phases 9 and 10 need 5. Phase 11 is independent of
everything above it and can land first if that suits. Phases 12 through 15 are a chain on 11.

**The grant flow is three phases, at Myk's direction (2026-07-27): small footprints.** Registration,
consent and the token exchange each merge alone. The seam that makes this work is the eviction pin.
Phase 13 ships it reading two sources. Phase 15 adds the third. Adding a pin source only makes
eviction more conservative, so phase 13's rails still pass unchanged — no phase rewrites another's
rail file. The largest phase is now the login door at about 500 lines.

---

## 4. Each phase in full

Every phase states four things. What it delivers. Why it merges alone. What it must NOT do. Which
findings become its criteria.

### Phase 1 — Credentials at rest

**Verification.** Every criterion below is proved in `test/server/credentials.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `credentials.json` in the home. Per-user scrypt parameters, salt and hash. Atomic
write. Mode 0600. No doors. No CLI.

**Merges alone.** The credential primitive is testable as a library. Nothing reads it yet.

**Must not.** It must not add a door. It must not add a CLI command.

**Criteria from findings.**
1. The salt reaches the derivation. Two hashes of one password differ. A hash crossed with another
   salt does not verify. (A round trip through hash and verify passes even when `derive` ignores its
   salt.)
2. The stored bytes equal `scryptSync` over that entry's own salt and parameters. Assert against an
   independent call, not against the pair under test.
3. An entry records the parameters it was created with. Pin against the literal, never against the
   file's own answer.
4. Every shape of damage refuses, by name: truncated, not JSON, empty, wrong version, empty hash,
   empty salt, non-hex hash, no parameters, unknown kind. "Cannot determine" never resolves to
   "matched".
5. The write is temp-then-rename. The inode changes. No residue remains. A stale temp does not
   poison the result.
6. The file lands at 0600 even when the path already sat at 0644.
7. The mode is asserted on POSIX only. Windows reports 0666 whatever `chmod` asked. Name that gap in
   the test file. State that a Windows run proves nothing about who may read a credential.
8. `fsync` is asserted by nothing. Name that gap. An ESM named import offers no spy point.

### Phase 2 — A user is a fact

**Verification.** Every criterion below is proved in `test/server/users-ground.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** A user record and a role binding, both as claims in the ground. A HyperSchema that
counts the operator's assertions only. A Schema that resolves latest-wins. `resolveUserView` and
`rolesOf`, which returns the SET of roles a user holds.

**Merges alone.** Users become readable facts. No door consumes them yet.

**Must not.** It must not touch `credentials.json`. It must not add a door.

**Criteria from findings.**
1. A user is an ENTITY. Its properties resolve through a Schema. Say so in the prose. (#282's header
   said "the half of a user that IS a delta", which collapses a claim into a fact. Myk caught it.)
2. "Operator-signed" is enforced on the READ, not asserted on the write. Any author with write
   standing may sign a claim at an ordinary context. So the select names the operator.
3. A stranger's negation does not retract what the operator said. Assert at both levels.
4. A store with no operator yields no user and no role. The door stays shut.
5. A struck role binding leaves the user readable and that role absent from the set. Assert both
   levels.
6. **A USER HOLDS MANY ROLES. THE PROPERTY IS A SET, NOT A LATEST VALUE.** The Policy for the role
   context is `all`, never `pick`. So the resolved value is every non-negated role claim, and two roles
   coexist. Rail it: grant `operator` and `actor` to one user, and both resolve. `pickLatest` would let
   the second grant silently displace the first, which is a permission bug wearing a data model's
   clothes.
7. A user with no grants resolves to an EMPTY SET, not to `undefined` and not to a default role. A
   permission check asks MEMBERSHIP — does this user hold `operator` — never equality.
8. The reading function is `rolesOf`, and it returns a set. There is no `roleOf` returning one role.
   A singular name would invite the caller to compare rather than to test membership.
9. A user name is safe in an entity id, a JSON key and an HTML page. One expression, stated once.
10. **MANY USERS MAY HOLD THE OPERATOR ROLE.** Each user is its own entity, and its role binding is a
   claim at that entity. So the shape carries no limit of one. Rail it: assign the role to two users,
   and `rolesOf` contains `operator` for both. Rail the other side: revoking one leaves the other.
11. **THE ROLE READ NAMES THE STORE'S OWN SEED AND NOTHING ELSE.** It stays exactly as it is today:
   `authoredBy: <the key in `<home>/operator.seed`>`. Do not widen it to a trust set. Revision 1 did,
   and that was an escalation — `users.ts` states that nothing refuses a role claim at the append door,
   so the read-side select is the ONLY defence.
   **Name it the STORE'S seed, never "the genesis operator's".** That phrasing implies a senior operator,
   and §9a says there is no such thing. The seed belongs to the store. Every operator with home access
   uses the same one.
12. **A ROLE CLAIM SIGNED BY ANY OTHER KEY RESOLVES TO NOTHING.** This is the rail that proves the
   escalation is closed, and it is two-sided. Append a role claim at `user:carol` signed by a key that
   is NOT the store's seed, and `rolesOf("carol")` is empty. Append the same claim signed by the store's
   seed, and it contains `operator`. Assert at both levels: the stray delta IS in the store, and no
   reading admits it.
13. A role the user does not hold is simply absent from the set. An unknown role NAME is refused at the
   write door rather than admitted into the set and guessed at on read.

### Phase 3 — The bootstrap, the role commands and per-operator keys

**Verification.** Every criterion below is proved in `test/cli/user-roles.test.ts` + `test/server/operator-keys.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `loam user create <name> --operator --home <dir>`, plus `loam user assign-role` and
`loam user remove-role`. `create` prompts twice with echo off, writes the credential, mints the user's
own signing seed when the role is operator, and appends the deltas. The role commands change a role
binding and a key grant, and nothing else.

**Merges alone.** An operator can provision a user, and that user's key becomes trusted in the ground.
Nothing serves it yet.

**Must not.** It must not add a door. It must not make a session sign as anyone — that is phase 8.

**ROLE ASSIGNMENT IS CLI-ONLY, at Myk's direction (2026-07-27).** These commands prove operatorship by
HOME ACCESS and sign with the home's genesis seed. There is no remote path that mints an operator.
Section 9 states why that is accurate rather than merely convenient, and why no future phase should
"fix" it without Myk's word.

**PER-OPERATOR KEYS RIDE THE GRANT VOCABULARY, not a widened role read.** Revision 1 tried to build the
trusted set from role bindings. That cannot work: an `inView` extract compares only `author` or `id`,
and a role binding carries an entity and a primitive. A GRANT already carries a public key in its
`subject` primitive, which is exactly what `lawfulStrikersJson` extracts today, and `loam.grants` is
already recognised at the append door. So `assign-role --role=operator` files TWO deltas: the role
binding that says what the user may DO, and a `loam.grants` entry that says whose SIGNATURE counts.

**Criteria from findings.**
1. It writes one credential entry at 0600, mints the user's seed at 0600 when the role is operator,
   and appends exactly two deltas. Count deltas before and after.
2. A second run refuses by name and appends nothing. Count deltas before and after.
3. A refusal that reaches the ground check reports honestly. It must not say deltas landed when
   nothing was appended.
4. No delta contains the salt or the hash. Scan the whole store. Plant a leak first and prove the
   scan sees it.
5. A boolean flag written as `--operator=true` REFUSES. It must not create a plain actor and report
   success. (This is T117. The parser sends `--name=value` to the wrong collection.)
6. `loam user unlock --all` exists and clears every record. A per-name command cannot reach names an
   attacker chose.
7. An unusable home is named, whatever makes it unusable: missing, a dangling symlink, a file, a
   sealed directory. Use `stat` and `isDirectory` and a traversal check. `lstat` alone misses a
   dangling home. `lstat` plus `isDirectory` condemns a healthy symlinked home. State the cure per
   fault, never one pair of cures for all faults.

**Per-operator keys, the CLI half.**

A. `create --operator` and `assign-role --role=operator` mint a keypair for that user. The seed lands
   in the home at mode 0600, beside the genesis operator's. It never enters the ground, for the same
   reason a credential does not: the ground replicates under federation.
B. **THE KEY BECOMES TRUSTED THROUGH A GRANT, and the grant is operator-authored.** `lawfulStrikersJson`
   admits a grant only when its author IS the genesis operator, and it masks the grant set so only the
   operator's strikes shrink it. So depth is bounded by AUTHORSHIP, not by stratification alone. A
   delegated operator cannot extend trust to a third party even if they file a grant, because their
   grant is not operator-authored. Rail that: alice files a grant for bob's key, and bob's key stays
   out of the trusted set.
C. **TWO OPERATORS ARE DISTINGUISHABLE IN THE GROUND.** Hand-append one claim signed by alice's seed and
   one signed by bob's. The two deltas carry different authors, each equal to its own user's public key.
   Assert the authors DIFFER and that each equals the expected key — not merely that both are non-empty.
D. A delta signed by a granted operator's key RESOLVES for a governed reader. A delta signed by an
   ungranted key does NOT. Two-sided, and it is the whole value of the grant stated as a rail.
E. The genesis operator stays trusted. A store built before this phase reads identically after it.
F. **NO ON-WIRE MIGRATION IS OWED, and prove it.** This phase only ADDS deltas — role bindings and
   grants, both in shapes that already exist. No existing delta's bytes change. Rail that a
   pre-phase store reads identically. If any delta's shape changes, this phase owes a §20 step and the
   plan is wrong.
G. A user with no operator role gets no operator seed, and no grant.
H. The seed file's mode is asserted on POSIX only, and the gap is named on Windows. Reuse phase 1's
   helper rather than writing a second one.
I. Losing a user's seed is recoverable and the help text says how: `assign-role` again mints a fresh
   key and files a fresh grant. The user's past deltas keep their old author, so history does not
   rewrite. State that the old key stays trusted until `remove-role` strikes its grant.

**Two more commands, and they are the reason a role is data rather than a flag.**

    loam user assign-role <name> --role=operator --home <dir>
    loam user remove-role <name> --role=operator --home <dir>

8. `assign-role` appends ONE operator-signed role claim. It appends nothing else. Count deltas before
   and after.
9. `assign-role` refuses a user the ground does not know. It must not create a user as a side effect.
10. `assign-role` refuses an unknown role by name. `--role=admin` is a refusal, not a guess. The
    shipped roles are `operator` and `actor`. State that a third role is a future ticket.
11. `assign-role` on a user who already holds that role appends nothing and says so. It must not
    report a write it did not make.
12. `remove-role` appends an operator-signed NEGATION of the role claim. It does not delete a delta.
    Only the operator's negation binds, so a stranger cannot revoke a role.
13. **`remove-role` STRIKES EVERY SURVIVING CLAIM OF THAT ROLE, not the latest one.** Roles resolve
    with `all` (phase 2), so each grant is a distinct delta and all of them are live at once. One
    strike therefore leaves a twice-granted role STILL HELD through its other grant. This repo already
    paid for that hazard: `demos/board/vocabulary.mjs` records it for `items: {all}` — "a single strike
    leaves a twice-added item listed through its other filing" (H4).
    Rail it as the double-grant case: grant `operator` twice, remove it once, and assert the user no
    longer holds it. A rail that grants once cannot see this defect.
    **The fixture cannot use `assign-role` twice — criterion 11 refuses the second call.** So it appends
    the second role claim DIRECTLY to the ground, operator-signed. That is not a workaround: a
    federated pull can deliver a second claim the CLI never made, which is exactly the state this rail
    must cover.
13b. **`remove-role operator` STRIKES THE KEY GRANT AS WELL AS THE ROLE BINDING**, and the same
    every-surviving-claim rule applies to both. A user whose role binding is struck but whose grant
    survives still has a trusted signature, which is the half that matters. Rail both: the role is
    absent from `rolesOf`, AND a delta freshly signed by that user's key no longer resolves for a
    governed reader. Two-sided: a DIFFERENT operator's key still resolves.
14. Removing one role leaves the user's OTHER roles intact. Two-sided: grant `operator` and `actor`,
    remove `operator`, and `actor` survives. Removing every role leaves an empty set and a readable
    user, never a deleted user.
15. After `remove-role operator`, the negations are in the ground and `rolesOf` no longer contains the
    role. **The DOOR half of this belongs to phase 5**, which is the first phase that has a door to
    refuse at. Name that split here rather than writing a rail this phase cannot run.
16. **THE LAST OPERATOR MAY REMOVE THEIR OWN ROLE, AND THE STORE STAYS RECOVERABLE.** These commands
    prove operatorship by HOME ACCESS and sign with the home's seed, exactly as `create` does. They
    need no session. So a store with no operator-role user is still repairable on the box. Rail it:
    remove the only operator, then assign it again, and the door opens. State this in the help text,
    because an operator who thinks they can lock themselves out will not use the command.

### Phase 4 — The session table

**Verification.** Every criterion below is proved in `test/server/session-table.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** Sessions in server memory. An opaque id. An idle window. A monotonic clock. A cap.

**Merges alone.** The table is a unit. Test it directly.

**Must not.** It must not add a door. It must not read a cookie.

**Criteria from findings.**
1. A session past its idle window is refused.
2. A wall-clock step BACKWARDS does not extend a session. Read the clock monotonically.
3. A restart invalidates every session. State that this is deliberate for one operator.
4. The table holds at most its cap. State what a full table does.
5. A minted token is held as a DIGEST, never as the secret. The token table is digest-keyed and says
   so. A plaintext copy would outlive the token by six times its window.
6. Dropping a session revokes the tokens it minted. A logout that answers 200 and revokes nothing has
   revoked nothing.

### Phase 5 — The login door

**Verification.** Every criterion below is proved in `test/server/login-door.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `GET /login`, `POST /login`, `POST /logout`. The session cookie. The pre-session
cookie.

**Merges alone.** An operator can sign in. The session opens no data door yet.

**Must not.** It must not open a JSON door. Phase 7 does that, through a bearer token.

**IT SHIPS THE WHOLE FORM-TOKEN SURFACE, and phase 6 adds only the ENFORCEMENT.** This is clause (ii)
of section 1's rule. If phase 5 railed a `POST /login` with no token field, phase 6 could not make the
token mandatory without editing phase 5's frozen rail file. So phase 5 issues the token on `GET /login`,
accepts it on `POST /login`, and **every phase 5 rail sends it**. Phase 5 does not yet refuse a request
that omits it. Phase 6 changes only what the door REFUSES.

**Criteria from findings.**
0. `GET /login` issues a form token and the page carries it. `POST /login` accepts it and ignores its
   absence. Every rail in this file sends a valid token, so phase 6 can turn absence into a refusal
   without touching one assertion here.
1. THE PRE-SESSION NONCE USES ITS OWN COOKIE. `GET /login` sets a nonce whenever no session is
   presented. `SameSite=Lax` presents none on a cross-site subresource request. One shared name
   therefore lets any page sign the operator out. The orphaned session keeps its idle window with no
   cookie to reach it, so its tokens become unrevokable.
2. A cross-site `GET /login` does not set the session cookie. The live session still mints.
3. The cookie attribute string is one pinned literal: `HttpOnly; Secure; SameSite=Lax; Path=/`. No
   `Domain`. Assert it byte for byte.
4. That string is identical under `X-Forwarded-Proto`, a foreign `Host`, and no forwarding header.
5. Exactly ONE session cookie is set. A reader that takes the first match cannot see a second.
6. Logging in over a live session mints a DIFFERENT id. The old id opens nothing.
7. A wrong password, an unknown user and a missing role answer the same status and the same body.
8. The login page carries a `Content-Security-Policy` that permits no script. The page carries no
   script.
9. A request with no credential receives the bytes it received before §36 existed. The refusal never
   reveals that users exist.
10. THE PUBLIC URL IS CONFIGURED. `--public-url` names the outside address. `Host` and
    `X-Forwarded-*` are the caller's to write and change nothing.

### Phase 6 — Cross-site defence

**Verification.** Every criterion below is proved in `test/server/login-csrf.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** A same-origin signal check. A per-session form token. Both on every POST door.

**Merges alone.** It hardens phase 5's doors. Phase 5 is usable without it and safer with it.

**Must not.** It must not weaken any phase 5 assertion, and it must not add a FIELD phase 5's rails do
not already send. Phase 5 ships the token surface; this phase only makes absence and forgery a refusal.

**Criteria from findings.**
0. **A REQUEST WITH NO FORM TOKEN IS NOW REFUSED.** Phase 5 accepted it. This is the enforcement half,
   and it is the only precondition this phase adds. Rail the transition explicitly: the same request
   that phase 5 admitted is now refused, and a request carrying a valid token still succeeds.
1. A cross-site-shaped POST is refused and changes no session state. Four shapes: no signal, a
   cross-site signal, a `none` signal, and a foreign `Origin`.
2. A foreign `Origin` beside a same-origin signal is refused. This pins the PRECEDENCE. Without it
   the two checks could be reordered and every other case stays green.
3. The form token is an HMAC under a boot key. Include a KEYLESS digest among the forged candidates.
   Without it, dropping the secret leaves every refusal intact.
4. A token issued for one cookie does not open another.
5. A cross-site POST cannot fill a victim's failure counter.
6. `GET /login` allocates nothing. A thousand of them leave the door open.

### Phase 7 — The bearer bridge

**Verification.** Every criterion below is proved in `test/server/session-token.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `POST /session/token`. It answers a short-lived bearer token for the session user.

**Merges alone.** This is the phase that lets a browser write. It is the whole reason cookie
authority stays off the JSON doors.

**Must not.** It must not let a cookie open a JSON door.

**Criteria from findings.**
1. THE COOKIE ALONE OPENS NO JSON DOOR. A cookie-only request to graphql, append and mcp receives the
   same bytes as a request with no credential. A cookie is ambient, so a cookie-opened data door is
   cross-site forgeable. `http.ts` states that authority is an explicit header.
2. The token opens a read door and a write door.
3. The landed delta is signed by the home's genesis seed, as every delta is today. **WHOSE key signs a
   session's write is phase 8**, and this phase must not pre-empt it. Rail what is true now: the write
   lands and resolves.
4. Every author in the ground is a key the home holds. Login must not grow a key nobody granted.
5. The token dies with its window. The session that minted it survives.
6. Signing out retires the tokens that session minted.
7. A container mount answers a session token exactly as it answers the static operator token. Anchor
   the mount first. Two identical errors satisfy an equality check.
8. The one-mount guard throws BEFORE the socket binds. A refusal that is a pure function of the
   options must not leave a bound listener with no doors.

### Phase 8 — A session signs as its user

**Verification.** Every criterion below is proved in `test/server/session-authorship.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** A session's writes carry that user's own author, not the home's genesis author. This is
the session half of per-operator keys; phase 3 delivered the CLI half.

**Merges alone.** Phase 3 made a user's key exist and be trusted. Phase 7 made a session able to write.
This joins them. Both halves are useful without it, so it lands last of the three and lands small.

**Must not.** It must not widen who may write, and it must not NARROW it either. An operator-role user
could already write everything through phase 7; this changes WHOSE NAME is on it. Per §9a every operator
is equivalent, so a per-operator key is attribution and never a restriction. It must not change the
shape of any delta.

**Why this phase exists, in Myk's words.** He read phase 3's provenance limit and scoped it into the
work rather than accepting it. Two operators writing as one author is fine for one person. It stops
being fine the moment a second person holds the role, which is what these phases enable.

**Criteria.**
1. A session for an operator-role user signs with THAT USER'S seed. Assert at the delta level: the
   author equals the user's own public key, not the genesis operator's.
2. **TWO SESSIONS ARE DISTINGUISHABLE.** Two operator-role users each write through their own session.
   The two deltas carry different authors, each equal to its own user's key. Assert they DIFFER.
3. The genesis operator's own session — the static operator token — keeps signing as the genesis
   operator. Two-sided against criterion 1.
4. A user whose grant was struck can still LOG IN, and their writes no longer resolve for a governed
   reader. Separating authentication from authorization is the point; rail that the two come apart.
5. **NO DELTA CHANGES SHAPE, so no §20 step is owed.** Only the author field's VALUE differs, and an
   author was always a key. Rail that a pre-phase store reads identically.
6. A user with an operator role but no seed on this box fails CLOSED with a named error. It must not
   silently fall back to the genesis seed, which would attribute their write to the operator.

### Phase 9 — The login delay

**Verification.** Every criterion below is proved in `test/server/login-delay.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** A per-username delay that replaces a lock. Records in `login-locks.json`.

**Merges alone.** It bounds guessing. Phase 5 works without it.

**Must not.** It must not refuse a correct password. It must not lock.

**Criteria from findings.**
1. Twenty failures do not lock. A correct password is admitted after any number of failures.
2. The wait grows with failures and is capped. Pin the table against hand-written literals.
3. The cost is paid BEFORE the password comparison. A refusal after the compare leaks the answer
   through the status code exactly as a 401 would.
4. A waiting attempt spends no hash budget while it waits. Another name gets in.
5. A flood against one name does not slow a different name.
6. Overlapping attempts each count. Read, increment and write with no await between them. A snapshot
   carried across the hash makes the limit `maxFailures × concurrency`.
7. Every concurrency fixture carries an in-flight witness. A fixture that completed early leaves the
   rail green having tested nothing.
8. A wall-clock step backwards does not erase an accumulated wait.
9. Both writes fail OPEN. A write fault must not turn a correct password into an error with a session
   already seated. **And name the consequence: fail-open means no budget at all.**
10. The record table is bounded. State what eviction takes and why. A row seated at one failure is
    always among the weakest, so a squat can hold a chosen name at zero. State the two squat shapes,
    their measured costs, and that the squat decays. **Do not claim the eviction order is a defence.**
11. Do not state a guesses-per-second bound. Concurrent attempts read one count and pay one wait, so
    a caller buys `maxConcurrentHashes` guesses per wait.
12. **THE DELAY KEYS ON THE USERNAME, NEVER ON THE CLIENT ADDRESS.** A rotated `X-Forwarded-For` must
    not reset the count. This is §36 (o), and revision 1 dropped it — an IP-keyed limiter passes every
    other criterion in this phase while defending nothing, because the header is the caller's to write.
    Rail it: twenty failures against one name from twenty distinct forwarded addresses still accumulate
    one wait.
13. **THERE IS A GLOBAL CAP ON UNAUTHENTICATED HASH WORK**, and criteria 4 and 5 assume it. This is
    §36 (q). Without it a flood across many names spends unbounded scrypt. Rail that the cap refuses
    the surplus attempt rather than queueing it unboundedly, and that a correct password for a name
    already seated is still admitted.
14. A forgotten record does not resurrect an old wait. State the forget window and rail both sides:
    inside it the wait persists, past it the name starts clean. This is §36 (o5)'s second half.
15. The record file's faults are named per fault, not one message for all. This is §36 (k) and (p).
    **T120 is live against this file** — a FIFO at `login-locks.json` blocks the login door forever,
    because `readLocks` has no non-blocking read. It is pre-existing and out of #282's scope. Fold it
    in HERE: this phase owns `login-locks.ts`, and T120's rails belong in this phase's file. Refuse a
    record path that is not a regular file, and bound the test with a real timeout so a regression hangs
    the suite visibly.

### Phase 10 — Erasure honesty

**Verification.** Every criterion below is proved in `test/server/users-erasure.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** The unswept-surface disclosure. It reaches `health()` AND the compliance receipt.

**Merges alone.** It makes an existing report honest. It changes no purge.

**Must not.** IT MUST NOT WIDEN WHAT GETS PURGED. That is Myk's merge by standing rule.

**Criteria from findings.**
1. The report NAMES `credentials.json` and `login-locks.json` as surfaces it does not sweep.
2. The disclosure reaches the RECEIPT, not only `health()`. The receipt is the document a reader
   treats as proof. Its `nonClaim` list reads as exhaustive.
3. A login for a user whose record delta is absent is refused. Assert at both levels.
4. The disclosure survives every path: a zero-match erasure, a partial one, a refusal, and the
   two-phase cut.
5. Erasing a credential entry is OUT OF SCOPE and stays a separate ticket.

### Phase 11 — Connector records at rest

**Verification.** Every criterion below is proved in `test/server/oauth-file.test.ts` + `test/server/oauth-lock-child.mts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `oauth.json`. Read, validate, write atomically. A cross-process lock.

**Merges alone.** The file and its lock are a unit. Nothing serves them yet.

**Must not.** It must not add a door.

**Criteria from findings.**
1. THE LOCK IS A HARD LINK FROM A TEMP THAT ALREADY HOLDS THE OWNER'S NAME. `link` fails atomically
   when the target exists. Create-then-write cannot promise that, which is why a read-back was needed
   at all.
2. Only `EEXIST` means contention. Every other code means the operation is unavailable here. Name that
   failure so an operator is not sent to the wrong subsystem.
3. Breaking a stale lock by path cannot be made race-free. Two writers both judge it stale, and the
   second deletes the first's LIVE lock. State the guarantee as: THE WRITE is exclusive, not the
   callback.
4. A callback must be a pure function of the file it is handed. State that condition where a fifth
   callback will read it.
5. List the check-then-act windows that remain. There are four. Do not claim two.
6. The acquire loop is bounded on every path. No path spins.
7. A cross-process property needs a REAL SECOND PROCESS. Bundle a child and spawn it. No in-process
   rail can prove it.
8. One rail must take the lock SUCCESSFULLY. Otherwise a mock that always fails satisfies every rail,
   and the toggle proves nothing.
9. Do not assert a timing floor. A stall spanning the child's hold leaves the parent acquiring
   instantly, so the assertion is unsound in principle. Assert the observable instead.
10. A refusal that already opened a resource must release it. On POSIX a leaked handle is invisible.
    On Windows the home cannot be removed. The Windows leg is the rail; name that in the test file.

### Phase 12 — Discovery and the 401

**Verification.** Every criterion below is proved in `test/server/oauth-discovery.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** Both well-known documents. The `WWW-Authenticate` header on the MCP door's 401.

**Merges alone.** A client can discover the store. No grant exists yet.

**Must not.** It must not mint anything.

**Criteria from findings.**
1. Every URL comes from `--public-url`. A request with a foreign `Host` and `X-Forwarded-Host` yields
   byte-identical documents.
2. The issuer the document advertises is the value the token endpoint validates. One source.
3. THE HEADER MUST NOT BE A MOUNT-EXISTENCE ORACLE. The refusal for an absent mount is byte-identical,
   headers included.
4. The documents require PKCE S256 and declare a public client.

### Phase 13 — Connector registration

**Verification.** Every criterion below is proved in `test/server/oauth-register.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `POST /oauth/register`. The configured redirect-origin fence. The client cap with its
eviction rule and pin.

**Merges alone.** With phase 12's discovery, a client can find the store and register. It can do
nothing else yet, and that is a safe place to stop.

**Must not.** It must not mint a code, a token or a seed.

**Criteria.**
1. Registration is fenced by a CONFIGURED allowlist of redirect origins. It cannot require a session,
   because claude.ai registers before any human is present. Without the fence, a stranger registers a
   client named "Claude", sends the operator an authorize link, and holds a writing identity. **That
   attack never needs operator escalation, so "the mint path cannot produce operator" is necessary and
   nowhere near sufficient.**
2. A `redirect_uri` outside the allowlist is refused AT REGISTRATION, not only at authorize.
3. Control bytes are refused in EVERY operator-facing field — `client_name` and every entry of
   `redirect_uris`. `new URL()` strips tab and newline, so a value can parse clean and still forge a
   row in `grant list`. A rule written for one field must cover its siblings. That is how this defect
   escaped once already.
4. **THE CAP EVICTS, IT DOES NOT REFUSE.** A plain cap is a lockout: a stranger fills it and the real
   connector is refused forever, with no command to remove one. So the pressure falls on registrations
   nobody is using.
5. **AN APPROVED CLIENT IS NEVER EVICTED.** The pin reads ONE source in this phase: a grant record in
   the file. Neither door that produces one exists yet — codes arrive in phase 14, grants in phase 15 —
   so **the fixture writes the grant record directly, using phase 11's file format.** Say that in the
   test. Revision 1 claimed two sources here and could rail neither; the criterion could have been
   deleted whole with every phase 13 rail still green.
   Rail both sides — a client with a grant record survives a flood, and an unpinned stranger is still
   evictable.
   **Phases 14 and 15 each ADD a pin source, and adding one only makes eviction more conservative.** So
   this phase's rails stay green unchanged. That monotonicity is what lets the grant flow be three
   phases at all.
6. A registration survives a restart.
7. The registration door answers a fixed string on any file fault. The detail goes to `onFault`. Never
   the home path, never a flag name.

### Phase 14 — The consent page

**Verification.** Every criterion below is proved in `test/server/oauth-consent.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `GET /oauth/authorize` and its approval POST. The code it mints.

**Merges alone.** The operator can approve a connector and see a code issued. Redemption arrives in
phase 15.

**Must not.** It must not mint a seed or a token.

**Criteria.**
1. The page requires a phase 6 session. Without one it shows the login form and mints nothing.
2. `redirect_uri` must EXACTLY match one registered for that client. A different path, an added query
   and another port are all refused.
3. No response carries a `Location` outside the allowlist, including on every refusal path.
4. The page escapes `client_name`. It displays the REGISTERED uri, never caller text. It carries a
   no-script CSP.
5. The approval POST carries phase 7's same-origin check and form token. A cross-site-shaped approval
   mints nothing.
6. A minted code binds to `client_id` AND `redirect_uri`. Its expiry is monotonic, so a wall-clock step
   backwards does not extend it.
7. The consent copy states the powers a grant really carries. **A granted author is a lawful striker,
   so it can retract claims the operator wrote.** Say that, or narrow the model — and narrowing is
   T118, not this phase.

### Phase 15 — The token exchange and revocation

**Verification.** Every criterion below is proved in `test/server/oauth-token.test.ts` + `test/server/oauth-revoke.test.ts`. A criterion
that cannot name an assertion in that file is not ready to build.

**Delivers.** `POST /oauth/token`. The per-connector seed. `loam grant list` and `loam grant revoke`.

**Merges alone.** This completes the connector. claude.ai can connect.

**Must not.** There must be no code path from a grant to `{ operator: true }`.

**Criteria.**
1. A code is single-use and BURNS ON ANY REDEMPTION ATTEMPT. A wrong PKCE verifier kills it; the right
   verifier afterwards is refused too.
2. A code minted for one client is refused when redeemed with another client's id, and refused against
   a different `redirect_uri` than it was bound to.
3. **THE EVICTION PIN NOW READS THREE SOURCES: a live code, a redemption IN FLIGHT, and a grant in the
   file.** Redemption deletes the code before it writes the grant. Between those two points the client
   holds neither, so a flood in that window evicts an approved connector whose code is already burnt.
   This phase adds the third source; phase 13 shipped the first two.
4. `redeeming` is a COUNT, not a flag. Two redemptions for one client would otherwise have the first to
   finish clear a pin the second still needs. Increment it immediately before the awaited mint, and
   release it in a `finally` so a throw cannot leak it.
5. A grant mints a NEW actor seed per client, never the operator's. Write the seed BEFORE the ground
   append, so a retry reuses it rather than minting a second.
6. A delta written through a minted token is authored by that connector's own actor. Assert at the
   delta level and through a reading.
7. No input to any endpoint can mint an operator identity. Enumerate the mint path's outputs.
8. Revocation bumps a GENERATION. A code issued before a revoke must not mint a token after it.
9. Revocation binds on the very next request of the SAME live process. A rail that restarts between
   revoke and retry proves nothing.
10. Revocation is two-sided: access is gone AND past deltas still name their author.
11. An unknown bearer token must not cost one key derivation per stored grant on the event loop.
12. Neither the seed, the token nor the PKCE material appears in any delta. Scan after a full flow.
13. No refusal sends the home path or a flag name to a caller. Rail it by INDUCING the fault and
    asserting the door's BODY, not what the code throws. Give every negative a positive control naming
    which branch answered — a 503 and the word "lock" are what separate this refusal from an unrelated
    400.

---

## 5. What we salvage

**Most of the source survives.** The implementations were reviewed hard and the last rounds found only
prose. I estimate 80% of `credentials.ts`, `users.ts`, `session.ts`, `login-locks.ts`, `oauth.ts` and
`oauth-file.ts` transfers unchanged.

**The rails move house.** #282's rail files do not match the phase boundaries. Each phase's rails must
live in the file that phase owns. That is mechanical work, and it is the price of the freeze rule.

**Three deleted rails do not return.** They passed against both versions of the code. The gaps they
covered are named in prose instead.

**The prose needs a pass nobody has done.** Twenty rounds asked whether the code was correct. None
asked whether the vocabulary was right. Myk found one collapse of a claim into a fact within minutes
of reading. Every phase must include a vocabulary read: HyperSchema, HyperView, View, Schema, Policy.

---

## 6. What this plan does not decide

**Removed from this list on 2026-07-27.** The shared-operator-key limit was here as an accepted
constraint. Myk scoped it into the work instead, and it is now phase 3. That is the right call: the
limit only bites when a second person holds the role, and these phases are what let that happen.

1. ~~Whether the grant flow splits into three.~~ **ANSWERED 2026-07-27: it does.** Phases 13, 14
   and 15.
2. **T115 — an erasure at a drilled-down entity.** Widen the purge, or document the limit. Both change
   §30's promise. Myk decides. Not in these phases.
3. **T118 — scope a connector to a container.** Myk ruled on the model. It needs its own plan, after
   these phases. §28 already commits to the shape.
4. **T119 — ejection.** Myk's idea. Undesigned.
5. **The order of phases 1 to 9 against 10 to 12.** The connector needs the login door, so 10 to 12
   follow 5. Otherwise the two groups are independent.

## 7. What happens next

1. Myk reads this plan.
2. Myk answers section 6, question 1.
3. I write twelve tickets. Each ticket carries its phase's criteria verbatim.
4. I archive T113, T114, T116, T117, T118, T119 and T121 with a note naming this plan.
5. `spec-lint` must pass on every new working spec before any build starts.
6. #282 stays open until phase 1 lands. Then it closes, and its branch stays for salvage.

---

## 8. What the independent review found

A reviewer read this plan against the codebase on 2026-07-27. It found ten items. Three are
plan-breaking. I verified the three myself before recording them.

### 8.1 Phase 2 criterion 11 encodes an ESCALATION — plan-breaking

**The defect.** Widening the read's `authoredBy` from the genesis operator to a trust set lets ANY set
member grant the operator role to a stranger.

**Why it works.** `users.ts` says it plainly, and I quoted it approvingly without following it:
a role binding "has no grant shape for `constitutionalDefect` to recognise and nothing refuses it at
the append door". So the READ-SIDE select is the only defence. Criterion 11 removes it. A granted
operator B then files a role claim at `user:C`. The delta is at root, its author is in the set, so the
gather admits it, so C holds `operator`. C never enters the trusted set — and does not need to.

**Why my depth-one answer was wrong.** Stratification limits the depth of SET MEMBERSHIP. It says
nothing about who may write a role. My criterion 12 — "a user the genesis operator trusted cannot
extend that trust to a third party" — is true of the set and false of the role.

**CONFIRMED** against `src/gateway/accounts.ts` and `origin/t113-users:src/server/users.ts`.

### 8.2 The delegated set cannot be built the way I specified — plan-breaking

`inView`'s extract compares only `author` or `id` (`@bombadil/rhizomatic/dist/pred.d.ts:53,84`). A
role binding's pointers are an ENTITY (`user:<name>`) and a PRIMITIVE (`"operator"`). Neither is a
key, so the set resolves empty forever.

`lawfulStrikersJson` works because it extracts `{ role: "subject" }` from a GRANT, and a grant's
subject pointer already holds a public key as a primitive. So the precedent I cited does not transfer
to the delta I defined.

**Adding a key pointer to the role binding in phase 3 changes the bytes of a delta phases 2 and 4
already landed.** That contradicts phase 3 criterion 8 and owes a §20 migration. My cheapest-looking
criterion was the most expensive.

**CONFIRMED.**

### 8.3 The governing rule does not catch behaviour coupling — plan-breaking

`rails-guard-ci` guards only DECLARED RAILS. It never guards source. So a later phase may freely edit
an earlier phase's source — and that is the hole, because behaviour lives in source while assertions
live in frozen files.

Concretely: phase 6 ships `POST /login` and rails it. Phase 7 makes the form token mandatory. Phase
6's rails cannot carry a token phase 7 invented, so they turn red, so phase 7 must edit phase 6's
frozen rail file. The guard exits 2.

**The rule needs a second clause: a phase must not add a PRECONDITION to a door an earlier phase
railed.** So phase 6 ships the whole token SURFACE and phase 7 adds only the ENFORCEMENT.

### 8.4 My diagnosis of #282 was factually wrong

Section 1 says "T116 rewrites the limiter's rail file, and T113 declared it". T113 declares seven
rails and the limiter file is not among them. T116 declares it alone — **because I moved that
declaration myself the night before.** So section 1 describes a state I created and then changed.

The real mechanism was T116 declaring a rail on a file T113's work had authored, which CLAUDE.md
forbids: "Declare `rails` when the tests EXIST, never in advance." A rule aimed at same-file overlap
prevents neither that nor 8.3.

**CONFIRMED** from both ticket shards.

### 8.5 The rest, in short

- **Phase 3 is not buildable at position 3.** Five of its ten criteria need a CLI and a session that
  phases 4, 5 and 6 deliver. Same reaching-forward in phase 4 (criteria 6, 15) and phase 5 (5, 6).
- **Phase 3 criterion 6 is self-contradictory.** A trust-set `inView` is re-evaluated per read with no
  as-of bound, so revoking a role retracts that user's PAST deltas too. "Stops the key going forward
  and keeps the past" cannot both hold.
- **Nine promises from the two working specs are dropped.** Two matter: §36 (o), that the limiter keys
  on the USERNAME and a rotated `X-Forwarded-For` does not reset the count — an IP-keyed limiter passes
  every phase-9 criterion; and §36 (q), the global cap on unauthenticated scrypt work, which two
  phase-9 criteria assume and none rails. Also §36 (k), (o5)'s forget-window half, (p); and §37 (s),
  (t), (u), (c).
- **Phase 13's pin has no producer.** Codes arrive in phase 14, grants in phase 15. Its criterion 5
  could be deleted whole with every phase-13 rail still green.
- **Phase 4 criteria 11 and 13 are jointly unreachable.** One refuses a duplicate grant; the other
  needs two. The fixture must append the second directly, and the plan must say so.
- **T120 is orphaned.** It is a live ticket against `readLocks` in phase 9's own file, and the plan
  never mentions it.
- **The bookkeeping will not execute.** §7 archives seven tickets that exist only on
  `origin/t113-users`, so `adlc ticket archive` fails. §7 says twelve tickets for fifteen phases. The
  estimates sum to 6,400, not 5,900. The finding count is 41 in two places and 35 in another. Phase 7
  calls phase 6's doors "phase 5's" three times. Phase 2's source column omits `gather.ts`.
- **How fifteen phases become SPEC sections is unstated.** §36 and §37 are two reserved numbers, and
  `test/site/capabilities.test.ts` requires every `spec/` file to be claimed by exactly one chapter.

### 8.6 What the review found sound

Both mechanical checks re-verified clean: seventeen rail files, all distinct, none matching any of the
72 rails across 41 live and 33 archived tickets. Section 2's seven lessons are the strongest part of
the document. The phase 13/15 pin MONOTONICITY claim is true. Phases 1, 10, 11 and 12 are genuinely
independently mergeable and valuable.

---

## 9. Myk settled it: role assignment is CLI-only

**His ruling, 2026-07-27.** *"We can solve this by saying that the only valid way to add an operator is
via the CLI for now. Sidestep the rest, assume whoever has CLI access is authorized."*

He also named the thing that makes 8.1 tempting: if a role assignment is just a delta, then anyone
holding the operator role should be able to issue one. That is true of the data model, and it is the
right end state. It is not what this work builds.

**WHY CLI-ONLY IS ACCURATE, NOT MERELY EASY.** This matters, because "we will secure it later" is how a
temporary shortcut becomes a permanent hole.

The CLI reads the genesis seed from `<home>/operator.seed` — `readSeed(home)` is a file read. So
**anyone who can run `loam user assign-role --home <dir>` can already read that file and sign as the
genesis operator.** Restricting role writes to the genesis seed therefore grants no power that
filesystem access did not already grant. The trust boundary is the filesystem, and it always was. The
plan now states the boundary it actually has instead of building a weaker one and calling it stronger.

**WHAT THIS DELETES.** Both plan-breaking findings dissolve:

- **8.1 is gone.** The role read keeps naming the genesis operator. There is no widened select, so there
  is no escalation. Phase 2 criterion 12 now RAILS the closure: a role claim signed by any other key
  resolves to nothing.
- **8.2 is gone.** Nothing needs an `inView` over a role binding, so the extract's `author | id`
  restriction stops mattering.

**WHAT REPLACES IT for per-operator keys.** The existing GRANT vocabulary, which is proven and already
validated at the append door. `assign-role --role=operator` files two deltas:

- a **role binding** — what the user may DO. Read `authoredBy: genesis operator`.
- a **`loam.grants` entry** — whose SIGNATURE counts. Its `subject` is a primitive holding the user's
  public key, which is exactly what `lawfulStrikersJson` extracts today.

`lawfulStrikersJson` admits a grant only when the genesis operator authored it, and masks the grant set
so only the operator's strikes shrink it. **So depth is bounded by AUTHORSHIP, not by stratification.** A
delegated operator's own grant is not operator-authored, so it never widens the set. Revision 1 credited
stratification for a limit that authorship actually enforces.

**THE LIMIT THIS ACCEPTS, written down so no phase silently removes it.** There is no remote path that
mints an operator. A browser session, however privileged, cannot assign a role. **The transport is the
limit, not the privilege** — §9a says every operator is equivalent, so the end state is that ANY
operator may mint an operator, not that one senior operator may.

Reaching that end state needs new append-door validation in `constitutionalDefect`, which today
recognises only `loam.grants`, `loam.members` and `loam.tenant` shapes. Without it, widening the role
read is the escalation of 8.1. **That is a separate ticket and Myk's decision, not a phase of this
work.**

---

## 9a. Every operator is equivalent. Keys buy PROVENANCE, not privilege

**Myk's ruling, 2026-07-27:** *"Any operator has equivalent operator privilege over the whole store."*

So there are **no operator tiers**. There is no senior operator and no junior operator. The operator
role grants total authority over the whole store, unscoped. The first operator is only the first, not
the most powerful.

**This corrects a phrase that ran through revision 2.** The plan kept saying "the genesis operator" as
if it named a privilege level. It does not. It names ONE KEY — the one in `<home>/operator.seed` — and
that key belongs to the STORE, not to a person. Every operator with home access signs with it. Say
"the store's seed" and the tier disappears from the vocabulary.

**WHAT PER-OPERATOR KEYS ACTUALLY BUY, stated plainly so no phase overclaims.** They buy ATTRIBUTION.
Alice's key proves alice wrote a delta. It does not limit what alice may write. She holds the same total
privilege as every other operator. A phase that describes a per-operator key as a restriction is wrong,
and phase 8's `must not` now says so in both directions: the key must not widen who may write, and it
must not narrow it either.

**THE LIMIT THIS EXPOSES, and it must be written down rather than discovered later.** `remove-role` is a
real privilege boundary **only against a remote user.** It does not bind against home access. Anyone who
can read `<home>/operator.seed` can sign anything, including a fresh role binding for themselves. So:

- Revoking a browser user's role STOPS them. Rail that.
- Revoking the role of someone with filesystem access to the home stops nothing. **Do not rail a
  guarantee here, and do not let the help text imply one.** State it in the command's help: revocation
  governs remote access, and home access is total.

That is not a defect. It is the same boundary §9 identifies — the filesystem is the trust root. It is a
defect only if a message claims otherwise, which is the H7 shape.

---

## 9b. THIS PLAN FAILS `spec-lint`, and that is correct

`adlc spec-lint .adlc/specs/users-oauth-phasing-plan.md` exits 2 with **110 wishes**. Every criterion
here names a BEHAVIOUR and not a verification METHOD. Do not silence that.

**The plan is a decomposition, not a working spec.** It maps fifteen phases and says what each must
prove. A working spec is P1's gateable instrument for ONE piece of work, and there will be fifteen of
them — `.adlc/specs/36a-credentials.md` and its siblings — written when each phase reaches P1.

**So the wish count is a WORK ESTIMATE, not a defect.** Each of those 110 criteria owes one named
assertion in the rail file its phase's `**Verification.**` line already fixes. Transcription, not
invention. A phase whose working spec still lints as a wish is a phase whose criterion nobody knows how
to test yet, and that is exactly what P1 exists to catch.

**What would be a defect** is treating this document as the gated artifact and reporting a green P1 off
it. That is the H7 shape at the process layer: a gate that gates nothing, reported as passed.

---

## 10. What happens next

1. Myk reads revision 2 and approves or redirects.
2. Fifteen tickets replace T113, T114, T116, T117, T118, T119 and T121. **Those seven shards exist only
   on `origin/t113-users`, so `adlc ticket archive` cannot reach them from this branch.** Archive them
   from a checkout that holds them, or land their shards to `main` first and archive there. Revision 1
   said "twelve tickets" and would have failed on both counts.
3. T120 is NOT replaced. It folds into phase 9, which owns `login-locks.ts`. Archive it when phase 9
   lands.
4. **Each phase lands one `spec/NN-slug.md` file, and §36 and §37 are two reserved numbers for fifteen
   phases.** So the phases group into sections rather than mapping one to one. Proposal: §36 covers
   phases 1 through 10 (users, sessions, keys), §37 covers phases 11 through 15 (connectors). A phase
   that lands mid-group EDITS its group's section file, which the standing rule permits as the rare
   exception. `test/site/capabilities.test.ts` then needs exactly two chapters, not fifteen.
   **This is the one item still open, and it is a process question rather than a design one.**
5. Salvage per section 5. Phases 1, 2, 11 and 12 are close to lift-and-shift from #282.
