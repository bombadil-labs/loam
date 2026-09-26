# The refactor: rhizomatic vNext, with Loam as its testbed

Read this file first. The measurements behind it are in `journal/2026-09-25-loam-is-the-testbed.md`.
That entry predates the rulings of 2026-09-25 afternoon. Where the two conflict, this file wins.

Loam is the testbed for rhizomatic. Models proven in Loam move into rhizomatic, and rhizomatic
itself gets a new version of its algorithm. Rhizomatic becomes a monorepo of tier libraries.

## Who owns what

- **Sol (GPT-6-Sol) owns the `rhizomatic` repo**: spec, vectors, and the TypeScript, Rust, Elixir
  and Haskell witnesses. Sol publishes rhizomatic releases and prereleases.
- **Claude owns the `loam` repo.** Claude never edits rhizomatic. Sol never edits Loam.
- **Myk decides** every change to what the system promises.
- Durable requests to Sol go as GitHub issues on `bombadil-labs/rhizomatic`. Conversation goes
  through the T3 thread "Coordinate Loam Refactor Workflow" in the rhizomatic project.
- Before a Loam PR that needs new rhizomatic code, ask Sol for a prerelease. Loam pins it, so CI
  resolves it.
- `bombadil-labs/kyber-ng` is an Elixir app. It will consume the Elixir witness later, as Loam
  consumes the TypeScript one.

## Rulings (Myk, 2026-09-25, in chat)

Process:

- **ADLC is suspended for the refactor, in Loam and in rhizomatic.** Ignore its gates, the rail
  freeze, the gate ledger and the ticket ceremony. Frozen tests may change. Leave `.adlc/` in the
  tree, untouched. Rhizomatic keeps its spec, shared vectors, witness parity and green gates.
- **The CI job `rails-guard` enforces the rail freeze.** Remove it from
  `.github/workflows/ci.yml` in the first change that edits a frozen test. Cite this ruling.
- **Greenfield.** No production data exists. Backward compatibility is not required. Wire changes
  ship no migration.
- **Hermetic is a check, not a codemod.** Do not lift the codebase automatically.
- **Hermetic is not ready yet** (Myk, 2026-09-25). It is under active development. Do not depend on
  it; ask Myk before you use it. Meanwhile, write functions to be hermetic-friendly: pure, with
  explicit inputs, and with no clock, randomness, environment, files or network. The census tools
  use it only to measure.
- **Cadence:** probably one tier at a time. Be pragmatic.

Design:

1. **Rhizomatic becomes a monorepo of tier libraries**, each depending only on tiers below it, with
   one barrel package over them. The current layers (L0 to L7) are a template, not a cage.
2. **Naming by owner.** Libraries are named `rhizomatic-*`. A `rhizomatic.*` vocabulary means a
   rhizomatic spec and its vectors fix the meaning. `loam.*` means only Loam gives it meaning. A
   vocabulary gets its new prefix when it graduates.
3. **A Loam container is a peer.** A peer is a bounded delta set with an admission rule, an offered
   lens, a governing key pair and arrival records. Nesting, the root container and tenants are
   Loam's. A local and a remote peer differ only in the transport binding.
4. **"Operator" is a Loam role, like sudo.** The user of the root container holds it. It may reach
   into child containers. That must be possible, and rare, and visible to the child's owner.
5. **Three times.** (a) when the author created the delta; (b) from when the claim holds; (c) when
   the delta arrived in the peer it is read from. (a) and (b) are signed and inside the content
   address. (c) is testimony by the receiving peer, outside the delta. A delta may also carry its
   own expiry; then every read takes `now` as an explicit input.
6. **Identity is resolvable, optionally and by grade.** A key is unique already; the gap is key to
   "who". A root identity is self-certifying and may be unreachable. Registries are optional, and
   hold locator claims that the identity signs. A delta without a resolvable chain is weaker
   evidence, not an error. Principal identity is probably its own tier.
7. **Forgetting is graded testimony.** A peer publishes which degrees of forgetting it honors. A
   receipt is testimony: it can be proven false, never true. The public promise: this instance
   forgets provably, it tells its peers, and it cannot make a peer forget unless the data was
   sealed before it left.
8. **Resolvers become a rhizomatic library.**

## Rulings (Myk, 2026-09-26, in chat)

1. **An expired negation of a grant revives it.** Write standing reads a negation only inside its
   own window, [validFrom, validUntil), at the read time. A grant also counts only inside its own
   window. The door, the revoke panel and the grant ledger read the same way.
2. **Succession records continuity only.** It does not confer authority. Authority comes from a
   separate delegation.
3. **The pinned principal root must authorize a succession.** The old key's signature is optional
   evidence.
4. **A revoked key's earlier acts are judged at the present, until step 6.** Step 6 brings arrival
   testimony. Until then, revoking a key's authority removes the effect of its earlier acts.

## What stays in force

- `npm run check` is the green bar: format, lint, typecheck, build and every test. Read the counts.
- Every erasure test proves two things: the target is gone, and a named bystander survives. Never
  erase data outside a test's own temp dir.
- Text for Myk uses STE style: commit messages, PR bodies and journal entries. One idea per
  sentence, and 20 words or fewer.
- Comments explain the code, and they stay short. History goes in the commit message or the
  journal. No ticket ids in comments.
- Keep each change readable. A change that Myk must review carries a few hundred lines of
  decisions at most; mechanical bulk goes in its own commit.

## The plan

1. **Audit, in parallel and independently.** Sol builds a matrix of rhizomatic's promises against
   Loam's behavior, with counterexamples, and a real dependency graph of rhizomatic's code. Claude
   inventories every place Loam built around rhizomatic, and records Loam's decision functions.
   Neither sees the other's results until both are done.
2. **Reconcile** into one plan: the tier graph, the vNext semantic changes and the landing order.
3. **Myk approves** the plan. No library code is written before that.
4. **Sol lands the package boundaries** with no change in behavior. Then the time fields, which
   change canonical bytes at the base. Then one tier at a time: spec, vectors, independent
   witnesses, parity, prerelease.
5. **Loam consumes each prerelease.** Loam's recordings are compared against it. A recording is
   evidence and a candidate vector, not normative truth. Then Loam deletes its own copy.

## Recordings

Loam's tests mostly compare one door's answer with another door's answer, so they can stay green
while a decision changes on both sides. Recordings cannot. `recordings/` holds canonical JSON of
Loam's decision functions over fixed corpora: fixed seeds, fixed timestamps, fixed keys. Where the
vNext algorithm changes a decision on purpose, the recording shows exactly what moved.

## Environment

Get a fully green baseline first. A red baseline teaches you to ignore red.

- Node 24 is required.
- The browser test files need Chrome. Set `LOAM_CHROME` to a Chrome or Chromium binary.
- Run `npm run build` before the tests. Some files need `dist/`.
- Run as a non-root user.

## Where things are

- **The map:** [MAP.md](MAP.md), the state of the refactor at a glance. It is updated in every
  refactor PR.

- `GLOSSARY.md`: the plain words that replace Loam's idiolect. Apply them as you go.

- `tools/`: the census scripts behind the journal's numbers. See `tools/README.md`.
- `audit/`: Loam's side of the audit.
- `recordings/`: the recording harness and its outputs.
