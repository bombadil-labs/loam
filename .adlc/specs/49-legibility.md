# §49 — Legibility: the store that stays on top of itself

**Working spec (P1 instrument). DESIGN-STAGE: this is the strawman for Myk's precise-detail
session (T212's gate). Nothing here builds before that conversation.** Realizes T212 when
settled.

## The problem, in Myk's words

The dream is deltas flowing in every direction and state accumulating MEANINGFULLY. The
nightmare is the same flows producing delta soup: any store running long enough becomes a mess
of noise nobody can stay on top of. The admin page is the biggest gap. (Myk, 2026-08-21.)

The visibility slices already landed — channel health, contested names, the grant ledger,
custody stamps — make the parts legible. This spec is about the WHOLE staying legible: what may
be written, how attention finds what changed, and how the old stops costing without stopping
being true.

## User stories

Myk opens his store after a week away. The first thing the admin page shows is not the
container tree — it is what CHANGED: per container, how many claims landed since he last
looked, who wrote them, and which of them bound law or touched trust. Three lines tell him
whether the week was quiet or he should keep reading.

A channel has polled every hour for a month with nothing to say. The ground holds NOTHING from
those polls — no heartbeats, no empty stamps — because a pulse is not a fact. The channel
record's lastSyncedAt (one row, superseded in place) is the only trace, and it is enough.

Rae's store has three years of viewings. The diary lens answers as fast as it did in month
one, and the admin page's attention surface does not make Rae scroll past 2024 to see this
week — the old is quiet by default, reachable by asking, never deleted.

An agent connected over MCP writes forty claims a day into its inbox container. Myk's
since-last-looked line for that container says "forty a day, all by the connector, none
touching law" — and he stops worrying about it, because the summary distinguishes bulk from
consequence.

A future operator asks "what happened here in March?" and the answer is a reading — the same
machinery as everything else — not an archaeology project.

## Strawman positions (for the session to accept, bend, or kill)

1. **The pulse law (write-side).** Adopt as Loam doctrine what Kyber's D5 states and T207
   already practices: *a pulse is not a fact*. Anything periodic — polls, heartbeats, health
   probes, keepalives — must either supersede one standing record in place (the channel
   record's shape) or write nothing. A delta is for something that HAPPENED. The law lands in
   CLAUDE.md's standing rules and this spec; every future ticket that appends on a schedule
   answers to it at review.
2. **The since-last-looked reading (read-side).** A per-reader attention surface needs exactly
   one new claim kind: `loam.looked` — a reader's own record that they looked at a container
   at a moment, superseded in place (one row per reader per container, obeying position 1).
   Everything else is a READING over existing deltas: claims since the looked-moment, grouped
   by author and by consequence class (data / law / trust / erasure), counted not listed,
   with the list one click deeper. No digests are ever written; a digest that is data is soup
   about soup.
3. **The dashboard leads with attention (surface-side).** The admin page's first screen
   becomes the since-last-looked summary across the reader's subtree, with the container tree
   demoted beneath it. Quiet containers collapse to one line. The consequence classes are
   visually distinct so "forty claims, all data, one author" reads as calm and "one claim,
   trust" reads as loud.
4. **Quiet by default, never gone (age-side).** A container may be marked quiet — a standing
   operator record, superseded in place — which removes it from the default attention surface
   and dashboard tree. Quiet is a READING preference, not a storage state: nothing moves,
   nothing archives, every door still answers. Un-quieting is deleting one's own mark. (True
   cold storage stays what it is today: the archive mirror. This position deliberately does
   NOT propose storage tiering — §11/§29's territory stays theirs.)
5. **The soup meter (honesty-side).** The store can report its own accumulation: claims per
   day per container, trend, and the share that is periodic-shaped (same author, same entity,
   metronomic timestamps) — a reading that names probable pulse-law violations so the
   operator can ticket the writer. The meter never blocks writes; it reports.

## What this spec refuses

No write throttles, no quotas, no auto-archival, no deletion of anything by age, no
server-side digest generation. Every mechanism above is either a standing record superseded
in place or a reading over deltas that already exist. Legibility is a lens problem; the
moment it becomes a storage mutation it inherits erasure's entire burden.

## Acceptance criteria (drafted for the session; they harden after it)

1. THE PULSE LAW. Every periodic writer in the tree either supersedes in place or writes
   nothing on a no-op cycle — verified by an audit case per periodic surface (channel sync,
   any future cron-shaped writer) in their own suites, plus the doctrine sentence landing in
   CLAUDE.md's standing rules.
2. SINCE-LAST-LOOKED. Recording a look supersedes the reader's prior look for that container;
   the summary over a fixture with data, law, trust, and erasure claims groups and counts by
   class and author; a second reader's looks do not disturb the first's — verified by
   `test/gateway/attention.test.ts`.
3. THE DASHBOARD. The first screen renders the summary; a quiet container collapses; a trust
   claim renders loud — verified by `test/server/admin-attention.test.ts` with the session
   fixture.
4. QUIET IS A READING. Marking quiet changes no door's answer and moves no bytes; unmarking
   restores the default surface — verified by `test/gateway/attention.test.ts` two-sided.
5. THE SOUP METER. A fixture with a metronomic writer is named by the meter; an organic
   writer is not (two-sided) — verified by `test/gateway/soup-meter.test.ts`.

## Open questions for the session (each with a lean)

1. Is `loam.looked` per-user or per-reader-key? Lean: per-user (the admin page's session
   user), since attention is a person's, not a credential's.
2. Does the attention surface reach the CLI (`loam status`?) in v1 or admin-page-only? Lean:
   admin-page-only first; the CLI reads the same reading later.
3. Should the soup meter's pulse-law heuristic ever gate anything? Lean: never — reports
   only, tickets follow.

**Provenance.** Drafted 2026-08-25 from T212 (Myk's framing, held verbatim), Kyber's D5, and
T207's attest-only-non-empty precedent, for the design session T212 gates on.
