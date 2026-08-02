## 37. Connectors — OAuth-based access for MCP clients

A connector is an outside party — claude.ai, or any MCP client — that reaches a Loam store over
OAuth rather than as the operator at a keyboard. §37 is built in fifteen small phases, each one
PR, each merging alone (`.adlc/specs/users-oauth-phasing-plan.md`). This section grows with every
phase that lands; what follows is only what has landed so far.

### 37.1 Connector records at rest

Before any door exists, a connector needs a durable record: which clients are registered, which
client owns which signing seed, and which token digests are live. `oauth.json` holds that record,
in the home, mode 0600, beside the operator's own seed — never in the ground, for the same reason
a password hash is not: the ground replicates under federation, and a peer receiving it would
receive a connector's signing key.

The record is read whole, validated whole, and written whole. A file this reader cannot fully
parse — truncated, wrong version, a grant whose actor disagrees with its own seed, a duplicate
`clientId` — throws rather than silently reading as empty, because "cannot determine what is
registered" is never "nothing is." Treating a damaged file as empty would let a later door mint a
SECOND seed for a connector that already has one, stranding the first grant in the ground with
nobody holding its key. The same validation runs on the way out: `writeOAuthFile` refuses to
persist an object a future caller's bug built that would fail its own read-time checks, since
persisting it would make every later read throw forever.

The write is temp-then-rename, the temp created at 0600 from birth (never written world-readable
and fixed up after), fsynced before the rename and the containing directory fsynced after.

`loam grant revoke` (a later phase's CLI) and the server both touch this file, from different
processes — a read-modify-write pair with no coordination would let whichever writes second spread
a snapshot taken before the other's change, silently discarding it. `withOAuthFile` is the
cross-process lock that closes that: a hard link from a temp file that already holds the acquirer's
128-bit nonce, because `link` fails atomically when the target exists and create-then-write cannot
promise that. Only `EEXIST` means contention; every other errno (FAT, exFAT, some SMB/FUSE mounts
that offer no hard links) is named as `OAuthFileUnlockable`, distinct from an ordinary busy lock, so
an operator is not sent to read a perfectly good file.

Breaking a stale lock cannot be made fully race-free without a filesystem primitive Loam does not
have — the guarantee is stated about the WRITE, not about a caller's callback: the ownership check
runs after the write's own disk work (the temp file's write and fsync) and immediately before the
rename, the narrowest placement possible, so a lock lost to a stale-break costs the loser a refusal
rather than a silent lost update.

**Provenance.** Working spec `.adlc/specs/37-11-connector-records-at-rest.md` (T132, phase 11 of
the plan's fifteen). Landed [#288](https://github.com/bombadil-labs/loam/pull/288) —
`src/server/oauth-file.ts`, `test/server/oauth-file.test.ts`,
`test/server/oauth-lock-child.mts`. No door, no CLI: the file and its lock are a unit that nothing
serves yet.

### 37.2 Discovery and the 401

The first door: a connector needs to find this store before any human is present. Two RFC
well-known documents answer that — `GET /.well-known/oauth-protected-resource` (RFC 9728) and
`GET /.well-known/oauth-authorization-server` (RFC 8414) — and the MCP door's existing 401 gains a
`WWW-Authenticate` header pointing at the first of them. Nothing here mints a client, a code, or a
token; those are later phases of the same plan.

Every URL either document advertises comes from ONE configured value, `--public-url`, opt-in like
the redirect fence a later phase adds: absent, neither well-known path exists and the MCP door's
401 carries no header, exactly as before this phase. `Host` and `X-Forwarded-*` never reach the
document-building functions at all — there is nothing in them for a forwarded header to act on,
which is a stronger guarantee than "tested to agree": the code cannot disagree with itself. A
single function, `issuerFor`, normalizes the configured string, and every document, and the
challenge header, call it rather than re-deriving the issuer a second way.

`--public-url` admits only a bare `http(s)` origin — no path, no query, no fragment beyond a single
trailing slash, compared case-insensitively so an operator's own capitalization never matters, and
refusing a default-port spelling (`https://x:443`) on purpose, since the WHATWG parser's own
`.origin` would silently drop it. A malformed value refuses at boot rather than guessing.

The `WWW-Authenticate` header is scoped to exactly the request shape that can answer 401 on `mcp` —
never a different verb, and never varying by whether the mount named in the URL exists, has a
public surface, or never existed at all. A byte-identical challenge across all three is what keeps
the header from becoming a second oracle beside the one the mount-refusal discipline (§12) already
closed: the header answers who to ask, not what is here.

**Provenance.** Working spec `.adlc/specs/37-12-discovery-and-the-401.md` (T133, phase 12 of the
plan's fifteen). Landed [#291](https://github.com/bombadil-labs/loam/pull/291) —
`src/server/oauth.ts` (new), plus the `--public-url` flag
threaded through `src/server/http.ts` and `src/cli/cli.ts`. No client registers, no code or token
is minted; a connector can find the store and nothing more.

### 37.3 Connector registration

The next door: `POST /oauth/register` (RFC 7591 dynamic registration). A connector registers itself
before any human is present — claude.ai has no browser, no cookie, and nobody at a keyboard when it
does this — so the door CANNOT require a session, and the only thing between it and the disk is a
CONFIGURED allowlist of redirect origins (`--oauth-allow-redirect <origins>`, opt-in like
`--public-url` and closed by default). Without that fence a stranger registers a client named
"Claude" pointing at a host they run, sends the operator a plausible authorize link, and walks away
holding a writing identity in the store — an attack that never needs to become the operator, which
is why "the mint path cannot produce operator" (a later phase's property) is necessary and nowhere
near sufficient. An empty allowlist refuses every registration and names the flag that opens §37;
there is no "allow anything" spelling. Every configured origin is validated at boot — a default-port
spelling `url.origin` would silently drop, a path, or a non-https non-loopback origin is a startup
error rather than a store that refuses every registration — and registration needs `--public-url`,
since a connector reaches this endpoint only through the discovery document that flag builds.

A `redirect_uri` is refused AT REGISTRATION, not only at authorize: it must be an absolute URL at an
allowlisted origin, with no fragment, percent-transparent (so a later phase's exact-match compare
cannot be reached under a second spelling), and carrying no control byte. That last check runs
BEFORE `new URL()`, which strips tab, LF and CR while parsing — a uri carrying them would parse
clean, pass every origin check, and keep its raw bytes in the stored record, where a future
`loam grant list` prints them and forges a row. It is the same rule the client name already gets
(phase 11's `clientNameDefect`/`uriTextDefect`), applied to its sibling field — the defect that
escaped once was a rule written for one field that did not cover the other. Every entry of
`redirect_uris` is checked, not the first that passes, because one honest uri carrying a hostile
sibling means the client holds both.

The door mints NOTHING — no code, no token, no actor seed; it records a public client and answers
201. It is unauthenticated, so a plain cap would be a lockout: a stranger files the maximum junk
registrations and the real connector is refused forever, with no command that removes one. So at the
cap the door EVICTS the oldest EVICTABLE registration (by `registeredAt`) and admits the newcomer —
the pressure falls on registrations nobody is using. A client the operator APPROVED is never
evicted; in this phase "approved" means it holds a grant record in `oauth.json`, and the door that
produces one is a later phase, so the eviction pin reads exactly one source here. Later phases each
ADD a pin source (a live code; a redemption in flight), and adding a source only makes eviction more
conservative, which is what lets the grant flow be three separate phases without any of them
rewriting another's rails. On any fault reading or locking `oauth.json` the caller receives a fixed
`503` string; the detail (the home path, the errno, the flag) goes only to the operator's `onFault`
channel, because the door answers an unauthenticated caller with a wildcard CORS origin and anything
derived from a local error would put the home's absolute path on the open internet.

**Provenance.** Working spec `.adlc/specs/37-13-connector-registration.md` (T134, phase 13 of the
plan's fifteen). Landed [#317](https://github.com/bombadil-labs/loam/pull/317) — the registration door
and the redirect fence in `src/server/oauth.ts`, threaded through `ServeOptions.connectors` in
`src/server/http.ts` and the `--oauth-allow-redirect` flag in `src/cli/cli.ts`. No code, token, or
seed is minted; a connector can find the store and register, and nothing more.

### 37.4 The consent page

`GET /oauth/authorize` renders a consent page behind a phase-5 session; without one it renders the
login form and mints nothing. The page is a READ — it uses `peek`, never sliding the session, so a
SameSite=Lax cross-site navigation carrying a victim's cookie cannot extend their session. It
displays the connector's `client_name` and the redirect URI, both HTML-escaped, under a
script-forbidding CSP, and it states plainly what the grant carries: a connected author is a lawful
author, so it can retract claims the operator wrote.

The approval `POST` carries phase 6's defence — a same-origin check and a session-bound form token,
compared in constant time — so a cross-site-shaped approval mints nothing. On success it mints ONE
authorization code and redirects to the registered URI with `code` and `state`. The `redirect_uri`
must match a registered one BYTE for byte: a different path, an added query, or another port is
refused, and no refusal path — bad parameters, a forged token, no session, a lock fault — ever
carries a `Location` outside the registered origins.

The code is a high-entropy secret handed to the client and stored only by its digest, bound to both
the `client_id` and the exact `redirect_uri`, with a monotonic deadline recorded at mint (a wall-clock
step backwards cannot extend it). The consent door mints NOTHING else: no actor seed and no access
token — those are the token exchange (§37.5). The `codes` collection is an optional field on the
connector record, absent-when-empty, so a store written before this phase round-trips byte-identical
and no migration is owed.

**Provenance.** Working spec `.adlc/specs/37-14-the-consent-page.md` (T135, phase 14 of the plan's
fifteen). Landed [#322](https://github.com/bombadil-labs/loam/pull/322) — the consent door
(`makeConsentDoor` in `src/server/oauth.ts`), the `OAuthCode` record in `src/server/oauth-file.ts`,
the `SessionGate` seam in `src/server/session.ts`, and the wiring in `src/server/http.ts`.

### 37.5 The token exchange and revocation

`POST /oauth/token` redeems a single-use authorization code for a per-connector actor seed and a
bearer token. The exchange is PKCE-S256: the code carries the `code_challenge` captured at consent,
and redemption must present a `code_verifier` that hashes to it, compared on the digest. The code
BURNS on any redemption attempt — a wrong verifier kills it, and the right verifier afterwards is
refused too — and it is bound to the client and the exact redirect URI it was minted for.

The mint derives a FRESH random 32-byte seed and its author; the connector writes as that actor,
never as the operator. There is no code path from any input here to an operator identity: the seed
lives only in `oauth.json` (mode 0600, never in the ground), the store holds only the token's digest,
and the resolver a presented bearer resolves through returns `{ actor }` and nothing else. The seed is
written before the ground append, so a retried redemption reuses it rather than minting a second.

An unknown bearer token costs nothing on the event loop: the door keeps an in-memory set of known
digests, so a flood of bogus tokens is one miss each, with no file read and no key derivation behind
it. Only a known digest pays a read, and that read re-checks the client's generation.

Revocation is a GENERATION bump on the client, and it strikes the connector's ground write-grant. A
token and a code each remember the generation they were minted under, so a bump makes both stop
matching at once — revocation binds on the very next request of the same live process, with no
restart, and a later re-grant does not resurrect an old token (a fresh grant never lowers the
generation). It is two-sided: access is gone, and every delta the connector already wrote keeps its
author. `loam grant list` shows the operator what is connected; `loam grant revoke` is the kill
switch.

The eviction pin the registration door reads (§37.3) now unions three sources — a grant in the file,
a live code, and a redemption IN FLIGHT — because redemption deletes the code before it writes the
grant, and in that window a flood must not evict the approved connector. The in-flight source is a
shared count, incremented before the awaited mint and released in a `finally`, so a throw cannot leak
it and two concurrent redemptions for one client are safe. No seed, token, or PKCE material ever
enters a delta.

**Provenance.** Working spec `.adlc/specs/37-15-the-token-exchange-and-revocation.md` (T136, phase 15
of the plan's fifteen — the last, completing §37). Landed
[#PENDING15](https://github.com/bombadil-labs/loam/pull/PENDING15) — the token door (`makeTokenDoor`
in `src/server/oauth.ts`), the seed/token/generation fields on `OAuthGrant`/`OAuthToken`/`OAuthCode`
in `src/server/oauth-file.ts`, the bearer-resolving `identify` wiring in `src/server/http.ts`, and
`loam grant list` / `revoke` in `src/cli/cli.ts`.
