## 2026-07-11 — Tutorial: step-through + in-order gating (v2d.1)

Two UX tweaks from Myk on the shipped 16-lesson arc. (1) **In-order gating:** a lesson is
locked in the nav until every earlier lesson is green — and "green" is the ground-derived
`check`, not UI memory, so the walk can never run ahead of what the store actually holds. (2)
**Step-through:** each lesson's single `perform` became a SEQUENCE of `steps`
(`{ label, look, run }`); only the frontier step is clickable, and once run a step shows its
`look` — which pane changed, what to notice — so the intermediary states a one-button lesson
used to blur past are each seen on purpose.

Design notes worth keeping: (1) the two progress notions are deliberately split — step
progress within the current lesson is EPHEMERAL (a reload forgets it, and re-running a step is
idempotent by content address), while the durable gate is the green. That let the gating stay
honest across reloads without polluting the ground with UI state. (2) For the split to be sound
the greening step must be the LAST required step, so a learner can't satisfy the gate and skip
a step a later lesson depends on. Two checks were strengthened to enforce it: lesson 2 now
requires BOTH Film and Book (lesson 7 reads the book), and lesson 10 now requires the reopen
"open" declaration as well as the roster (lessons 12–13 federate the wider world, which a
still-rostered door would bounce). Lesson 3 also folds the tag into its check so all three
writes are required. All three stay EARNED/DURABLE/SIDE-EFFECT-FREE (§19). (3) The inspector
moved from lesson 2 (where no "Arrival" fact exists yet to bend) to lesson 5, whose copy
actually invites it. (4) The arc test drives `for (const step of lesson.steps) step.run(ctx)`
in place of `perform`; every in-order / subscription / finale / heal pin held unchanged. 445
green; gating + stepping + look-lines + green transitions verified live in the browser.
