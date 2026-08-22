# §48 — Tutorial v3: lessons in steps, steps with revert, understanding checked

**Working spec (P1 instrument). Design-stage: Myk's merge, and his word in chat before any
implementation code.** Realizes T211 AND T106 — T106 is Myk's own earlier rewrite directive
(2026-07-26): every step framed three ways (what we have / what we want / how we get there), an
introspection surface, and language accessible to someone who has never met the system. The two
tickets are one rewrite. §16/§19 remain the historical record of v1/v2.

## Why a rewrite

The current tutorial is out of date, never fully worked right, and collapses multiple things
into single interactions (Myk, 2026-08-21). The data layer already knows better than the UX
shows: `demos/tutorial/lessons.mjs` models lessons with discrete steps (`{label, look, run}`)
and per-lesson checks, but the page plays a lesson's steps as one motion, the student cannot
step backward, and nothing verifies understanding. v3 keeps the film-diary
MECHANISM (Myk, 2026-08-21: it is a useful mechanism for understanding) and rebuilds BOTH the
player and the arc around the promises of both tickets: one step at a time, framed three ways; revert to any prior state; an optional quiz per
lesson; and an introspection surface that shows what the words claim.

## User stories

June opens the tutorial link. Lesson one greets her. Each step shows her three sentences —
what we have, what we want, how we get there — in words that assume nothing. She presses one
button and sees one observable result. The next step does not run until she asks for it.

June is skeptical of a step's claim, so she opens the introspection drawer: the derived GraphQL
SDL as it stands, and the deltas the step just landed, before and after. The words said "a
grant landed"; the drawer shows the grant.

June makes a mess in lesson 5. She opens the progress rail, picks the checkpoint labeled
"after lesson 4", and confirms on an in-page control. The page reloads into exactly that
moment. Her discarded experiments are gone from the store and from every pane.

June finishes lesson 6 and a quiz card offers three questions. She answers one wrong; the card
does not scold — it names the step that teaches the thing and offers to jump there. She can
skip the whole quiz and the arc never blocks on it.

June closes the tab on Tuesday. On Thursday the tutorial reopens exactly where she left it —
same lesson, same step, same quiz results — because the progress was in the store all along.

A maintainer breaks a step's real effect. CI goes red naming that lesson and step, because the
step's observable is a predicate over the page and the store — never an echo of its own prose.

## Design decisions (recommendations — Myk decides)

1. **A step carries a machine-checkable observable.** A v3 step is
   `{label, have, want, how, run, observe}` — the T106 three-way framing as three short
   sentences, and `observe` as TWO predicates: one over the page (selector + expected
   condition) and one over the store (the delta or view state the step produces). The rails
   assert both — CLAUDE.md's both-levels rule — so a no-op `run` goes red and a red-probe
   breaks exactly one named step. Prose is never compared to the DOM it produced (H10).
2. **Progress is deltas, and the Ground pane stays honest about it.** Progress (lesson entered,
   step completed, quiz answered, checkpoint taken) lands as signed claims in the tab store
   under a `tutorial.*` vocabulary — the progress rail is a lens over them, no parallel state
   machine for STATE. The Ground pane filters `tutorial.*` OUT by default behind a visible
   toggle ("show the tutorial's own records"), and `classifyDelta` gains a `tutorial` kind —
   otherwise progress claims badge "fact" and outnumber the student's own facts in the very
   pane lesson 3 says to watch.
3. **Revert is re-seed plus reload.** A checkpoint is a frozen export taken at each lesson
   boundary; revert re-seeds the tab store's localStorage rows from it and calls
   `location.reload()`. The reload is load-bearing: `app.mjs` captures the gateway at module
   scope, `watchFilm` holds a live subscription, and lesson 14's `Runner.attach` has no
   detach — swapping stores under a live page leaves panes haunted by the discarded future.
   Reload makes "the panes re-render from the restored ground" true by construction.
4. **Checkpoints live beside the store, named and swept.** Checkpoint blobs go under their own
   `loam:tutorial-ckpt:<lesson>` prefix — NOT inside the store (a store cannot contain its own
   serialization) and NOT under `loam:tutorial:` (boot's healStrayKeys purges non-hex suffixes
   there). Start-over clears checkpoints too. One checkpoint per lesson boundary, superseded in
   place, so quota stays bounded; an over-quota write refuses with the step named.
5. **Erasure sweeps the checkpoints — and the arc teaches it, as its finale.** SETTLED
   (Myk, 2026-08-21): accepted, and erasure moves to the very END of the arc so the checkpoint
   destruction IS part of the lesson — the student finishes by learning that the right to be
   forgotten costs them their undo into the time the thing was known. A checkpoint taken before an
   erasure holds the condemned bytes; leaving it is T40 reproduced inside the lesson that
   teaches forgetting. When the erasure lesson runs, every checkpoint that could hold the
   erased delta is dropped, and the lesson SAYS so: "the right to be forgotten costs you your
   undo into the time it was known." Checkpoint granularity stays per-lesson — per-step is not
   a storage knob, it is an erasure-surface widening, and it is not recommended.
6. **Quizzes are data beside steps.** `{ask, choices, answer, teaches}` where `teaches` names a
   step id; local checking; a wrong answer links the teaching step; skippable always; results
   land as progress claims.
7. **One browser suite, a new driver file, no native dialogs.** The story rails drive the real
   page over CDP. The frozen driver `test/browser/cdp.ts` cannot answer a `window.confirm`
   (Runtime.evaluate blocks on the modal) and must not be edited — v3 uses in-page
   confirmation controls only, and shared helpers live in a NEW `test/browser/tutorial.test.ts`
   + `test/browser/tutorial-driver.ts` beside the frozen file (the human-doors pattern). ONE
   suite, because four Chrome suites racing `build-site.mjs`'s fixed `site-dist/` rmSync is a
   flake the repo has already paid for; the suite sets
   `vi.setConfig({testTimeout: 90_000, hookTimeout: 90_000})` like every existing browser file.
8. **The player is rebuilt; the arc is rewritten greenfield** (Myk, 2026-08-21). The
   film-diary mechanism stays; the lessons do not carry over. The bar for the new arc, in his
   words: it must demonstrate features that enable meaningful examples, never draw examples to
   highlight features — it should feel human and real. No lesson-count parity with v2, no
   content parity. T106's plain-language bar and the three-way framing govern every new step.
   `test/site/arc.test.ts` is NOT frozen (verified: T106 lists it under scope, not rails) and
   is rewritten alongside.

## Acceptance criteria

1. STEPPING, BOTH LEVELS. A lesson renders exactly one pending step at a time with its
   have/want/how framing; completing a step satisfies BOTH of its observe predicates (page and
   store); a completed step stays visibly banked — verified by
   `test/browser/tutorial.test.ts` (CDP, real page) and the revised `test/site/arc.test.ts`
   (headless, asserting the store predicate of every step in the arc).
2. RED-PROBE. Neutralizing one step's `run` (fixture mutation) turns the rail red naming that
   lesson and step, because the observe predicates fail while the prose still renders —
   verified by a red-probe case inside `test/browser/tutorial.test.ts`.
3. REVERT. After actions in lesson N+1, reverting to the lesson-N checkpoint (in-page confirm,
   re-seed, reload) yields a store whose sorted delta-id set equals the checkpoint's, a named
   discarded claim absent AND a named pre-checkpoint claim surviving (two-sided) — verified by
   `test/browser/tutorial.test.ts`.
4. RESUME, FALSIFIED. Before reload, every localStorage key that is not a store row and not
   the seed is deleted; the page still reopens on the same lesson, step, and quiz results,
   proving progress reconstructs from claims and not from a parallel store — verified by
   `test/browser/tutorial.test.ts`.
5. QUIZ. A quiz is offered after a lesson that declares one, can be skipped without blocking
   the arc, and a wrong answer names and links the teaching step — verified by
   `test/browser/tutorial.test.ts`.
6. PROGRESS IS CLAIMS, ENUMERATED. The progress event kinds — lesson-entered, step-completed,
   quiz-answered, checkpoint-taken — each land as `tutorial.*` claims, with a per-kind count
   floor matching the actions the rail performed, and the progress rail renders them —
   verified by the revised `test/site/arc.test.ts` plus `test/browser/tutorial.test.ts`.
7. THE GROUND STAYS THE LESSON'S. With the default filter, the Ground pane shows no
   `tutorial.*` claims; the toggle reveals them badged `tutorial`, not `fact` — verified by
   `test/browser/tutorial.test.ts` and a classifier case in the revised
   `test/site/arc.test.ts`.
8. ERASURE REACHES THE CHECKPOINTS. After the erasure lesson, no checkpoint blob under
   `loam:tutorial-ckpt:` holds the erased bytes, and a bystander lesson's checkpoint behavior
   is stated to the student (two-sided at the bytes) — verified by
   `test/browser/tutorial.test.ts` asserting on localStorage directly.
9. INTROSPECTION. The drawer shows the current derived GraphQL SDL and the step's
   before/after deltas, and its content comes from the live gateway, never a fixture —
   verified by `test/browser/tutorial.test.ts`.
10. THE DEPLOYED PAGE. The tutorial still ships at the repo's github.io path from `demos/`,
    self-contained, no server — verified by the existing site build check extended to the v3
    entry point (`npm run check` site suite).

## Open questions for Myk (each with a recommendation)

1. Keep the film/book arc's subject matter? Recommendation: keep — the copy holds up; the
   collapse was in the player, not the story. T106's plain-language bar applies to the
   revision pass.
2. Decision 5 (erasure drops the checkpoints that could hold the bytes) narrows what revert
   can reach after a forgetting. Recommendation: accept — the alternative is plaintext
   surviving erasure in the tab, which the store's own `holds()` cannot see. This is an
   erasure-surface decision, so it is explicitly yours.
3. Should quiz results ever surface outside the tab? Recommendation: no for v3 — the tutorial
   is private by construction; revisit with the discovery story.

**Provenance.** Working spec drafted from T211 (Myk, 2026-08-21) and T106 (Myk, 2026-07-26),
a read of `demos/tutorial/` as built, and an independent premortem (11 findings, all folded:
machine-checkable observables, checkpoint placement and erasure sweep, re-seed+reload revert,
Ground-pane filtering, falsifiable resume, the frozen-driver dialog limit, single-suite CDP,
seventeen lessons). Becomes `spec/48-tutorial-v3.md` only at landing, after implementation.
