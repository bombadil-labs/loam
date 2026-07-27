# Users and connectors: a phased plan

**Status.** A plan for review. It replaces the single change in
[#282](https://github.com/bombadil-labs/loam/pull/282). It creates no tickets yet. Myk approves the
plan first. Then the tickets replace T113, T114, T116, T117, T118, T119 and T121.

**What this plan is for.** #282 holds 13,299 lines. Myk cannot read a change that size. This plan
cuts the same work into thirteen phases. Each phase merges on its own. Each phase is useful on its own.

**Read this section first if you read nothing else.** The plan carries 41 findings from 20 review
rounds. Those findings are now ACCEPTANCE CRITERIA rather than discoveries. A builder reads the
criterion and writes the code once. It does not find the defect on round six.

---

## 1. Why #282 became one change

Two causes. One is real. One is mine.

**The real cause: rails freeze when a ticket lands.** The CI backstop reads the base tree. It freezes
every rail that the base's tickets declare. So a later ticket cannot edit an earlier ticket's rail
file. T116 rewrites the limiter's rail file, and T113 declared it. So T113 could not land before
T116. I stacked them to avoid the refusal.

**My cause: I integrated before I landed.** I merged all three pieces into one branch. Then I opened
one pull request. The standing rule is the opposite: land each decision on its own, and land the
mechanical bulk last. I inverted the rule. The cost is real — the three readable pieces targeted the
integration branch, so Myk can read them but cannot approve them one at a time.

**THE RULE THIS PLAN OBEYS: every phase owns its own rail FILES. No two phases declare the same
file.** A phase that must edit an earlier phase's rail is a phasing error. Fix the phasing, not the
freeze.

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
| 2 | A user is a fact | `test/server/users-ground.test.ts` | `users.ts`, `accounts.ts` | ~500 |
| 3 | **Per-operator signing keys** | `test/server/operator-keys.test.ts` | `users.ts`, `config.ts` | ~550 |
| 4 | The bootstrap and role commands | `test/cli/user-roles.test.ts` | `cli.ts`, `prompt.ts` | ~500 |
| 5 | The session table | `test/server/session-table.test.ts` | `session.ts` | ~400 |
| 6 | The login door | `test/server/login-door.test.ts` | `session.ts`, `http.ts` | ~500 |
| 7 | Cross-site defence | `test/server/login-csrf.test.ts` | `session.ts` | ~350 |
| 8 | The bearer bridge | `test/server/session-token.test.ts` | `session.ts`, `http.ts` | ~350 |
| 9 | The login delay | `test/server/login-delay.test.ts` | `login-locks.ts` | ~450 |
| 10 | Erasure honesty | `test/server/users-erasure.test.ts` | `erase.ts`, `slate.ts` | ~300 |
| 11 | Connector records at rest | `test/server/oauth-file.test.ts` + `test/server/oauth-lock-child.mts` | `oauth-file.ts` | ~600 |
| 12 | Discovery and the 401 | `test/server/oauth-discovery.test.ts` | `oauth.ts` | ~350 |
| 13 | The connector grant | `test/server/oauth-grant.test.ts` + `test/server/oauth-consent.test.ts` | `oauth.ts`, `cli.ts` | ~900 |

Thirteen phases. About 5,800 lines of source and rails. #282 holds 13,299 lines. The plan is smaller
because 41 findings are criteria now, and because three deleted rails do not return.

**Phase 13 is the largest and I flag it.** It holds registration, consent and the token exchange. I
can cut it into three. I did not, because its three parts share one file and one fixture, and a
reviewer must hold the whole grant flow to judge any part of it. Myk decides.

---

## 4. Each phase in full

Every phase states four things. What it delivers. Why it merges alone. What it must NOT do. Which
findings become its criteria.

### Phase 1 — Credentials at rest

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

**Delivers.** A user record and a role binding, both as claims in the ground. A HyperSchema that
counts the operator's assertions only. A Schema that resolves latest-wins. `resolveUserView` and
`roleOf`.

**Merges alone.** Users become readable facts. No door consumes them yet.

**Must not.** It must not touch `credentials.json`. It must not add a door.

**Criteria from findings.**
1. A user is an ENTITY. Its properties resolve through a Schema. Say so in the prose. (#282's header
   said "the half of a user that IS a delta", which collapses a claim into a fact. Myk caught it.)
2. "Operator-signed" is enforced on the READ, not asserted on the write. Any author with write
   standing may sign a claim at an ordinary context. So the select names the operator.
3. A stranger's negation does not retract what the operator said. Assert at both levels.
4. A store with no operator yields no user and no role. The door stays shut.
5. A struck role binding leaves the user readable and the role absent. Assert both levels.
6. A user name is safe in an entity id, a JSON key and an HTML page. One expression, stated once.
7. **MANY USERS MAY HOLD THE OPERATOR ROLE.** Each user is its own entity, and its role binding is a
   claim at that entity. So the shape carries no limit of one. Rail it: assign the role to two users,
   and `roleOf` answers `operator` for both. Rail the other side too: revoking one leaves the other.
8. **THE TRUSTED SET ADMITS DELEGATION BY CONSTRUCTION, even before any key uses it.** Today the read
   is `authoredBy: <the one operator key>`. Phase 3 needs it to be {the genesis operator} ∪ {users the
   genesis operator granted the operator role}. Build that shape HERE, in phase 2. With zero grants it
   resolves to exactly today's behaviour, so it costs almost nothing now — and it means phase 3 adds
   keys without rewriting phase 2's rails. Rail the degenerate case: with no grants, the set is the
   genesis operator alone.
9. **ONE LEVEL OF DELEGATION, and say why.** `lawfulStrikersJson` in `accounts.ts` already computes
   this shape with `inView`, and stratification bans `inView` inside the sub-term. So the chain cannot
   recurse. A user the genesis operator trusted cannot extend that trust to a third party. That is a
   limit, not an oversight. State it where a reader meets the set.
9. A role a user does not hold answers `undefined`, never a default. An unknown role name is refused
   rather than guessed at.

### Phase 3 — Per-operator signing keys

**Delivers.** A signing key per operator-role user. Their deltas carry their own author. Two operators
become distinguishable in the ground.

**Merges alone.** Phase 2 makes a role readable. This makes an operator's writes attributable. Neither
needs a door.

**Must not.** It must not widen who may write. An operator-role user could already write everything;
this changes WHOSE NAME is on it. It must not let a granted operator grant to a third party — phase 2
fixed the depth at one.

**Why this phase exists, in Myk's words.** He read phase 2's provenance limit and scoped it into the
work rather than accepting it. Two operators writing as one author is fine for one person. It stops
being fine the moment a second person holds the role, which is what these phases enable.

**Criteria.**
1. `loam user create <name> --operator` mints a keypair for that user. The seed lands in the home at
   mode 0600, beside the operator's. It never enters the ground, for the same reason a credential does
   not: the ground replicates under federation.
2. A session for that user signs with THAT USER'S seed, not the home's operator seed. Assert at the
   delta level: the author equals the user's own public key.
3. **TWO OPERATORS ARE DISTINGUISHABLE.** Two operator-role users each write a claim. The two deltas
   carry different authors. This is the whole point of the phase, so it is the rail that must not be
   hollow — assert the authors DIFFER and that each equals its own user's key, not merely that they
   are non-empty.
4. The genesis operator remains trusted. An existing store's deltas were all signed by it, and they
   must keep resolving. Rail it against a store built before this phase.
5. A granted operator's writes resolve for a governed reader. The trusted set from phase 2 admits
   them, so their role bindings and their claims both count.
6. **REVOKING A ROLE STOPS THE KEY GOING FORWARD AND KEEPS THE PAST.** After `remove-role`, that
   user's new writes no longer resolve for a governed reader. Their earlier deltas still do, and still
   name them. Two-sided, and it is the provenance win stated as a rail.
7. A user with no operator role gets no operator seed. An actor's writes are signed by whatever the
   actor path already uses. State what that is rather than inventing a second mechanism.
8. **NO ON-WIRE MIGRATION IS OWED, and prove it.** No existing delta changes shape. This phase only
   ADDS deltas — role bindings authored by new keys. Rail that a store created before this phase reads
   identically after it. If any delta's bytes change, this phase owes a §20 step and the plan is wrong.
9. The seed file's mode is asserted on POSIX only, and the gap is named on Windows. Reuse phase 1's
   helper rather than writing a second one.
10. Losing a user's seed is recoverable and the help text says how: `assign-role` again mints a fresh
    key. The user's past deltas keep their old author, so history does not rewrite.

### Phase 4 — The bootstrap and role commands

**Delivers.** `loam user create <name> --operator --home <dir>`, plus `loam user assign-role` and
`loam user remove-role`. `create` prompts twice with echo off, writes the credential, and appends the
two deltas. The role commands change a role binding and nothing else.

**Merges alone.** An operator can provision a user. Nothing serves it yet.

**Must not.** It must not add a door.

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
13. **`remove-role` STRIKES ONE BINDING; it does not set a user roleless.** The property resolves
    latest-wins over the surviving claims, so striking `operator` on a user who was earlier an `actor`
    leaves them an `actor`. That is correct and it is surprising. Rail both outcomes: a user with one
    binding becomes roleless, and a user with two becomes the earlier one.
14. After `remove-role operator`, that user's session opens no operator door. Assert at both levels —
    the negation is in the ground, and the door refuses.
15. **THE LAST OPERATOR MAY REMOVE THEIR OWN ROLE, AND THE STORE STAYS RECOVERABLE.** These commands
    prove operatorship by HOME ACCESS and sign with the home's seed, exactly as `create` does. They
    need no session. So a store with no operator-role user is still repairable on the box. Rail it:
    remove the only operator, then assign it again, and the door opens. State this in the help text,
    because an operator who thinks they can lock themselves out will not use the command.

### Phase 5 — The session table

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

### Phase 6 — The login door

**Delivers.** `GET /login`, `POST /login`, `POST /logout`. The session cookie. The pre-session
cookie.

**Merges alone.** An operator can sign in. The session opens no data door yet.

**Must not.** It must not open a JSON door. Phase 7 does that, through a bearer token.

**Criteria from findings.**
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

### Phase 7 — Cross-site defence

**Delivers.** A same-origin signal check. A per-session form token. Both on every POST door.

**Merges alone.** It hardens phase 5's doors. Phase 5 is usable without it and safer with it.

**Must not.** It must not weaken any phase 5 assertion.

**Criteria from findings.**
1. A cross-site-shaped POST is refused and changes no session state. Four shapes: no signal, a
   cross-site signal, a `none` signal, and a foreign `Origin`.
2. A foreign `Origin` beside a same-origin signal is refused. This pins the PRECEDENCE. Without it
   the two checks could be reordered and every other case stays green.
3. The form token is an HMAC under a boot key. Include a KEYLESS digest among the forged candidates.
   Without it, dropping the secret leaves every refusal intact.
4. A token issued for one cookie does not open another.
5. A cross-site POST cannot fill a victim's failure counter.
6. `GET /login` allocates nothing. A thousand of them leave the door open.

### Phase 8 — The bearer bridge

**Delivers.** `POST /session/token`. It answers a short-lived bearer token for the session user.

**Merges alone.** This is the phase that lets a browser write. It is the whole reason cookie
authority stays off the JSON doors.

**Must not.** It must not let a cookie open a JSON door.

**Criteria from findings.**
1. THE COOKIE ALONE OPENS NO JSON DOOR. A cookie-only request to graphql, append and mcp receives the
   same bytes as a request with no credential. A cookie is ambient, so a cookie-opened data door is
   cross-site forgeable. `http.ts` states that authority is an explicit header.
2. The token opens a read door and a write door.
3. The landed delta is signed by THAT USER'S OWN seed, per phase 3. The role authorizes. The seed
   signs. A user is not a seed, and a user's key is not the store's key.
4. Every author in the ground is a key the home holds — the genesis operator, or a user's own seed
   from phase 3. Login must not grow a key nobody granted.
5. The token dies with its window. The session that minted it survives.
6. Signing out retires the tokens that session minted.
7. A container mount answers a session token exactly as it answers the static operator token. Anchor
   the mount first. Two identical errors satisfy an equality check.
8. The one-mount guard throws BEFORE the socket binds. A refusal that is a pure function of the
   options must not leave a bound listener with no doors.

### Phase 9 — The login delay

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

### Phase 10 — Erasure honesty

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

### Phase 13 — The connector grant

**Delivers.** Registration, the consent page, the token exchange, `loam grant list` and
`loam grant revoke`.

**Merges alone.** This completes the connector. It is the largest phase. Myk may cut it in three.

**Must not.** It must not mint an operator identity. There must be no code path from a grant to
`{ operator: true }`.

**Criteria from findings.**
1. Registration is fenced by a CONFIGURED allowlist of redirect origins. It cannot require a session,
   because claude.ai registers before any human is present. Without the fence, a stranger registers a
   client named "Claude", sends the operator an authorize link, and holds a writing identity. **That
   attack never needs operator escalation, so "the mint path cannot produce operator" is necessary and
   nowhere near sufficient.**
2. `redirect_uri` matches a registered one EXACTLY, at registration and at authorize. A different
   path, an added query and another port are all refused.
3. No response carries a `Location` outside the allowlist, including on refusal paths.
4. The consent page escapes `client_name`. It displays the REGISTERED uri, never caller text. It
   carries a no-script CSP.
5. Control bytes are refused in EVERY operator-facing field. `new URL()` strips tab and newline, so a
   value can parse clean and still forge a row in `grant list`. A rule for one field must cover its
   siblings.
6. A code binds to `client_id` AND `redirect_uri`. It is single-use and burns on ANY redemption
   attempt. Its expiry is monotonic.
7. THE EVICTION PIN READS THREE SOURCES: a live code, a redemption in flight, and a grant in the file.
   Redemption deletes the code before it writes the grant. Between those points the client holds
   neither. A flood in that window evicts an approved connector, and its code is already burnt.
8. `redeeming` is a COUNT, not a flag. Two redemptions for one client would otherwise have the first
   to finish clear a pin the second needs.
9. The eviction cap evicts the oldest never-approved client, never an approved one. A plain cap is a
   lockout: a stranger fills it and the real connector is refused forever.
10. A grant mints a NEW actor seed per client. The seed is written before the ground append, so a
    retry reuses it rather than minting a second.
11. Revocation bumps a generation. A code issued before a revoke must not mint a token after it.
12. Revocation binds on the very next request of the SAME live process. A rail that restarts between
    revoke and retry proves nothing.
13. Revocation is two-sided: access is gone AND past deltas still name their author.
14. An unknown bearer token must not cost one key derivation per stored grant on the event loop.
15. Neither the seed, the token nor the PKCE material appears in any delta. Scan after a full flow.
16. No refusal sends the home path or a flag name to a caller. The detail goes to `onFault`. **A
    fixed string goes to the caller.** Rail it by inducing the fault and asserting the door's BODY,
    not what the code throws.

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

1. **Whether phase 12 splits into three.** Myk decides.
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
