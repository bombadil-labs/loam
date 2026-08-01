## 36. Users and sessions — credentials at rest

**This section opens with its first phase.** §36 covers a ten-phase arc — a user as a fact, roles,
per-operator keys, the session table, the login door, cross-site defence, the bearer bridge,
per-session authorship, the login delay, and erasure honesty. Each phase is its own pull request,
landing in dependency order; each later phase **edits this file** to add its own subsection, per
the plan that decomposed the work (`.adlc/specs/users-oauth-phasing-plan.md`). This first phase
delivers the one piece every later phase in the arc needs before it can be built: a place to keep a
password.

### 36.1 Credentials at rest

A password hash is the one part of a Loam user that is **not** a delta. Every other fact a store
holds is a signed claim in the ground, and the ground replicates: a federated peer receives it, an
offer file can carry it off the box. A password hash must never take that path. So it lives beside
`operator.seed`, in a plain file — `credentials.json` — in the Loam store's own home directory (the
`<home>` a caller names with `loam serve --home <dir>`, never the operating system user's home).

The file is small and its shape is simple: a `version` number and a `users` object keyed by
username, each entry holding a `kind` tag (`"scrypt"`, the only kind this phase writes), a hex salt,
a hex hash, and the scrypt cost parameters that entry was created with. Nothing about the shape is
clever — the honesty is in what the file does when it cannot be trusted.

**A file this code cannot fully verify is a file it refuses to authenticate against, and it refuses
the whole file, not just the damaged entry.** A truncated write, a hand-edited typo, a stray
non-hex character in a hash, an entry that has drifted to disagree with its own byte length — any of
these throws a named error rather than quietly treating "I could not tell" as "it matched." A
reader that dropped just the damaged entry and kept authenticating the rest would hide exactly the
kind of tampering this refusal exists to catch.

The write is temp-then-rename: a fresh, uniquely named temporary file lands beside the target (never
in a shared OS temp directory, so the rename stays on one filesystem and stays atomic), is written,
flushed to disk, and only then swapped into place. It lands at file mode 0600 from the moment it is
created, never by a later permission change, and a fault at any point in that sequence — a short
write, a failed flush, a failed rename — removes the temp file rather than leaving it to accumulate.
An absent `credentials.json` is read as an empty file, not as damage: a freshly initialized home has
not yet failed at anything.

The scrypt cost a reader will accept is bounded on both the memory a derivation may claim and the
CPU time it may spend, checked independently — a parameter set within one bound is not assumed to be
within the other. A stored hash's length must agree with its own entry's cost parameters, checked
before any byte-comparison runs against it.

**This phase adds no door and no CLI command.** The credential file is a tested library and nothing
yet reads or writes one in the running server — that arrives with the bootstrap and role commands
(phase 3) and the login door (phase 5).

**Provenance.** [PR #286](https://github.com/bombadil-labs/loam/pull/286) — `src/server/credentials.ts`,
proved by `test/server/credentials.test.ts`. Working spec:
`.adlc/specs/36-01-credentials-at-rest.md`. Ticket T122, from the fifteen-phase plan at
`.adlc/specs/users-oauth-phasing-plan.md`.

### 36.2 A user is a fact

A user is an entity. Its name and its roles resolve through a Schema over a HyperSchema, never as a
delta read directly — a claim is one assertion, not the fact a reader resolves.

A role binding is data, not a grant: nothing at the append door refuses an ordinary write from
claiming a role at `user:<name>`. The read is the only defence. `userHyperSchema` selects claims
authored by the store's own seed key (the file at `<home>/operator.seed`) and masks so that only the
seed's own negations bind — a stranger's claim lands in the ground but never resolves, and a
stranger's strike never retracts what the seed said.

Roles resolve as a SET: the Policy for the role context is `all`, never `pick`, so a user may hold
`operator` and `actor` at once, and each role strikes independently. `rolesOf` is the one reader,
returning `ReadonlySet<UserRole>` — there is no singular `roleOf`, so a permission check always asks
membership, never equality.

Every operator with home access is equivalent — there is no senior "genesis operator" tier, only the
one seed key every operator on the box shares.

**Provenance.** [PR #285](https://github.com/bombadil-labs/loam/pull/285) — `src/server/users.ts`,
`src/gateway/gather.ts`, proved by `test/server/users-ground.test.ts`. Working spec:
`.adlc/specs/36-02-a-user-is-a-fact.md`. Ticket T123.

### 36.3 The bootstrap, the role commands, and per-operator keys

`loam user create <name> [--operator]` is the first door onto a store: it asks for a password twice
with the terminal echo off, writes the credential, and plants the user and role deltas — signed with
`<home>/operator.seed`, the same file `loam init`/`loam serve` already read. Proving operatorship is
proving home access; there is no remote path that mints a role, and a browser session, however
privileged once a later phase wires one up, cannot call these commands.

`loam user assign-role <name> --role=<role>` and `loam user remove-role <name> --role=<role>` make a
role a first-class, revisable fact rather than a flag `create` can only set once. `assign-role`
appends one operator-signed role claim (or refuses if the role is already held); `remove-role`
appends an operator-signed negation of **every surviving claim** of that role — never the latest
one, since roles resolve with `all` (§36.2) and a second grant, however it arrived, keeps a struck
role held through its own filing.

**A `--role=operator` assignment also mints the user their own signing key**, beside
`operator.seed`, at the same file mode, and never inside the ground — the same reason a credential
never is. The key becomes trusted through the existing grant vocabulary (§7): the CLI files a
`loam.grants` entry at the store's own entity, authored by the store's seed, naming the fresh public
key as `subject`. `lawfulStrikersJson` — unmodified, and already governing every trust-aware read —
already admits exactly that shape, and admits it only when the grant's author is the store's own
seed. So a delegated operator's own grant for a third party never widens who is trusted: depth is
bounded by authorship, not by how many links a chain can express. `remove-role operator` strikes the
grant alongside the role, when the key file can still name it; when the key file was already lost,
the command says so and leaves that lingering grant named as a residue, rather than guessing.

Losing a user's own key file is not losing the role. Recovery is `remove-role` then `assign-role`
again: the latter mints a fresh key and files a fresh grant regardless of what came before, and the
user's past deltas keep their old author, so history never rewrites. The same home-access proof
means even the LAST operator on a store may remove their own role and reassign it — both commands
need no session and no live operator-role user in the ground at any point in between, so a store can
never lock itself out from the box that holds its own seed.

An unusable `--home` is refused with the fault named, not one message for every shape of "no":
missing (when a command must not bootstrap one, unlike `create`), a dangling symlink, a plain file
where a directory was named, and a directory this process cannot read, write, or traverse.

**Provenance.** [PR #290](https://github.com/bombadil-labs/loam/pull/290) — `src/cli/cli.ts`,
`src/cli/prompt.ts`, `src/cli/config.ts`, `src/cli/args.ts` (the T117 parser fix — a boolean flag
given a value now refuses rather than reading as absent), proved by `test/cli/user-roles.test.ts`,
`test/server/operator-keys.test.ts`, and `test/cli/prompt.test.ts`. Working spec:
`.adlc/specs/36-03-the-bootstrap-the-role-commands-and-per-operator-keys.md`. Ticket T124.

### 36.4 The session table

A signed-in session lives in the server's own memory, in a plain `Map` with no persistence: a
restart forgets every session, which is deliberate for one operator on one box (§9a) rather than a
gap this section leaves open. A session id is 32 random bytes, base64url — never a counter, never
derived from the user's name.

**Where that map actually lives, corrected.** Phase 4 landed this design as a standalone
`createSessionTable`, on the expectation that the login door (§36.5) would be its first caller. The
door did not call it. It grew its own session map instead, because a door session carries two things
a standalone table has no slot for — the user's `roles`, re-read from the ground on every ask, and
the per-session `formToken` that §36.6 checks — and because the token half belongs one layer further
out still: a session token names a server-wide IDENTITY rather than a user, and §36.7 re-checks it
against the live mount set on every presentation, so its table lives in `http.ts` where the bearer
header is read. The standalone table was therefore a second implementation that no request ever
executed, and its test file was green about code the store did not run. It is deleted. The behaviour
this section describes is what ships; what was wrong was the claim that one object held it, and the
closing paragraphs name the three places where the standalone table proved or did something the
shipped doors do not.

Every session carries an idle window. Touching a session slides the window forward; touching it
after the window has passed refuses the touch and deletes the row outright, so a later clock
reading — even one that runs backward — has no live row left to revive. The doors read a monotonic
clock (`performance.now()` by default, injectable for a test), never the wall clock: a wall clock a
caller or the OS can step backward would let an already-expired session look like it had gained time
back. Sweeping runs only on a login or a presented cookie, so a lapsed row may still be sitting in
the map; every question asked of a row therefore checks that row's own expiry rather than trusting
that something has already removed it.

Each minted bearer-token digest carries its OWN expiry, never the parent session's — a token that
rode its session's much longer idle window past its own stated TTL was a defect an independent
review caught before any code existed, and a second review caught the same shape again after the
first fix. What ships closes it from the other side: the token table asks a `stillLive` callback on
every presentation, so a session past its idle window stops authenticating the tokens it bought even
when no traffic has swept its row. Dropping a session erases every digest it minted, so a login
door's logout genuinely revokes what it claims to revoke. A lapse alone erases nothing: it withdraws
the tokens' AUTHORITY at once through `stillLive`, and the digests go when the lapsed row is next
touched or swept and dropped. A session may hold at most 16 live token digests at once, so a rapid,
long-TTL minting loop cannot grow one session's footprint without bound.

A full map refuses a new session rather than evicting a live one: evicting a live session to admit
a flood of new logins would trade one denial-of-service shape for a worse one, an attacker signing a
real operator out. A session already past its idle window is reclaimed the next time anyone logs in,
so an abandoned session does not block a login slot forever — bounding how fast an attacker may open
new sessions at all is a later phase's concern.

**What is railed, and what is not.** The idle window and the clock backstep are proved in
`test/server/login-door.test.ts` (o); the cap, the refusal to evict a live session, and the sweep in
the same file (p). On the token half, `test/server/session-token.test.ts` proves TTL isolation in
both directions — a token dying inside its live session (e), and a lapsed session refusing a token
whose own TTL has not run out (f) — and the per-session live-token cap, refusing and recovering, in
(g).

Five properties this section states are NOT railed. They are named here rather than left for a
reader to assume, and the list is meant to be exhaustive — a claim in this section that appears in
neither the paragraph above nor the five below is an omission worth reporting.

*A restart invalidating every session* has no live rail. The map is a closure-local `Map` allocated
per `serve()` call and no persistence path reaches it, so the property holds structurally. A door-level
rail is writable — sign in against one `serve()`, present the cookie to a second — and none is added
here; it would go red only the day someone gives sessions a persistence path, which is the regression
worth catching.

*A token being held as a DIGEST rather than the plaintext* is unobservable from outside. Both the
doors and the token table would behave identically if each held the secret instead, so no test
driving real HTTP can distinguish them. The standalone table's own unit test could see it, by asking
the table for its stored digests, and that observability went with the table. The property still
holds in the code — `src/server/session.ts` and `src/server/http.ts` both hash before storing — but it
now rests on reading them, not on a rail.

*Pruning a session's expired digests on `touch` as well as on mint* is not a property of what ships.
The standalone table did it on both paths; the doors prune only when minting. The set stays bounded
by the per-session cap and is cleared whenever a session drops, so the leak the original design
guarded against is closed by other means rather than by that sweep.

*The default clock's SOURCE* is unrailed, and it is the one gap here with a security edge. Every
clock-bearing test injects `monotonicNow`, so nothing pins that the default is `performance.now()`
rather than `Date.now()`: change both defaults to the wall clock and the whole suite stays green.
What (o) proves is that a backward step does not extend a session — a property the delete-on-discovery
rule holds under ANY clock. The paragraph above argues the monotonic source is what stops a backward
step arising in the first place; only the second line of that defence is tested.

*A session id's shape and entropy* are unrailed. No test asserts 32 random bytes, or base64url, or
any distribution; (f) asserts only that a fresh login yields a different value than the one before it.

**Provenance.** [PR #289](https://github.com/bombadil-labs/loam/pull/289) landed this design as
`createSessionTable` in `src/server/session.ts`, proved by `test/server/session-table.test.ts`.
Working spec: `.adlc/specs/36-04-the-session-table.md`. Ticket T125. Corrected by
[PR #297](https://github.com/bombadil-labs/loam/pull/297) and
[PR #298](https://github.com/bombadil-labs/loam/pull/298), which deleted that table once §36.5–§36.7
had shipped the behaviour elsewhere, retired its rail from T125 under `adlc ticket update
--authorize`, and re-pointed this section at the rails that prove the shipping code. An independent
premortem during §36.7 found the divergence.

### 36.5 The login door

Three routes, two cookies, and nothing else: `GET /login` shows the form, `POST /login` trades a
password for a session, `POST /logout` ends one. The doors open only when the home holds a
`credentials.json` — a store with no users is byte-for-byte the store it was before §36, `/login`
resolving as any unresolvable name does, no request anywhere reading a cookie.

A session cookie is ambient — the browser attaches it to any request any page makes — so cookie
authority is confined to these pages and opens no data door: a cookie attached to `graphql`,
`append` or `mcp` earns exactly the bytes a credential-less request earns. The bearer bridge a
browser writes through is phase 7's.

The signed-in session and the not-yet-signed-in form use two different cookies, both `__Host-`
prefixed, and the split is a security property: `SameSite=Lax` withholds a cookie on a cross-site
subresource request, so a shared name would let any page on the internet fetch `/login` and
overwrite the operator's live session id with a fresh nonce — a forced sign-out whose orphaned row
idles out with no cookie left to reach it. The pre-session is stateless (a nonce cookie, its form
token an HMAC under a boot-minted key), so `GET /login` allocates nothing a flood could fill. The
cookie attribute string is one pinned literal — `HttpOnly; Secure; SameSite=Lax; Path=/`, no
`Domain` — computed from no request header, identical under any `Host` or `X-Forwarded-*` a caller
writes. Every page carries one pinned `Content-Security-Policy` literal permitting no script, no
framing and no form retargeting, and carries no script.

A login refuses one way. A wrong password, a name nobody holds, and a credential whose user holds
no role in the ground answer the same status and byte-identical bodies; the unknown-name path
spends a decoy hash at the credential file's own parameters so a miss and an absent name cost the
same time. What went wrong in detail — an unreadable credential file, entries disagreeing about
scrypt cost — reaches the operator's own channel, never the caller. Unauthenticated hash work is
capped by an in-flight counter that refuses the surplus attempt outright (login is deliberately
degradable; the API does not pass through it), and the failed-login delay is phase 9's.

A correct password is not enough: the GROUND must still hold the user, read through `rolesOf` at
the door, so erasing a user record genuinely shuts the door the credential file cannot know was
shut. The read distinguishes "gone" from "cannot decide" — an unresolvable mount or a ground that
cannot name its operator answers 503 with the session untouched, because destroying an
authenticated session over a local fault would be the store lying downward. Logging in over a live
session mints a NEW id and drops the old one (a planted cookie value must not become a live session
when the victim signs in), and the sessions here obey the same discipline as the phase-4 table:
monotonic clock, idle expiry that deletes on discovery, a cap that refuses rather than evicts.

The CLI opens the doors at boot iff the home holds users, and refuses one trap by name: a
non-loopback bind over plain HTTP would set a `Secure` cookie no browser keeps — a login loop with
no error anywhere — so `loam serve` demands an `https` `--public-url` in front of a wide bind, or
the loopback default.

**Provenance.** [PR #292](https://github.com/bombadil-labs/loam/pull/292) — `src/server/session.ts`
(the doors beside the table), `src/server/credentials.ts` (the decoy hash), `src/server/http.ts`,
`src/cli/cli.ts`, proved by `test/server/login-door.test.ts` and `test/cli/serve-login.test.ts`.
Working spec: `.adlc/specs/36-05-the-login-door.md`. Ticket T126.

### 36.6 Cross-site defence

Phase 5 issued the form token and checked nothing; this phase is the enforcement, and it adds
exactly one precondition to the POST doors: provenance. A cookie is ambient and a form POST is a
simple request no preflight guards, so before this phase any page on the internet could sign the
operator out, or seat them in an attacker-chosen session.

The preamble runs in a pinned order. First provenance: `Origin`, when present, must be one of the
store's own origins, and it outranks `Sec-Fetch-Site` — a header that names a specific foreign
page is believed over a browser hint, and `Origin: null` (a sandboxed context) refuses like any
foreign origin rather than falling through, since the pages forbid framing and null is exactly
the origin an attacker can select. With no `Origin`, the browser's `Sec-Fetch-Site` must say
`same-origin`. Second, the body is drained regardless — an early refusal must not leave bytes on
a keep-alive socket. Third, on `/logout` only, session presence: a same-origin caller with no
session gets the 401 phase 5 always gave. Last, the form token, compared timing-safely
(`sameSecret`, one implementation): the session's own token when a session is presented, else the
HMAC of the presented pre-session nonce under the boot key.

Two properties of that order are load-bearing. A refused request slides no idle window — the
session row is peeked, never touched, until every check passes, so refused traffic cannot keep a
victim's session alive. And the provenance refusal fires before the hash gate, so a cross-site
POST spends no scrypt and, once the phase-9 limiter exists, fills no counter.

The recognised origins come from the settled public URL, widened only across the loopback
spellings (`127.0.0.1`, `localhost`, bracketed `[::1]`) on the same port — a browser at
`localhost` names the same store as the bound `127.0.0.1`. Two faults are loud at door opening:
an unparseable public URL empties the set (every Origin-bearing POST refuses, closed and said
so), and an unroutable one (`0.0.0.0`) names `--public-url` — the alternative was a silent
universal 403 after every deploy behind a proxy. The refusal itself names its cure ("reload the
page and try again"): every non-attack path to it — a form issued before a restart, a stale
tab — is fixed by a fresh form.

**Provenance.** [PR #293](https://github.com/bombadil-labs/loam/pull/293) — `src/server/session.ts`,
proved by `test/server/login-csrf.test.ts` (phase 5's two rail files untouched, per the plan's
freeze discipline). Working spec: `.adlc/specs/36-06-cross-site-defence.md`. Ticket T127.

### 36.7 The bearer bridge

A session opens the store's own pages and nothing else. `POST /session/token` is how a browser
crosses to the JSON doors: it trades a live session for a short-lived bearer token the browser
then presents in a header, like any other client. The cookie never crosses — a cookie is ambient,
so a cookie-opened data door would be cross-site forgeable, and this is the whole reason cookie
authority stays off them.

The token names the operator's authority on this server, for its own window (five minutes by
default), and it is held as a DIGEST on both sides — the doors keep no plaintext, because a
session idles far longer than a token lives. One clock decides which tokens are live for both the
server's table and the session's own cap, so the two can never disagree about what a cap slot
means. A session may hold sixteen live tokens; a lapsed one frees its slot.

The roles are re-read from the ground at every mint, never trusted from the session: a struck role
closes the door to new tokens at once. An already-minted token still lives out its window, which
is stated rather than implied — the alternative reading, that revocation is instant, would be a
promise the bytes do not keep. And a session row and the tokens it bought die TOGETHER, through
one function, because `drop` has four callers: signing out, the idle sweep, the ground losing the
user, and the re-login that kills a fixated session. Attaching revocation to the logout door alone
would have left an operator token alive across the other three.

A session token is authority over the whole server, while the role binding that earns it is read
from ONE mount's ground. So no world other than the doors' own may answer beside them: `serve()`
refuses at boot before the socket binds, `addMount` refuses a stranger, and — because a container
mounts ITSELF and boot never sees it — the mint door asks the LIVE mount table and refuses to mint
while a second world is answering, naming it. That refusal is not the whole closure, because a
container can attach AFTER a mint: an already-minted session token also stops being honored while
a stranger answers, asked on every presentation, and starts again when the stranger goes. The
narrowing is total for that token — it is refused even at the world it was legitimately minted
for, since nothing can scope it to one mount today. Nothing is taken from the operator's own
configured token; only the session's path to server-wide authority closes.

A long-lived response is the one place authority outlives its own request, so an authenticated
subscription re-asks on every event: a stream opened with a session token ends, saying so, the
moment that token is revoked, lapses, or loses the session behind it. Without that, "signing out
retires the tokens that session minted" would have been true only of new requests.

One boundary is worth stating plainly, because this phase is what makes it consequential: the mint
door's authority boundary is the ORIGIN. Anything a store serves script from on the same origin is
inside it — a script on a rendered route can fetch the login page, read its form token, and mint.
That is inherent to any cookie-anchored session, but before this phase the strongest thing such a
script could obtain was a page.

**Provenance.** [PR #294](https://github.com/bombadil-labs/loam/pull/294) — `src/server/session.ts`,
`src/server/http.ts`, `src/server/mounts.ts` (the live mount enumeration the mint door asks),
proved by `test/server/session-token.test.ts`. Working spec:
`.adlc/specs/36-07-the-bearer-bridge.md`. Ticket T128.

### 36.8 A session signs as its user

Phase 3 gave each operator-role user their own signing key in the home; phase 7 let a session
write. This joins them: a session's writes carry that user's own author, not the store's. Two
operators are now distinguishable in the ground — which is the whole point, because two people
writing under one name is fine until the moment a second person holds the role.

The minted identity carries both halves, and both are deliberate. The user's seed decides whose
name goes on what the doors sign. The operator flag keeps the operator-gated doors open, because
dropping it would be a silent NARROWING dressed up as attribution — every operator is equivalent
(§9a), and a per-operator key buys attribution, never privilege separation. The seam is the
request context every signing door shares, so `graphql`, `rest` and `mcp` agree on the name; a
door-specific implementation would give one person two.

A user holding the operator role with no USABLE key on this box is refused by name, and the refusal
is the load-bearing part: falling back to the store's seed would put that person's writes under the
store's name, a lie about provenance no later reader could detect. Three states, not two — a seed
file can be absent, unreadable, or present and not a key (a crashed write leaves it zero-byte), and
the third fails open unless the shape is checked, so it is. The key is read at mint time, never
cached in a session, and never reaches a response, a page, or a log. Its one residency is the
server's token table, and the bound on that copy is TRAFFIC, not time: the table is swept on every
mint and every session-ending event, so on a busy server a lapsed seed goes promptly, but on a
server nobody touches again the last copy sits until the process ends. It authenticates nothing
there — the token check reads the token's window, the session's window, and the mount rule before
answering — so the residue is a disclosure surface, never an authority one; a wall-clock timer to
close it fully is a decision left to its own phase.

Two limits are stated rather than left to be discovered. The constitutional doors — registration,
the renderer's pen, artifact — still sign as the STORE, because publishing law refuses any author
but the store's own; a session opens those doors and what they write still carries the store's
name. And a session whose write GRANT was struck can still log in and still mint: authentication
and authorization come apart on purpose, so the writes are refused at admission instead. Nothing
about a delta's SHAPE changes, so no migration is owed — but the author is part of a delta's
content address, so two people writing the identical claim now produce two deltas where they once
produced one.

**Provenance.** [PR #295](https://github.com/bombadil-labs/loam/pull/295) — `src/server/session.ts`,
proved by `test/server/session-authorship.test.ts`. Working spec:
`.adlc/specs/36-08-a-session-signs-as-its-user.md`. Ticket T129.

### 36.9 The login delay

A wrong password must cost something, or a store whose operator name is known is a store anyone may
guess at until they are in. The cost here is a WAIT, never a lock: each failure makes the next
attempt FOR THAT NAME wait longer — the base doubled once per failure, capped so "slow" never becomes
"shut" — and a correct password is admitted however many failures came before it. A lock would be an
off switch a stranger could pull with a handful of wrong guesses at a name they already know; a delay
taxes the guesser and never touches the operator's own way in.

It keys on the USERNAME, never on a caller-supplied source. Behind a proxy every request arrives from
127.0.0.1, and `X-Forwarded-For` is the caller's own to write, so a per-source counter is a remote
lever pointed at the operator's login. Keying on the name puts the one lever that clears a record —
`loam user unlock`, which this phase makes meaningful — where only the box can reach it. The state
lives in a plain file in the home, `login-locks.json`, for the same reason: the unlock command is a
separate process, and a record in server memory is one it could never clear.

The wait is paid BEFORE the password is compared. A cost charged after the check is no cost at all — a
fast refusal beside a slow success tells a caller which guess was close as plainly as the status would
— so the door reads the owed wait, serves it, and only then spends a hash. A waiting attempt holds no
hash slot, so a flood against one name never freezes another name out, and the global cap on
unauthenticated hash work (§36.5) is re-read AFTER the wait, never before it, so a burst cannot pass
one stale free-budget reading and then hash all at once when its waits elapse together.

Both writes fail OPEN, and that is the whole promise restated: a home this process cannot write, or a
record path replaced by a directory, must never turn a correct password into an error. Fail-open means
no budget at all — a name with no row waits zero until the disk is fixed — which is the safe
direction, because a work budget is not an authorization surface and a local fault has no business
refusing a login. A record path that is not a regular FILE is refused before it is opened: a FIFO left
at `login-locks.json` would otherwise park `readFileSync`, and with it the whole single-threaded login
door, forever.

The table is bounded, because an unauthenticated caller drives every write to it, and the bound has an
honest cost stated rather than hidden: a caller who floods the table can keep a chosen name's row out
of it and pay that name's delay nothing. The eviction order is not a defence and is not sold as one —
the delay taxes a serial guesser against one name, the hash cap bounds the parallel one, and neither
pretends to be the other. There is deliberately no guesses-per-second number here: concurrent attempts
read one count and pay one wait, so a caller buys the hash cap's worth of guesses per wait, and a
per-second figure would be wrong by orders of magnitude.

**Provenance.** [PR #296](https://github.com/bombadil-labs/loam/pull/296) — `src/server/login-locks.ts`
and the `postLogin` wiring in `src/server/session.ts`, proved by `test/server/login-delay.test.ts`.
Working spec: `.adlc/specs/36-09-the-login-delay.md`. Tickets T130 and T120 (the non-regular-file
refusal, folded in here).
