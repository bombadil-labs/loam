# §36 phase 6/15 — cross-site defence (T127)

## The problem

Phase 5's doors issue a form token and carry it; they refuse nothing about it, and they check no
same-origin signal. A cookie is ambient, and a form POST is a simple request no preflight guards —
so today any page on the internet can POST to `/login` (login CSRF: seating the operator in an
attacker-chosen session) and to `/logout` (signing the operator out at will). This phase is the
enforcement half phase 5 deliberately shipped without: both checks, on both POST doors, refusing.

Salvaged from `salvage-282:src/server/session.ts`: `ownOrigins` (with its loopback widening),
`fromThisPage` (Origin outranks `Sec-Fetch-Site`), `sameSecret` (timing-safe), and the `guarded`
preamble transfer with a vocabulary pass — but NOT the salvage's check ORDER, which a premortem
convicted twice over: it refuses a no-session `/logout` with the provenance 403 where phase 5's
frozen rail pins 401, and it `touch`es (slides) a session's idle window before the token compare
answers, so refused traffic could keep a victim's session alive forever. The order below is this
phase's own. The limiter interplay stays out — phase 9's.

## What this phase does not do

- **No new FIELD.** Phase 5's rails already send `form_token` and `Sec-Fetch-Site: same-origin`
  on every POST; this phase only makes their absence and forgery a refusal. Not one phase-5
  assertion is touched (`git diff` of the two phase-5 rail files against main is empty).
- **No door beyond /login and /logout.** `/session/token` (phase 7) will be born inside the same
  `guarded` preamble, but it does not exist yet.
- **No limiter.** A cross-site POST must not evaluate the password at all — which is what "cannot
  fill a failure counter" reduces to while no counter exists; phase 9 rails the counter proper.

## Decisions

**Two independent signals, both required, and the ORDER is pinned.** A POST door's preamble
runs, in this order and no other:

1. **Origin/provenance.** `Origin`, when present and non-empty, must be one of the store's own
   origins — and it OUTRANKS `Sec-Fetch-Site` (a caller that names a specific foreign page is
   believed over a browser hint). `Origin: null` REFUSES OUTRIGHT, never falling through: the
   pages forbid framing (`frame-ancestors 'none'`), so no legitimate flow reaches these doors
   from a sandboxed context, and null is exactly the origin an attacker can select. With no
   `Origin` at all, `Sec-Fetch-Site` must say `same-origin`. Failure: 403, before any session
   read (no `touch`, no slide), before the hash gate, before the body is PARSED.
2. **Drain.** The request body is read (bounded) regardless — an early refusal must not leave
   bytes on a keep-alive socket for the next request to trip over. Draining is not parsing;
   phase 5's deliberate drain survives.
3. **Session presence, on `/logout` only.** Same-origin, no live session: 401 with phase 5's
   exact body — the frozen rail (k) pins it, and session-absence outranking token-absence
   reveals nothing (the caller already proved same-origin).
4. **Token compare**, `timingSafeEqual`: the session's own token when a live session is
   presented (peeked WITHOUT sliding its window), else the HMAC of the presented pre-session
   nonce. Failure: the same 403. Only a fully admitted request slides the idle window.

**`ownOrigins` comes from the settled public URL, with a bounded loopback widening.** Exactly the
configured origin — except when it is loopback, where the equivalent spellings on the SAME port
(`127.0.0.1`, `localhost`, `[::1]`) are the same store: a browser at `http://localhost:4321`
sends that spelling, and refusing the operator's own form over it would be a self-inflicted
outage. The widening can never admit a foreign host. An unparseable public URL yields an EMPTY
set — every Origin-bearing POST refuses, failing closed and loudly (`onFault`).

**The compare is `timingSafeEqual`, in one exported helper.** `sameSecret(a, b)` — length-guarded,
empty-refusing. One implementation, because the second one is where somebody writes `===`.

**The refusal is its own shape, not the login refusal, and it names the cure.** 403
`{"errors":["this request did not come from this store's own page, so it is refused — reload the
page and try again"]}` — distinct from the 401 uniform login refusal on purpose (it refuses the
REQUEST's provenance, not the credential, and fires before any credential is read), and carrying
the reload hint because every NON-attack path to it — a form issued before a restart (the boot
key died with the process), a stale tab — is cured by a fresh form, and an operator reading an
attack accusation after a deploy files an outage.

**A parseable-but-unroutable public URL is a loud fault, not a silent universal 403.** The
default public URL is the bound address; bound to `0.0.0.0` or `::`, no browser ever sends that
Origin, so every real POST would refuse with nothing anywhere saying why. `makeUserDoors` says
so once on `onFault`, naming `--public-url`. (The CLI already refuses this shape at boot —
phase 5's (t) — so this guards the library caller.)

## Acceptance criteria

All in `test/server/login-csrf.test.ts` against live `serve()` instances.

- (a) **The transition: absence is now refused.** A correct-password `POST /login` with NO
  `form_token` (but a same-origin signal) answers 403 and sets no cookie; the identical request
  WITH the valid token answers 200. Two-sided in one fixture. Verified by
  `test/server/login-csrf.test.ts`.
- (b) **Six cross-site shapes refuse and change no session state.** With a live session's cookie
  attached, `POST /logout` sent with (1) no Origin and no `Sec-Fetch-Site`, (2)
  `Sec-Fetch-Site: cross-site`, (3) `Sec-Fetch-Site: none`, (4) `Origin: https://evil.example`,
  (5) `Origin: null`, (6) `Origin: null` beside `Sec-Fetch-Site: same-origin` — each answers
  403 with NO Set-Cookie, and after all six the session still opens its page (the state
  control). Verified by `test/server/login-csrf.test.ts`.
- (b2) **A refused request slides no idle window.** Injected clock: session opened with
  `idleMs: 1000`; at 900, a refused cross-site-shaped `POST /logout` carrying the cookie; at
  1500, the session is GONE — the refusal touched nothing. Two-sided: at 900 an ADMITTED
  same-origin `GET /login` with the cookie does slide it, and 1500 still answers the page.
  Verified by `test/server/login-csrf.test.ts`.
- (b3) **The /logout precedence phase 5 froze survives.** Same-origin `POST /logout` with no
  cookie and no token answers 401 with phase 5's body, byte-identical to what
  `test/server/login-door.test.ts` (k) pins — session absence outranks token absence once
  provenance passed. And the whole phase-5 file passes on this branch:
  `npx vitest run test/server/login-door.test.ts`. Verified by `test/server/login-csrf.test.ts`
  and that command.
- (b4) **An early refusal leaves a clean socket.** A cross-site `POST /login` with an 8 KiB
  body answers a readable 403, and the next request on the same keep-alive connection answers
  normally. Verified by `test/server/login-csrf.test.ts`.
- (c) **Origin outranks the fetch-site hint.** `Origin: https://evil.example` BESIDE
  `Sec-Fetch-Site: same-origin` refuses — pinning the precedence so the two checks cannot be
  reordered while every other case stays green. Positive control: the store's own origin beside
  the same hint succeeds. Verified by `test/server/login-csrf.test.ts`.
- (d) **The token is an HMAC under a boot key, and forged candidates die.** Candidates: the
  nonce itself, a keyless SHA-256 of the nonce (kills a mutant that drops the key), a token
  minted for a DIFFERENT nonce (kills a compare that ignores its binding), the empty string, and
  a valid token truncated by one. Each with a same-origin signal and correct password: all 403,
  no cookie set. Verified by `test/server/login-csrf.test.ts`.
- (e) **A token issued for one cookie does not open another.** Two fresh pre-sessions A and B:
  A's token posted with B's nonce cookie refuses; A's token with A's cookie succeeds. Verified by
  `test/server/login-csrf.test.ts`.
- (f) **A session-holder's POST uses the SESSION token.** A signed-in caller's `POST /logout`
  with the PRE-session token it signed in with (not the session's own) refuses; with the
  signed-in page's token it succeeds. This pins which token binds once a session exists.
  Verified by `test/server/login-csrf.test.ts`.
- (g) **A cross-site POST evaluates no password — proven at the hash gate, not by byte
  identity.** With `maxConcurrentHashes: 1` and a slow scrypt parked in flight (phase 5's (q)
  fixture shape), a cross-site-shaped `POST /login` answers 403 — never the 503 busy answer —
  so the refusal demonstrably precedes the hash gate (byte-identity alone is satisfied by an
  implementation that hashes first and then answers the constant; the premortem's point). The
  byte-identity and twenty-refusals-cost-nothing controls ride along. Verified by
  `test/server/login-csrf.test.ts`.
- (h) **`GET /login` allocates nothing.** With `maxSessions: 1`, a thousand `GET /login`
  requests, then one login: it succeeds — the GETs held no seat. (The pre-session is stateless;
  this is its rail, deferred here from phase 5 by the plan.) Verified by
  `test/server/login-csrf.test.ts`.
- (i) **The loopback widening is bounded, and the IPv6 spelling is real.** With `publicUrl`
  `http://127.0.0.1:<port>`, an `Origin` of `http://localhost:<port>` succeeds and
  `http://localhost:<other-port>` and `http://evil.example` refuse. With `publicUrl`
  `http://[::1]:<port>` (the bracketed form `URL.hostname` actually returns), an `Origin` of
  `http://localhost:<port>` still succeeds — the widening recognises the bracket spelling.
  Verified by `test/server/login-csrf.test.ts`.
- (j) **Phase 5's rails are untouched.** `git diff origin/main -- test/server/login-door.test.ts
  test/cli/serve-login.test.ts` is empty. Verified by that command in review and by CI's
  rails-guard.
- (k) **An unparseable public URL fails closed and loudly.** `makeUserDoors` handed a garbage
  `publicUrl` refuses every Origin-bearing POST (403) and says so once on `onFault`. Verified by
  `test/server/login-csrf.test.ts` (unit-level: the deps are injectable).
- (l) **An unroutable public URL is a loud fault.** `makeUserDoors` with `publicUrl`
  `http://0.0.0.0:<port>` says so once on `onFault`, naming `--public-url` — the silent
  universal 403 is the outage shape the premortem predicted. Verified by
  `test/server/login-csrf.test.ts`.
- (m) **The 403 names the cure.** The refusal body contains "reload" — the recoverable message
  for every non-attack path (a form issued before a restart, a stale tab). Verified by
  `test/server/login-csrf.test.ts`.

## What phase 7 inherits

`guarded` returns the identified session (or stateless pre-session) with the parsed body, having
already refused a cross-site or forged request — `/session/token` is born behind it, adding only
"a session must exist".
