# Loam is the testbed for rhizomatic's layers

*2026-09-25. A chat with Myk about extracting libraries: the decisions, the measurements, and the
handoff for the long-running refactor.*

## What Myk decided (in chat, 2026-09-24 and 2026-09-25)

1. Loam is the testbed. It expands fast. At a milestone, a proven model graduates into a
   `rhizomatic-*` library.
2. Each rhizomatic layer becomes its own library. It depends only on the layers below it. The
   ladder sets the order of work.
3. The loop for one model: write the TypeScript library, switch Loam to it until the tests pass,
   write vectors from it, and build the other languages against the vectors.
4. A rewrite is cheap now. The real work is finding the abstraction.
5. Hermetic is a check, not a codemod. Automatic lifting is probably not the plan. Its guarantees
   matter most for code that travels in deltas.

The aim behind the plan: apps exchange deltas, so data does not stay inside walled gardens.

## What we measured (main at aeeea24)

`refactor/tools/` reproduces every number in this section.

- `src/` has 53.5k lines. Comments are 49% of its non-whitespace bytes. Rhizomatic's TypeScript
  has 4.5k lines, with 19%.
- 306 comment blocks name a ticket, a PR, a person or a date.
- One import cycle holds 20 files across `gateway/` and `federation/`. `Gateway` has 144 members.
- 245 of 372 test files are frozen. 210 of those import internal paths.
- Few tests pin bytes: one snapshot file, one golden store, and four files with hex ids. Most
  tests compare one door's answer with another door's answer.
- Loam runs rhizomatic 0.8.0. The substrate is at 0.10.0. Loam uses no L0 packs, and no L6
  `Peer` or sync.
- Hazard citations per 1,000 code lines: storage 22, erasure 15, containers 14, federation 10.
  The HTTP doors, the query surface and the CLI have 3.6 to 5.5.
- About 10k of Loam's 36k code lines sit in areas that SPEC-6 claims: trust (§3), protocol (§4),
  admission (§5), federating semantics (§6) and data lifecycle (§7).
- Hermetic: 24% of Loam's functions are already hermetic, but they hold only 8% of the code lines.
  A full lift typechecks and gives the same test results. In rhizomatic's TypeScript, only
  `http.ts` reaches ambient authority.

## Why nothing graduated before

- NOTE-11 already states the working agreement. It says to prototype "app-layer, ahead of any
  normative vectors," and then: "do not vector a guess." Loam did the first half. Nobody owned the
  second half.
- CLAUDE.md marks rhizomatic frozen: a change there needs a PR and Myk's word. An agent working
  alone read that as blocked, so it built inside Loam.
- Rhizomatic's own CLAUDE.md defers networking until a milestone needs it. So L6 stayed minimal
  while Loam needed more.

## The loop, with its guards

1. **Record first.** Run Loam's current decision functions over every test fixture and over
   generated delta sets. Save the outputs. The new library must reproduce them exactly. The
   reason: a test that compares door with door stays green when a decision changes on both sides.
2. **Write the TypeScript library deterministic by design.** Pass `now` in. Break every tie by id.
   Forbid ambient globals, and seal the decision functions with hermetic. Today two Loam readers
   keep the first record they see on a timestamp tie (`channel.ts:529`, `attention.ts:119`).
3. **Switch Loam to the library.** The tests and the recordings must both pass. Then delete
   Loam's copy. This step collides with the rail freeze, because frozen tests import internal
   paths.
4. **Write vectors from the library,** starting with the recordings.
5. **Build the other languages against the vectors.** SPEC-0 says the TypeScript implementation
   "has no special authority." When a new language disagrees with a vector, check the spec first.
   A vector is settled when two independent implementations agree.

A second model family helps most in two places. It can read each spec section cold and ask
whether it can implement from the text alone. It can also write the second witness clean-room,
from the spec and the vectors only. CLAUDE.md names cross-model review as the strongest tier, and
this repo has not run it yet. Keep one owner per set of files. The 2026-09-11 entry records two
models on one ticket store that used two different field names.

## The graduation checklist

- The model has stopped changing, and its tickets are closed.
- Its decisions are pure functions with explicit inputs.
- Its current outputs are recorded.
- Two hosts must agree on it. Instance policy stays in Loam.

## The first rung

L1 to L5 exist at full depth in TypeScript and Rust. Loam consumes them, after an upgrade to
0.10.0. L6 is the first rung that Loam needs and that is not finished.

Inside L6, follow SPEC-6's own order: trust, then admission, then subscriptions and scopes, then
law across peers, then forgetting. Forgetting comes last because it depends on the others: the
doors refuse tombstoned ids, and tombstones cross the seeding edge.

The first candidate is trust and admission. The grant and roster readers are pure. `authorize`
chains ten pure checks. `interpretBindingPolicy` calls itself "THE SPEC AS CODE" and already has
an equivalence test.

L7 comes next. Loam can be the working host that the WASM ABI proposal waits for.

## Open questions for Myk

1. During the extraction, does the rail freeze hold file paths, or behavior?
2. Where do the `rhizomatic-*` libraries live, and which sessions can push there?
3. Resolvers: a read-side ABI in L5, or fold them into L7 derived authors?
4. Forgetting has three candidate tiers. NOTE-11 says "you cannot un-send." Loam's conformant
   peers honor tombstones. SPEC-6 §7 proposes key destruction. How do they compose?
5. Must each milestone graduate one model before the next expansion starts?
6. Gate evidence in cloud sessions: the ADLC signing key was not available on 2026-09-11.
