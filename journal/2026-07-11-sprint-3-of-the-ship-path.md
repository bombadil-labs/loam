## 2026-07-11 — Sprint 3 of the ship path: the tutorial (PRs #54, #55, #56 — SPEC §16)

Learn Loam by growing one, shipped in three slices. **3a (PR #54), the arc before any UI:**
eleven lessons as data and functions — `buildArc(loam)` with `perform(ctx)`/`check(ctx)` per
lesson, every check a real read of the learner's store, durable and monotone so a revisit
re-verifies every green from the ground alone. The bundled world (the circle, a complete
foreign store; the adversary, one really-signed forged claim) generates deterministically and
is committed byte-identical, gated by `--check` in CI. The finale is pinned whole: export →
`loam init --seed` → `loam pull` → `_hex` for `_hex`. **3b (PR #55), the theater:** zero
framework — the store is the state, the page is a subscriber; View | Ground | GraphQL panes,
the one-byte-shatters inspector, the finale's localhost compare with the paste-the-hash
fallback, `recordHomecoming` making lesson 11's green a record IN the store. Walked end to
end in a real browser: all eleven greens through the actual buttons, a reload mid-arc, and
the page's own export served from a real CLI home and matched hash for hash. **3c (PR #56):**
pages.yml (build from the same commit as the library — skew impossible; inert until Myk
enables Pages in repo settings), the cold-reader copy pass, the README invitation.

Learnings worth keeping: (1) the review catch of the arc — lesson 11's check was VACUOUSLY
GREEN from first boot, and the fix was doctrine: the finale's completion became a signed
homecoming claim the check reads back, progress-is-the-store all the way to the end. Checks
must be earned (asserted false before their lesson), durable (monotone in the ground), and
side-effect-free — each of those requirements caught a real bug. (2) "Set an aggregate" is a
§14 promise the SPEC made ahead of the code; the shipped lesson teaches the current truth
(the "set" is one more counted claim — arguably the more memorable beat) and the SPEC now
says which truth ships. (3) Driving the UI in a real browser caught what no headless test
could: the inspector's byte-flip bent a wire shape that didn't exist and shattered nothing.
(4) A multi-pointer claim's view entry resolves to its whole record — better pedagogy than
the scalar §16 sketched (the guest is visible in the film's view), and `merge max` simply
left the domain. (5) Store-derived strings are DATA, never markup: the hostile-claim lesson
is exactly why view values render via textContent.
