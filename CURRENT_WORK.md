# Current work — Step 6: Gateway transport

_The live checklist for the step in progress: its success criteria, the sub-tasks (checked as they complete), and a "left off here" note so any model can resume mid-step. Replaced at the start of each step; cleared when a step merges._

**The design:**

- One `node:http` server, no framework: `serve({ mounts, tokens, port, host })` where `mounts`
  maps names to `Gateway`s and `tokens` maps bearer tokens to identities (`{ actor: seed }` or
  `{ operator: true }` — explicit, never a default). Token comparison is timing-safe.
- **HTTP**: `POST /:mount/graphql` (query + mutate, actor from the token);
  `GET /:mount/subscribe?query=…` (SSE: one `data:` event per subscription payload; client
  disconnect returns the iterator). Junk or missing token → 401; unknown mount → 404.
- **MCP**: `POST /:mount/mcp` — minimal streamable-HTTP JSON-RPC (`initialize`, `tools/list`,
  `tools/call`) exposing `loam_query` and `loam_mutate`, chorus `mcp-http.ts` as the reference.
- The actor-per-request seam from step 5 is what tokens map onto — transport adds no new
  authority concepts, only authentication.

**Success criteria (from CLAUDE.md):** a real HTTP client runs query/mutate/subscribe end-to-end
with a bearer token; a real MCP client (JSON-RPC over HTTP) runs query/mutate; a junk token is
rejected; multi-store mounts isolate; `npm run check` green.

**Sub-tasks:**

- [ ] `test/server/http.test.ts` — tests first, real `fetch` against a listening server:
      auth (valid/junk/missing), query, authorized + denied mutations, SSE subscribe
      (initial + patch), mount isolation + unknown mount, MCP handshake/list/call
- [ ] `src/server/http.ts` — the server
- [ ] Exports; gate green → PR → one review agent → resolve → merge → journal

**Left off here:** plan written; next: tests.
