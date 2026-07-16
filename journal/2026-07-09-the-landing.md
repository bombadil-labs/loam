## 2026-07-09 — The landing

The v1 plan is delivered end to end: eleven PRs (a scaffold, the rhizomatic spike, persistence,
the read gateway, mutations+subscriptions, capabilities, transport, runner+genesis, CLI+deploy,
federation, and one 23-finding audit), 151 tests, every step tests-first with a strict review
resolved before merge. Closing the sprint:

- **CLAUDE.md is now the process, not the plan.** The build-steps section is removed (the journal
  is the record); what remains is the loop any future work runs, the standing rules, and the
  standing decisions. Its "to resume" now says: if `CURRENT_WORK.md` is empty, ask Myk what's
  next — there is no queued plan to fall through to.
- **README is a manual.** The vision prose gave way to install / CLI / HTTP API / embedding /
  capabilities / runner / federation / deploy, every example checked against the shipped API
  surface (`src/index.ts`). A brief poetic opening stays — the vision is a standing value, not
  a phase.
- **npm-ready, publish deferred to Myk.** Added `keywords`/`repository`/`homepage`/`bugs` and a
  `prepublishOnly: npm run check` guard (a publish can never ship a red gate); the tarball
  surface (`dist/index.js`, `dist/cli/bin.js`, `README.md`) is confirmed and pinned by
  `test/cli/pack.test.ts`. **Two prerequisites remain Myk's**, both deliberately not automated:
  drop `"private": true`, and add the `LICENSE-MIT` / `LICENSE-APACHE` files (they carry a
  copyright line and a license choice that are the author's to make, not code to generate). Then
  `npm publish` is one command behind the gate.

Per the autonomy grant ("run until the plan's steps are secured, then regroup"), this is the
regroup point. The ground is prepared.
