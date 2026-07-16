## 2026-07-11 — Sprint 2 of the ship path: continuity (PR #53, SPEC §15)

The store walks out of the browser. `exportOffer(gateway)` freezes a store as EXACTLY the
bytes `GET /federate` serves — the door is the reference implementation, pinned byte-for-byte
against a live server in test — and `loam pull <url|file>` lands either source through the one
door, `Gateway.federate`: verification, trust-admission, tombstones. The fork is the
operator's, never the command's: the same-operator test proves the law BINDS on arrival (the
imported registration answers with no register() call, the imported grants gate writes, and
the round trip matches `_hex` for `_hex`); the foreign-operator test proves the law stays
inert. The village's phase18 made the identity claim VISIBLE: the first pull reports "3
accepted, of 4 offered" because the fourth delta — the operator marker — was already present
by content address; the laptop's genesis and the tab's genesis are the same delta.

Learnings worth keeping: (1) file and wire diverge at the failure margin ON PURPOSE now —
pullFrom drops a delta that fails reconstruction and lands the rest (the next pull heals),
parseOffer refuses the whole file (a frozen offer is a document; if a byte rotted, the honest
report is "make a new export", not a quiet partial import) — the review caught this as an
undocumented difference and the fix was to decide it, not align it. (2) A `git checkout -- .`
buried in a commit-command reverted uncommitted implementation before staging — caught because
the next gate run was about to be a lie; the restore commit says what happened. Standing
lesson: never compose destructive git flags into a convenience chain. (3) The uninitialized-
home pull needed its own sentence in the output: a home minted mid-pull holds a brand-new
operator, so the offer's law is silently foreign — the CLI now says so and points at
`loam init --seed`, because the difference between "my store came home" and "my deltas
arrived somewhere lawless" is one flag the user may not know exists.
