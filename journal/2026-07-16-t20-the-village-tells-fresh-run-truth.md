## 2026-07-16 — T20: the village tells fresh-run truth again

T19 slice 1's pure-move discipline demanded a fresh village run, and the fresh run told on the
standing homes: **no schema file carried a `writable` list**, so ever since §14 flipped to
immutable-by-default, a store registered from scratch served mutation-less types — phase 1 failed
1/7 and phases 2–8 cascaded into crashes. The long-lived untracked `homes/` had been masking it the
whole time, because their registrations predate the flip. Myk's call: fix the witness before
carrying it forward under six more decomposition slices.

Four repairs, all village-side (no src/ change — the ticket's boundary held):

- **`gen-schemas.mjs` names each lens's honest `writable` list**, derived from the mutations the
  phases actually make — and only those. Person writes name/bio; Colony writes queen/frames/yield/
  grumbles; Circle, FilmNight, Presence, TrustedDossier name nothing (their writes arrive as signed
  relation deltas or the mill's derived emissions). Deliberate writability demonstrated, not
  defeated.
- **§21-rename drift**: phase 4 asserted the pre-#92 `schema:` prefix where the door now answers
  `hyperschema:`, and `screening-classic.json` still carried `entity: "schema:ScreeningClassic"` —
  actively wrong now that `schema:<name>` belongs to the living resolution Schema. Phase 7's
  mallory-trap handed `publishSchemaClaims` a hyperschema-shaped object where 0.3.0's L5
  realignment wants a real `Schema` (props as a Map, name + alg); the rival reading is now a
  proper oldest-wins Schema, a sharper trap than the old shape ever was. `sighting.json` was still
  the pre-unification flat register format — the README's own grow command would have choked on it.
- **A genuine collision**: phases 21 and 22 both used `ledger:almanac` on the same store, so 22's
  sum resolver absorbed 21's entries (140 became 370). Phase 22 now keeps its own ledger — this one
  only ever showed up in a full in-order run, which nobody had done from fresh in weeks.
- **The ritual, written down**: the README now carries the fresh-run ritual — `rm -rf homes`, all
  phases in numeric order — as the bar before trusting the village as a regression net. The
  standing homes stay (they are the living world), but they are the demo, not the witness.

**The certification: 28/28 acts green from a fresh seed, in numeric order** — phases 0–23 plus
bytes, pinned, guestbook, quarantine, every individual check passing. The meta-lesson joins the
fan-out doctrine from this morning as the day's pair: *a fan-out must re-derive its own reach, and
a witness must be re-run from its own genesis.* Both are the same humility — trust nothing that a
comfortable accumulation of state merely implies.
