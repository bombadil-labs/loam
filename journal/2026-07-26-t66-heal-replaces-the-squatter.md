# heal can replace a corrupt row — and refuses to plant past one it cannot read (T66)

**Date:** 2026-07-26. **Ticket:** T66 (split from T57). **PR:** #240.

The bug: a corrupt row squats on its id — `INSERT OR IGNORE` silently drops the archive's healthy
copy (`changes === 0`, indistinguishable from a healthy boot), and `repair re-admit` re-runs
admission on the same bad bytes. The fix folds into heal, which already held the cure: the healthy
copy was always in `replant`. `restoreQuarantined` on both key-owning drivers, guarded two-sidedly
inside the driver from its own bytes — the incoming delta must pass the same `admit()` the read
path runs, and the row currently filed under the id must NOT — so an unsigned twin can never
displace a verified row. The verdict is `claimed ∩ admitted-by-a-re-read`: a driver's return value
is evidence, never proof.

Two signals ride a SIBLING surface (`MirrorBackend.lastRestore`), not the frozen `HealReport` —
and the test for that choice is the durable lesson: **a fold into an existing field is honest only
if that field's READER can act on the new entry without distinguishing it.** `purgeFailures`'
reader prints "bytes the operator ordered forgotten may still be at rest," which is false of a
stranded strike. The sibling is also strictly stronger: `undefined` until a heal has run means
"nobody asked" can never read as "nothing was corrupt" (H9).

P5's three lenses found ten defects, all fixed, one of them the irreversible direction: a corrupt
TOMBSTONE row is invisible to the condemned-set derivation, so heal would have replanted what the
operator erased. The interim behavior — Myk blessed it (2026-07-26) — is that heal WITHHOLDS its
plant while the pen holds an unreadable row and says so on stderr, with a rail proving the
withholding lifts once the row settles. The root cause (the derivation reads only READABLE deltas,
in both directions — a corrupt tombstone un-erases, a corrupt forgiveness destroys the forgiven)
is T99, and T98 carries the `archivePath` CWD footgun found in passing. Myk's note on the day:
erasure keeps forcing carve-outs everywhere it touches the model, and he doesn't like it — worth a
design pass over whether the carve-outs share one principle.
