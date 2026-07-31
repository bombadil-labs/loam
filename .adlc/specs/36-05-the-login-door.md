# §36 phase 5/15 — the login door (T126)

## The problem

An operator has credentials at rest (phase 1), a user record and role bindings in the ground
(phases 2–3), and a session table in server memory (phase 4). Nothing connects them: there is no
door where a person presents a password and receives a session. This phase is that door — three
routes and two cookies, nothing else.

Salvaged from `salvage-282:src/server/session.ts` (tag pinned 2026-07-28): the cookie names and
attribute string, the stateless pre-session, the page shell, the body reader, the login/logout
handlers transfer with a vocabulary pass. The salvage's `/session/token` door, its same-origin
and form-token enforcement, its failed-login limiter, and its `ConsentAuth` window are NOT part
of this phase — they arrive with phases 7, 6, 9 and 14 respectively, into the same file.

A premortem ran against revision 1 of this spec and found six causes worth building differently;
they are folded into the decisions below rather than listed as errata.

## What this phase does not do

- **No JSON door opens.** A session cookie reaches no `graphql`, `append`, `mcp` or byte door.
  Nothing in mount routing reads a cookie. Phase 7 builds the bearer bridge.
- **No refusal for a missing or wrong form token, and no same-origin check.** Phase 5 issues the
  token on `GET /login`, carries it in the page, and PARSES it on POST — and refuses nothing
  about it. No comparison ships in this phase: a compare whose verdict nothing consumes cannot be
  railed (the premortem's point — its deletion would turn no criterion red), so phase 6 builds
  the compare and rails all four of its cases the day the verdict becomes a refusal. Every rail
  in this phase's file sends the valid token it was issued, so phase 6 cannot need to touch one
  assertion here (plan §1 clause ii).
- **No delay and no lockout.** Phase 9 owns `login-locks.json`. (The hash-work CAP is here —
  see Decisions — because its absence harms the doors this phase promises not to touch.)
- **No consent window.** `ConsentAuth` is phase 14's need and arrives with it.

## Decisions

**The doors live in `src/server/session.ts`** beside the table, as `makeUserDoors(deps)`. The
salvage kept them there; the table (phase 4) is the file's existing tenant and the doors are its
first caller. `serve()` gains `users?: UserDoorOptions` — absent, this server has no login doors,
`/login` is an unresolvable mount name exactly as before §36, and no request anywhere reads a
cookie. (`/login` never resolved to anything: mount doors live at `/:mount/:verb`, and a bare
`/login` has no verb. A container mounted under the name `login` keeps its verb doors either
way; the exact paths `/login` and `/logout` were nobody's.)

**The doors' sessions keep their own map, RAILED AS THE TABLE WAS.** The phase-4 `SessionTable`
has no form-token slot and its token half is phase 7's concern, so the doors carry their own
`Map<string, Session>` of `{ user, formToken, expiresAt }` — but every clock-and-cap property
phase 4 proved of its table is a criterion here too, against an injected monotonic clock:
`monotonicNow` (never `Date.now()` — a wall clock is steppable and a stepped clock must not
extend a session), idle expiry that deletes on discovery, a sweep on every open, and a
`maxSessions` cap that refuses a new session rather than evicting a live one. A second store of
the same thing does not get to ship unrailed because a sibling file's rails are green. Phase 7
decides how the two tables meet; this phase does not pre-empt it.

**Two cookies, two names, both `__Host-` prefixed.** `__Host-loam_session` for the signed-in
session, `__Host-loam_form` for the stateless pre-session nonce. One shared name would let any
page on the internet fetch `/login` cross-site (SameSite=Lax presents no cookie on a cross-site
subresource) and overwrite the operator's live session id with a fresh nonce — a forced sign-out
whose orphaned row keeps its idle window with no cookie left to reach it. The attribute string is
ONE pinned literal, `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, computed from no
request header.

**`Secure` over plain HTTP is an operational trap the CLI refuses to set.** A browser discards a
`Secure` cookie from a non-TLS origin unless it is loopback — so a store served on a LAN address
over plain HTTP would show a login form whose successful POST sets a cookie no browser keeps: an
unbreakable loop with no error anywhere. `loam serve` therefore refuses to BOOT, by name, when
the login doors would open (credentials.json present) on a non-loopback bind without an `https`
`--public-url` in front: the message says the session cookie needs TLS and names both cures (a
TLS terminator named by `--public-url`, or a loopback bind). Loopback binds are exempt — browsers
treat localhost as trustworthy. A refusal is honest where silently not opening the doors would be
the H7 shape.

**The pre-session is stateless.** The cookie carries a random nonce; the form token is
`HMAC-SHA256(nonce)` under a key minted at boot. `GET /login` allocates no table row, so a flood
of GETs cannot evict a real session (phase 6 rails the allocation claim explicitly; the shape
ships here). An existing nonce cookie is reused so a reload does not invalidate a half-filled
form.

**Login requires a non-empty role set.** Roles are a SET of non-negated claims (`rolesOf`, phase
2); the door asks membership-of-anything to sign in, and the signed-in page prints the set. No
`roleOf` singular exists and none is added.

**"Cannot decide" is not "gone", and the split is mechanical.** `rolesOf` returns an empty set
for a role-less user AND for a store whose operator identity is unknowable — the read cannot
report a fault. So the door never interprets an empty set alone: `deps.ground()` returning
`undefined` (unresolvable mount, mid-erase reseat) answers 503 with the session untouched, and a
reachable ground whose `operator` is `undefined` ALSO answers 503 — only a ground that names its
operator and then answers an empty set is "this user is gone", which drops the session (and, at
login, refuses). A local fault must never destroy an authenticated session or read as a
password's failure.

**The unknown-name path spends a decoy hash.** `credentials.ts` gains `decoyParamsFor`,
`paramsDisagree` and `spendDecoyHash` (transcribed from the salvage). What this equalizes,
precisely: an unknown name and a known name with a wrong password both cost exactly one scrypt at
the credential file's own parameters and no ground read (the ground is read only after a correct
password). What it does not equalize: the correct-password path does more work; a caller who
already holds the correct password learns nothing from that they would not learn from the 200.
Timing is asserted by no rail (a timing assertion is a flake by construction); the rails pin the
deterministic half — same status, same body — and this paragraph is the timing intent.
`paramsDisagree` is reported once at door opening through `onFault`, never per attempt.

**Unauthenticated hash work is capped, here and now.** scrypt at the shipped parameters is
~100ms and ~16MiB on the shared libuv pool; without a cap, a burst of anonymous POSTs starves
the very data doors criterion (i) promises are untouched — and byte-equality rails cannot see
latency, so no criterion would ever catch it. A plain in-flight counter refuses the surplus
attempt at `maxConcurrentHashes` (default 4) with a 503 whose body says the door is busy; it
never queues. Phase 9's criteria 4, 5 and 13 rail this cap's interplay with the delay
exhaustively in their own file ("criteria 4 and 5 assume it" — the plan words the cap as a
precondition of phase 9, and this phase is what makes that true); this phase rails the basic
shape: the surplus refuses, and a correct password is admitted once the burst drains.

**The body is parsed by `URLSearchParams`, and the rails speak wire bytes.** A browser encodes
space as `+` and non-ASCII as UTF-8 percent-escapes; a hand-rolled decoder that throws on a lone
`%` would turn a typo into a 503 through the outer guard. `URLSearchParams` never throws and
decodes what browsers encode. The page declares `charset=utf-8` in its `content-type` and its
`<meta>`. A criterion posts a password containing `+`, a space and a non-ASCII character as the
literal encoded bytes a browser would send.

**Faults split into two channels.** The caller sees one refusal (`401`, one body) whatever went
wrong — wrong password, unknown user, empty role set. Local faults (unreadable
`credentials.json`, unreachable ground, unknowable operator) answer `503` with a body that names
no path and no user; the detail goes to `onFault`, the operator's channel. One try/catch over the
whole route function backstops any unanticipated throw the same way.

**Session fixation dies at login.** A successful `POST /login` mints a NEW id and drops any
session the presented cookie named. The pre-session cookie is cleared in the same response — the
nonce was good for one login.

**`GET /login` over a live session re-reads the ground.** Roles present → the signed-in page (no
Set-Cookie at all). Cannot decide (either 503 shape above) → 503, session untouched. Ground
names its operator and the set is empty → drop the session, show the form. This is the phase-2
read (`rolesOf`) doing its job at the door.

**The CLI opens the doors when the home holds users, probed at boot.** `loam serve` passes
`users: { home, mount: "default", publicUrl }` iff `credentials.json` exists in the home when the
server boots — a store with no users is exactly the store it was before §36, and a
`credentials.json` written AFTER boot opens nothing until the next serve (stated, and railed,
rather than discovered). `--public-url` (already a flag, T133) names the outside address; the
doors read no `Host` and no `X-Forwarded-*`. The doors keep `publicUrl` in their deps for phase
6, which builds the origin check from it; nothing in this phase consults it beyond the CLI's TLS
refusal above.

## Acceptance criteria

All in `test/server/login-door.test.ts` against live `serve()` instances unless a command or the
CLI rail file (`test/cli/serve-login.test.ts`) is named.

- (a) **The form-token surface.** `GET /login` answers 200, sets `__Host-loam_form=<nonce>` with
  the pinned attributes, and the page carries `name="form_token"` with a non-empty value. A
  `POST /login` sending that token with a correct password answers the signed-in page. A `POST
  /login` sending NO `form_token` with a correct password ALSO succeeds — phase 5 refuses
  nothing about the token, asserted positively so phase 6's transition rail has its "before"
  side. Verified by `test/server/login-door.test.ts`.
- (b) **The pre-session uses its own cookie.** The `Set-Cookie` on an anonymous `GET /login`
  names `__Host-loam_form`, never `__Host-loam_session`. A `GET /login` presenting a live
  session cookie sets NO cookie at all and answers the signed-in page. A cross-site-shaped `GET
  /login` (`Sec-Fetch-Site: cross-site`, no session cookie presented) still answers the form
  with only the pre-session cookie — and a live session's id, presented after that cross-site
  GET happened without it, still opens the signed-in page (the nonce write cannot orphan it).
  Verified by `test/server/login-door.test.ts`.
- (c) **The attribute string is one pinned literal.** Every `Set-Cookie` this phase emits ends
  with exactly `HttpOnly; Secure; SameSite=Lax; Path=/` (plus `Max-Age=0` on the two clears), no
  `Domain` anywhere — asserted byte for byte against the literal, not against a parse. Verified
  by `test/server/login-door.test.ts`.
- (d) **The string is header-blind.** The same request sent three ways — no forwarding headers,
  `X-Forwarded-Proto: https` + `X-Forwarded-Host: evil.example`, and a foreign `Host` — yields
  byte-identical `Set-Cookie` headers. Verified by `test/server/login-door.test.ts`, with the
  positive control that the baseline response DID set a cookie. The raw-`Host` leg uses a raw
  `node:http` request (WHATWG `fetch` cannot send a forged `Host` — T133's precedent).
- (e) **Exactly one session cookie.** The successful login response's `Set-Cookie` list contains
  exactly ONE entry naming `__Host-loam_session` (and one clearing `__Host-loam_form`). A
  request presenting TWO cookies named `__Host-loam_session` is treated as presenting none — the
  signed-in page does not render; the form does. Verified by `test/server/login-door.test.ts`.
- (f) **Login over a live session mints a different id.** Sign in, capture id A; sign in again
  presenting A; capture id B. `A !== B`, and a request presenting A gets the form, not the
  signed-in page. Verified by `test/server/login-door.test.ts`.
- (g) **One refusal for three causes.** Wrong password for a real user, a name nobody holds, and
  a real credential whose user has an empty role set (credential present, no role claims in the
  ground) each answer the SAME status (401) and byte-identical bodies. Positive control: the
  correct password with a role answers 200. Verified by `test/server/login-door.test.ts`.
- (h) **The whole CSP is one pinned literal.** Every HTML response carries a
  `content-security-policy` equal byte for byte to `default-src 'none'; script-src 'none';
  style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, and no
  page body contains `<script`. A `script-src`-only header would leave the page framable and its
  form retargetable — the full literal is the criterion, not one directive. Verified by
  `test/server/login-door.test.ts` over the form page, the signed-in page, and the signed-out
  page.
- (i) **The pre-§36 bytes survive.** Boot two servers over equivalent stores, one with `users`
  configured and one without. A credential-less request to the data doors (`GET
  /default/graphql`-shaped read, `POST /default/append`, `POST /default/mcp`) answers
  byte-identical status and body on both. On the users-less server, `GET /login` answers exactly
  what any unresolvable mount name answers. Verified by `test/server/login-door.test.ts`.
- (j) **A cookie opens no data door.** A signed-in session's cookie attached to `graphql`,
  `append` and `mcp` requests yields byte-identical answers to the same requests with no
  credential at all. (Phase 7 owns the full criterion; this phase rails the half it could
  regress.) Verified by `test/server/login-door.test.ts`.
- (k) **Logout ends the session.** `POST /logout` with the session cookie answers the signed-out
  page, clears both cookies (`Max-Age=0`), and the old id opens nothing afterward. `POST
  /logout` with no session presented answers 401. Verified by
  `test/server/login-door.test.ts`.
- (l) **The doors read no forwarded identity.** `grep -nE "x-forwarded|headers\.host" src/server/session.ts`
  finds nothing — the door code consults neither, structurally. Verified by that command in
  review and by (d) behaviorally.
- (m) **The CLI opens the doors iff users exist at boot.** `loam serve` on a home holding
  `credentials.json` answers `GET /login` with the form; on a home without it, `/login` answers
  the unresolvable-name bytes; a `credentials.json` written AFTER boot changes nothing until the
  next serve. Verified by `test/cli/serve-login.test.ts`.
- (n) **Method discipline.** `GET /logout` answers 405 naming POST; so does `PUT /login`.
  Verified by `test/server/login-door.test.ts`.
- (o) **The session dies of inactivity, on a monotonic clock.** With an injected `monotonicNow`,
  a session past its idle window answers the form, and the row is deleted on discovery (asserted
  via the door answering the form on a SECOND presentation too, after the clock stepped back
  below the expiry — a deleted row cannot revive). Activity slides the window: a touch inside
  the window extends it. Verified by `test/server/login-door.test.ts`.
- (p) **The table refuses past its cap and never evicts a live session.** With `maxSessions: 1`,
  a second login answers 503 while the first session still opens its page; after the first
  session's idle window lapses (injected clock), the login succeeds — the sweep on open reclaims
  the lapsed row. Verified by `test/server/login-door.test.ts`.
- (q) **The hash cap refuses the surplus and recovers.** With `maxConcurrentHashes: 1` and a
  slow scrypt held in flight (a fixture credential with expensive parameters, or a held
  `readSecret`-style latch), a concurrent `POST /login` answers 503 with the busy body and spends
  no hash; once the burst drains, a correct password is admitted. The fixture carries an
  in-flight witness (plan §2: a fixture that completed early leaves the rail green having tested
  nothing). Verified by `test/server/login-door.test.ts`.
- (r) **Wire-encoded credentials round-trip.** A credential whose password is `a+b c%wö` (set
  through `writeCredentials` directly) logs in when posted as the literal
  `application/x-www-form-urlencoded` bytes a browser sends (`+` for space inside the value,
  UTF-8 percent-escapes); a body containing a lone `%` answers 401, never 503. The page's
  `content-type` carries `charset=utf-8`. Verified by `test/server/login-door.test.ts`.
- (s) **Cannot-decide is not gone.** Serving a store whose mount resolves but whose ground
  cannot name an operator answers 503 on `GET /login`-with-session and on a correct-password
  `POST /login`, and the presented session STILL opens its page once the ground answers again.
  Two-sided: with the ground healthy and the user's role claims struck, the same GET drops the
  session. Verified by `test/server/login-door.test.ts`.
- (t) **The CLI refuses the Secure-cookie trap.** `loam serve` on a home WITH `credentials.json`,
  a non-loopback `--host`, and no `https` `--public-url` refuses to boot with a message naming
  the TLS requirement and both cures; the same command with `--public-url https://…` boots, and
  the same command on the default loopback bind boots. Verified by
  `test/cli/serve-login.test.ts`.

## What phase 6 inherits

The `guarded` preamble parses the body and identifies the presented session or pre-session; it
issues and threads the form token but compares nothing. `deps.publicUrl` is threaded and stored,
consulted by no check. Phase 6 builds the comparison (timing-safe, HMAC-bound, keyless-digest
among its forged candidates — all four cases railed the day the verdict refuses) and the
`ownOrigins` set, and turns both verdicts into refusals.
