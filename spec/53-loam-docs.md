## 53. The store hands the agent its own manual

A cold MCP agent's entire documentation is the introspected surface plus the tool descriptions —
and a registration grammar cannot ride a description. `loam_docs` is the read-only tool that
serves the manual: no arguments lists the topics, a topic returns the markdown, an unknown topic
refuses by naming what exists. The content compiles into the package from `docs/*.md` at build
time — a `--check` step fails any build whose docs were edited without regeneration — so the
served manual is always the deployed build's own, with no artifact to drift.

The teaching arrives at the moment of need: the register door wraps exactly the `unknown term op`
family of parse refusals with the pointer — `call loam_docs(topic: "register-grammar")` — and no
other refusal carries it, so a fence or standing refusal still reads as itself. The same topics
ride MCP resources from the same compiled source, the `initialize` instructions name the tool,
and an anti-drift rail probes the served doc against the live parser in both directions: a
phantom op in the doc reddens, and so does a real op the doc omits.

**Provenance.** Designed in chat with Myk (2026-08-26/27); realized by T247 (PR #484, stacked on
the declarations PR #483, which restored the frozen discover rail's designed evolution order
after the build lane edited ahead of authorization — disclosed there). Implementation:
`src/server/http.ts` (the tool, resources, the wrapped refusal), `scripts/build-docs.mjs`,
`docs/register-grammar.md` → `src/server/docs-content.ts`. The rails are
`test/server/loam-docs.test.ts` and `test/cli/pack-docs.test.ts`.
