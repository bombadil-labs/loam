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

**Provenance.** [PR TBD] — `src/cli/cli.ts`, `src/cli/prompt.ts`, `src/cli/config.ts`,
`src/cli/args.ts` (the T117 parser fix — a boolean flag given a value now refuses rather than
reading as absent), proved by `test/cli/user-roles.test.ts`, `test/server/operator-keys.test.ts`, and
`test/cli/prompt.test.ts`. Working spec:
`.adlc/specs/36-03-the-bootstrap-the-role-commands-and-per-operator-keys.md`. Ticket T124.
