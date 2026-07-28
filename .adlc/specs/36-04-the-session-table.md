# §36 phase 4/15 — The session table

**Ticket.** T125. **Scope.** `src/server/session.ts`, `test/server/session-table.test.ts`.

## What this delivers

An in-memory table of signed-in sessions. A session row holds the user's name (a string; phase 2's
`resolveUserView`/`rolesOf` read the role from the ground, so the table itself carries no role) and
an idle-expiry timestamp. Opening a session mints an opaque id — 32 random bytes, base64url — never
a counter or a name-derived string. The table reads a MONOTONIC clock, injectable so a test can drive
it, and defaulting to `performance.now()` rather than `Date.now()`: `Date.now()` is a wall clock a
caller or the OS can step backward (a manual clock change, an NTP correction), and a session whose
expiry check ever reads a smaller "now" than a prior read would look like it has more time left than
it really has — the wall clock's backward step reads as an extension of the session's life.
`performance.now()` is guaranteed non-decreasing within one process, so this cannot happen through
the default clock; the injected-clock rail (criterion 2) still proves the table does not resurrect an
already-expired row even when handed a clock reading that goes backward, because the row is deleted
the moment it is found past its idle window — there is no live row left for a later, smaller reading
to revive.

The table also holds a table of minted bearer-token digests, keyed by digest for O(1) resolution
rather than a per-session scan, with each session row holding only the set of digests IT minted (so
`drop` knows which entries to erase). The table itself does not construct the token's caller-facing
meaning (what the token authorizes) — that is the bearer bridge, phase 7
(`test/server/session-token.test.ts`). This phase's token surface is the minimal shape phase 7 needs
to build on: `mintToken` returns an opaque secret and records only its SHA-256 digest, alongside its
OWN expiry (`now() + ttlMs`) — never the session's idle expiry. That separation is load-bearing: an
independent review of this spec (recorded below) found that a digest with no expiry of its own
resolves for as long as its parent session stays alive, which can be far past the token's stated TTL
(a session idles for up to 30 minutes by default; a token defaults to 5). `resolveToken` checks the
DIGEST's own expiry, not the session's, and answers whether a presented secret currently names a live
session. `drop` erases every digest a session minted from the shared digest table, so a subsequent
`resolveToken` of that secret fails. Both `mintToken` and `touch` prune that session's own
already-expired digests as a side effect — minting alone would miss a session that mints once and is
then kept alive by ordinary activity for a long time, which a premortem of this spec named as a slow
memory leak; pruning on `touch` too closes that path without a background timer.

**`resolveToken` does NOT slide the session's idle window.** Presenting a bearer token is a read of
the table, not an assertion that a human is at the keyboard, so it does not count as the activity
that keeps a session's idle window open. A caller that wants token traffic to keep a session alive
calls `touch` itself — that is a phase 7 (bearer bridge) decision, not this table's, and this phase
takes no position on it beyond leaving the primitive available.

**`ttlMs`, like `idleMs`, is a DURATION in milliseconds, never an absolute timestamp** — both are
added to a `now()` reading inside the table, never compared to one directly. A caller must not pass
`Date.now()`-shaped values here; the table's own default options never do.

**This table is one process's in-memory state, deliberately, matching criterion 3's restart
behaviour** — it has no cross-process or cross-replica coherence, and a clustered or multi-replica
deployment of the login door is out of scope for this arc. Loam's server is a single-process store
today; a future clustered deployment is a different ticket; a multi-user single-tenant deployment
already relies on a single home directory.

**A named, accepted limitation: `open` does not evict a LIVE session to make room.** An independent
review flagged the cap (criterion 4) as a denial-of-service surface — enough abandoned logins fill
the table and lock out new sign-ins until they age out. Two things bound this rather than eliminate
it, and the phase states both rather than solving a problem outside its scope: first, `open` sweeps
every session already past its idle window before checking the cap, so an ABANDONED session is
reclaimed at the next login rather than sitting until a process restart — it does not survive past
its own stated idle window. Second, this table deliberately never evicts a session that is still
LIVE to make room for a new one: doing so would let a flood of new logins evict a legitimate,
active user's session, which trades one denial-of-service shape for a worse one (an attacker who can
merely log in repeatably could then sign a real operator out). Bounding how fast an attacker can
OPEN new sessions at all is the login door's concern (phase 5) and the login delay's (phase 9,
`test/server/login-delay.test.ts`) — a table cannot rate-limit its own inputs from inside itself.
A premortem of this spec named the same gap a different way: an attacker who opens `maxSessions`
sessions and `touch`es each just under its idle window keeps every one of them permanently live, so
the sweep-on-open fix reclaims nothing. That is the identical trade-off restated, not a new one — a
table that evicted a session merely for being touched slowly would evict real users the same way,
and an absolute (non-idle) maximum session lifetime, if wanted, is a future ticket's decision, not
this phase's.

## Why this merges alone

The table is a unit, testable directly with no HTTP surface, no cookie, and no CLI. Nothing outside
this ticket's scope file reads it yet — the login door (phase 5) is the first caller.

## Must not

This phase must not add a door — no HTTP route, no GraphQL field. It must not read a cookie: there
is no `IncomingMessage` parameter anywhere in this file, and no import of `node:http`.

## Acceptance criteria

Every criterion is proved in `test/server/session-table.test.ts`. Rails are declared at P3, once
these tests exist and are red.

1. A session past its idle window is refused. Open a session with a short idle window, advance the
   injected clock past it, and `touch` the session id: the call returns `undefined`, not the row.
   Verified by `test/server/session-table.test.ts`.
2. A wall-clock step BACKWARDS does not extend a session. Open a session, advance the clock past its
   idle window (`touch` returns `undefined` — criterion 1's own assertion, doubling as the positive
   control that expiry detection actually runs), then feed the table a clock reading SMALLER than the
   one that proved expiry, and `touch` the same id again: it still returns `undefined`. The row was
   deleted on first expiry, so no later backward reading can revive it — the case a naive
   read-the-wall-clock-live design would get wrong. Verified by `test/server/session-table.test.ts`.
3. A restart invalidates every session. State that this is deliberate for one operator: the table is
   a plain in-memory `Map` with no persistence, so a fresh `createSessionTable()` call — which is what
   a process restart produces — starts with no rows regardless of what an earlier instance held.
   Verified by `test/server/session-table.test.ts` (open a session on one table instance, `touch` its
   id against a second, freshly created instance, and get `undefined`) and stated in a comment in
   `src/server/session.ts`.
4. The table holds at most its cap. State what a full table does: `open` refuses a new session
   (returns `undefined`) once the table is at its configured `maxSessions`, and it does not evict a
   LIVE session to make room — a session already open stays open (positive control: `touch` a
   pre-existing session id after the table is full, and it still resolves). Two-sided on the sweep
   fix: fill the table, advance the clock past every row's idle window, and confirm `open` NOW
   succeeds — an abandoned session is reclaimed at the next login rather than blocking one forever.
   Verified by `test/server/session-table.test.ts`.
5. A minted token is held as a DIGEST with its OWN expiry, never as the secret and never sharing the
   session's idle expiry. `mintToken` returns the plaintext secret to its caller; the table's own
   record is a SHA-256 hex digest (independently computed `sha256(secret)` is what a live token
   resolves against — the returned secret never has the digest's shape: different length, different
   alphabet) paired with its own `now() + ttlMs`. Two-sided rail on the TTL isolation: mint a token
   whose TTL is short and whose session's idle window is long; advance the clock past the token's TTL
   but not the session's; `resolveToken` answers `undefined` while `touch` on the same session still
   succeeds — the token did not silently borrow the session's remaining idle time. Verified by
   `test/server/session-table.test.ts`.
6. Dropping a session revokes the tokens it minted. Mint a token, confirm `resolveToken` answers the
   session's user (positive control — proves resolution works at all before proving revocation),
   `drop` the session, and confirm `resolveToken` of the same secret now answers `undefined`. A
   `drop` that answers and revokes nothing has revoked nothing. Verified by
   `test/server/session-table.test.ts`.

## Independent review

`adlc review --input .adlc/specs/36-04-the-session-table.md --provider gemini --model
gemini-pro-latest --timeout 900 --verify` ran twice (once plain, once with `--verify`, which tries to
refute each finding rather than only asserting it). Four findings survived `--verify`: a token digest
with no TTL of its own (critical — fixed above, criterion 5), a full table never reclaiming an
abandoned session (high — fixed above, criterion 4's sweep-on-open), an unbounded per-session digest
set (medium — fixed above, pruned on mint), and the cap being globally exhaustible with no per-actor
quota (high — named as an accepted limitation above rather than fixed, since a quota or eviction
policy is outside what "an opaque id, an idle window, a monotonic clock, a cap" scopes for this
phase, and the login door/delay phases are where a request rate is actually bounded).

`adlc premortem .adlc/specs/36-04-the-session-table.md` ran with `ADLC_MODEL_CHEAP=gemini-flash-latest
--tier cheap` (the frontier and mid tiers hit the same deprecated-model 404 as the review above; the
cheap tier's response also stayed under the tool's fixed 4096-token cap, an operational limit rather
than a finding). Five causes came back. Two restate findings already fixed or named above (the digest
leak, the slow-drip cap exhaustion) and are folded into the prose above. Three are addressed directly
in prose: `resolveToken` does not touch (documented, a phase 7 decision), `ttlMs` is a duration
(documented), and multi-process coherence is out of scope (documented, matches criterion 3).
