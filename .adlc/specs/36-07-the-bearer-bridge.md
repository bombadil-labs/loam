# §36 phase 7/15 — the bearer bridge (T128)

## The problem

A session opens the store's own pages and nothing else. A browser that wants to READ or WRITE
through the JSON doors has no way in — and must not get one through the cookie, because a cookie
is ambient: the browser attaches it to any request any page makes, so a cookie-opened data door
is cross-site forgeable by construction. `http.ts` states the invariant it relies on — authority
on those doors is a bearer header the caller presents explicitly.

This phase is the bridge: `POST /session/token` trades a live session for a short-lived bearer
token, which the browser then presents in a header like any other client. The cookie never
crosses; the token does.

Salvaged from `salvage-282:src/server/session.ts`: `postToken`, the per-session minted-digest
bookkeeping, and the `mint`/`revoke` deps transfer with a vocabulary pass.

A premortem ran against revision 1 and returned eight causes. Seven are folded into the decisions
and criteria below; the eighth (a dead second implementation) is named as a known gap with its
own ticket, because closing it means retiring a frozen rail and that is not this phase's to do.

## What this phase does not do

- **It does not decide WHOSE key signs a session's write.** Phase 8 does. Today every write
  lands signed by the home's genesis seed, as every write does; this phase rails what is true
  now (the write lands and resolves) and adds no authorship claim that phase 8 would have to
  unpick.
- **It does not widen who may write.** The token names the operator identity the role binding
  already earns; no new authority is created, and a user without the operator role gets no
  token.
- **It does not add a door beyond `/session/token`.** The consent page (phase 14) rides §36's
  session through its own window, not through this one.

## Decisions

**The token is minted against the SERVER's token table, and the digests are the session's.**
`serve()` grows two closures the doors receive: `mint(identity, ttlMs)` adds a runtime entry to
the same table `identify()` reads, and `revoke(digests)` removes them. The doors hold DIGESTS
only, never the plaintext — a session idles far longer than a token lives, and holding the
secret to hand back at revocation time would keep live operator tokens in the heap for the
session's whole window.

**One session may not mint without bound, and the cap counts LIVE tokens.** `maxTokensPerSession`
(default 16). Counting every token ever minted would make the cap permanent — a session that
reached it could never mint again however long it waited, while its own idle window kept it
alive. A lapsed token frees its slot, and the refusal says so.

**The role is re-read from the ground at mint time, never trusted from the session.** A role
revoked, or a user erased, after sign-in must stop minting on the next ask rather than the next
restart. The three answers separate: ground unreachable → 503 (cannot decide is not "gone", and
the session survives); ground answers and holds no role for this user → the session is dropped
and 401; holds roles but not `operator` → 403, session intact (a real user, genuinely not
entitled).

**What the token IS, exactly:** the operator's authority on this server, for `tokenTtlMs`
(default 5 minutes). Signing out retires it early (`drop` revokes every digest the session
minted); nothing else does. So revoking a user's role closes the door to NEW tokens at once, and
an already-minted one lives out its window. That is stated rather than implied, because the
alternative reading — that revocation is instant — is the H7 shape.

**`/session/token` is born behind phase 6's `guarded`.** It adds exactly one precondition beyond
the two that door already enforces: a live SESSION must exist (a stateless pre-session is enough
to attempt a login; it is not enough to mint). That refusal is 401, distinct from the provenance
403.

**The one-mount guard is BOTH a boot refusal and a LIVE check at mint time.** A session token is
`{ operator: true }` — authority over this whole server, every mount it hosts — while the role
binding that earns it is read from ONE mount's ground. Boot-time alone is not enough, and the
premortem found why: a CONTAINER mount is derived rather than registered (`mounts.ts` tier 3), so
a container attached after boot answers at its own name with its write doors open, and neither
`serve()`'s options nor `addMount` ever sees it. So there are three refusals, and the third is the
one that actually closes the hole:

1. `serve()` refuses at boot when the login doors are open and `options.mounts` is anything other
   than exactly the doors' own mount — before the socket binds, because a refusal that leaves a
   listening socket with no doors is strictly worse than not starting.
2. `addMount` refuses while the doors are open.
3. **`POST /session/token` refuses to MINT while the live mount table resolves any name other
   than the doors' own** — containers included, asked at the moment of minting rather than
   remembered from boot. 503, naming the extra world. A token already minted lives out its
   window; this closes the door to new ones the instant a second world appears.

**The mint door's authority boundary is the ORIGIN, and that is stated rather than assumed.**
Anything this store serves script from on this origin is inside the boundary: a script on a
rendered route can `fetch('/login')`, read the form token out of the page, and mint. That is
inherent to any cookie-anchored session — the cookie is what the browser attaches, and
same-origin script is the browser — but it is newly CONSEQUENTIAL here, because before this phase
the strongest thing such a script could obtain was a page. It is written into the spec section so
an operator serving a renderer route beside the login doors knows what they are choosing.

**One clock, passed once.** The cap counts LIVE tokens in the doors, and the server's token table
decides which tokens open doors. Two clocks behind that pair would let the doors free a slot for
a token the server still honors — the cap silently stops bounding live operator authority while
its refusal message keeps promising it does. `serve()` therefore passes the SAME `now` closure
into both.

**A session row and its digests are erased TOGETHER, through one function.** `drop` revokes; no
caller does it separately. That matters because `drop` has four callers, not one: logout, the
idle sweep, `getLogin` when the ground no longer holds a role, and `open(..., replacing)` when a
user re-authenticates over a live session. Attaching revocation to the logout DOOR instead would
leave an operator token alive across idle expiry, across a struck role, and across the very
re-login that exists to kill a fixated session.

## Acceptance criteria

All in `test/server/session-token.test.ts` against live `serve()` instances.

- (a) **The cookie alone opens no JSON door — with the cookie proven live.** A signed-in
  session's cookie attached to `graphql`, `append` and `mcp` yields byte-identical status and
  body to the same requests with no credential at all, AND that same cookie value, in the same
  request shape, opens `GET /login` immediately before and after the comparison. Without that
  second control the criterion is a tautology (nothing in `http.ts` reads a cookie on a data
  door, so a dead cookie passes it). The compared body is additionally asserted to be the known
  uniform refusal, not merely equal to itself. Verified by `test/server/session-token.test.ts`.
- (b) **The token opens a read door and a write door.** `POST /session/token` answers 200 with
  `{token, expiresIn, user, roles}`; that token in an `Authorization: Bearer` header reads
  through `graphql` and writes through `append`, both 200. Verified by
  `test/server/session-token.test.ts`.
- (c) **The written delta lands and resolves.** The delta appended through a session token is
  readable back through `graphql` afterwards. NO assertion about WHOSE key signed it — phase 8
  owns authorship, and a rail here would freeze what that phase must change. Verified by
  `test/server/session-token.test.ts`.
- (c2) **The token names the OPERATOR identity, not merely a valid one.** The session token opens
  an operator-gated door (`POST /:mount/register`), and a non-operator identity is refused there.
  `append` cannot show this — it is the non-custodial door, where every delta carries its own
  signed author, so an actor token, the static operator token, and a mis-scoped identity all
  answer 200 alike. This is the one assertion that turns red if `mint` were handed
  `{actor: "nobody"}`. Verified by `test/server/session-token.test.ts`.
- (d) **Login grows no key nobody granted.** After a login and a session-token write, every
  distinct author in the ground is one the home already held (the genesis operator, plus any
  fixture author seeded by the test) — asserted as a set comparison against the fixture's own
  known authors, not against a count. Verified by `test/server/session-token.test.ts`.
- (e) **The token dies with its window; the session survives it.** With an injected clock and a
  short `tokenTtlMs`, the token opens `graphql` inside its window and is refused past it, while
  the session still opens `GET /login` — the two lifetimes are separate. Verified by
  `test/server/session-token.test.ts`.
- (f) **Every path that drops a session retires its tokens — all four.** A minted token is
  refused after: `POST /logout`; the session lapsing past its idle window (injected clock);
  the user's roles being struck and a `GET /login` observing it; and a re-login over the live
  session (the fixation drop). Each with the positive control that the identical request one
  step earlier succeeded. One of these is the shape a logout-only revoke would leak past.
  Verified by `test/server/session-token.test.ts`.
- (f2) **The digest the doors record is the key the table deletes by.** A hex/base64 mismatch
  would make every revocation a silent no-op answering 200 (H7). Asserted by minting, reading
  the door's recorded digest for that session, and confirming it is exactly the string that,
  once revoked, stops the token — plus a direct equality against the server table's own key
  form. Verified by `test/server/session-token.test.ts`.
- (g) **The per-session cap refuses and recovers, on ONE clock.** With `maxTokensPerSession: 2`,
  a third mint answers 429 naming the cap; after the first token's TTL lapses (injected clock),
  a mint succeeds AND the lapsed token is refused at the data door **in the same test at the same
  instant** — the two tables are asserted to agree, so a second clock behind either cannot pass.
  Verified by `test/server/session-token.test.ts`.
- (h) **The ground is re-read at mint time, three ways.** Roles struck after sign-in → the next
  mint answers 401 and the session is dropped; a user holding only `actor` → 403 with the
  session intact; the mount unresolvable → 503 with the session intact. Verified by
  `test/server/session-token.test.ts`.
- (i) **A container's appearance closes the mint door rather than widening the token.** The
  plan's phase-7 line asked that a container mount answer a session token as it answers the
  static operator token; the premortem showed that is the widening itself — a container is
  derived, not registered, so a role binding read from the host's ground would buy operator
  authority over a world nobody granted. So: with the login doors open and a container attached,
  `POST /session/token` answers 503 naming the extra world, while the STATIC operator token
  still answers that container normally (the operator configured it; nothing is taken away).
  Two-sided: with no container attached, the mint succeeds. Verified by
  `test/server/session-token.test.ts`.
- (j) **`/session/token` is behind phase 6's guard.** A cross-site-shaped mint (no same-origin
  signal) answers 403 and mints nothing; a mint with a valid session cookie but no form token
  answers 403; a stateless pre-session with no live session answers 401. Verified by
  `test/server/session-token.test.ts`.
- (k) **The one-mount guard throws BEFORE the socket binds, on a port proven free.** On one
  EXPLICIT port: first a single-mount `serve()` binds and answers (proving the port was free and
  the fixture otherwise valid), and is closed; then the two-mount call on that same port throws
  with the guard's own message (asserted by text, so an unrelated early throw cannot satisfy it)
  and leaves that port refusing a connection. `addMount` while the doors are open also throws.
  Verified by `test/server/session-token.test.ts`.

## Known gap, named rather than hidden

**`createSessionTable` (phase 4) is a second, unused implementation of the token half**, fully
railed by `test/server/session-table.test.ts` and imported by nothing else. This phase builds the
bearer bridge on the doors' own session map, so those rails stay green while proving cap and
expiry semantics for code no request executes — a dead implementation with living tests, which
is worse than either alone. Closing it means retiring a frozen rail of a landed ticket (T125),
which is an authorized change of its own rather than something to do inside this phase. Filed as
its own ticket; stated here so a reader of a green `session-table` run knows what it does and
does not prove about the shipped door.

## What phase 8 inherits

`mint` names an identity (`{operator: true}` today). Phase 8 changes WHAT identity a session's
token names — the user's own key rather than the store's — without touching this door's shape,
its cap, or its refusals.
