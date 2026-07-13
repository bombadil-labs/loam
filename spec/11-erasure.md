## 11. Erasure — degrees of forgetting

GDPR Art. 17 and plain conscience both demand that a store can truly forget. The architecture
makes this cheaper than it sounds: **Loam's immutability is per-fact, not global** — the ground
is a set, not a chain, so no delta's identity depends on another's existence. Erasing one fact
costs one fact plus whatever cited it; nothing structural breaks. The design principle
throughout: **the store remembers THAT it forgot — who asked, when, and which id — never
what.** Content addressing lets a store refuse a delta forever while retaining zero bytes of
its content.

- **The tombstone.** An erasure is a signed claim at `loam:erasure` (context `loam.erasure`)
  naming the delta id and its author (`spoken-by`, the compliance record). **Authority is the
  INSTANCE OPERATOR's alone** (decided 2026-07-10): erasure is destructive, and the substrate
  cannot stop anyone from *minting* a removal-order, so the store must be certain never to
  *accept* one its operator did not sign. Not the record's author, not a grantee, not a peer —
  a data subject asks, and the operator, as the controller, executes. Every door (append AND
  federation) runs `eraseDefect` and refuses a tombstone the operator did not sign, so an
  unauthorized removal-order is never even stored; the readers then bind only the operator's.
  Tombstones are append-only forever — the erasure log is itself the compliance record — and a
  tombstone cannot itself be erased. An ungoverned store (no operator) honors no erasure.
- **The purge.** A new, loud seam operation — `StoreBackend.purge(ids)` — a NAMED exception to
  grow-only, exactly as mirror-lag is a named exception to every-failure-rejects. Purge must
  reach every tier: the sqlite row, the mirror, the archive's fan file. **`heal()` must consult
  tombstones and never resurrect a purged id** (the crash in reverse — this interaction is where
  the bugs will hide; test it first).
- **The door remembers the hole.** Admission (federate AND append) composes the tombstone set:
  a tombstoned id is refused re-entry forever — a hash-set check, cheap. Union normally lets
  anything return; the tombstone is how forgetting sticks against the store's own gossip.
- **The manifest.** Before purging, compute the blast radius — which registered
  materializations reference the id, which deltas cite it as provenance — and show it. Cascade
  to derived emissions (translations of the erased fact) is a per-store policy; GDPR usually
  wants cascade.
- **Federated forgetting is per-instance.** A tombstone is one operator's order over one
  store's ground; a peer refuses a foreign operator's removal-order at the door. So erasure
  does NOT auto-propagate — each store's operator independently decides to honor a request (a
  forged or malicious order can never cascade a deletion across the network). A request may
  travel as ordinary data (an "erase me" claim a controller acts on), which is GDPR Art. 17(2)
  — "inform downstream controllers" — done as data; compliance is TESTABLE per store: ask that
  store for the id and see what returns. No recall of pre-request copies; precision and
  auditability, not magic.
- **Degrees — all built from purge + tombstone + reassert; NEVER in-place mutation.** The id
  hashes the claims (author included) and the signature binds them; an edited delta fails
  recomputation and is refused as corruption by every driver. That rigidity is load-bearing:
  erasure authority must never be forgery authority.
  1. **Full erasure** — purge + tombstone. Gone; the hole is signed.
  2. **Anonymous reassertion** — the operator re-speaks the content in the store's own voice,
     then purges the original. **No on-record link between old and new** — content addressing
     is a confirmation oracle (hash the preserved content + timestamp + each candidate author
     against the old id; the roster is a small brute-force space). Author-derived lens weight
     (byAuthorRank, trust masks) degrades BY DESIGN — "anonymize but keep my earned ranking"
     is trust laundering.
  3. **Sealed authorship** — the reasserted delta carries one pointer:
     `hash(salt ‖ author)`. Anonymous today; reveal the preimage to reclaim your words
     whenever you choose. Reversible anonymity, no new cryptography.
  4. **Partial redaction** — reassert with specific pointer VALUES replaced by a redaction
     marker; the fact survives, the sensitive field does not.
- **The replacement is the operator's to append.** Anonymous reassertion (rung 2) is the
  operator re-speaking the content in the store's own voice — a normal append the operator
  signs, not an auto-propagating order (erasure is per-instance, above). The reassertion
  inherits the source timestamp, so it is content-addressed and idempotent (the translation
  trick): two operators who independently honor the same request converge on one anonymous copy
  without coordinating.
- **Honest boundary.** This is rigorous severance/pseudonymization; true anonymity is a
  property of the content itself (timestamps correlate, style fingerprints). Rung 4 is the
  tool for content-side scrubbing; no substrate can do it for you.

**Provenance.** Landed — [#34](https://github.com/bombadil-labs/loam/pull/34) (the erase seam), [#36](https://github.com/bombadil-labs/loam/pull/36) (the law slice: authority → manifest → tombstone → purge), [#38](https://github.com/bombadil-labs/loam/pull/38) (operator-only gating + hardening). Lives in `src/gateway/erase.ts` (`Gateway.erase`, `eraseDefect`) and the tombstone readers (`readTombstones`, honored at both the append and federation doors). Key decision (Myk, 2026-07-10): erasure is the instance operator's alone — a data subject asks, the operator executes — and the signed tombstone refuses the exact bytes' return by id, so the store remembers THAT it forgot without keeping what.
