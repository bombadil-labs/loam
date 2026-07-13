## 10. Reference inventory — what to learn from Chorus

Roughly half of Loam's _plumbing_ has a shipped, tested ancestor in
[chorus](https://github.com/bombadil-labs/chorus)'s `src/`. **Decided (2026-07-09): chorus is
reference-only** — read it as a design guide (its seams, its edge cases, its lessons), but write
Loam's code clean, against Loam's tests; no EAV residue rides in. The reference map: the
**persistence tier** (`store-tier` / `sqlite-core` / drivers / content-sniffing — Loam's is async
from birth), the **store registry** (`stores.ts`, incl. `adopt`), the **GraphQL lifecycle** (`gql.ts`
— Loam's is hyperschema-sourced, plus mutations), the **MCP/HTTP transport** (`mcp-http.ts`), the
**CLI scaffolding** (`cli*.ts`, `config.ts`), and the **resolution-policy set** (`policies.ts`).
Design-pattern references (they carry the EAV model): `agent.ts` (`beliefPointers`), `decisions.ts`
(the pin-and-replay pattern), and the belief instruments/messages/briefing/librarian. The genuinely
new code is the hyperschema-sourced GraphQL, accounts-as-schema, and the runner's runtime variety
and deployment.

**Provenance.** Foundational / reference-only — no landing PR. Decided (Myk, 2026-07-09): [chorus](https://github.com/bombadil-labs/chorus) is read as a design guide only — its seams, its edge cases, its lessons — never as a dependency or a source of copied code; Loam's plumbing is written clean, against Loam's own tests, and no EAV residue rides in. This section is a map for future readers, not a build record.
