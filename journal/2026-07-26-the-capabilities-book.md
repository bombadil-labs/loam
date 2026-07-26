# The capabilities book — prose that goes red when it goes stale (T95)

**Date:** 2026-07-26. **Ticket:** T95. **PR:** #233.

Myk asked for "an up-to-date document of this system's capabilities — the long tedious read,
organized by chapter, probably with visuals." The load-bearing word was *up-to-date*, so the
deliverable is the mechanism and the prose is what it protects: twelve chapters as DATA in
`demos/capabilities/chapters.mjs`, rendered by the page and asserted by
`test/site/capabilities.test.ts` — the tutorial's anti-rot identity (`arc.test.ts`) pointed at
prose. Chapters partition `spec/`; every promise names a test or states its gap in writing; every
term's gloss says whether the word is the code's or ours, types included, case-folded. 82 promises,
79 with a test. Myk accepted the standing tax this puts on every future landing (one cited claim
per new spec section), so the coverage rail is now part of P6 — CLAUDE.md says so, and the red
message teaches the fix.

Novel learnings, both paid for the same day:

- **H10 was born here.** The rail as first written could be evacuated — every citation check was
  guarded on `claim.proof`, so nulling all proofs with a one-character gap deleted the feature
  under a green bar; the term and figure rails were mutual pairs satisfied by empty sets; coverage
  was satisfiable by one string in a `covers` array. Three lenses found the same shape in three
  unrelated changes within hours, and it became SUBSTRATE-HAZARDS H10 with the shrink-to-nothing
  question. The fix shape everywhere: hand-written expectations, floors, and a CAP on the unproven
  count that can only rise by editing the line.
- **The browser caught what the rail could not, twice** — `*emphasis*` printing its own asterisks,
  then gap paragraphs rendering `[[Schema]]` literally. A balanced-marker rail proves a marker is
  CLOSED, not that it is RENDERED. The manual pass over the real page is part of the bar for
  anything with a face.

Independent review also caught four sentences stronger than the code (the governed-reading trusted
set is the operator's; trust-aware reading is opt-in; an operatorless store governs nothing; the
tutorial's lesson 1 is green by construction) — each corrected rather than dropped, and the §7
residual now rides the claim as its stated gap.
