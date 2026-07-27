# §37 — OAuth for connectors: consent mints a seed, never shares one

**Ticket: T114.** Depends on T113 (§36). Status: design approved in chat (Myk, 2026-07-26);
implementation delegated.

## The problem

Claude.ai custom connectors authenticate with OAuth 2.1. Loam's MCP door wants a bearer token.
There is no place in the connector dialog to paste one — and there should not be: the token in
that box would be the door token, and §36 exists so root secrets stay out of browsers.

## The shape

Loam becomes its own (tiny) OAuth provider. No external service. The whole flow is: claude.ai
discovers our endpoints, registers itself as a client, sends Myk's browser to our consent page,
Myk logs in as `myk` (§36 session), approves, and the token endpoint mints a bearer token that
maps to a NEW actor seed for that connector. The connector then holds ITS OWN identity —
`connector:claude-ai` — with granted-author rights. Every delta it writes says so.

Structural rule, not policy: the mint path writes `{ actor }` identities only. There is no
code path from an OAuth grant to `{ operator: true }`.

## The endpoints

- The MCP door's 401 gains `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"` (RFC 9728).
- `GET /.well-known/oauth-protected-resource` — names this resource and its authorization
  server (same host).
- `GET /.well-known/oauth-authorization-server` (RFC 8414) — names the three endpoints below;
  declares `code` response type, `authorization_code` grant, PKCE `S256` required, no client
  secret (public clients).
- `POST /oauth/register` (RFC 7591) — dynamic client registration: accepts `redirect_uris` and
  a client name, answers a `client_id`. Registrations persist in the home.

  **Registration is open by protocol and therefore fenced by configuration.** Claude.ai
  registers before any human is involved, so this endpoint cannot require a session. The fence
  is a configured allowlist of redirect origins (`--oauth-allow-redirect <origin>`, repeatable):
  a `redirect_uri` outside it is refused at registration AND at authorize. Without the fence, a
  stranger registers a client named "Claude" pointing at their own host, sends Myk a plausible
  authorize link, and walks away with a writing identity — the premortem's second finding. Note
  what that attack does NOT need: escalation to operator. An attacker-held actor is already a
  full compromise, so "the mint path cannot produce operator" is necessary and nowhere near
  sufficient.
- `GET /oauth/authorize` — requires a §36 session; without one it shows the login form first.
  With one it shows the consent page: client name, redirect target, the one scope in plain
  words ("read the doors, write claims — as its own named author"). Approval mints a
  single-use code bound to the PKCE challenge, 5-minute expiry.
- `POST /oauth/token` — exchanges code + PKCE verifier for an access token. Verifier mismatch,
  expired code, or reused code all refuse with the RFC error shape and mint nothing.

## Custody

- At FIRST grant for a client, the server mints a fresh actor seed, stores it in the home
  beside the operator's, and enters the access token into the token table mapped to that
  actor. Later grants for the same client reuse the same actor (one connector, one author).
- Issued tokens and registrations persist in `oauth.json` in the home, mode 0600. Local
  secrets: never in the ground (same law as §36 credentials).
- `loam grant list` and `loam grant revoke <client>` — revocation removes the token; the seed
  and its past deltas remain (history does not lose its author).

## Acceptance criteria

- (a) An unauthenticated `POST <mount>/mcp` answers 401 with a `WWW-Authenticate` header
  naming the protected-resource metadata URL — `test/server/oauth-discovery.test.ts`
- (b) That refusal is byte-identical, headers included, to the refusal for a mount that does not
  exist — the new header is not a mount-existence oracle —
  `test/server/oauth-discovery.test.ts`
- (c) Both well-known documents parse and agree: the resource document names the AS; the AS
  document names authorize/token/register endpoints and requires PKCE S256 —
  `test/server/oauth-discovery.test.ts`
- (d) Every URL in both documents is built from the configured `--public-url`, not from the
  request: a request carrying a foreign `Host` and `X-Forwarded-Host` yields byte-identical
  documents — `test/server/oauth-discovery.test.ts`
- (e) The issuer the AS document advertises is the same value the token endpoint validates
  against (one source, not two) — `test/server/oauth-discovery.test.ts`
- (f) `POST /oauth/register` answers a client_id; the registration survives a server restart —
  `test/server/oauth-register.test.ts`
- (g) A `redirect_uri` outside the configured allowlist is refused at registration —
  `test/server/oauth-register.test.ts`
- (h) `GET /oauth/authorize` refuses a `redirect_uri` that is not an EXACT match of one
  registered for that client — a different path, an added query, or another port is refused —
  `test/server/oauth-authorize.test.ts`
- (i) No OAuth response ever carries a `Location` outside the allowlist (no open redirect),
  including on the refusal paths — `test/server/oauth-authorize.test.ts`
- (j) The consent page escapes `client_name` and the redirect target byte for byte, displays the
  REGISTERED uri rather than the caller's text, and carries a `Content-Security-Policy` that
  permits no script — `test/server/oauth-authorize.test.ts`
- (k) A cross-site-shaped approval POST — no same-origin signal, or a missing form token — is
  refused and mints nothing — `test/server/oauth-authorize.test.ts`
- (l) The full flow mints a working token: register → authorize (with a §36 session) → code →
  token; the token then opens the MCP door (`tools/list` answers) —
  `test/server/oauth-flow.test.ts`
- (m) `GET /oauth/authorize` WITHOUT a session answers the login form and mints nothing —
  `test/server/oauth-flow.test.ts`
- (n) A wrong PKCE verifier is refused; the code is then dead — the RIGHT verifier afterwards
  is also refused (single use burns on any attempt) — `test/server/oauth-flow.test.ts`
- (o) A code minted for one client is refused when redeemed with another client's id, and
  refused when redeemed against a different `redirect_uri` than it was bound to —
  `test/server/oauth-flow.test.ts`
- (p) A code past its 5-minute expiry is refused, and a wall-clock step BACKWARDS does not
  extend its life (expiry is monotonic) — `test/server/oauth-flow.test.ts`
- (q) A delta written through an OAuth-minted token is authored by the connector's own actor —
  asserted at the delta level (author id in the ground) and the object level (a reading shows
  the value) — never by the operator — `test/server/oauth-flow.test.ts`
- (r) No input to any OAuth endpoint can mint an operator identity: the token table entry
  created by the flow is `{ actor }`; a test enumerates the mint path's outputs —
  `test/server/oauth-flow.test.ts`
- (s) Two concurrent first-grants for the same client end with exactly ONE minted seed, and both
  tokens resolve to it — `test/server/oauth-concurrency.test.ts`
- (t) `oauth.json` is written atomically (temp, rename, fsync) and ends at mode 0600 even when
  the path already existed at 0644, asserted after a SECOND write —
  `test/server/oauth-concurrency.test.ts`
- (u) A truncated or malformed `oauth.json` refuses the flow with a named error and does not
  crash the server or the boot path — `test/server/oauth-concurrency.test.ts`
- (v) `loam grant revoke <client>` closes the door on the very next request of the SAME live
  process (no restart), and the connector's PAST deltas still name their author (two-sided:
  access gone, history intact) — `test/server/oauth-revoke.test.ts`
- (w) Neither the minted seed, the token, nor the PKCE material appears in any delta
  (delta-level scan after a full flow) — `test/server/oauth-flow.test.ts`
- (x) `npm run check` green with all of the above — `npm run check`

## Deferred, named

- Refresh tokens — v1 mints long-lived access tokens; revocation is the lever. Revisit if a
  second connector family needs short-lived tokens.
- Per-lens scopes — one scope in v1; the consent page's plain-words line is written so a
  scope list can replace it.
- An erasure that reaches `oauth.json` — same reasoning as §36: it widens what gets purged, so
  it is Myk's merge and its own ticket.
