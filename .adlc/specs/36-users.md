# §36 — Users: authenticate a person, authorize a role, sign with a seed

**Ticket: T113.** Status: design approved in chat (Myk, 2026-07-26); implementation delegated.

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
  rate-limited per source: after 5 failures in a minute, 429 with `Retry-After`.
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
- (o) The failed-login limiter keys on the USERNAME, not on a caller-supplied source: six wrong
  passwords for `myk` lock `myk` with 429 and `Retry-After`, while a second user's correct
  password still succeeds — and rotating `X-Forwarded-For` does not reset the count —
  `test/server/login-limit.test.ts`
- (p) `loam user unlock <name>` clears the lock from the box, so a remote party cannot hold the
  door shut — `test/server/login-limit.test.ts`
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
