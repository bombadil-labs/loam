## 3. Loam's actual scope — what to build

- **The GraphQL interface** — GraphQL derived from `HyperSchema` + `Schema`, exposing `query` /
  `mutate` / `subscribe` / `loadSchema` over rhizomatic's `resolveView` and reactor. rhizomatic gives
  the resolution primitives; GraphQL-as-the-surface is Loam's. (Chorus's read-only `gql.ts` is the
  design reference; Loam's is written clean: hyperschema-sourced, plus mutations.)
- **Durable / pluggable persistence** — rhizomatic is in-memory `DeltaSet` + `pack`/`unpack`. Loam
  adds the **async** `StoreBackend` seam + drivers (in-memory, sqlite, and a hosted one — Turso /
  libSQL is shaped right) + a store registry. Chorus's persistence tier is the reference (§10).
- **Accounts & capabilities** — users / ownership / capability-grants as schemas in the genesis set;
  the gateway authorizes a mutation iff a resolved grant permits it; an operator identity roots the
  first grants. Policy-as-data, enforcement-as-gateway-code.
- **The gateway transport** — MCP + HTTP serving the gateway (mounts, token auth). Chorus
  `mcp-http.ts` is the reference.
- **Deployment & runtime variety** — CLI, containerization, turnkey hosted persistence; and function
  **runtimes beyond in-process `DerivedFn`** (HTTP, VM, human) plus the runner's peer-client
  deployment (§6).
- **The genesis assembly** — bundle `HYPER_SCHEMA_SCHEMA` + accounts + names + function/trigger schemas
  into a shippable genesis every store is born from.

**Provenance.** Foundational scope framing — no single landing PR; each bullet is realized section-by-section across the build: persistence (step 2, [#3](https://github.com/bombadil-labs/loam/pull/3)), the read/write gateway (steps 3–4, [#4](https://github.com/bombadil-labs/loam/pull/4)/[#5](https://github.com/bombadil-labs/loam/pull/5)), accounts & capabilities (step 5, [#7](https://github.com/bombadil-labs/loam/pull/7)), the transport (step 6, [#8](https://github.com/bombadil-labs/loam/pull/8)), the runner & genesis assembly (step 7, [#9](https://github.com/bombadil-labs/loam/pull/9)), and CLI/deployment (step 8, [#10](https://github.com/bombadil-labs/loam/pull/10)). Full narrative in the [Journal](../JOURNAL.md).
