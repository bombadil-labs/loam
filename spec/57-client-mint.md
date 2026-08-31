# §57 — Client mint: a key, its grants, and a bearer in one motion

A script, a bot, or another agent that writes to a store as itself needs three things an
interactive login never mints: a signing key of its own, standing for that key, and a bearer
that opens doors without a browser. Before this section they were three hand-held steps
(generate a seed, `loam grant`, edit a token table, restart). `loam client mint <name>` is the
one motion, and `loam client revoke <name>` is its inverse.

## 57.1 What a mint makes

The seed is written to `client.<name>.seed` (0600, the `user.<name>.seed` convention) and
never printed. The grants are appended to the ground: `write` always, `register` fenced to
each `--register-prefix` namespace, `federate` scoped to each `--federate` container. The
bearer is printed ONCE; only its sha-256 digest is recorded, in `clients.json` beside the
record's name and public author. The door resolves the bearer to `{ actor }` — a minted
client can never answer as an operator.

## 57.2 Write standing is store-wide, and the mint says so

Pointing is free, entity ids are unowned, and no door prefix fences a write. A minted client's
fences are ATTRIBUTION — every delta it appends names its own author — and each reader's trust
mask. The mint's printed warning states exactly that rather than pretending a write fence the
door does not hold; only `register` and `federate` carry scopes, because those verbs reach the
store's shared surfaces.

## 57.3 Freshness is split, honestly

The TOKEN binds per request: the door reads `clients.json` on an unknown-token miss (the one
file the identify ladder ever opens, and it refuses rather than guesses when the file is
unreadable), so a mint authenticates and a revoke stops authenticating on the very next
request, no restart. The GRANTS live in a serving reactor from boot: a mint or revoke beside a
live server moves standing only at restart, and both commands print the split in words.
Revoke strikes first and retires the record second — the strike is idempotent over the
surviving set, so a failure between the two leaves a rerunnable revoke — and a sibling
client's key, record, and standing survive untouched.

**Provenance.** PR #513 (T256); the last gap the medialog federated demo named (2026-08-29).
Implementation: `cmdClient` in `src/cli/cli.ts`, `src/server/clients-file.ts`, and the
`resolveClientBearer` rung of identify in `src/server/http.ts`.
