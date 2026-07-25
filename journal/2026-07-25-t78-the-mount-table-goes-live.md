# The mount table goes live — a container answers at its own name, now (T78)

**Date:** 2026-07-25. **Ticket:** T78. **PR:** [#209](https://github.com/bombadil-labs/loam/pull/209).
**Spec:** new section **§31** (the mount table).

Mounts were frozen at `serve()`, so "ingest this module and run it" ended at a restart. The table moves now:
static mounts (boot's word), `addMount` / `removeMount` on the running handle, and every ATTACHED container at
its declared entity name — resolved LAST, so a container can never displace a name the operator already spoke
for. The container tier is DERIVED rather than registered: it reads the host gateway's own attachment index
live, so `openContainer` mounting and `drop()`/`detach()` unmounting need no callback into the server and the
two facts cannot drift.

This landed as a **new spec section** rather than an amendment. Every served path already begins `/:mount/`
(§5, §17, §23, §26), but no section owned the routing question — *which gateway answers at this name, right
now* — because until containers became live objects the answer was a boot-time constant. §27 is normative for
the container primitive, §24 for the quarantine policy, §12 for what an anonymous door may say; the mount
table is the seam between them, and it carries safety properties none of them state.

## Novel learnings

- **Precedence IS the security control here.** Tier 3 resolving last is not an implementation convenience: a
  store loads modules it did not write, and a module declares its own container name, so if that name could
  shadow a static or dynamic mount then a stranger's manifest would decide where the operator's own world is
  served. The ordering is the whole guarantee, which means it needs a rail that cannot pass with an empty
  fixture — the precedence rail earned a twin for exactly that reason. **An invariant carried by an ordering
  is the easiest kind to rail vacuously**, because the assertion is about which of two things answered and
  both being absent looks the same as the right one winning.
- **When a resource has a host and a copy, name which one owns each question before wiring the gate.** The
  first version asked the CONTAINER pool's `hasPublicSurface()` for the anonymous door — and a wall holds its
  own seeded copy of `loam:public` that moves only on `reseed()` (§24.2). So striking the declaration closed
  the host's door and left every container mount's open **permanently**: revocation defeated (§12), confirmed
  with captured probe output — `/commons` 200, strike, `/garden` 401, `/commons` still 200. Two questions,
  two owners: the host answers WHETHER a tokenless caller may read, the wall answers WHAT. Nothing about the
  code looked wrong; the wrong gateway was simply the nearest one to hand.
- **A captured gateway is a claim about the past, not a licence — and the widest window is client-paced.**
  The gateway was resolved before the identity check and before every `await`, and `readBody` runs at
  whatever rate the caller sends: a slow body held across `drop()` was answered from the dropped world, a 200
  whose bytes `drop()` had just proven gone. H7 at the transport layer. Every handler now re-resolves past
  every await — same name, same instance, or the answer an absent mount gives that caller. The subscribe path
  is the same window with worse consequences (a stream registering AFTER the teardown sweep), so the two are
  provably ORDERED rather than merely careful: check-to-register holds no await, and the sweep's
  remove-and-snapshot is one synchronous turn.
- **A derived tier inherits a rule only if the rule is applied at the READ.** The name validation bound tiers
  1 and 2 at their call sites and left tier 3 alone, because the server does not own `openContainer` and
  cannot refuse it — so a container declared `"a/b"` attached and was silently unreachable while the module
  header promised it served at its declared name, and one declared `"a%2Fb"` answered under a spelling nobody
  wrote. The rule now runs at resolve for all three tiers, and `unroutableMounts()` says what it skipped. **A
  silent skip and a phantom mount are the same lie told from opposite ends**, and the honest half of skipping
  is a list an operator can read.
- **A moving mount set is how a 404-vs-401 oracle gets reintroduced.** Existence becomes observable the
  moment the set can change, so the rails sweep twelve verbs tokenless and demand byte-identical refusals
  across a live mount, a removed one, and a name that never existed. Worth stating because the temptation runs
  the other way: a helpful "that mount was removed" is a working existence oracle.
- **A consequence you decline to state reads as one you did not notice.** An operator or actor token may
  `POST /<container>/append` straight into the walled arena, bypassing `admit` and `membership` — which govern
  the SEEDING edge, not the door. Nothing there exceeds what the same token can already do to the host (one
  operator, §24.1), so it widens no authority; but a header justifying the design with "the wall governs
  writes, never visibility" owed the reader that sentence, and §31.5 now carries it.

## Across both lanes tonight

Two landings, disjoint surfaces — the gateway's law-blessing door (T33) and the server's mount table — and
**independent review found confirmed defects in both**, including one would-be security hole per lane: a
container mount's anonymous door surviving revocation, and a module choosing which of the root's own schema
entities to land in. Neither was found by a gate. Both were found by a reader who did not share the ticket's
premise, which is the whole argument CLAUDE.md's P5 section makes and the fourth night running it has been
paid. The other cross-lane note is in the T33 entry: eslint had been linting six agent worktrees, so a green
run reported 2973 findings about copies of itself — a bar nobody can read is a red bar nobody can see.

Gate evidence: 23 rails in `test/server/dynamic-mounts.test.ts`, object level throughout (what the HTTP door
answers, before and after — the delta level is T32's, already railed under `test/gateway/container-*`).
Watched red before the code: 14 of 15 failed on the bare handle, and six of the fold rails were watched red
before their fixes, including revocation 200→401, the escaped container name 200→404, the paced body over
`drop()` and over `removeMount()`, the paced WRITE (asserted at the delta level too — the late delta never
reaches the store), and the parked subscription serving a live event-stream where a 404 belonged. Six hand-run
mutation probes killed. Residual carried forward as **T88** — a NARROWED public set still serves through the
wall's snapshot until reseed, which needs a Gateway-side seam and should land before dynamic mounts are
advertised. Myk's merge (P6): a new serving surface on an anonymous door.
