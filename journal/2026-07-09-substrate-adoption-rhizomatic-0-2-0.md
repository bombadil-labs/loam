## 2026-07-09 — Substrate adoption: rhizomatic 0.2.0 (PR #17)

The substrate came back with both asks — `chain` orders (rhizomatic#1) and `inView`
reflective predicates (rhizomatic#2) — and the whole gate ran green on 0.2.0 before a single
Loam line changed. What Loam grew on it: `governedGatherBody(operator)` (a gather whose
negation mask trusts the operator + the operator's grantees, resolved as a LIVE view over the
grant deltas — stranger strikes inert, community strikes bind, revocation un-binds on the next
read) and `tenantSchemaFor(operator)` (the audit view under the standing discipline). The
founding village field-note bug — TrustedDossier showing an OLD bio on rank ties — is fixed
where it was found, by the substrate change it motivated. 212 tests; village phase 8 (3/3);
the dashboard now shows three lenses disagreeing over one ground, live.

Learnings worth keeping:

- **Run the pin before writing the prose.** The review claimed (probe-and-all) that an
  operator-minted admin's revocation diverges lens from door; the test we wrote to pin that
  FAILED — the admin is a subject of an operator-authored grant, so she IS in the trusted set.
  The reviewer was wrong one way, our first docs wrong the other; the truth (lenses reach ONE
  link; divergence begins at chain-minted standing) came from the red test. Empiricism over
  authority, including the reviewer's and ours.
- **Mask and order guard DIFFERENT attacks.** The trust mask stops ERASURE (a strike on the
  record); the chain order stops FABRICATION (a newer forgery). The village made this vivid:
  plain Dossier believed the raccoon; TrustedDossier resisted the forgery but lost the struck
  bio; GuardedDossier (mask + chain) held through both. A dossier wants belt AND braces
  because they are different garments.
- **Constitutional shape rules must be total**: duplicate subject/verb pointers read
  differently in enforcement (last wins), validation (first checked), and inView extraction
  (all match) — now malformed law, refused for everyone.
- **The loop grew stage 7** (Myk): the village is a LIVING demonstration — tracked, documented
  (`_testing/README.md` with a per-PR ledger), extended with every step, homes disposable.
  Its dashboard catching the three-lens divergence in real time is worth a hundred assertions.
