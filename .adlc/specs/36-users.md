# §36 — Users: authenticate a person, authorize a role, sign with a seed

**Ticket: T113.** Status: design approved in chat (Myk, 2026-07-26); implementation delegated.

**Amended by T116** (Myk, 2026-07-27, in chat): the failed-login limiter DELAYS; it never locks. A
lock is an off switch a stranger can pull — anyone who knows a username could hold the operator out
of their own store. So each failure for a name makes the next attempt for that name wait longer, up
to a cap, and the door always admits a correct password. Criteria (o) and (p) below are T116's.

**The cost, named — four parts, and none of them is a bound to lean on.**

1. A caller who grinds the operator's username makes the operator's own login slow, up to the cap,
   once per login. Slow is not shut, and that is the whole trade.
2. A waiting attempt spends no hash budget WHILE IT WAITS, so another name gets in during the wait.
   That is all criterion (o3) proves, and the stronger reading is false: the waits then elapse
   together, the flood spends the whole hash budget at once, and a name arriving in that window is
   refused with 503. Login is deliberately degradable under a flood, and it still is. A waiting
   attempt also pins one socket on the shared `node:http` server for up to `maxDelayMs`, and a caller
   holding enough sockets exhausts descriptors for every door. Nothing caps how many attempts may
   wait at once, and no such cap is safe — refusing past one is the lockout again, and serving past
   one without the wait is free guessing. That exposure is unbounded here and is not railed.
3. The delay bounds a SERIAL guesser only. Waits do not serialize — the pre-compare read is advisory
   and the wait is a bare timer with no per-name queue — so a caller holding many connections has all
   their waits elapse together, and their rate is the concurrent-hash cap divided by one hash. That
   cap pre-dates this change. Do not read `maxDelayMs` as an attempts-per-second bound; against a
   caller who opens more than one connection it is wrong by orders of magnitude. A per-name queue
   would close it and reintroduce the lockout, so it stays open and named.
4. **A SQUATTED TABLE CHARGES A TARGETED NAME NOTHING, and this one is Myk's to weigh.** The record
   file is bounded by `maxTracked`, because an unauthenticated caller writes a row per name and every
   write rewrites the file whole (H8). A row is seated at ONE failure, so a new row is always among
   the weakest — and a caller who holds `maxTracked` rows above that count keeps a chosen name out of
   the table for one fresh name per round. Measured against the module at `maxTracked: 8`: 0ms charged
   to the target on every round, under BOTH eviction tie-break orders. The tie-break only moves the
   setup price. So the delay taxes a serial guesser against an UNSQUATTED table, and a determined
   caller who squats can guess one chosen name at the concurrent-hash cap's rate — which is where the
   pre-T116 lock also ended up, by a different route. Closing it needs a store that is not a bounded
   whole-file rewrite, or per-name counters that collide and therefore slow innocent names, breaking
   criterion (o3). Recommendation: land T116 as it stands, and open a follow-up ticket for the store.
   The residual is strictly narrower than the lockout this section removes, and it refuses nobody.

## The problem

Today one word, "token", does three jobs. A bearer token authenticates the caller, carries the
caller's rights, and stands in for the signer. That collapse forced a bad shape: to consent to
anything in a browser, the operator would paste the root secret into a web form. Myk refused
that shape. He is right: a root secret that enters a browser is a root secret you must assume
is lost.

## The model

Three things, three questions:

- A **user** answers "who is this person?" — `user:myk`.
- A **role binding** answers "what may this user do here?" — `myk` holds the operator role.
- A **seed** answers "what key signs a delta?" — seeds stay in files and in grants; a user is
  not a seed.

A login authenticates a user. A permission check reads the user's role binding. A write is
signed by a seed. The door token keeps working for API callers and never gains a browser form.

## Where the pieces live

- **In the ground (deltas):** the user record (`user:<name>`, a `name` prop) and its role
  binding (a claim at context `role` with value `operator`), signed by the operator seed at
  bootstrap. These are facts: readable through a genesis-style reading, subject to provenance
  and erasure like all facts.
- **In the home (files):** `credentials.json` — per-user scrypt parameters, salt, and hash;
  mode 0600. A local secret. It never enters the ground, because the ground replicates under
  federation and a credential hash must never travel to a peer.
- **In server memory:** sessions. An opaque 32-byte id in an HttpOnly cookie, mapped to a user
  in memory. Sessions die with the process — for a single-operator store that is a feature,
  not a gap.

## The doors

- `loam user create <name> --operator --home <dir>` — the bootstrap CLI. Run on the box, one
  time. Home access is the proof of operatorship. Prompts for the password twice with echo
  off; writes the credential entry; appends the user + role-binding deltas signed by the
  home's operator seed.
- `GET /login` — a minimal HTML form. No script.
- `POST /login` — verifies the password against `credentials.json` (scrypt, timing-safe
  compare), sets the session cookie on success, answers 401 on failure. Failed attempts are
  DELAYED per username, never refused: each failure makes the next attempt for that name wait
  longer, up to a cap. There is no lock and no `Retry-After`, because a correct password is
  always admitted.
- `POST /logout` — drops the session.
- `POST /session/token` — with a session, answers a short-lived bearer token for the session
  user's identity. This is how a browser UI writes: JavaScript holds the token and sends it in
  an `Authorization` header.

## Cookie authority is CONFINED — the premortem's first finding

A cookie is ambient: the browser attaches it to any request any page makes. `http.ts` says the
CORS wildcard is safe precisely because "authority here is a bearer header the caller must
present explicitly (never a cookie, never ambient)." A session that opened the GraphQL door
would break that sentence and hand every web page a write door (cross-site request forgery: a
form POST with a JSON-shaped body is a simple request — no preflight, cookie attached, mutation
lands).

So the cookie opens exactly four doors, all browser-facing HTML: `/login`, `/logout`,
`/session/token`, and (in §37) `/oauth/authorize`. Every other door stays header-only, exactly
as today. A browser that wants to write asks `/session/token` and then presents a header like
any other client. The invariant survives: authority is always explicit.

The three POST doors also require a same-origin signal (`Sec-Fetch-Site: same-origin`, or an
`Origin` matching the configured public URL) and carry a per-session form token. Belt and
braces, because this is the door that guards everything else.

## The public URL is configured, never guessed

The server binds loopback behind a proxy it cannot see. `Host` and `X-Forwarded-*` are
caller-controlled. So a new `--public-url <url>` names the outside address; cookies, redirects,
and §37's discovery documents all read it. A foreign `Host` header changes nothing.

## What does not change

Bearer tokens, the token table, door discipline, and the tokenless-public rule stay as they
are. This section adds a second way to BECOME an identity; it does not change what any identity
may do.

## Acceptance criteria

- (a) `loam user create myk --operator` writes a `credentials.json` entry with mode 0600 and
  appends exactly two deltas: the user record and the operator role binding, both signed by the
  operator seed — `test/server/users-bootstrap.test.ts`
- (b) Running the same create twice refuses the second run with a named error and appends
  nothing — delta count asserted before and after — `test/server/users-bootstrap.test.ts`
- (c) After bootstrap and one login, no delta in the ground contains the salt or hash bytes
  (delta-level scan of the whole store) — `test/server/users-bootstrap.test.ts`
- (d) `POST /login` with the right password answers a cookie whose attribute string is exactly
  `HttpOnly; Secure; SameSite=Lax; Path=/` with no `Domain`; a wrong password answers 401 and
  sets no cookie — `test/server/login.test.ts`
- (e) The cookie's attribute string is byte-identical whether the request arrives with
  `X-Forwarded-Proto: https`, with a foreign `Host`, or with no forwarding headers at all —
  `test/server/login.test.ts`
- (f) A session cookie opens `/session/token`, and the token it answers opens a read door AND a
  write door; the token carries the identity the user's ROLE binding names, and the landed delta
  is signed by the store's operator seed — asserted at the delta level (the author key in the
  ground) and through a reading — `test/server/session-doors.test.ts`
  <!-- A user is not a seed: the role authorizes, the seed signs. An earlier wording asked for a
  delta authored by the user, which the three-way split makes impossible by construction. -->
- (f2) A per-user signing key is NOT minted: no delta in the ground is authored by a key absent
  from the home's seed files — `test/server/session-doors.test.ts`
- (g) The session cookie ALONE opens no JSON door: a cookie-only request to graphql, append,
  and mcp is refused with the same bytes a request with no credential at all receives —
  `test/server/session-doors.test.ts`
- (h) A cross-site-shaped `POST /login`, `/logout`, or `/session/token` — no same-origin
  signal, or an `Origin` other than the configured public URL — is refused and changes no
  session state — `test/server/csrf.test.ts`
- (i) A POST to those doors carrying a wrong or absent form token is refused —
  `test/server/csrf.test.ts`
- (j) A request with neither cookie nor token gets the same refusal bytes such a request got
  before this section existed (no oracle: the refusal never reveals that users exist) —
  `test/server/session-doors.test.ts`
- (k) `POST /logout` ends the session: the next request with the old cookie is refused —
  `test/server/login.test.ts`
- (l) Logging in while presenting an existing session cookie answers a DIFFERENT session id,
  and the old id opens nothing (no session fixation) — `test/server/login.test.ts`
- (m) A session past its idle window is refused (fake timers), and a wall-clock step BACKWARDS
  does not extend it (expiry is monotonic) — `test/server/login.test.ts`
- (n) A server restart invalidates all cookies: the same cookie that opened a door before the
  restart is refused after it — `test/server/login.test.ts`
- (o) The failed-login limiter keys on the USERNAME, not on a caller-supplied source, and it DELAYS
  rather than locks: twenty wrong passwords for `myk` never refuse `myk`, the right password still
  answers 200 with a session cookie, and rotating `X-Forwarded-For` does not reset the count —
  `test/server/login-limit.test.ts`
- (o1) The wait grows with each failure and is CAPPED, so it cannot become a denial under another
  name; `delayFor` saturates at the cap for any count — `test/server/login-limit.test.ts`
- (o2) The wait is paid BEFORE the password comparison: a door with no hash budget at all still waits
  it out before it answers 503 — `test/server/login-limit.test.ts`
- (o3) A flood against one name neither slows another name's login nor spends the hash budget — a
  waiting attempt holds no slot, and the concurrent-login cap is asserted with waits in flight —
  `test/server/login-limit.test.ts`
- (o4) Concurrent attempts cannot lose an accumulated count: four overlapping misses record four, and
  the next attempt is charged for all four — `test/server/login-limit.test.ts`
- (o5) A wall clock stepped BACKWARDS cannot erase an accumulated wait, and silence past the forget
  window does clear one — `test/server/login-limit.test.ts`
- (o6) The record file holds no more than `maxTracked` rows, a flood of fresh names cannot flush a
  record that holds more failures, and MATCHING a record's count does not evict it — ties take the
  newest — `test/server/login-limit.test.ts`
- (o7) BOTH writes to the record file fail open: a home the door cannot write leaves a failed attempt
  answering 401 rather than 503, and still admits a correct password, reporting the fault to the
  operator's channel instead of the caller — `test/server/login-limit.test.ts`
- (p) `loam user unlock <name>` clears that name's accumulated wait from the box, `--all` clears every
  record whatever name it holds, and the report names the COUNT rather than a wait the CLI's process
  cannot know — `test/server/login-limit.test.ts`
- (q) Unauthenticated scrypt work is globally capped: concurrent login attempts past the cap are
  refused without hashing — `test/server/login-limit.test.ts`
- (r) The login page carries a `Content-Security-Policy` that permits no script —
  `test/server/login.test.ts`
- (s) A malformed, truncated, or empty-hash `credentials.json` refuses every login with a named
  error and never treats "cannot determine" as "matched"; the running server does not crash —
  `test/server/credentials-corrupt.test.ts`
- (t) `credentials.json` is written atomically (temp file, rename, fsync) and ends at mode 0600
  even when the path already existed at 0644 — `test/server/credentials-corrupt.test.ts`
- (u) The erasure report NAMES `credentials.json` as a surface it does not sweep, and a login
  for a user whose user-record delta is absent is refused — the report cannot claim a
  completeness it does not have (H7) — `test/server/users-erasure-honesty.test.ts`
- (v) The user record and role binding resolve through a reading into a View naming the user
  and the role (object level of criterion a) — `test/server/users-bootstrap.test.ts`
- (w) `npm run check` green with all of the above — `npm run check`

## Deferred, named

- Passkeys (WebAuthn) replace or join passwords — its own ticket; `credentials.json` carries a
  per-entry `kind: "scrypt"` field so the passkey entry lands without a migration.
- More than one user, invitations, non-operator roles beyond plain actor — future tickets.
- **An erasure that also removes a user's credential entry** — that WIDENS what gets purged, so
  it is Myk's merge by standing rule. Criterion (u) makes the report honest instead; the sweep
  itself is its own ticket.
- Sessions that survive restart — deliberately out; revisit only with a named need.
