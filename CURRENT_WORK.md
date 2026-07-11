# Current work — Tutorial v2d.1: step-through + in-order gating

_Two UX tweaks from Myk (2026-07-11), on top of the shipped 16-lesson arc:_

1. **Force in-order.** Future lessons are unavailable until every prior lesson is green. The
   nav locks them; the learner cannot jump ahead of the store's real progress.
2. **Step-through, not one big button.** Each lesson's single `perform` becomes a SEQUENCE of
   steps. Only the next un-run step is clickable; each, when clicked, tells the learner where
   to look and what to notice — so intermediary states are actually seen, never skipped past.

## Success criteria

- [ ] The lesson model is `{ id, title, copy, steps: [{ label, look, run }], check }` — no
      `perform`, no `action`. Each `run(ctx)` does one meaningful, separately-observable slice;
      each `look` says which pane changed and what to notice.
- [ ] Green ⟺ all of a lesson's required steps ran (checks strengthened so the last step is the
      one that flips green — L2 requires Book, L3 requires the tag, L10 requires the reopen).
      §19's bars still hold: every check EARNED (false before its first step), DURABLE (monotone
      in the ground), SIDE-EFFECT-FREE.
- [ ] Nav gating: a lesson is unlocked iff every earlier lesson is green; locked lessons show a
      🔒 and don't navigate. `current` never lands on a locked lesson.
- [ ] Step gating: within the current lesson, only the step at the run-frontier is enabled;
      done steps show their `look`, later steps are disabled. Step progress is EPHEMERAL UI
      state (re-running is idempotent by content address); durable progress stays the green.
- [ ] The inspector moves to lesson 5 (whose copy invites it and where "Arrival" exists).
- [ ] `test/site/arc.test.ts` drives `for (const step of lesson.steps) await step.run(ctx)` in
      place of `perform`, keeping all in-order / subscription / finale / heal pins. 445 green.
- [ ] `npm run check` green; verified live in the browser (step-through + gating for the arc).

## Sub-tasks

- [ ] `demos/tutorial/lessons.d.mts`: add `LessonStep`, replace `perform`/`action` with `steps`.
- [ ] `demos/tutorial/lessons.mjs`: rewrite `buildArc` to the steps model; strengthen L2/L3/L10.
- [ ] `test/site/arc.test.ts`: `runSteps` helper; drive steps everywhere `perform` was called.
- [ ] `demos/tutorial/app.mjs`: `renderNav` gating; `actionsFor` renders the step sequence with
      the frontier enabled; `stepProgress` map; inspector on lesson 5.
- [ ] `demos/tutorial/style.css`: locked-nav + step-row styles.
- [ ] Build the site, `npm run check`, browser-verify, PR, review, journal, village note.

## Queued after this (unchanged)

- **Hardening pass** — draft a new SPEC section (backend namespace marking, quarantine-vs-refuse
  for corruption, boot resilience, entity-ID reserved-vs-user convention, `loam repair`) per
  memory `hardening-pass-design.md`, then STOP for Myk's review before implementing
  (quarantine-vs-refuse is his call).
