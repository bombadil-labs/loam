# §37 phase 13/15 — connector registration (T134)

**Revision 2.** An independent premortem read (`37-13-connector-registration.premortem.md`) named
four mechanistic failure causes; this revision folds all four — the opt-in `owns()` gate (so phase
12's frozen rail (n) stays green), boot-validation of the allowlist (a `:443` entry that silently
never matches), the eviction wall-clock tie (a real delay in the ordering rail), and a
`connectors`-without-`publicUrl` boot refusal. Causes 2 and 4 became criterion (8).

## The problem

Phase 12 made the store discoverable: a connector (claude.ai, or any MCP client) can read the two
well-known documents and learn that a `registration_endpoint` sits at `<issuer>/oauth/register`.
Nothing answers there yet. This phase opens that one door — `POST /oauth/register`, RFC 7591
dynamic client registration — behind a CONFIGURED redirect-origin fence, with a client cap that
EVICTS rather than refuses so a stranger cannot lock the real connector out.

This phase MINTS NOTHING. No authorization code, no access token, no actor seed. It records a
public client (an id, a display name, a set of allowed redirect URIs) in `oauth.json` and answers
201. Consent (the code) arrives in phase 14; the token and the actor seed arrive in phase 15.

Salvaged from `salvage-282:src/server/oauth.ts` (tag pinned 2026-07-28): `redirectOriginDefect`,
`redirectUriDefect`, `readBody`, `formFields` and the `postRegister` handler transfer with a
vocabulary pass. The salvage's authorize and token doors, its `redeeming` counter, its `serialized`
in-process write chain, and its `codes` map are NOT part of this phase — they exist only to
coordinate the async token mint this phase does not have, and the eviction pin they feed reads
sources (a live code, a redemption in flight) that no door here produces.

## What this phase does not do

No code. No token. No seed. `postRegister` calls no signing-key material and no ground append. The
one write it performs is a client record through phase 11's `withOAuthFile` — the same cross-process
lock and atomic writer `oauth-file.ts` already ships. It reads `file.grants` only to PIN, never to
produce one.

## Registration takes no session — the fence is the whole defence

claude.ai registers itself before any human is present: there is no browser, no cookie, nobody to
type a password. So the endpoint is open by protocol, and the only thing between it and the disk is
a CONFIGURED allowlist of redirect origins (`--oauth-allow-redirect <origin>`, new flag, threaded
through `ServeOptions.connectors` in `src/server/http.ts`). Without that fence a stranger registers
a client named "Claude" pointing at a host they run, sends the operator a plausible authorize link,
and walks away holding a writing identity in this store — an attack that never needs to become the
operator, which is why "the mint path cannot produce operator" (phase 15's property) is necessary
and nowhere near sufficient.

The allowlist is OPT-IN and closed by default: an EMPTY allowlist refuses every registration and
names the flag that opens §37. There is no "allow anything" spelling, deliberately. When
`connectors` is absent from `ServeOptions`, `serve()` builds no registration door at all —
`/oauth/register` resolves exactly as it did after phase 12 (an unrouted OAuth path, the ordinary
uniform 401), which is what keeps phase 12's rail (`oauth-discovery.test.ts` criterion (n)) green.

## The cap evicts; an approved client is pinned

`POST /oauth/register` is unauthenticated, so a plain cap would be a lockout: a stranger files
`maxClients` junk registrations and the real connector is refused forever, with no command that
removes one. So at the cap the door EVICTS the oldest EVICTABLE registration (by `registeredAt`
wall clock) and admits the newcomer. The pressure falls on registrations nobody is using.

One kind of client is NOT evictable: one the operator APPROVED, which in this phase means one that
holds a grant record in `oauth.json`. The pin reads exactly ONE source here — `file.grants` — and
neither door that produces a grant exists yet (codes in phase 14, grants in phase 15). So the rail
that a pinned client survives a flood writes the grant record DIRECTLY, with phase 11's
`writeOAuthFile`, rather than through a door. When every slot is pinned, the door refuses `full`
rather than evicting an approved connector.

**Phases 14 and 15 each ADD a pin source (a live code; a redemption in flight), and adding a source
only makes eviction more conservative.** So this phase's eviction rails stay green unchanged when a
later phase widens the pin — that monotonicity is what lets the grant flow be three separate phases.

## Control bytes are refused in every operator-facing field

A registered `client_name` and every registered `redirect_uri` will one day reach the operator's
terminal through `loam grant list`. This door takes no credential, so a newline in either field
forges a whole extra row in the operator's only view of what is registered, and an ANSI escape
erases the caller's own line. `new URL()` STRIPS tab, LF and CR while parsing, so a hostile uri
parses clean, passes the origin and percent-transparency checks, and keeps its raw bytes in the
stored string. The rule the `client_name` gets (phase 11's `clientNameDefect`) must therefore cover
its sibling the `redirect_uri` (phase 11's `uriTextDefect`), checked BEFORE `new URL()`. This is
the defect that escaped once already — a rule written for one field that did not cover the other.

## The door leaks nothing on a file fault

The registration door is unauthenticated and answers with `access-control-allow-origin: *`, so
anything derived from a local error would put the home's absolute path on the open internet. On any
fault reading or locking `oauth.json` — an unparseable file, a filesystem with no hard links, a
lock another process holds — the caller receives a FIXED string (`503 temporarily_unavailable`,
one of two constant descriptions) and the detail (the path, the errno, the flag) goes only to the
operator's `onFault` channel.

## Acceptance criteria

Every criterion is proved in `test/server/oauth-register.test.ts` against a live `serve()` instance
with `connectors` configured, unless it names another command.

- (1) Registration is fenced by a CONFIGURED allowlist of redirect origins, and requires no session.
  A `POST /oauth/register` with an allowlisted `redirect_uri` and no cookie answers 201 with a
  `client_id`, `client_name`, `redirect_uris`, and `token_endpoint_auth_method: "none"` (a public
  client — no `client_secret`). An EMPTY allowlist refuses every registration with 400 and an
  `error_description` naming `--oauth-allow-redirect`, and writes nothing
  (`readOAuthFile(home).clients` stays `[]`). Verified by
  `test/server/oauth-register.test.ts` ("answers a client_id with no session" and "an EMPTY
  allowlist refuses every registration, and says why").

- (2) A `redirect_uri` outside the configured allowlist is refused AT REGISTRATION, both at the door
  and in the file. A registration whose uri sits at a non-allowlisted origin answers 400
  `invalid_redirect_uri` and `readOAuthFile(home).clients` is `[]`. A subdomain, a suffix match, a
  differing scheme and a differing port are each a DIFFERENT origin and each refused (the positive
  control: an allowlisted origin admits any PATH at that origin with 201). Verified by
  `test/server/oauth-register.test.ts` ("a redirect_uri outside the configured allowlist is
  refused" and "an allowlisted ORIGIN admits any path at that origin, and no other origin").

- (3) Control bytes are refused in EVERY operator-facing field. A `client_name` carrying `\n`,
  `\r`, an ANSI escape (`\u001b`), a NUL (`\u0000`), a C1 byte (`\u009b`) or a line separator
  (`\u2028`) is refused 400 and nothing is written; a `redirect_uri` carrying any of the same —
  which `new URL()` would strip and hide — is refused 400 and nothing is written. The positive
  control: a `client_name` with punctuation and non-ASCII letters (`"Claude — Myk's connector ✨"`) is admitted
  201, so the rule is control bytes and not non-ASCII. Verified by
  `test/server/oauth-register.test.ts` ("a client_name carrying a control byte is refused" and "a
  redirect_uri carrying a control byte is refused, at the door and in the file") and by
  `grep -n "uriTextDefect" src/server/oauth.ts` finding the redirect-uri check calls phase 11's
  shared rule.

- (4) THE CAP EVICTS, IT DOES NOT REFUSE. With `maxClients` set small, more than `maxClients`
  registrations each answer 201, and `readOAuthFile(home).clients.length === maxClients`. The OLDEST
  never-approved registration is evicted and the newest is present: after registering "oldest",
  "middle", "newest" at `maxClients: 2` (with a real delay between them so `registeredAt` differs),
  the held ids CONTAIN "newest" and do NOT contain "oldest". Verified by
  `test/server/oauth-register.test.ts` ("registration is bounded: a flood cannot grow oauth.json
  without limit" and "at the cap the OLDEST never-approved registration is evicted, not the newest
  refused").

- (5) AN APPROVED CLIENT IS NEVER EVICTED, and an UNPINNED stranger still is (both sides). The pin
  reads ONE source this phase: a grant record in `oauth.json`, written DIRECTLY by the fixture with
  phase 11's `writeOAuthFile` (a valid grant: a fresh 32-byte `actorSeed`, `actor` =
  `authorForSeed(actorSeed)`, `standing: true`). A client with a grant record survives a flood of
  registrations at `maxClients: 2` (its id stays in `readOAuthFile(home).clients`), while a
  registered stranger with no grant IS evicted by the same flood (its id leaves the file). When
  every slot is pinned by a grant, a further registration refuses 400 `full` and evicts nothing.
  Verified by `test/server/oauth-register.test.ts` ("a client with a GRANT RECORD survives a
  registration flood", "a client with NO grant is still evictable — the pin is not a blanket", and
  "when every slot is pinned by a grant, a full house refuses").

- (6) A registration survives a restart. After a registration, closing the server and re-serving
  over the SAME home reads the existing record: a SECOND registration against the new server leaves
  BOTH clients in `readOAuthFile(home)` (the restart neither lost the first nor clobbered it).
  Verified by `test/server/oauth-register.test.ts` ("a registration survives a restart — a new
  server over the same home keeps it").

- (7) The registration door answers a FIXED string on any file fault, and the detail goes to
  `onFault` alone. With `oauth.json` made unparseable, a registration answers 503
  `temporarily_unavailable` with a constant `error_description`, the response body contains NEITHER
  the home path NOR a flag name, and the `onFault` callback receives a message that DOES name
  `oauthPath(home)` (the positive control: the detail exists and reached the operator's channel, it
  simply did not reach the caller). Verified by `test/server/oauth-register.test.ts` ("a file fault
  answers a fixed string to the caller and the detail to onFault").

- (8) The allowlist is boot-validated, and registration needs `--public-url`. `serve()` runs
  phase 12's `redirectOriginDefect` over every configured allowlist origin and THROWS on a defect —
  a default-port spelling (`https://claude.ai:443`, which `url.origin` would silently drop and never
  match), a path, or a non-https non-loopback origin — so an operator's typo is a startup error
  rather than a store where every registration is refused. `serve()` also throws when `connectors`
  is configured without `publicUrl`, so `--oauth-allow-redirect` is never silently ignored. Verified
  by `test/server/oauth-register.test.ts` ("serve refuses a malformed allowlist origin at boot" and
  "serve refuses connectors without a public url").

## What a later phase inherits

The `registration_endpoint` path phase 12's document already advertises (`/oauth/register`) is the
literal this phase routes — no drift. Phase 14 adds `GET/POST /oauth/authorize` into the same
`makeOAuthDoors`, widening the eviction pin with a live-code source; phase 15 adds
`POST /oauth/token`, the actor seed, and a redemption-in-flight pin source. Both only make eviction
more conservative, so neither rewrites this phase's `oauth-register.test.ts`.
