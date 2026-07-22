# Working specs — the P1 instrument

A **working spec** lives here as `NN-slug.md`, numbered with the SPEC section it will become. It is
what P1 interrogates: `adlc spec-lint`, `premortem`, `parallax`, `adversarial-review`.

It is **not** `spec/`. The two are different genres with different lifetimes:

| | `.adlc/specs/NN-slug.md` | `spec/NN-slug.md` |
|---|---|---|
| genre | a gateable instrument for a builder | narrative record for a reader |
| says | what MUST be true, and how it is verified | what IS, and why |
| lifetime | until the work lands | forever, footered with its Provenance |
| written | at P1, before any code | at P6, the last step of the landing PR |

Conflating them is what let P1's gates be skipped for the whole first arc: a narrative section
carries no acceptance criteria, so `spec-lint` reports `WARNING: no criteria found` and exits **0** —
a gate that gates nothing.

## The format `spec-lint` actually parses

Criteria are collected from a section whose heading matches
`acceptance | criteria | requirements | definition of done | success`, plus any standalone
`MUST`/`SHOULD` line anywhere in the file. Inside a criteria section, every list item (`-`, `*`,
`1.`, `- [ ]`) is one criterion.

Each criterion must name a **verification method**, or it is a WISH and the gate FAILS (exit 2). A
method is recognized as any of:

- a **test/spec file path** — `test/gateway/byte-door-lens-gate.test.ts`
- a **backtick command** — `` `npm run check` ``, `` `adlc rails-guard --ticket T42` ``
- the literal **`verify:`** or **`verified by`** followed by text

```markdown
## Acceptance criteria

- The anonymous byte-door refuses a reading the operator never declared.
  Verified by `test/gateway/byte-door-lens-gate.test.ts`.
- A struck adoption record leaves the trail. Verified by `test/gateway/promotion.test.ts`.
- MUST NOT change the bytes or roles of any delta an older store already holds.
  verify: `npm run check` plus the §20 migration suite.
```

## Why this shape is the point

**A verification method is a rail.** `spec-lint` mechanically enforces *every promise names the test
that will prove it* — at design time, before code exists. That is the hollow-rail defense moved
upstream: from something the model has to remember into something the gate refuses to let past.

So by P3 the acceptance criteria ARE the rail list, and freezing rails is transcription rather than
invention. If a criterion turns out to have no test, P1 under-specified — that is the signal, and it
arrives before the build instead of after the merge.

## Running the gates

```bash
adlc spec-lint .adlc/specs/NN-slug.md        # exit 2 on a wish; --llm also catches vacuous methods
adlc premortem  .adlc/specs/NN-slug.md       # failure-first stress test
adlc parallax   --file .adlc/specs/NN-slug.md # ambiguity / route-conflict fan-out
```

All three are LLM-backed and support `--prompt-only`. Per CLAUDE.md's rule on who answers a gate:
`spec-lint` and `premortem` judge the ARTIFACT and may be self-answered; anything whose product is a
second set of eyes (`adversarial-review`) must go to an independent subagent.

Existing `spec/` sections are **not** retrofitted — they are correct as history. This convention
governs new design work from here.
