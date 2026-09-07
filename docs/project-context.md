# Loam: Architecture Context and Codex Handoff

**Prepared:** 2026-09-04  
**Purpose:** Give a fresh coding session the architectural context needed to continue the Loam work without importing an entire conversation transcript.

## How to use this file

This file lives at `docs/project-context.md`. In this repository the operating rules are `CLAUDE.md`, and current work lives in `.adlc/tickets/` and `.adlc/specs/`; read `AGENTS.md` and `PLAN.md` below as those two. The repository's current code, tests, ticket shards, and git history remain the source of truth for implementation state.

This document records the architectural direction reached in discussion. If the repository has advanced or contradicts this snapshot, the coding agent must identify the discrepancy before changing behavior.

Shadow Walker is a separate project and is not relevant to this handoff.

## Executive thesis

Loam should no longer be treated as one indefinitely expanding application repository.

The current system became a valuable requirements laboratory: it proved many difficult local invariants while the product and ontology were still being discovered. That success also produced a kitchen-sink architecture, accidental coupling, and infrastructure whose implementation strategy no longer fits the intended system.

The direction is **not** to greenfield or discard Loam. It is to extract the discovered machine incrementally:

1. Identify semantic and interface boundaries inside the existing system.
2. Extract one bounded Loam-owned library without initially changing behavior.
3. Refine it while the existing Loam application exercises it.
4. Specify only the proven universal semantics in a language-independent form.
5. Create conformance vectors and native implementations in every supported language.
6. Promote that stable abstraction into the `rhizomatic-*` standards family.
7. Replace the Loam incubator with the promoted TypeScript implementation.
8. Adopt the corresponding native implementation in Kyber.

In shorthand:

> Loam incubates mechanisms. Rhizomatic graduates semantics. Loam and Kyber compose the resulting libraries according to their native affordances.

## Current architectural diagnosis

The existing Loam repository appears to have accumulated several structural problems that must be verified against current code:

- SQLite is used largely as a persistence filesystem while Gateway reconstructs the effective database in memory.
- Gateway loads too much, potentially the entire delta set, into memory.
- Ambient root/operator assumptions leak through APIs and runtime behavior.
- One Gateway can implicitly stand for "the world."
- Materialization ownership is unclear or over-centralized.
- Subscriptions and historical reads may reconstruct subtly different worlds.
- Surface-specific concerns have migrated into Gateway.
- Feature work has continued on top of these accidental boundaries because individual behavior was being discovered and delivered.

These are reasons to replace particular implementation strategies, not reasons to throw away the behavioral knowledge encoded in the current system and tests.

## Container-as-ground: the current central discovery

The missing abstraction found independently in Loam and Kyber is a locally bounded ground of interpretation and authority.

The mistaken equation is:

> One delta set = one constitutional reality.

The corrective distinction is:

> A claim may be present and attributable without being operationally authoritative in this reading.

A container-as-ground lets the system distinguish:

- Claims present in a peer ground from claims that constitute local law.
- Shared storage from separate physical grounds.
- An inbox or channel ground from trusted memory or constitutional state.
- Portable rhizomatic claims from runtime-local operational state.
- An entity/author from the particular ground in which one of its running incarnations acts.

An agent is not itself a container. An agent is an author/entity. A running incarnation stands in a container-ground, may read from several grounds, and may write to different grounds according to capability and local law.

The eventual execution context may need concepts resembling:

```ts
interface ReadingContext {
  actor: Author
  home: ContainerRef
  readGrounds: GroundRef[]
  writeGround: GroundRef
  lawGround: GroundRef
  trust: TrustContext
  moment: Moment
}
```

This is illustrative, not a frozen interface. The important requirement is that actor, selected grounds, law, trust, time, and write destination are explicit rather than process-global or ambient.

Recent task identifiers discussed in this context were:

- **T263:** container semantics, expected to continue discovering the correct ground/context model.
- **T274:** removal of ambient authority / introduction of explicit context, expected to become an important kernel boundary.

The fresh coding session must inspect current `PLAN.md` and history before assuming either task remains current or incomplete.

## Ecosystem identities

### Rhizomatic

Rhizomatic is the language-independent standards family and the accessible path into rhizomatic engineering described by the manifesto.

Something earns a `rhizomatic-*` name only when the project is prepared to provide:

- A language-independent behavioral specification.
- Conformance vectors or black-box scenarios.
- Equivalent implementations in every currently supported target language.
- A clear statement of the appropriate conformance strength.

`rhizomatic-*` artifacts are always embeddable libraries, never applications. They may maintain state or run native processes, but they do not assume ownership of the application, global configuration, credentials, implicit filesystem locations, or deployment lifecycle.

Rhizomatic standardizes meanings, capabilities, observable effects, and refusals. It does not standardize internal topology, scheduling, cache shape, storage layout, or host-language idiom.

Useful conformance categories are:

1. **Wire conformance:** exact canonical bytes, hashes, signatures, or refusal decisions.
2. **Denotational conformance:** equivalent inputs yield the same abstract values, contests, diagnostics, and provenance.
3. **Behavioral conformance:** equivalent operation sequences permit the same externally observable transitions and outcomes.

Only atom-level concerns necessarily require byte identity. Higher layers usually require denotational or behavioral equivalence.

### Loam

Loam is the production TypeScript database/reference ecology in which Rhizomatic abstractions are discovered, exercised, optimized, and composed.

Loam may eventually become a composition of `rhizomatic-*` libraries plus the affordances that remain specifically Loam:

- Indexed durable grounds.
- SQLite storage, transactions, and query planning.
- Explicit reading-context construction.
- Container-ground topology.
- Constitutional standing and adoption.
- Lifecycle and physical erasure.
- Production subscriptions.
- Reference server and integration composition.

Some of those semantics may later graduate. Graduation is evidence-driven; do not pre-name or universalize them before Loam and another serious consumer prove the shared invariant.

### Kyber

Kyber is an Elixir/OTP agent runtime and an independent consumer/evolutionary pressure on Rhizomatic.

Kyber may implement a shared container or reactor specification using native OTP affordances such as one GenServer per container, DynamicSupervisors, ETS, message passing, monitors, and links. It should not be forced to imitate TypeScript internals.

If an abstraction works naturally in both Loam's database ecology and Kyber's agent runtime, that is strong evidence that its observable semantics deserve Rhizomatic promotion.

## Package and repository rule

Define package boundaries before creating repository boundaries.

A git repository is a release and ownership boundary. Splitting today's modules directly into many repositories would freeze accidental coupling and turn ordinary refactors into coordinated multi-repository changes.

The useful standard is not a hard 4,000-line constitutional limit. It is:

> One repository has one sentence describing its authority, one public contract, and no need to reach through another component's internals.

Approximately 4,000 source lines remains a useful comprehensibility smell threshold, especially for coding agents, but cohesion and independent evolution matter more than line count.

## First extraction candidate: schemas

The first likely incubation/promotion path is:

```text
Loam internals
  -> loam-schemas
  -> language-neutral schema specification + vectors
  -> rhizomatic-schemas
  -> TypeScript adoption in Loam
  -> Elixir adoption in Kyber
  -> retirement of loam-schemas
```

The working semantic cluster is **HyperSchema, Schema, and HyperView**.

A clean schema library may know about:

- Schema declarations and compilation.
- Schema composition and dependency resolution.
- Pure validation.
- Materialization of selected claims.
- Contests, failures, diagnostics, and provenance.
- Canonical outputs where interoperability specifically requires them.

It must not decide which world is authoritative. Something upstream supplies the selected claims or effective reading.

It should not know about:

- Gateway.
- SQLite or other storage.
- Containers, channels, or ground selection.
- Operator/root authority.
- Registration standing or constitutional adoption.
- HTTP, GraphQL, MCP, or renderer surfaces.

Conceptually:

```ts
compileSchema(selectedClaims, options)
  -> compiledSchema | diagnostics

materialize(compiledSchema, selectedClaims)
  -> values + provenance + contests
```

These signatures are illustrative. The boundary test is stronger:

> Could an Elixir or Rust implementer build the behavior from the eventual specification and vectors without reading Loam?

During incubation, extraction should initially preserve current Loam behavior. Refinement comes after parity is established. Promotion ends the incubator; `loam-schemas` should not become a permanent parallel dialect.

## Reactor candidate

After or alongside schema extraction, a storage- and container-agnostic reactor can incubate inside Loam.

Its extensional law is a candidate for eventual Rhizomatic graduation:

```text
reactor.reconcile(change); reactor.read(program)
==
pureEval(program, currentEffectiveSet)
```

An input removal means a claim has left this selected reading; it does not imply deletion from an underlying append-only ground.

Potential effective-set changes include:

```ts
type InputChange =
  | { kind: "add"; delta: Delta }
  | { kind: "remove"; id: DeltaId }
  | { kind: "reset"; deltas: AsyncIterable<Delta> }
```

The reactor must not recreate the current all-in-memory problem behind a cleaner interface. It likely needs a demand/selector protocol so an installed term can request candidate data and a SQLite implementation can push selection into indexes.

The universal semantics may graduate into `rhizomatic-reactor`; the TypeScript scheduling, dependency tracking, caches, query planning, and incremental machinery may remain Loam-specific.

Containers do not belong inside the pure reactor. A container/world layer constructs an effective `DeltaSource` or reading from physical grounds, law, trust, membership, exclusions, and time.

## Storage direction

Do not begin by designing a universal storage adapter. First define the semantic `Ground`/reading boundary, then build one excellent SQLite implementation against the real workload.

SQLite should perform database work:

- Store canonical delta bytes once, keyed by content identity.
- Index author, pointer role, target, context, ground, and arrival information.
- Maintain negation and provenance indexes.
- Commit delta persistence and required index updates before publishing visibility.
- Use WAL, cursors, and streaming reads.
- Push candidate selection into SQL before Rhizomatic evaluation.
- Maintain incremental derived state/materializations that can be discarded and replayed.
- Keep only bounded hot caches in memory, never an authoritative full copy of the world.

The exact schema must be derived from current query workloads and invariants, not from this summary.

## Preserve versus rewrite

### Preserve or port behavior

- Rhizomatic atom semantics and conformance vectors.
- Container trust/storage distinctions already proven correct.
- Constitutional projectors and their behavioral tests.
- Persistence-before-visibility.
- Erasure receipts and fail-closed lifecycle behavior.
- Federation custody accounting.
- Renderer confinement.
- The distinction among possession, blessing, execution, exposure, and write standing.
- Schema/lens semantics whose behavior is already sound.
- Existing tests as an executable oracle where they encode intentional behavior.

### Likely rewrite or substantially reshape

- Persistence/indexing that treats SQLite as a filesystem.
- Gateway context construction and full-set loading.
- Ambient root/operator APIs.
- Materialization ownership.
- Subscription and historical-read paths that reconstruct different worlds.
- Surface-specific logic embedded in Gateway.

The current implementation should remain available as a compatibility/reference oracle while extracted components grow. Differences must be intentional improvements or identified defects, not incidental drift.

## Recommended migration sequence

This order is provisional and must be reconciled with the live repository:

1. Inspect and, if still active, finish T263 because it is discovering the semantics every later boundary depends on.
2. Treat T274's explicit-context work as a candidate first kernel contract.
3. Freeze broad feature expansion long enough to perform a component census:
   - Semantic core.
   - Storage implementation.
   - Constitutional extension.
   - Surface adapter.
   - Reference-server composition.
   - Legacy compatibility.
   - Experimental feature.
4. Extract `loam-schemas` behaviorally, using current tests as parity checks.
5. Refine the schema boundary until it has no Gateway, storage, container, authority, or transport dependency.
6. Write the language-neutral schema specification and adversarial conformance vectors.
7. Promote to `rhizomatic-schemas`, implement natively in supported languages, adopt in Loam and Kyber, then retire `loam-schemas`.
8. Incubate the reactor in Loam with pure-evaluation equivalence and indexed demand as explicit laws.
9. Pressure-test equivalent reactor semantics in Kyber before Rhizomatic promotion.
10. Create independent repositories only after their contracts and release boundaries survive real implementation.

A broader Loam engine extraction can be proven through one thin vertical slice:

- Open two physical grounds.
- Append verified deltas transactionally.
- Construct an explicit reading spanning them.
- Resolve both a shared container and a separate-ground container.
- Subscribe without loading the complete delta set.
- Restart and derive the same reading.
- Physically drop the separate ground with correct lifecycle behavior.

An adapter such as MCP can later serve as a stress test: if it must reach into raw SQLite, Gateway internals, or ambient operator state, the engine contract is incomplete.

## Working discipline for the new agent

- Read `AGENTS.md`, `PLAN.md`, architecture notes, contributor guidance, and relevant tests before editing.
- Inspect recent history and current branches; do not assume this 2026-09-04 snapshot is current.
- Preserve in-flight work and unrelated changes, including work Fable may have completed after this discussion.
- Lead architectural claims with code/test evidence.
- Distinguish existing behavior, intended semantics, proposed refactors, and universal candidates.
- Do not call something `rhizomatic-*` before the specification, vectors, and all supported implementations exist.
- Do not force different languages into the same internal architecture.
- Prefer one bounded vertical slice with parity tests over broad scaffolding.
- Do not greenfield Loam or split repositories before proving package seams.
- Do not expose, log, or commit credentials.
- End each task with exact tests run, changed files, decisions made, discovered contradictions, and the next bounded step.

## Kickoff prompt for a fresh Codex session

> Work on the selected Loam repository. Read `docs/PROJECT_CONTEXT.md` in full, then read the repository's `AGENTS.md`, `PLAN.md`, architecture guidance, relevant task records, tests, and recent git history. This context file records architectural intent as of 2026-09-04; the live repository is authoritative for current state. Do not greenfield Loam and do not begin by splitting repositories. First report the current status of T263 and T274, reconcile any work completed since this document, and map the code into semantic core, storage implementation, constitutional extension, surface adapters, reference composition, compatibility, and experiments. Then identify the smallest safe extraction seam for HyperSchema/Schema/HyperView into a Loam-owned `loam-schemas` library that preserves current behavior and does not depend on Gateway, storage, containers, authority, or transports. Run the current tests before editing. If the seam and next change are unambiguous, implement the smallest parity-tested slice; otherwise stop with one concrete boundary proposal, evidence from the code, and the single decision needed from the user. Preserve all unrelated and in-flight changes.

## Durable context after the handoff

Do not rely on one long-running chat as project memory.

- Stable doctrine and boundaries belong in this file.
- Setup and public usage belong in `README.md`.
- Agent-specific operating rules belong in `AGENTS.md`.
- Consequential architectural decisions belong in short ADRs.
- Current work belongs in `PLAN.md`, task records, or issues.
- Behavioral promises belong in executable tests and conformance vectors.

That structure lets future sessions reconstruct the project from the repository without carrying the entire exploratory conversation.
