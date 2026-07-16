## 2026-07-09 — Open decisions resolved; sprint begins

Myk resolved both standing questions at the start of a three-day build sprint:

- **Multi-tenancy (§7): full.** v1 treats tenant isolation as a first-class construct — genesis
  schemas and gateway enforcement carry it from the start, not as a later graft.
- **Chorus (§10): reference-only.** Read its plumbing as a design guide; write Loam's code clean,
  against Loam's tests. SPEC §10 is now a reference inventory, not an extraction inventory.
- **Cadence:** run the loop autonomously until the plan's steps are secured, then regroup.

Also verified at sprint start: `@bombadil/rhizomatic@0.1.0` is live on npm (published 2026-07-06),
and its export surface matches SPEC §2 name-for-name — the spike (step 1) will confirm semantics.
