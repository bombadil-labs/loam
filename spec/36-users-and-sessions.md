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
