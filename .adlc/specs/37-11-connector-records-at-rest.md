# §37 phase 11/15 — connector records at rest (T132)

## The problem

A connector needs a durable record: which clients are registered, which client owns which
signing seed, and which token digests are live. The record must survive a restart, must never
half-write, and its WRITES must never race two processes to a lost update — `loam grant revoke`
(a later phase's CLI) and the server both touch it, and a lost update there either strands a
connector's seed or resurrects a revoked one. This is a claim about writes, not about reads: a
crashed holder's lock is deliberately broken after a timeout so a second process can proceed, and
that break can (rarely) let a live-but-frozen first process's `work` still be running when a
second process's `work` starts — "The lock" section below states precisely what stays exclusive
through that window (the write) and what does not (a stalled reader's callback).

This phase ships only the file and its lock: `oauth.json`, read, validated, written atomically,
guarded by a cross-process lock. Plan §9e: this ticket's rails are empty until P3. Per the
plan's edges, phase 11 has no prerequisite among phases 1–10 and no phase above it may edit this
file's rail file — so its tests import nothing from a door or a CLI, only `node:fs`,
`node:child_process` and the module itself.

**Named assumption, not a gap: ONE MACHINE, ONE FILESYSTEM CLOCK.** The lock's staleness test
compares the lock file's `mtime` to `Date.now()` in the SAME process that reads it. `<home>` is a
local directory the operator's own CLI and server share; this is not a design for a home mounted
over a network filesystem with its own clock, and `OAuthFileUnlockable`'s own message already
steers an operator whose filesystem lacks hard links (some SMB/FUSE mounts) onto a local
filesystem. A clock-skewed network mount is the same class of unsupported configuration, named
here rather than solved: solving it would mean embedding a signed absolute expiry in the lock's
own bytes, which is new design, not this ticket's `Delivers` line.

The same `Date.now()` dependency means a local clock adjustment (an NTP step, not drift) can move
the staleness computation either direction. A backward step delays a real crash's recovery — the
lock outlives `LOCK_STALE_MS` in wall-clock terms before it reads as stale, which fails toward an
extra `OAuthFileBusy` refusal, not toward a lost update. A forward step ages a live lock early,
which is the ordinary stale-break race already named above, not a new one. Neither direction is
fixed here, for the same reason the network-mount case is not.

## What this phase does not do

No door reads or writes this file. No CLI command exists yet. The record shape (client, grant,
token) is fixed here because phase 13's eviction-pin fixture writes a grant record directly
"using phase 11's file format" (plan §4, phase 13 criterion 5) before any door mints one — but
the MEANING of a grant (who approved it, when a token expires) is a later phase's job. This
phase only proves the bytes round-trip and the lock excludes.

## The record shape

`OAuthFile` is `{ version: 1, clients: OAuthClient[], grants: OAuthGrant[], tokens: OAuthToken[] }`.
A registered client carries `clientId`, `clientName`, `redirectUris`, `registeredAt`, and
`generation` (a counter later phases bump on revocation — defined now so its shape never changes
under them, per the corollary that a migration-worthy change must be shape-distinguishable from
day one). A grant carries `clientId`, `actorSeed` (32 bytes hex), `actor` (re-derived and checked
against the seed on read), `grantedAt`, and `standing` (a boolean a later phase sets once the
grant's append lands in the ground). A token carries `digest`, `clientId`, `issuedAt`. None of
these fields is interpreted by this phase; each is validated for shape only.

**Validation runs on the way OUT too, not only on the way in.** `withOAuthFile` writes whatever a
future caller's `work` returns; without a write-time check, a bug in a later phase's callback could
persist a value that fails the read-time checks above, and every later read would throw forever —
the file-layer version of the same "cannot determine" hazard the read side exists to prevent, only
self-inflicted instead of arriving from outside. So the write path re-validates with the same
checks before it serializes anything.

**Not implemented, matching phase 1's own precedent for `credentials.json`:** a write always ends
at 0600, but nothing on the READ path checks or repairs a file some other process left
world-readable — phase 1 asserts mode after a write and states the Windows gap; it does not add
mode-on-read enforcement, and this phase does not either. Refusing or repairing an insecure mode on
read is a real, undecided design question, separate from what this ticket's `Delivers` line asks
for: read, validate the record's SHAPE, write atomically, lock. It is unbuilt, not overlooked.

`oauth.json` is never in the ground: it holds a connector's actor seed, and the ground
replicates under federation. It lives beside `operator.seed` and `credentials.json`.

## The lock

`withOAuthFile(home, work)` reads the file, hands it to a synchronous `work`, and writes what
`work` returns — with the WRITE exclusive against every other process holding the same home. The
lock is a hard link from a temp file that already holds the acquirer's nonce, because `link`
fails atomically (`EEXIST`) when the target exists and create-then-write cannot promise that.

**The nonce is `pid:32-hex-chars`, the hex from `randomBytes(16)` — 128 bits of randomness per
acquire, freshly drawn every call.** Two acquirers landing on the same nonce is a collision in 128
bits of CSPRNG output, not a design gap this working spec leaves open; the pid prefix is for a
human reading the file during an incident, not for uniqueness, since two containers sharing a PID
namespace already fail the "one machine" assumption above for reasons the pid could not fix
either.

`claimLock` runs ONLY in the acquire loop, before `work` is called. Nothing re-acquires the lock
afterward. The ownership check runs INSIDE `performAtomicWrite` — after the temp file is written
and fsynced, immediately before the rename — and compares the lock file's bytes, byte for byte, to
the acquirer's own nonce; a mismatch — the file gone, or holding a different nonce — refuses the
write with no retry, and removes the now-orphaned temp.

**THE GUARANTEE NAMED HONESTLY, because two review rounds sharpening this same claim are worth
recording as a lesson rather than papering over: THE WRITE IS EXCLUSIVE AGAINST EVERY OTHER
PROCESS, MODULO A WINDOW THIS DESIGN MAKES AS SMALL AS POSSIBLE WITHOUT A REAL COMPARE-AND-SWAP.**
Breaking a stale lock by path cannot be made race-free — this is the ticket's own criterion 3,
verbatim. Four check-then-act windows are inherent to advisory locking without one, and the
ownership check's PLACEMENT is what the second review round changed: an earlier draft ran the
check before calling the write function at all, which put the write's own `fsync` — a synchronous
disk operation that can genuinely stall past `LOCK_STALE_MS` under real contention, not merely
under an OS-level process freeze — INSIDE the unprotected gap. Moving the check to after the fsync
and immediately before the rename shrinks that gap to the syscall distance between one file read
and one rename call, which is the smallest this design can make it without a primitive the
filesystem does not offer. **This is not caught, and this working spec does not claim it is.**
Naming the one real gap, and making it as narrow as the mechanism allows, is the point of this
section — an "it never happens" claim would be exactly the kind of overclaim §2.6 warns against.

The other three windows are races between writers that never held the lock past their own check: a
thief that broke this writer's lock right after a successful write can claim it before the release
runs, and the release then deletes the thief's fresh lock rather than this writer's already-gone
one — but that thief's OWN pre-rename check runs the identical test against whatever the lock file
holds by the time IT reaches the rename, so this costs the thief a refusal, never a silent
overwrite; the stale-break itself is check-then-act, so between reading a lock's age and removing
it, the holder can release and a third writer can claim, and the breaker then deletes a fresh live
lock it never judged stale, and that third writer's own pre-rename check catches it the same way;
and an ordinary crashed holder's lock is broken and its (never-resumed) write simply never happens.

## Acceptance criteria

The record:

- (a) An absent `oauth.json` reads as `EMPTY_OAUTH` (`{version:1,clients:[],grants:[],tokens:[]}`)
  — a home with no connectors is not a damaged home. Verified by `test/server/oauth-file.test.ts`.
- (b) Every shape of damage refuses by name by throwing `OAuthFileUnreadable`, never by silently
  reading as empty: truncated, empty, not JSON, a JSON array, JSON null, wrong version, `clients`
  not an array, a client missing an id, a grant whose `actorSeed` is not 64 hex chars, a grant
  whose `actor` disagrees with `authorForSeed(actorSeed)`, a grant missing `standing`, a client
  missing or zero `generation`, a client name carrying a control character, `tokens` not an array,
  a token missing its `digest`, a token whose `digest` is not a 64-hex sha-256, and a token missing
  `clientId` or `issuedAt`. Verified by `test/server/oauth-file.test.ts` (a table of corruptions,
  one assertion per row, covering clients, grants AND tokens — not two of the three).
- (c) A client name, a redirect uri, or a client id carrying a control character, DEL, a C1 code,
  or a Unicode line/paragraph separator is refused on the way IN — a hand-edited or older-build
  file must not be able to forge a row in a future `grant list`. Verified by
  `test/server/oauth-file.test.ts`.
- (d) The write is temp-then-rename: the file's inode changes across two writes, and a 0644 file
  the write lands on ends at 0600 afterward (POSIX only — Windows reports 0666 regardless of the
  `chmod`, named as a gap in the test rather than asserted). Verified by
  `test/server/oauth-file.test.ts`.
- (d2) The temp file is created AT 0600 from birth (`openSync(temp, "wx", 0o600)`), never written
  world- or group-readable and fixed up after — the actor seed is in the body before the first
  byte lands, so a default-umask temp would expose it for the whole write-and-rename window, not
  merely until a later `chmod` runs. Verified by `grep -n 'openSync(temp, "wx", 0o600)'
  src/server/oauth-file.ts` finding the call, and by `test/server/oauth-file.test.ts` asserting a
  FIRST write (fresh path, no prior file to inherit a mode from) lands at 0600 (POSIX only).
- (e) No temp file is left behind after a write, across repeated writes. Verified by
  `test/server/oauth-file.test.ts` (`readdirSync` finds no `oauth.json.*.tmp`).
- (f) The write DOES call `fsync` on the temp file before the rename, and on the containing
  directory after it (POSIX; Windows refuses to fsync a directory handle and the write is still
  atomic there, only the crash-durability of the directory entry is weaker) — but no TEST asserts
  either fsync, and the test file says so rather than implying coverage it does not have: nothing
  observable from a test distinguishes a synced write from an unsynced one without a power cut,
  the same shape as phase 1's credentials.ts gap. Verified by
  `grep -n "does not assert.*fsync" test/server/oauth-file.test.ts` finding the line, and by
  `grep -n "fsyncSync" src/server/oauth-file.ts` finding both call sites.

The lock:

- (g) THE LOCK IS A HARD LINK FROM A TEMP THAT ALREADY HOLDS THE OWNER'S NAME, and reading that
  name back is what proves ownership everywhere below. Verified by `test/server/oauth-file.test.ts`
  ("a writer whose lock is STOLEN refuses"), which depends on the name being present the instant
  the lock exists.
- (h) Only `EEXIST` from the link call means contention. Every other errno (`EPERM`, `EXDEV`,
  `ENOSYS`, `EOPNOTSUPP` — FAT, exFAT, some SMB/FUSE mounts) throws `OAuthFileUnlockable`, named
  distinctly from `OAuthFileBusy`, so an operator is not sent to read a perfectly good file.
  Verified by `test/server/oauth-file.test.ts` (mocks `node:fs`'s `linkSync` per errno; `EEXIST` is
  asserted to land in the OTHER class, as the positive control).
- (i) A writer whose lock is visibly stolen (the lock file names someone else at the moment of the
  pre-rename check) refuses rather than writing — the check compares the lock file's bytes to the
  writer's own nonce and refuses on any mismatch, with no re-claim on that path, and it runs AFTER
  the temp file is written and fsynced, immediately before the rename (not before the fsync) — the
  narrowest placement this design has without a real compare-and-swap. Stated honestly, not as a
  total guarantee: this closes the ordinary theft (lock stolen, then observed stolen before the
  rename), and the working spec's "The lock" section names the one narrower gap this test cannot
  reach — a stall inside that syscall-scale gap itself, which no test can force without mocking the
  syscalls. Verified by `test/server/oauth-file.test.ts`'s "stolen lock" case, which puts a second
  claimant's name in the lock file mid-callback (after the fsync a real write would have already
  done) and asserts the first writer refuses rather than overwriting it, and by
  `grep -n "verifyOwnership()" src/server/oauth-file.ts` showing the call sits between the fsync
  and the rename inside `performAtomicWrite`.
- (j) A callback handed to `withOAuthFile` must be a pure function of the file it receives —
  stated in the function's own doc comment, where the fifth caller will read it. Verified by
  `grep -n "pure function" src/server/oauth-file.ts` finding the line.
- (k) The list of open check-then-act windows names exactly four (the check-before-rename, the
  release, the stale-break, and a crashed holder's own write never happening) — not fewer, not
  "handled." Verified by `grep -A20 "THE GUARANTEE IS ABOUT THE WRITE" src/server/oauth-file.ts |
  grep -c '^ \*   - '` finding exactly 4 bullet items in `withOAuthFile`'s doc comment.
- (l) The acquire loop is bounded on every path: a live lock waits and retries up to
  `LOCK_WAIT_MS` then throws `OAuthFileBusy`; a lock whose `statSync` throws (gone, or a dangling
  symlink) pauses rather than spins; a stale lock is broken and retried at once. Verified by
  `test/server/oauth-file.test.ts` ("a held lock blocks a second writer" and "a STALE lock is
  broken").
- (m) A REAL SECOND OS PROCESS contends for the lock: a child bundled with esbuild
  (`test/server/oauth-lock-child.mts`) is spawned on plain `node`, claims the lock, and busy-waits
  inside the callback for a fixed hold — proving genuine cross-process exclusion, since two
  synchronous callers on one thread can never interleave and would pass this rail whether or not
  anything actually locked. Verified by `test/server/oauth-file.test.ts` ("TWO PROCESSES
  contending").
- (n) One rail takes the lock SUCCESSFULLY and completes a write under it — a positive control,
  without which a `linkSync` mock that always throws would satisfy every rail in this file.
  Verified by `test/server/oauth-file.test.ts` ("a held lock blocks a second writer", the "same
  call succeeds" branch once the lock is cleared).
- (o) No timing floor is asserted on the cross-process rail: the assertion is that the parent's
  callback observed the child's row already written (an observation from inside the callback),
  never that the acquire took at least one poll interval — a stall spanning the child's whole hold
  would make that assertion unsound. Verified by `test/server/oauth-file.test.ts` ("TWO PROCESSES
  contending"), which asserts on content ordering, not elapsed time.
- (p) A refusal that already opened a resource releases it: when `claimLock` fails after opening
  its temp file (any errno, including a mocked `OAuthFileUnlockable` path), the temp is removed
  and no open handle survives the throw. Verified by `test/server/oauth-file.test.ts` ("writes
  nothing, and leaves no claim temp behind"). POSIX cannot observe a leaked handle directly, so the
  rail checks the visible residue (the temp file and the lock file); the test file names this as
  the Windows-relevant leg, since on Windows an open handle would make the home unremovable — a
  property this suite cannot exercise on a POSIX CI runner and does not claim to.
- (q) `writeOAuthFile` re-validates its argument with the same checks `readOAuthFile` runs, before
  it serializes anything — so a caller's bug that builds a structurally-typed but semantically
  invalid `OAuthFile` (a bad `actorSeed`, a control character smuggled into a name) is refused
  rather than persisted, since persisting it would make every later `readOAuthFile` throw forever
  with nothing left to repair it. Verified by `test/server/oauth-file.test.ts`, which hands
  `writeOAuthFile` an object failing each of (b)'s corruption shapes and asserts it throws
  `OAuthFileUnreadable` with the file on disk unchanged from before the call.
- (r) A duplicate `clientId` across `clients`, a duplicate `clientId` across `grants` (one grant
  per client), or a duplicate `digest` across `tokens` refuses on read AND on write, by the same
  shared check — a later phase's bug that appends rather than replaces must not silently corrupt
  the one-row-per-key shape every later phase assumes. Verified by `test/server/oauth-file.test.ts`
  (three corruption-table rows, one per collection, each exercised through both `readOAuthFile` and
  `writeOAuthFile`).
- (s) The temp file's body is written with `writeFileSync(fd, body)`, never the raw `writeSync`
  syscall binding — `writeSync` can return short of the whole string, and a short write here would
  fsync and rename a truncated JSON body over a good one with no way back. Verified by
  `grep -n "writeFileSync(fd, body)" src/server/oauth-file.ts` finding the call.
- (t) A throw during the temp's own open, write, or fsync leaves no temp file behind — before this,
  cleanup ran only around the later ownership-check and rename steps, so a fault in the write phase
  itself orphaned a temp holding a plaintext actor seed. Verified by `test/server/oauth-file.test.ts`
  ("a write that throws during its own fsync leaves no temp behind"), which mocks `fsyncSync` to
  throw once and asserts no `.tmp` file and no half-written `oauth.json` remain.
