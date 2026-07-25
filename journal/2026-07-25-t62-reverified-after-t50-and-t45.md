# T62 re-verified after T50 and T45 — the archival holds

**Date:** 2026-07-25. **Ticket:** T62 (archived, `.adlc/ticket-archive/`, PR #200). **This pass:**
independent re-verification only — no code, no ticket-store mutation.

The 2026-07-25 triage (PR #200) archived T62 — "unify on byte-presence, bound the archive sweep" —
as REALIZED, on the strength of T67's shared `incompleteErasureFaults()` collector and the archive's
`heldAmong` batch probe. Two landings since then touch exactly those files (**T50** #221 qualified
`ArchiveBackend.purge`'s catch to ENOENT/ENOTDIR and added `holds`'s `existsSync` fast path to
`heldAmong`; **T45** #215/#216 closed four in-memory tiers), so the archival's premise was worth
re-reading against the CURRENT tree rather than trusting the snapshot it was made from.

**Both original claims still hold, confirmed by reading, not by re-running the old evidence:**

- One collector, both sites, transitive. `incompleteErasureFaults` (`src/gateway/erase.ts:370-398`)
  is called from both `eraseImpl` (line 323) and `eraseReplicaImpl` (line 461); both ask
  `gw.backend.holds(id)` and fail closed on a throw (H9, lines 380-385); `eraseReplicaImpl` recurses
  into nested quarantine pools (lines 452-456), so the same collector runs at every depth.
  `test/gateway/erasure-fanout.test.ts`'s "the fan-out is transitive" and "attached beneath TWO
  parents" cases exercise this directly; `test/gateway/erase-tier-completeness.test.ts` pins the
  byte-presence verdict against silent per-tier retention under a `MirrorBackend`.
- The archive sweep is bounded EVERYWHERE it is asked in bulk. `ArchiveBackend.heldAmong`
  (`src/store/archive.ts:356-388`) is a single-pass file-outer walk, with the `existsSync` canonical
  fast path T50 added (line 366) so it cannot disagree with `holds`'s own fast path (line 316).
  `MirrorBackend.heal` (`src/store/mirror.ts:203-226`) prefers it over per-id `holds` when a tier
  offers one; so does `/health`'s `outstandingAmong` (`src/gateway/erase.ts:515-542`) and the
  wall-settling sweep on container attach (`src/gateway/container.ts:878-891, 1013-1017`). No bulk
  caller in the current tree still does the O(dead × files) walk the ticket named.
  `ArchiveBackend.purge`'s file-outer inversion (line 240 comment cites the same "~256,000 directory
  reads" figure the ticket body used) and its ENOENT/ENOTDIR-only catch (`holdsNothing`, lines
  75-78, T50) hold too.

Ran `test/gateway/{erase,erase-tier-completeness,erasure-fanout}.test.ts` and
`test/store/{archive,mirror}.test.ts`: 67/67 passing. `test/store/archive-purge-unreadable-fan.test.ts`
(T50's own rail) and `test/store/mirror-heldamong.test.ts` also green.

**Bookkeeping.** T62 was already correctly archived — there was nothing to archive again
(`adlc ticket archive T62 --write --authorize` confirms `TICKET_NOT_FOUND`, since an archived ticket
is no longer in the active store: T69's rule is that its shard stays put and its rails stay frozen,
never re-touched). This entry is the durable record that the archival was re-checked against a
tree two landings newer than the one it was made from, and still stands.

## Novel learning

A ticket's archival is a claim about a snapshot, not a standing guarantee — the honest move when a
later PR touches the same files is to re-read the current code against the original claim, not to
assume the archive is self-evidently still true (or to silently re-trust it). Where the claim still
holds, the correct bookkeeping is a journal entry, not a redundant `ticket archive` call: an already-
archived ticket has left the active store, and `adlc` refuses to act on an id it can no longer find
there.
