# §36 phase 8/15 — a session signs as its user (T129)

## The problem

Phase 3 made a user's own signing key exist and be trusted: `loam user assign-role <name>
--role=operator` mints that user a seed in the home and lands an operator-signed write grant for
its key. Phase 7 made a session able to write, through a bearer token. But that token names
`{operator: true}` — the STORE's identity — so two operators writing through their own sessions
produce deltas indistinguishable from each other and from the store itself.

That is fine for one person. It stops being fine the moment a second person holds the role, which
is exactly what these phases enable. This phase joins the two halves: a session's writes carry
that user's own author.

## What this phase does not do

- **It does not widen who may write.** Every operator is equivalent (§9a); a per-operator key buys
  ATTRIBUTION, never privilege separation.
- **It does not NARROW it either, and that is the subtle half.** `{operator: true}` opens
  operator-gated doors (`register`, `health`, `federate`, `artifact`) that an actor identity does
  not. So the minted identity carries BOTH: the user's seed for signing and the operator flag for
  those doors. Dropping the flag would be a silent narrowing dressed as attribution.
- **It changes no delta's SHAPE — and it necessarily changes its ADDRESS.** Only the author
  field's VALUE differs, and an author was always a key, so no reader changes and no §20 step is
  owed. But the author is part of a delta's content address (H4), so two people writing the
  identical claim no longer collide into one delta — they produce two. Criterion (l) rails that
  as a fact rather than leaving it to be discovered.
- **It does not touch the CLI.** Phase 3 owns seed creation; this phase only reads what phase 3
  wrote.
- **It does not change WHO signs the constitutional writes.** `register` (and the renderer's pen,
  and `artifact`) publish LAW, and `publishRegistration` refuses any author but the store's own —
  so a session token OPENS those doors while what they write still carries the store's name. That
  is a real limit, not an oversight, and criterion (k) rails it so a later attempt to change it
  fails loudly instead of quietly breaking registration for every session.
- **It does not check that the seed still has STANDING.** A stale or rotated key mints happily and
  its writes are then refused at admission. That is the same authentication/authorization split
  criterion (e) exists for — but it means a confusing outcome (a successful mint whose every write
  fails), so the refusal path is railed rather than smoothed over.

## Decisions

**The mint door names `{ actor: <the user's seed>, operator: true }`** when the home holds a
usable seed for that user. `contextFor` already maps `actor` to the signing identity, and the
operator flag already gates the operator-only doors, so both properties fall out of the existing
token shape with no new field.

**The seam is `contextFor`, so the change reaches every door that signs — `graphql`, `rest` and
`mcp` alike.** That uniformity is the point: the same person's writes must not carry two
different names depending on which door they used. Criterion (a) rails `graphql` because it is
the shortest path to a door-signed delta; (m) rails that the other two agree.

**A user with an operator role but NO USABLE seed on this box fails CLOSED, by name.** 409,
saying which user and that `loam user assign-role` mints the seed. Falling back to the store's own
seed would attribute that person's writes to the store — the exact confusion this phase exists to
end, and an H7-shaped lie about provenance.

THREE STATES, not two, and a premortem caught the third failing OPEN. `readUserSeed` answers a
two-state question — no file, or a file it could not read — and a seed file has a third: present,
readable, and not a key (a crashed write leaves it zero-byte; a hand-edit truncates it). That
reads as `present`, mints `{actor: ""}`, and because `""` is not nullish nothing downstream falls
back — so the failure surfaces as an opaque error at the first write instead of a refusal at the
door. The mint therefore checks the seed's SHAPE (the same 64-hex rule `initHome` writes) and
treats a malformed one exactly as unreadable. In every failing case the detail goes to `onFault`
and never to the caller.

**Authentication and authorization come apart, deliberately.** A user whose write GRANT was struck
can still log in and still mint (they hold the role claim; the login door asks roles, not
grants) — their writes are then refused AT ADMISSION, because standing is a surviving grant and
theirs is gone. That separation is the point: the login door is not the
authorization surface, and railing the two apart is how we prove neither is doing the other's job.

**The seed is read at MINT time, not at login.** A seed written between sign-in and mint is picked
up on the next mint; one deleted is refused on the next mint. Reading it at login would cache a
key across a window in which the operator may have changed it, and would put a signing key in the
session row for its whole idle life.

**The key never leaves the process.** The seed goes into the token table's identity, which the
doors already hold; nothing about it reaches the response body, the pages, or a log.

## Acceptance criteria

All in `test/server/session-authorship.test.ts` against live `serve()` instances.

- (a) **A session's write carries that user's own author.** A delta appended through a session
  token — one the door itself signs, i.e. a mutation through `graphql`, not a pre-signed delta
  carried through `append` — resolves with `author` equal to `authorForSeed(<the user's seed>)`,
  and NOT equal to the genesis operator's author. Asserted at the DELTA level, reading the
  store's own deltas rather than a rendered view. Verified by
  `test/server/session-authorship.test.ts`.
- (b) **Two sessions are distinguishable.** Two operator-role users, each with their own seed,
  each write through their own session. The two deltas carry DIFFERENT authors, each equal to its
  own user's key. Verified by `test/server/session-authorship.test.ts`.
- (c) **The static operator token still signs as the store.** The same mutation carried by the
  configured operator token produces a delta authored by the genesis operator — two-sided against
  (a), so the change is about SESSIONS rather than about the store's identity moving. Verified by
  `test/server/session-authorship.test.ts`.
- (d) **The operator doors stay open to a session token.** A session token whose identity now
  carries a user seed registers a schema through `POST /:mount/register` — 200, and the named
  schema comes back registered — exactly as the static operator token does with a different
  name. ABSOLUTES, not a bare equality: two identical failures would satisfy "same status, same
  body", which is the trap the plan warns about. Verified by
  `test/server/session-authorship.test.ts`.
- (e) **A struck grant separates authentication from authorization.** With the user's write grant
  struck (their role claim intact), the user still logs in and still mints a token, and their
  mutation is REFUSED AT ADMISSION for want of standing — asserted on the `errors` payload the
  graphql door answers with (it reports a gateway refusal at HTTP 200, so a status check would
  read as success) AND on the store, where no such delta exists. Two-sided: a second
  operator-role user whose grant survives still writes. Verified by
  `test/server/session-authorship.test.ts`.
- (f) **No seed on this box fails closed, by name.** An operator-role user with no seed file gets
  409 from the mint door, naming the user and the command that mints one; nothing is minted, and
  the response names no path. A store-seed fallback would make (a) pass while attributing the
  write to the store, so this is the rail that forbids it. Verified by
  `test/server/session-authorship.test.ts`.
- (g) **An unreadable seed fails the same way, and the detail reaches only the operator.** With
  the seed file replaced by a directory, the mint answers 409 with a body naming no path, and
  `onFault` receives the detail. Verified by `test/server/session-authorship.test.ts`.
- (h) **No delta changes shape.** A delta written through a session has the same claim SHAPE as
  one written by the operator — same roles, same target kinds, same claim fields — differing only
  in the author's value. (The earlier form of this criterion also ran a grep over `src/migrate/`
  for a string no migration would ever contain, and asserted that a store this phase never
  touches reads unchanged: both pass with the feature deleted, so both are gone.) Verified by
  `test/server/session-authorship.test.ts`.
- (i) **The seed is read at mint time.** A seed written AFTER sign-in is used by the next mint
  (the mint succeeds and the write carries that author); a seed deleted after a successful mint
  makes the NEXT mint fail closed while the already-minted token keeps working until its window
  ends. Verified by `test/server/session-authorship.test.ts`.
- (j) **The key never leaves the process.** The mint response body, the signed-in page, and the
  fault channel are each asserted not to contain the seed's hex. Verified by
  `test/server/session-authorship.test.ts`.

- (g2) **A seed that is present but NOT A KEY fails closed too.** Zero-byte, whitespace, a
  non-hex string, and a half-length key each answer 409 with the operator getting the detail —
  each with a positive control that the same server minted successfully a moment before.
  Verified by `test/server/session-authorship.test.ts`.
- (k) **The constitutional doors still sign as the STORE.** A schema registered through a session
  token produces deltas authored by the genesis operator, not by the user — the limit named
  above, railed so a later change to it cannot pass silently. Verified by
  `test/server/session-authorship.test.ts`.
- (l) **Two users writing the identical claim produce two distinct deltas.** Same field, same
  value, two authors: two delta ids, both surviving. The content address moved (H4), and this
  says so. Verified by `test/server/session-authorship.test.ts`.
- (m) **Every signing door agrees on the name.** The same user's write through `graphql` and
  through `mcp`'s mutate tool carries the same author — the seam is `contextFor`, and a
  door-specific implementation would give one person two names. Verified by
  `test/server/session-authorship.test.ts`.

## What phase 9 inherits

Nothing structural: the delay governs how a wrong PASSWORD is answered, which is upstream of
every decision here.
