# §49 — Legibility: the store that stays on top of itself

The dream is deltas flowing in every direction and state accumulating meaningfully; the
nightmare is the same flows producing delta soup. This section is how the WHOLE store stays
legible: what a periodic writer may put in the ground, how attention finds what changed, and
how the old stops costing without stopping being true. Five positions, settled at the
2026-08-28 design session, all five accepted as drafted.

## 49.1 The pulse law

*A pulse is not a fact.* Anything periodic — polls, heartbeats, health probes, keepalives —
either supersedes one standing record in place or writes nothing on a no-op cycle. A delta is
for something that HAPPENED.

The law is enforced where the tree's one periodic writer lives: a channel sync with nothing to
say writes nothing at all — no success stamp, no clock-only row. The first successful sync
ever still stamps (a channel proving it works is news), a failure always stamps, a debt
declared or cleared stamps, a record healing its legibility stamps — and a quiet completion
still re-reads liveness, so a severed lineage refuses exactly as loudly as before (§46.4,
T233). One consequence is named on the record itself: `lastSyncedAt` is the last EVENTFUL
sync, and the human surfaces say "last recorded sync" so a quiet month never reads as a dead
poller — the live/not-resumed distinction stays with the serving process, where it lives.
Every future cron-shaped writer owes an audit case beside its own suite
(`test/federation/pulse-law-audit.test.ts` is the shape).

## 49.2 The since-last-looked reading

One new claim kind, `loam.looked`: a reader's own record that they looked at a container at a
moment — one standing row per (user, container), keyed by the USER'S NAME in the entity id
(`looked:<user>:<container>`), superseded in place, never struck. Everything else is a
reading: claims since the looked-moment, grouped by author and by consequence class — data,
law, trust, erasure — counted, never listed. No digests are ever written; a digest that is
data is soup about soup, and the summary skips its own bookkeeping rows for the same reason.

Because the key is the user's name, two devices — or a recovered key — share one
looked-moment. Which keys speak for a user is the caller's question (the ground holds no
canonical user↔key binding; that is T137's arc), so the reading takes an explicit
accepted-author set and the admin door answers it from the user's own seed. Time is the
author's clock: a federated peer's backdated claim can hide beneath a looked-moment, and the
close for that reads arrival attestations instead — named, deferred.

## 49.3 The dashboard leads with attention

The admin page's first screen is the summary — per container in the session user's reach, the
counts by class and author, with trust and erasure LOUD and the container tree demoted beneath
it. A quiet container collapses to one line. A container whose members cannot be read from
here (an unattached separate pool) is one honest row naming the refusal — its zeros are
absence, never calm — and the readable siblings stay whole. Marking a container read posts in
the session user's OWN voice through the real form; attention is a person's, never a
credential's. Admin-page-only in v1; the CLI reads the same reading later.

## 49.4 Quiet, never gone

A container may be marked quiet — a standing operator record, superseded in place — which
removes it from the default attention surface. Quiet is a READING preference, not a storage
state: nothing moves, nothing archives, every door still answers, and asking past the
preference answers whole. Un-quieting restores the default surface. True cold storage stays
what it is today: the archive mirror (§11/§29's territory, deliberately untouched).

## 49.5 The soup meter

The store reports its own accumulation: claims per day per container, and the share that is
periodic-shaped — same author, same entity, metronomic timestamps, at least `PERIODIC_MIN`
ticks with inter-arrival spread under `PERIODIC_CV`. The meter names probable pulse-law
violations so the operator can ticket the writer; it NEVER gates a write, because a heuristic
that blocks writes will one day block a true fact. It reads the author's own clock, so a
deliberately jittered pulse evades it — honesty instrumentation, not an adversarial control.

## What this section refuses

No write throttles, no quotas, no auto-archival, no deletion of anything by age, no
server-side digest generation. Every mechanism above is either a standing record superseded in
place or a reading over deltas that already exist. Legibility is a lens problem; the moment it
becomes a storage mutation it inherits erasure's entire burden.

**Provenance.** PR #502 (with declarations PR #501); designed at the 2026-08-28 session
(PR #468, T212), from Kyber's D5 and T207's attest-only-non-empty precedent. Implementation:
`src/gateway/attention.ts`, `src/gateway/soup-meter.ts`, the quiet-poll guard in
`src/federation/channel.ts`, and the attention panel in `src/server/admin-pages.ts` /
`src/server/admin.ts`.
