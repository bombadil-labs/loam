## 2026-07-16 — #111 hardened: a fresh-eyes review pass, three real findings, three fixes

Myk asked for a review of the week's open PRs, and a fresh-eyes pass on #111 (one reviewer agent, findings
verified against the code) caught three substantive defects in the first cut of promote-outputs. All three
are fixed on the branch, each with its rail:

1. **The closure remedy was impossible.** "Adopt its closure first" could never succeed: promoting A mints
   A′ under a NEW id, so B's citation of A's pool id dangled forever — every multi-delta output (exactly
   the fork/PR case §27 celebrates) was unpromotable. Fix: the adoption trail is the bridge — a citation of
   an already-adopted pool delta is REWRITTEN to its adopted counterpart, so chains promote in dependency
   order and no pool id ever enters the primary. (Rail: promote A then B-citing-A; B′ cites A′.)
2. **The fresh timestamp contradicted §11 and reopened erased content.** §11 rung 2 pins that a
   reassertion "inherits the source timestamp, so it is content-addressed and idempotent" — and §24.3
   claims exactly that kinship. The first cut stamped `nextTimestamp()`, so a re-promotion after erasure
   minted a fresh id the tombstone could not refuse. Fix: inherit the source timestamp. Idempotence,
   erasure-holds, and honest byTimestamp ordering all fall out of the one property, exactly as the doctrine
   said they would. (Rails: promote-twice converges; erase-then-repromote is refused by the tombstone.)
3. **Promote-outputs was promote-anything.** No shape screening stood between `reactor.get` and `append`,
   and operator authorship is force — a guest's grant-shaped, tombstone-shaped, or `loam.adoption`-shaped
   "output," promoted blind by id, became operator LAW (including a forgeable audit trail). Fix:
   `promotionRefusal` refuses reserved vocabularies (`loam.*`/`rhizomatic.*` contexts, `loam:` entities)
   and negations — facts cross by adoption, law crosses only by §24.4's own ceremony. (Rails: the three
   refusals.) Named residual for Myk at §24.4: may a DOMAIN negation ever cross by adoption?

Plus the one-liner: `readAdoptions(reactor)` with no operator filter returned [] always — the optional
filter now filters instead of emptying, and `Gateway.adoptions()` states its unoperated-store behavior.

Learning, and it is the §24 lesson again: the door that crosses a boundary must re-derive EVERYTHING from
what is recorded, never from what the caller implies — the purge re-checked the tombstone (slice 1's catch),
and now promotion re-checks the shape, the closure through the trail, and the id the content itself mints.
A crossing is a re-derivation, not a copy.
