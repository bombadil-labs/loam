# §56 — Whoami: a caller may ask who the door thinks they are

Under `mask: drop`, an anonymous reader and an empty store are indistinguishable from
outside: a masked read folds to an empty view, and a well-designed client renders it as a
welcoming empty state — confidently wrong. A production connector paid exactly that bug. The
answer is standing introspection: any caller may ask who this door resolves them to be and
what the ground currently grants them, in one request.

## 56.1 The two forms, one truth

`loam_whoami` sits on the MCP roster beside `loam_docs`, and `GET /:mount/whoami` answers the
same JSON for non-MCP clients. Both resolve THIS request's identity — the same ladder every
door uses — and read standing from the GROUND per request, so a revocation binds on the very
next call with nothing to invalidate. The tool's description teaches when to ask: call it
FIRST when a view answers empty.

## 56.2 The four kinds

- **operator** — the configured operator token: unfenced, its author named.
- **connector** — a bearer the OAuth exchange minted: the answer names the client id and the
  connector's own PUBLIC author (never a seed), plus its surviving grants.
- **actor** — a configured bearer acting as a key: the key, and exactly its granted standing —
  write, register prefixes, federate containers.
- **anonymous** — no credential: `masked: true`, and the sentence the whole section exists
  for, in words — *reads on this door are masked; views fold empty for this caller; an empty
  answer here is not an empty store.*

## 56.3 The anonymous answer is uniform, deliberately

The anonymous reply names no store fact and is served before any mount fact is consulted —
identical bytes for every path, real mount or not. Answering only where a public surface
exists would mint the mount-existence oracle the uniform refusals below it exist to prevent.
The operator and actor answers disclose only the caller's OWN standing — facts the caller
could establish by exercising them.

**Provenance.** PR #511 (T255); asked for by the medialog spec (2026-08-29), written
by the connector that hit the masked-empty trap in production. Implementation: `whoamiFor` and
the two doors in `src/server/http.ts`, `describe` on the token exchange in
`src/server/oauth.ts`.
