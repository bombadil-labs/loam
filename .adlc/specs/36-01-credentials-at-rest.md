# §36 phase 1/15 — Credentials at rest

**Ticket.** T122. **Scope.** `src/server/credentials.ts`, `test/server/credentials.test.ts`.

## What this delivers

A credential file, `credentials.json`, held in the Loam STORE's home directory — the `<home>` a
caller passes to `loam serve --home <dir>`, never the operating system user's home directory — beside
`operator.seed`. The root object carries a
`version` number (currently `1`) and a `users` object keyed by username. Each user's value is one
entry: a `kind` tag (currently only `"scrypt"`), a hex salt, a hex hash, and the scrypt parameters
`{N, r, p, keylen}` that entry was created with. The file writes atomically. It lands at mode 0600.
This phase adds no door and no CLI command — the credential primitive is a library, and nothing
reads it yet.

The temp file is created inside the same `<home>` directory as the target, never in the OS temp
directory — a rename across filesystems is not atomic and can fail with `EXDEV`, and same-directory
placement is what makes the rename atomic at all. Its name carries the process id and a random
suffix, never a fixed name, and it is opened exclusively (fails rather than truncates if that exact
name already exists) — so two writers racing each other corrupt neither the other's temp file nor
each other's rename target; each independently produces a well-formed file, and only the LAST rename
to land determines the final content (§ "No cross-process write lock" states that outcome, and this
is what keeps it a lost update rather than a corrupted file). The write opens its temp file at mode
0600 from the moment of creation, never by a later `chmod` — so no window exists where the temp file
is readable at the process umask. The write calls `fsync` on the temp file, then closes that file
descriptor, and only then renames it into place — an open descriptor held across the rename fails on
Windows, so the close must come first. After the rename, the write calls `fsync` on the directory, on
platforms that support a directory fsync. Reading treats `ENOENT` alone as an empty file (no users,
no fault) — a fresh home
has not yet failed at anything. Every other read error (permission denied, too many open files, and
so on) throws `CredentialsUnreadable` rather than being folded into "empty," because a real fault
must not be mistaken for a fresh install. The scrypt parameters a reader accepts are bounded, not
read as free-form numbers: `N` must be a power of two no smaller than 2 (scrypt itself rejects
`N = 1`, so a reader that admitted it would hand a crash to the derivation instead of a refusal to
the reader), `r` and `p` must be positive integers no larger than 16, `keylen` between 16 and 128
bytes, the pair `(N, r)` is bounded together so the memory a derivation may claim never exceeds 64
MiB (`128 * N * r`), and the triple `(N, r, p)` is bounded together so the CPU work a derivation may
claim — proportional to `N * r * p` — never exceeds 8 times the shipped default's own cost (`8 *
16384 * 8 * 1 = 1,048,576`). A large `p` alone cannot buy CPU time back that the memory bound denied
it: `N * r` within the memory bound and `p` within its own cap can still multiply past the CPU
bound, so the two are checked separately rather than assuming one implies the other. An entry
outside these bounds is damage, refused the same as a missing field, so a corrupted or hostile
parameter set cannot force an oversized scrypt call. A salt shorter than 8 bytes (16 hex characters)
is damage too, refused the same way — `hashPassword` always mints a 16-byte salt, so anything
shorter can only have arrived through damage or tampering, and admitting it would derive against too
little entropy to matter. A stored hash whose length disagrees with its own entry's `keylen` is
damage too, checked at read time — so two buffers of mismatched length are never handed to a
constant-time compare, which throws rather than compares on a length mismatch.

**Reading copies parsed entries into a `users` object built with no prototype**
(`Object.create(null)`) — `JSON.parse`'s own result inherits from `Object.prototype` like any plain
object, so a lookup for a username spelled `toString` or `constructor` against the parsed object
directly would resolve to a built-in method rather than to "no such user." Copying into a
null-prototype object before any lookup is what makes such a username an ordinary, absent key
instead.

**Usernames are opaque, case-sensitive JSON keys in this phase.** No normalization or collision rule
(`"admin"` vs `"Admin"`) applies here — the credential file is a keyed store, not an identity system.
Whether two spellings name the same user, and any safety rule over the name's characters, is phase
2's concern (`.adlc/specs/users-oauth-phasing-plan.md`, phase 2 criterion 9): "a user name is safe in
an entity id, a JSON key and an HTML page." This phase's writer always receives the username a caller
already chose; it neither invents nor rejects one.

## Must not

This phase must not add a door. This phase must not add a CLI command.

## Acceptance criteria

1. The salt reaches the derivation. Two hashes of the same password differ from each other. A hash
   verifies against its own salt and does not verify when crossed with a different salt.
   Verified by `test/server/credentials.test.ts`.
2. The stored hash bytes equal an independent `scryptSync` call over that entry's own salt and
   parameters, computed outside the function under test. Verified by `test/server/credentials.test.ts`.
3. An entry records the scrypt parameters it was created with. The test pins the expected parameters
   as a hand-written literal, never by reading the file's own answer back.
   Verified by `test/server/credentials.test.ts`.
4. Every shape of damage to `credentials.json` refuses, by name, rather than allowing a login: a
   truncated file, a file that is not JSON, an empty file, a file with the wrong version number, an
   entry with an empty hash, an entry with an empty salt, an entry with a non-hex hash, an entry with
   a non-hex salt, an entry whose hash length does not match its own `keylen`, an entry with no
   parameters, and an entry of an unknown kind. In every case, "cannot determine" never resolves to
   "matched" — the reading function throws `CredentialsUnreadable`, never returns a false match. One
   damaged entry fails the read for every user in the file: the ticket's own wording is "a damaged
   neighbour means the file's shape is unknown, and an unknown shape is not a shape to authenticate
   against," so a reader that quietly dropped the damaged entry and kept serving the rest would
   silently authenticate against a file it could not fully verify (SUBSTRATE-HAZARDS H9).
   Verified by `test/server/credentials.test.ts`.
5. Writing the file is temp-then-rename. The file's inode changes across a write, proving the write
   went through a rename rather than an in-place truncate. No temp file of the writer's own making is
   left behind afterward. A stale temp file left by a crashed writer does not poison a later write.
   Verified by `test/server/credentials.test.ts`.
6. The file lands at mode 0600 after a write, even when the path already existed at mode 0644 before
   the write. Verified by `test/server/credentials.test.ts`.
7. The mode assertion (criterion 6) runs on POSIX only and is skipped on Windows, because Windows
   reports 0666 for an ordinary file regardless of what `chmod` requested. The test file states, in a
   comment, that a Windows run proves nothing about who may read a credential.
   Verified by `test/server/credentials.test.ts`.
8. `fsync` is asserted by nothing in this test file, because an ESM named import of `node:fs` offers
   no spy point to intercept the call. The test file names this gap in a comment rather than hiding
   it behind an assertion that cannot fail. Verified by `test/server/credentials.test.ts`.
9. A store with no `credentials.json` yet (an `ENOENT` read) reads as an empty file — no users, no
   fault. A file that exists and cannot be parsed still refuses, and a read error other than
   `ENOENT` refuses too, rather than being treated as an empty store.
   Verified by `test/server/credentials.test.ts`.

## Out of scope

No door reads a credential in this phase. No CLI command writes one. Both arrive in later phases of
the plan (`.adlc/specs/users-oauth-phasing-plan.md`, phase 3 and phase 5).

**No cross-process write lock.** `writeCredentials` takes the caller's full desired file state and
writes it atomically — one write cannot tear or truncate the file. It does not itself serialize two
independent callers who each read, modify, and write without knowing about each other; a second
writer's rename can still land after a first writer's, discarding the first writer's change. This
phase ships no CLI command and no door, so no such second caller exists yet. Phase 3's `create` and
role commands are the first callers of this file, one CLI invocation at a time. Serializing
concurrent callers is a real requirement once two callers can run at once, and it belongs to
whichever phase introduces the second caller — most likely phase 3, by the same hard-link-lock
pattern phase 11 specifies for `oauth.json` — rather than to this library primitive, which has no
caller to serialize yet.
