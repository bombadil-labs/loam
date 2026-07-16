## 2026-07-09 — Step 11: Authors, not owners (PR #14)

The write gate moved from the touched entities' tenancy to the AUTHOR'S STANDING: one
surviving, operator-rooted `write` grant at `loam:store`, asked once per delta, blind to what
the delta points at. Entities are unowned (Myk's correction, out of the village field test):
pointer resolution is string matching, a delta is an assertion from a perspective, and the
question is never "may this be said?" but "who listens?" — answered read-side, where the
constitutional slice always lived. The per-target requirements machinery is deleted; the
village's re-tenanting ritual died with it. 193/193.

Learnings worth keeping:

- **"Lands but binds nothing" is one discipline, and it must be EVERYWHERE.** The review's
  probe-confirmed find: `readBindingDefinitions` honored ANY negation — so while foreign
  grants, registrations, and definitions were all inert, a write-granted author (or federated
  stranger) could retire the operator's binding definitions with one strike. The lawful
  negation algebra (only the operator's strikes bind; a struck strike revives) now lives in
  one exported helper shared by every constitutional reader. When a model claims a uniform
  discipline, grep for every reader and prove each one.
- **Open writes surface every place enforcement and AUDIT can diverge.** The TENANT audit view
  masks with `drop` (honors any strike); enforcement honors only lawful ones — so under a
  standing-less strike the audit undercounts while the door stays open. Pinned deliberately as
  interim: the audit lens needs "negations from the operator/admins", a DYNAMIC set no static
  mask predicate expresses — the second concrete case for reflective predicates (rhizomatic#2,
  filed, Myk iterating). The interim tests are written to break the day the substrate makes
  the right behavior expressible.
- **Deleting an ownership model is mostly deleting.** authorize() went from a requirements
  walker (tenancy, adoption, re-tenanting, ungoverned-ground) to one grantHeld call; the
  tenant machinery survives untouched as read-lens vocabulary. The strikes rule is the one
  place new judgment was needed: constitutional strikes bind from operator/store-admin only.
- Pre-strikes (negating a delta id before it arrives) are expressible under open writes —
  inert against the constitution, a data-mask hazard inside the documented interim. And
  per-tenant admin chains still mint effective community-vocabulary grants while strikes need
  store standing — an asymmetry noted in SPEC §7, to revisit with trust-is-data (step 13).
