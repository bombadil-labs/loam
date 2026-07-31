# 2026-07-31 — hollow-test had never seen a line of TypeScript

`adlc hollow-test` is the gate CLAUDE.md calls "the shipped detector for our worst recurring bug."
It is mandated at P3 and P5. It has never mutated a line of Loam source.

The include-list that decides what may be mutated lives in `@adlc/hollow-test/lib/targets.mjs`:

    const SOURCE_EXT_RE = /\.(?:mjs|cjs|js)$/i;

TypeScript is not in it. Loam's `src/` is entirely TypeScript. The gate was total, and silent about
being total.

## Two failure shapes, and the quiet one is worse

**Explicit target.** `--target src/server/http.ts` exits 1 with a refusal that contradicts itself:

    error: --target src/server/http.ts is not a supported source language — mutation operators
    are JS/TS-shaped, and mutating another language yields syntactically invalid code that is
    scored as "killed" rather than testing anything.

The operators *are* JS/TS-shaped. They are line-level regex rewrites, every one of them valid on a
syntactic superset of JavaScript. The guard was written to keep out `.py` and `.css` and caught
TypeScript by never naming it. This is the loud shape. It fails closed, and it is honest by
accident.

**Diff-scoped.** No `--target`. This is the shape that matters. Measured on a real diff of three
changed `.ts` files (`src/server/http.ts`, `src/server/mounts.ts`, `src/server/session.ts`) plus one
`.mjs`:

| | mutated | exit |
|---|---|---|
| before | `scripts/patch-adlc-hollow-ts.mjs` only — **0 TypeScript lines** | 0 |
| after | all three `.ts` files, plus the `.mjs` | 2 |

The gate reported coverage having mutated none of the code the diff was about. On a diff with no
`.mjs` in it at all, it exits 1 with `nothing to mutate — the diff contains no eligible source
files (only test/spec/non-code files changed)`, which describes a pure-TypeScript changeset as
non-code.

A gate that reports green by not looking is worse than no gate. Upstream knows this sentence — it
is written in the comment directly above the broken regex, describing an earlier bug where "A
TypeScript-only diff did exactly that." The comment survived the fix that should have accompanied
it.

## Upstream has no fix

Installed 1.7.0. Latest published 1.7.0. Every published version — 1.1.0 through 1.7.0 — carries
the same include-list. There is nothing to upgrade to, so this is a local patch:
`scripts/patch-adlc-hollow-ts.mjs`, wired into `npm run adlc:patch` beside the two Windows patches.

## Admitting TypeScript is not enough on its own

The refusal message names a real hazard even though it misapplies it. `invert-comparison` swaps
bare angle brackets, and cannot tell a comparison from a type argument:

    readonly mounts: Record<string, Gateway>;   →   readonly mounts: Record>=string, Gateway>;

That does not parse. `runner.mjs` scores `killed = timedOut || status !== 0`, so a mutant that
breaks the build is recorded as **killed by the tests**. Admitting TypeScript without guarding this
would have traded a gate that refuses for a gate that inflates its own kill rate — the same false
green wearing a better hat, and harder to see.

So the patch has two sites: the include-list, and a guard withholding only the two ambiguous swaps,
and only on lines carrying a generic-shaped token. `===`, `!==`, `<=` and `>=` are unambiguous and
keep firing everywhere, including on generic-bearing lines.

## The patch tried to corrupt the package, and its own verify step caught it

Worth recording because it nearly shipped. The guard **wraps** the line it protects rather than
replacing it, so the first draft's patched form contained its own needle byte-for-byte. Read-back
verification reported `1 unpatched site(s) remain, 1 patched` and refused. That is the house
pattern working exactly as the two Windows patches designed it — but the refusal came *after* the
write, and a re-run re-wrapped, nesting the guard one layer deeper each time.

Indenting the inner line does not fix it: a deeper indent still contains the shallower needle as a
substring. The fix was to re-lay-out the regexes onto a bracket-prefixed line that no amount of
leading whitespace can match, plus `assertReplaces()` — a structural check that refuses **before**
any write when a substitution embeds its own needle. A patch whose output contains its input is not
a substitution, it is a loop.

## Seen red, on TypeScript

CLAUDE.md's standing warning is that a gate you have never seen red has proven nothing. So:

- `src/gateway/accounts.ts`, weakened suite (one unrelated test file) → **exit 2**, 1 survivor.
- Same file, **full suite** (1659 passing tests) → **exit 2**, 1 survivor:

      SURVIVED  src/gateway/accounts.ts:91  [off-by-one]
        original: export const TENANT: HyperSchema = { name: "Tenant", alg: 1, ... };
        mutated:  export const TENANT: HyperSchema = { name: "Tenant", alg: 2, ... };

The first thing the gate found, the first time it could see our source, was a real one. `TENANT`'s
`alg` can be changed and the entire suite still passes. The other `alg: 1` site is
`accounts.ts:183`; no test in the tree pins either. The hyperschema algorithm field is part of a
schema's identity, and nothing holds it. Not fixed here — recorded as the finding it is.

## Also observed, not fixed

`test/cli/serve-host.test.ts` fails deterministically on macOS: it connects to `127.0.0.2`, and
Darwin binds only `127.0.0.1` on `lo0` where Linux routes all of `127.0.0.0/8`. Pre-existing, from
#273, unrelated to this change. Not flaky — deterministic per platform, which is why it reads as a
red bar on every local run on this box and green in CI.

## The lesson

The two Windows patches were found because the tools *crashed*. This one had to be found by reading
the source of a gate that was exiting 0. Both prior patches are recorded in CLAUDE.md under the
heading that a tool which has nothing to say is indistinguishable from a tool that is broken. That
heading was right and its list was incomplete, in the direction that costs the most: a gate whose
failure mode is silence will not be discovered by using it.

Check that a gate can go red **on the actual artifact it is supposed to inspect**. Not on the tool's
own examples, not on whatever file happens to be adjacent. `hollow-test` was green on `.mjs` in this
repo for as long as it has been installed, and every one of those greens was about scripts and demos.
