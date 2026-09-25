# The refactor: Loam graduates into rhizomatic layer libraries

Read this file first. Then read `journal/2026-09-25-loam-is-the-testbed.md` for the measurements
behind it.

Loam is the testbed for rhizomatic. A model proven in Loam graduates into a `rhizomatic-*`
library, one layer at a time. This folder holds that work until the libraries move to their own
repos.

## Rulings (Myk, 2026-09-25, in chat)

- **ADLC is suspended for the refactor.** Ignore its gates, the rail freeze, the gate ledger and
  the ticket ceremony. Frozen tests may change. Leave `.adlc/` in the tree, untouched.
- **The CI job `rails-guard` enforces the rail freeze.** Remove it from
  `.github/workflows/ci.yml` in the first change that edits a frozen test. Cite this ruling.
- **This repo is a monorepo for now.** New libraries live under `refactor/`. Building them here
  does not edit rhizomatic; its repo stays as it is until a library moves there.
- **One library per rhizomatic layer.** Each library depends only on the layers below it. The
  ladder sets the order of work.
- **The loop below is the method.** A rewrite is cheap now. Finding the abstraction is the work.
- **Hermetic is a check, not a codemod.** Do not lift the codebase automatically.

## What stays in force

- `npm run check` is the green bar: format, lint, typecheck, build and every test. Read the counts.
- A breaking on-wire change ships a migration step in `src/migrate/`, in the same change.
- Every erasure test proves two things: the target is gone, and a named bystander survives. Never
  erase data outside a test's own temp dir.
- Text for Myk uses STE style: commit messages, PR bodies and journal entries. One idea per
  sentence, and 20 words or fewer.
- New code under `refactor/` looks like rhizomatic's TypeScript. Comments explain the code, and
  they stay short. History goes in the commit message or the journal. No ticket ids in comments.
- Keep each change readable. A change that Myk must review carries a few hundred lines of
  decisions at most; mechanical bulk goes in its own commit.

## The loop, for one model

1. **Record.** Run Loam's current decision functions over fixed corpora: the relevant test
   fixtures, plus generated delta sets with fixed seeds and fixed timestamps. Save the outputs as
   canonical JSON under `refactor/recordings/`. Loam's tests mostly compare one door's answer
   with another door's answer, so they can stay green while a decision changes. Recordings
   cannot.
2. **Write the TypeScript library.** Make it deterministic by design. Pass `now` in. Break every
   tie by delta id. Allow no ambient globals: no clock, randomness, environment, files or network.
   Its decision functions should pass `hermetic/sealed`.
3. **Switch Loam to the library.** The tests and the recordings must both pass. Then delete
   Loam's copy, and update the imports in every test that used it.
4. **Write vectors** from the library, starting with the recordings. Keep them beside the
   library, in rhizomatic's vector format.
5. **Build a second witness** in another language, from the spec text and the vectors only. The
   TypeScript version has no special authority (rhizomatic SPEC-0 §5). When the two disagree,
   check the spec first. A vector is settled when two independent implementations agree.

## The graduation checklist

A model graduates when all four hold:

- It has stopped changing.
- Its decisions are pure functions with explicit inputs.
- Its current outputs are recorded.
- Two hosts must agree on it. Policy inside one instance stays in Loam.

## Milestones, in ladder order

L1 to L5 already exist in `@bombadil/rhizomatic`, at full depth in TypeScript and Rust. Loam
consumes them. The new work starts at L6.

- **M0: record and measure.** Build the recording harness for M2 and M3 first:
  `src/gateway/accounts.ts` (grants and the `authorize` chain) and `src/gateway/trust.ts`
  (rosters). Add a census to CI that fails when a coupling count rises; `tools/` has the measuring
  code. M0 changes no behavior.
- **M1: upgrade rhizomatic from 0.8.0 to 0.10.0.** In 0.9.0, every object in the term, schema and
  claims profiles became a closed record: an unknown key is an error, and so is an ambiguous
  one-of node. Anything Loam wrote with a stray key now fails to parse, and that includes stored
  deltas. For each failure, fix the writer or add a migration. 0.10.0 only adds vectors. The
  unreleased byte-honest strings change moves no canonical bytes. Run M0's recordings before and
  after.
- **M2: L6 trust.** Grants, membership, rosters and trust policy move to
  `rhizomatic-federation/`. Loam's readers here are already pure: `grantClaims`, `holdsGrant`,
  `grantsHeldBy`, `readTrustPolicy` and `trustRosterPred`.
- **M3: L6 admission.** The validation chain at the append door: `authorize` and the ten defect
  checks it calls. `interpretBindingPolicy` already has an equivalence test
  (`test/gateway/binding-equivalence.test.ts`). Copy that pattern.
- **M4: L6 subscriptions and scopes.** Channels, against rhizomatic SPEC-6 §4 and NOTE-11. Test
  the idea that a container is a local peer. Rhizomatic's `Peer` is a reactor, a key pair, an
  offered lens and an admission rule.
- **M5: L6 law across peers.** Registration, versioning, adoption and manifests, against SPEC-6
  §6 and the open supersession question in SPEC-3.
- **M6: L6 forgetting.** Tombstones, slates, graveyards and receipts, against SPEC-6 §7. Purging
  bytes at rest stays in Loam, as instance policy.
- **M7: L7 derivation.** Loam becomes the working host that rhizomatic's
  `spec/07-derivation-abi.PROPOSAL.md` waits for. The library is `rhizomatic-derivation/`.

Inside L6, the order follows SPEC-6's sections: trust, admission, protocol, federating semantics,
lifecycle. Forgetting comes last because it depends on the others. The doors refuse tombstoned
ids, and tombstones cross the seeding edge into every container.

## Working with a second model

Use `t3-threads` to spawn a thread on a second model family. It acts as your conscience and your
reviewer. Give it this file and the journal entry. Do not give it your reasoning; an independent
reader is the point. It helps most in four places:

- It reads each spec section cold and asks: could I implement this from the text alone?
- It writes the second witness in step 5, clean-room.
- It reviews decisions that change what Loam promises, such as forgetting and admission.
- It reviews each diff for correctness before you push.

Three rules come from this repo's own history:

- **One owner per set of files.** Two models on one ticket store once drifted into two field names
  (journal, 2026-09-11).
- **A finding is a bug report.** Verify it, then fix it or refute it with evidence.
- **When fixes keep causing new defects, stop.** Fix the model at that seam, not the code. On one
  PR, 11 of 12 review rounds found something, mostly in the previous fix (journal, 2026-09-04).

## Environment

Get a fully green baseline before M0. A red baseline teaches you to ignore red. On 2026-09-24,
3,364 tests passed, and 15 files failed for environment reasons only:

- Node 24 is required. Node 22 breaks the renderer-globals golden in
  `test/gateway/render-ocap.test.ts`. The two memory-bound render tests failed too, probably from
  Node 22 or the container's memory limit.
- The six browser test files need Chrome. Set `LOAM_CHROME` to a Chrome or Chromium binary.
- Run `npm run build` before the tests. Five files need `dist/`.
- Run as a non-root user. Two permission tests in `test/cli/user-roles.test.ts` fail under root.

Verified on 2026-09-25: after `npm run build`, and with `LOAM_CHROME` set to Playwright's
Chromium, 3,414 tests passed. Only four files still failed: `render-ocap`, the two memory-bound
render tests (`quarantine-envelope-memory`, `render-sandbox`) and `user-roles`. They need Node 24
and a non-root user.

## Open decisions for Myk

1. **Vocabulary names.** Every Loam vocabulary is named `loam.*` or `loam:*`. A graduated library
   keeps those bytes by default. A rename to `rhizomatic.*` changes the wire format. It needs a
   migration, which can re-sign only what the operator signed, or an alias mapping (rhizomatic's
   SPEC-9 proposal: "matching, never renaming").
2. **Resolvers.** A read-side ABI in L5, or fold them into L7 derived authors?
3. **Forgetting tiers.** How do these compose: "you cannot un-send" (NOTE-11), tombstones honored
   by conformant peers (Loam), and key destruction (SPEC-6 §7)?
4. **Cadence.** Must each milestone graduate one model before the next expansion starts?

## Where things are

- `tools/`: the measuring code behind the journal's numbers. See `tools/README.md`.
- `rhizomatic-federation/`: the L6 library. Empty until M2.
- `rhizomatic-derivation/`: the L7 library. Empty until M7.
- `recordings/`: created in M0.
