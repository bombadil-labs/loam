# §53 — loam_docs (working spec, T247)

The store hands a connected agent its own manual, at the moment of refusal. Tool descriptions
teach the shape of a call; the grammar of a registration cannot ride them. A read-only tool
serves compiled-in documentation that versions with the deployed code, the term-parse refusal
points at it, and the same topics ride MCP resources for clients that surface those.

## User stories

- A cold agent calls `loam_register` with a guessed op, reads `unknown term op "latest" — call
  loam_docs(topic: "register-grammar")`, makes that one call, and its next registration parses.
- Myk upgrades the store; the served grammar is the new build's grammar, with no hand-updated
  artifact to drift.

## Mechanism

`loam_docs` (read-only, `annotations.readOnlyHint: true`): no args → the topic list, each with a
one-line summary; `{ topic }` → the full markdown; an unknown topic refuses by listing the topics.
Content compiles into the package from `docs/*.md` at build time. Seed topic `register-grammar`
(the field guide, §refs section included; the operational bounce note is dropped — T243 made the
CLI say it). The register door wraps rhizomatic's term-parse error with the pointer (Loam-side
wrap; rhizomatic untouched). The `initialize` instructions gain one sentence naming the tool. The
same topics are advertised as MCP resources (`resources/list` + `resources/read`) from the same
compiled source.

## Acceptance criteria

- (a) `tools/list` serves `loam_docs` with `readOnlyHint: true`; calling it with no args lists
  `register-grammar` with a summary; with the topic it returns markdown containing `"op":
  "select"`; an unknown topic refuses and names the topics. Verify:
  `test/server/loam-docs.test.ts`.
- (b) The register door's refusal for a body with an unknown term op contains both the parser's
  own words and `loam_docs(topic: "register-grammar")`; a body that fails for a DIFFERENT reason
  (fence, absent prop) does NOT carry the pointer (two-sided). Verify:
  `test/server/loam-docs.test.ts`.
- (c) ANTI-DRIFT, both directions: every op named in the served doc's §3 list parses as a term op
  (accepted, or refused for a non-`unknown term op` reason), and every op the parser accepts in
  that family appears in the served doc. A phantom op or an omitted op goes red. Verify:
  `test/server/loam-docs.test.ts`.
- (d) `initialize` capabilities advertise `resources`; `resources/list` names the topic and
  `resources/read` returns the same bytes `loam_docs` serves. Verify:
  `test/server/loam-docs.test.ts`.
- (e) The instructions string in `server/discover` (and `initialize` where served) names
  `loam_docs`. Verify: `test/server/loam-docs.test.ts`.
- (f) The anonymous door is unchanged: `loam_docs` refuses without a bearer exactly as its
  siblings do. Verify: `test/server/loam-docs.test.ts`.

## Provenance (working)
Myk's design conversation and front-of-line order, 2026-08-26/27. Ticket T247.
