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
plan's fifteen). Landed [PR pending] — `src/server/oauth.ts` (new), plus the `--public-url` flag
threaded through `src/server/http.ts` and `src/cli/cli.ts`. No client registers, no code or token
is minted; a connector can find the store and nothing more.
