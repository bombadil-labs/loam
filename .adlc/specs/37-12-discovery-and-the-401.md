# §37 phase 12/15 — discovery and the 401 (T133)

## The problem

A connector (claude.ai or any MCP client) must be able to find this store's OAuth surface before
any human is involved: the two RFC well-known documents, and a `WWW-Authenticate` challenge on the
door it tried without a token. Nothing here mints a client, a code, or a token — those are phases
13, 14 and 15. This phase only makes the store discoverable and points a refused caller at where to
start.

Salvaged from `salvage-282:src/server/oauth.ts` (tag pinned 2026-07-28): `issuerFor`,
`protectedResourceDocument`, `authorizationServerDocument`, `challengeFor`, and the two well-known
routes transfer with a vocabulary pass and no behavior change. The salvage's registration, consent
and token doors are NOT part of this phase — they arrive with phases 13–15, into the same file.

## What this phase does not do

No client registers. No code is minted. No token is minted. `src/server/oauth.ts` imports no
signing key material and no `oauth-file.ts` writer — the two documents are pure functions of one
configured string.

## The public-url discipline

Every URL either document advertises, and the challenge header's `resource_metadata` URL, comes
from ONE configured value: `--public-url` (new flag, `src/cli/cli.ts`), threaded through
`ServeOptions.publicUrl` (`src/server/http.ts`) to `makeOAuthDoors` (`src/server/oauth.ts`).
Neither document-building function reads `req` at all — there is nothing for a foreign `Host` or
`X-Forwarded-Host` to influence, which is the strongest form of the plan's §1 promise ("Host and
X-Forwarded-* are the caller's to write and must change nothing in the advertised URLs") this slice
can make: not merely "tested to agree," but structurally unable to disagree.

**`publicUrl` is OPT-IN, matching phase 13's `--oauth-allow-redirect` precedent (empty means
fenced shut).** When `--public-url` is absent, `serve()` builds no `OAuthDoors`; the two
`.well-known` paths resolve exactly as they did before this phase (an ordinary unmounted path, the
uniform 401/404 an unresolvable name always got), and no `WWW-Authenticate` header is ever added.
A store an operator has not configured for connectors advertises nothing about them — the same
"no spelling means no" discipline the redirect fence itself uses one phase later.

## The MCP door's 401

`http.ts`'s existing anonymous-refusal path (`identity === undefined`) already answers 401 for a
tokenless or wrong-token request to `/:mount/mcp`, uniformly across a mount that exists, one that
never did, and one with no public surface — that uniformity (T78/§12) is what the discovery header
must not disturb. The header is added at exactly the two call sites inside that path that can
answer a request whose parsed verb is `"mcp"`, and its value is `discovery.challenge` —
`` `Bearer resource_metadata="<issuer>/.well-known/oauth-protected-resource"` `` — a constant of
the server for the lifetime of the process, never a function of the mount, the verb otherwise, or
the token presented. No other door's refusal gains a header; the plan's `Delivers` line names the
MCP door alone.

**THE HEADER IS EXPOSED, NOT ONLY SENT** (an independent review's finding, folded in before any
code existed rather than after). A cross-origin `fetch()` from a browser-hosted connector cannot
read a response header that is not on the CORS safelist unless the server names it in
`Access-Control-Expose-Headers` — `WWW-Authenticate` is not safelisted. A header a caller cannot
read is not a discoverable challenge, only a return-trip curiosity for a tool inspecting raw
sockets. So the same two call sites that add `www-authenticate` also add
`access-control-expose-headers: www-authenticate`, and nowhere else — the CORS preflight `http.ts`
already answers for every `OPTIONS` request (before any routing) is unchanged by this phase, and is
why criterion (f)'s 405 never has to consider `OPTIONS` at all.

## Acceptance criteria

The documents:

- (a) `issuerFor(raw)` is the ONE function that normalizes a string (strips trailing slashes), and
  `protectedResourceDocument`, `authorizationServerDocument` and `challengeFor` all call it rather
  than re-deriving it — so every document and the challenge header advertise the identical issuer
  for one configured store. Verified by `test/server/oauth-discovery.test.ts` (asserts
  `authorizationServerDocument(u).issuer`, `protectedResourceDocument(u).authorization_servers[0]`,
  and the issuer embedded in `challengeFor(u)` are the same string for both `"http://x:1"` and
  `"http://x:1/"`) and by `grep -c "function issuerFor" src/server/oauth.ts` finding exactly one
  definition.
- (b) `GET /.well-known/oauth-protected-resource` answers HTTP 200,
  `content-type: application/json`, `access-control-allow-origin: *` (the same CORS constant every
  other door in `http.ts` already answers with — this phase adds no new CORS policy, only reuses
  the existing one), and the RFC 9728 body: `resource: issuerFor(publicUrl)` (the SAME string, not
  merely an equal-looking one — asserted with `toBe`), `authorization_servers: [issuer]`,
  `bearer_methods_supported: ["header"]`, and `scopes_supported: [CONNECTOR_SCOPE]`. Verified by
  `test/server/oauth-discovery.test.ts` against a live `serve()` instance with `publicUrl` set.
- (c) `GET /.well-known/oauth-authorization-server` answers HTTP 200,
  `content-type: application/json`, `access-control-allow-origin: *`, and the RFC 8414 body:
  `issuer`, `authorization_endpoint: \`${issuer}/oauth/authorize\``,
  `token_endpoint: \`${issuer}/oauth/token\``, `registration_endpoint: \`${issuer}/oauth/register\``
  — the EXACT paths criterion (n) proves are not yet routed, so an engineer building phase 13/14/15's
  doors has one literal to match rather than a free choice that could drift from what this document
  already promised, `response_types_supported: ["code"]`,
  `grant_types_supported: ["authorization_code"]`, `scopes_supported: [CONNECTOR_SCOPE]`. Verified by
  `test/server/oauth-discovery.test.ts`. (Two independent review rounds are folded into (b) and (c)
  as written, rather than left for a later phase to discover as broken assumptions: round one flagged
  that the "what a later phase inherits" section named `CONNECTOR_SCOPE` in `scopes_supported` while
  the first draft's criteria omitted it from both documents; round two flagged that neither criterion
  named a status code or content-type, which an RFC-literal client validates, nor pinned the three
  endpoint paths against the literal a later phase must actually route.)
- (b2) `--public-url` NAMES AN HTTP(S) ORIGIN, NEVER A PATH AND NEVER ANOTHER SCHEME. `serve()` boot
  runs the SAME normalization as (a) — `issuerFor(raw)`, stripping trailing slashes — and THEN
  validates the result is a bare `http:`/`https:` origin: the parsed `protocol` is checked against
  exactly those two strings FIRST (a `ws://`, `ftp://` or any other scheme refuses regardless of
  what the rest of the check would say — RFC 8414 §2's endpoints are HTTP(S) URIs, and a discovery
  document is only as trustworthy as the transport it names), and only then compared
  CASE-INSENSITIVELY — `new URL(normalized).origin.toLowerCase() ===
  normalized.toLowerCase()` — since RFC 3986 §3.1/§3.2.2 make a URL's scheme and host
  case-insensitive and an operator's shell history or a copy-pasted `https://MyHost:8080` should
  boot exactly as `https://myhost:8080` does, wrapped in a try/catch that refuses with a plain
  message rather than throwing when `normalized` does not parse as a URL at all
  (`redirectOriginDefect`-shaped, and written so phase 13 can import it rather than re-deriving the
  same rule for `--oauth-allow-redirect`). **Refuses a default-port spelling on purpose**
  (`https://x:443`, `http://x:80`): the WHATWG parser's own `.origin` drops a default port, and a
  dropped port survives lowercasing, so the comparison still catches one — an operator who typed
  the port gets a boot refusal naming the canonical spelling to use instead, the same "typo becomes
  a boot error" trade this whole check exists for, and identical to how `redirectOriginDefect`
  already treats the same shape. A value carrying a real path, query, or fragment BEYOND a single trailing
  slash refuses immediately, before any document can advertise a URL RFC 8414 §3's "insert
  `.well-known` before the path" rule would otherwise force onto this phase. Running (a)'s own
  normalizer first is what lets `--public-url http://x:1/` — a spelling an operator's shell
  completion or a copy-pasted browser address bar commonly produces — boot cleanly rather than fail
  on the one trailing character `issuerFor` exists to strip; a real path (`/store`) still refuses,
  since stripping ONE trailing slash from `"http://x:1/store"` leaves `"http://x:1/store"` unchanged
  and its origin still disagrees with the whole string. Refusing the
  ambiguous case outright — rather than silently accepting a path and building a `resource_metadata`
  URL nothing serves — is the same "typo becomes a boot error, not a silent hole" discipline the
  plan's phase 13 already applies to `--oauth-allow-redirect`. **The value `makeOAuthDoors` receives
  is the CANONICAL form** — `new URL(normalized).origin`, already lowercased by the parser — never
  the operator's raw casing, so `issuerFor` applied later (inside `protectedResourceDocument` etc.)
  is acting on the same string the validator already accepted, and a document never advertises a
  differently-cased issuer than the one that passed the boot check. Verified by
  `test/server/oauth-discovery.test.ts` (`serve()` rejects `publicUrl: "http://x:1/store"`,
  `"http://x:1?q=1"`, `"https://x:443"`, `"ws://x:1"`, and a string `new URL()` cannot parse at all;
  accepts `"http://x:1"`, `"http://x:1/"` (identical issuer), and `"http://MyHost:1"` (issuer
  lowercased)).
- (d) `code_challenge_methods_supported` is EXACTLY `["S256"]` — not `.toContain("S256")`, which
  would also pass a widened list that still permitted `plain`. `token_endpoint_auth_methods_supported`
  is EXACTLY `["none"]`, declaring a public client with no secret to leak. Verified by
  `test/server/oauth-discovery.test.ts` (`toEqual`, both fields).
- (e) A request to either well-known path with a foreign `Host` header and a foreign
  `X-Forwarded-Host`/`X-Forwarded-Proto` header answers byte-identical JSON to a request with
  neither — the documents are computed from `options.publicUrl` alone, never `req.headers`.
  Verified by `test/server/oauth-discovery.test.ts` (three requests, one baseline, two hostile
  headers, `toBe` on the response text) and by `grep -n "req.headers" src/server/oauth.ts` finding
  no match in the document-building functions (the discovery `handle` function never reads them).
- (f) Neither well-known path answers anything but GET or HEAD: `POST`/`DELETE` answer 405 carrying
  `allow: GET, HEAD` (RFC 9110 §15.5.6 requires a 405 to name what IS allowed, not only refuse what
  was tried); `HEAD` answers the SAME status and headers as `GET` (RFC 9110 §9.3.2: a resource
  serving `GET` answers `HEAD` identically, minus the body) with an empty body — a health-checking
  proxy in front of a real deployment routinely probes with `HEAD` before a client's first real
  `GET`. Verified by `test/server/oauth-discovery.test.ts`.
- (g) With no `--public-url`/`publicUrl` configured, both well-known paths resolve exactly as an
  ordinary unmounted path always did (the same uniform tokenless refusal `test/server/front-door.test.ts`
  already pins) — discovery adds a door only when configured, never a bare `serve()` call already
  covered by every OTHER test in this suite. Verified by `test/server/oauth-discovery.test.ts`
  (asserts the well-known response equals the unmounted-path baseline byte for byte, `serve()`
  called with no `publicUrl`).

The MCP door's 401:

- (h) A tokenless request to `/:mount/mcp` carries `www-authenticate: <challengeFor(publicUrl)>`
  when `publicUrl` is configured — on a mount that EXISTS, one that is registered but has no
  public surface, and one that NEVER EXISTED — all three carry the SAME header value, and the same
  JSON body §12/T78 already pins. Verified by `test/server/oauth-discovery.test.ts` (three
  requests, one per mount shape, asserting `res.headers.get("www-authenticate")` is identical and
  non-empty across all three — the positive control that distinguishes "the header is present and
  correct" from "the header is merely absent from all three alike").
- (h2) The same response also carries
  `access-control-expose-headers` naming `www-authenticate` (case-insensitively acceptable, but the
  test pins the literal the code emits) — without it a browser-hosted connector's `fetch()` cannot
  read the challenge it was just handed, even though `refused()` already answers every 401 with
  `access-control-allow-origin: *` today (the CORS constant this phase does not change): the allow
  header lets a browser READ the response at all; the expose header is the separate, additional
  permission needed to read a NON-safelisted response header such as `WWW-Authenticate` from
  JavaScript. Verified by `test/server/oauth-discovery.test.ts`.
- (i) A PRESENTED-BUT-WRONG bearer token on `/:mount/mcp` carries the same header as no token at
  all — the header attaches to "this identity did not resolve," not to "no `Authorization` header
  was sent." **Deliberately no `error="invalid_token"` parameter** (RFC 6750 §3.1 permits one, and
  a client library MAY use it to distinguish a missing credential from a bad one): `http.ts`'s
  existing anonymous-refusal path already answers a wrong token and no token with the byte-identical
  BODY on every other door, precisely so a caller cannot use the refusal's shape to learn whether a
  token it guessed was merely absent-shaped or actively wrong. A parameter that split the two cases
  on this ONE door would reopen, on a header, the oracle the body discipline closes everywhere else.
  Verified by `test/server/oauth-discovery.test.ts`.
- (j) A tokenless request to `/:mount/graphql` (same absent/existing mount pair) carries NO
  `www-authenticate` header — the header is the MCP door's alone, not a blanket addition to every
  401 `refused()` answers. Verified by `test/server/oauth-discovery.test.ts` — the criterion (h)
  fixture with the verb changed, asserting `res.headers.get("www-authenticate")` is `null`. This is
  the rail that would catch a fix that widened `refused()` itself instead of the two `verb === "mcp"`
  call sites the working spec names.
- (k) With no `publicUrl` configured, a tokenless `/:mount/mcp` request answers the SAME 401 body
  it always did, with NO `www-authenticate` header — the header is opt-in with the door, per (g).
  Verified by `test/server/oauth-discovery.test.ts`.
- (l) `makeOAuthDoors({ publicUrl }).challenge` is a pure function of `publicUrl`: calling it twice
  with the same string yields the same value, and the value embeds `issuerFor(publicUrl)` — not a
  freshly-randomized or request-derived string. Verified by `test/server/oauth-discovery.test.ts`
  (direct unit assertion on the exported function, no HTTP server involved — the "revert the fix
  and watch the rail fail" check: hand-deriving the expected string from `issuerFor` independently
  in the test, never comparing the function to itself).

Must not mint:

- (m) `src/server/oauth.ts` imports nothing from `node:crypto` and nothing from `./oauth-file.js`
  — this phase has no seed, no code, no token to protect, so it needs none of the machinery that
  handles them. Verified by `grep -n "node:crypto\|oauth-file" src/server/oauth.ts` finding no
  match.
- (n) `POST /oauth/register`, `GET|POST /oauth/authorize`, and `POST /oauth/token` are not routed
  by this phase's `makeOAuthDoors` — `owns()` returns `false` for all three, so they fall through
  to the server's ordinary "no such path" answer exactly as they did before this phase existed.
  Verified by `test/server/oauth-discovery.test.ts`.

## What a later phase inherits

Phases 13–15 extend `src/server/oauth.ts` in place (this is not a new-file-per-phase section; the
plan's §9d groups phases 11–15 under one `spec/37-connectors.md`, and the source file groups the
same way once a door needs more than discovery). `OAuthOptions`/`OAuthDoors` gain fields; the
`issuerFor`/`challengeFor` functions this phase ships are the ones later phases reuse rather than
re-deriving. `CONNECTOR_SCOPE = "loam.connector"` is defined here (both documents advertise it in
`scopes_supported`) because the discovery documents are the first place a scope name is said out
loud; phases 14–15 import the same constant rather than restating the string.
