# The hardening night — four landings, one seam, and the audit that earned its keep

**Date:** 2026-07-24 · **PRs:** #186, #187, #188, #189, #190, #191

The survivor inventory's tickets, worked as an autonomous stretch. What landed:

- **T71 (#186)** — the inherited-freelist VACUUM railed. Both mutants that had survived T67's
  sweep now turn a two-sided rail red.
- **T74 (#187)** — golden genesis ids. The marker and constitution deltas are pinned as literal
  content-address hexes; a drive-by change to a genesis constant now meets a red bar that says
  *you are re-minting the constitution of every existing store*.
- **T70 (#189)** — heal answers erasure with a **byte verdict**. The one completeness path T67
  left trusting `purge`'s count now asks each tier `holds` and routes survivors — or a tier that
  cannot answer (H9) — into `purgeFailures`, the channel the boot path already surfaces loudly.
- **Two boundary flakes fixed same-day** (#188, #190), per the standing discipline: a vitest
  config raising the bare 5s default that was killing real-sqlite I/O on loaded Windows runners,
  and the render happy-path rail booted with a generous clock so it observes a good render rather
  than racing worker-spawn under contention (T75 tracks the remaining design question).

**The decision worth recording: `heldAmong` joined the store seam** (Myk approved the shape in
chat). T70's first cut called `holds` per dead id, and the scan-scale lens caught what no green bar
could: `ArchiveBackend.holds` pays a full sweep on a *negative* answer, so the healthy boot heal was
O(dead × archive) — a latency cliff on the success path, the exact shape T55 had already inverted
for `purge`. The fix is an **optional** batch primitive: `heldAmong(ids)` — of these ids, which does
a tier still hold, answered in one pass. Only the archive implements it; memory and sqlite fall back
to their already-cheap per-id `holds`. Optional is the point: the seam grows one method nobody is
forced to implement, and the verdict keeps `holds`'s exact reach and fail-closed posture.

**What the night proved about the process.** The audit-after-every-piece rule caught a real
regression the author had just written and every test passed over — introduced *while fixing* a
finding from the previous audit round, which is the recurring shape (T67's fixups had it too: the
worst bug of that night was in round two). Self-review would have shipped the cliff; the lens that
caught it was reading for H8 with no access to the author's reasoning. And adlc 1.6.0's tightened
P5 turned out to demand structured, revision-bound evidence — three distinct dry lenses, a
transcript, a hashed review packet — which the old flat gate-manifest records never satisfied; T74
was the first genuinely-green structured P5 in this repo. Two flakes also confirmed the flaky-test
rule's economics: each was fixed the day it was observed, and each fix was *removing a competing
bound to observe the one under test* — never a widened assertion.

**Still open on T70:** the durable degraded latch (serve boots status-0 with only a log line when
an erasure could not verifiably finish) — design latitude, Myk's call. And SUBSTRATE-HAZARDS.md's
T70 note predates cli.ts reading `purgeFailures`; correct it at the next hazards-file landing.
