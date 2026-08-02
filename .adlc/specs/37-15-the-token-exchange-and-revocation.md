# §37 phase 15 — The token exchange and revocation (working spec, T136)

**Ticket.** T136. **Status.** Working spec, transcription of the phasing plan (Myk approved
2026-07-27). **Landing PR is Myk's merge** (it decides — plan §9c); the design is the approved plan.
**This phase completes the connector — claude.ai can connect.**

**One sentence.** `POST /oauth/token` redeems a single-use code for a per-connector actor seed and a
bearer token, `loam grant list`/`revoke` manage connectors, and revocation binds on the next request
of the same live process — with no code path from any input to an operator identity.

## What it delivers

- `POST /oauth/token` — redeems an authorization code (PKCE S256) for a bearer token. Mints ONE
  per-connector actor seed, never the operator's.
- `loam grant list` and `loam grant revoke` — the operator's view and the kill switch.

## What it must not do

- **There must be no code path from a grant to `{ operator: true }`.** (Criterion 7 enumerates the
  mint path's outputs.)

## Acceptance criteria

Proved in `test/server/oauth-token.test.ts` and `test/server/oauth-revoke.test.ts` as noted.

1. **A code is single-use and BURNS ON ANY REDEMPTION ATTEMPT.** A wrong PKCE verifier kills it; the
   right verifier afterwards is refused too. `test/server/oauth-token.test.ts`: redeem with a wrong
   verifier (refused), then redeem the same code with the correct verifier (refused — the code is
   already burnt). Positive control: a fresh code with the correct verifier mints once.
2. **A code is bound to its client and its redirect_uri.** A code minted for client A is refused when
   redeemed with client B's id, and refused against a different `redirect_uri` than it was bound to.
   `test/server/oauth-token.test.ts`: two negative cases, each with the positive control that the
   bound pair succeeds.
3. **The eviction pin reads THREE sources: a live code, a redemption IN FLIGHT, and a grant in the
   file.** Redemption deletes the code before it writes the grant; between those points a flood must
   not evict the approved connector. `test/server/oauth-token.test.ts`: drive a redemption to the
   in-flight window, flood registrations, assert the in-flight connector is NOT evicted. Phase 13
   shipped sources one and two; this phase adds the grant-in-file source.
4. **`redeeming` is a COUNT, not a flag.** Two concurrent redemptions for one client: the first to
   finish must not clear a pin the second still needs. Increment immediately before the awaited mint;
   release in a `finally` so a throw cannot leak it. `test/server/oauth-token.test.ts`: assert the
   count semantics — two in-flight, one completes, the pin still holds; a throw in the mint releases
   the count (no leak).
5. **A grant mints a NEW actor seed per client, never the operator's.** The seed is written BEFORE the
   ground append, so a retry reuses it rather than minting a second. `test/server/oauth-token.test.ts`:
   assert the minted `actorSeed` differs from the operator seed and from any other client's; assert a
   retried redemption reuses the same seed (no second seed).
6. **A delta written through a minted token is authored by that connector's own actor.** Assert at the
   delta level AND through a reading. `test/server/oauth-token.test.ts`: write a delta with the token,
   assert its `author` equals the grant's `actor`, and a View resolves it as that author's.
7. **No input to any endpoint can mint an operator identity.** Enumerate the mint path's outputs — none
   is `{ operator: true }`. `test/server/oauth-token.test.ts`: assert the redemption result and the
   token-authorized context resolve to the connector actor, never the operator; `grep -n "operator: true" src/server/oauth.ts`
   finds no reachable assignment from the mint path.
8. **Revocation bumps a GENERATION.** A code issued before a revoke must not mint a token after it.
   `test/server/oauth-revoke.test.ts`: issue a code, revoke the client, attempt redemption — refused
   by the generation check. Positive control: a code issued after a re-grant redeems.
9. **Revocation binds on the very next request of the SAME live process.** A rail that restarts
   between revoke and retry proves nothing. `test/server/oauth-revoke.test.ts`: revoke and retry
   against the same in-memory door instance, no restart; assert refusal.
10. **Revocation is two-sided: access is gone AND past deltas still name their author.**
    `test/server/oauth-revoke.test.ts`: after revoke, a new write is refused (access gone) AND a delta
    the connector wrote before revoke still carries its author and still resolves (bystander survives).
11. **An unknown bearer token must not cost one key derivation per stored grant on the event loop.**
    `test/server/oauth-token.test.ts`: assert the unknown-token path does a bounded lookup (digest
    index), not an O(grants) derivation loop — probe by counting derivations or asserting the lookup
    is by digest.
12. **Neither the seed, the token nor the PKCE material appears in any delta.** Scan after a full
    flow. `test/server/oauth-token.test.ts`: run register→consent→redeem→write, scan every delta in
    the ground, assert none contains the seed, token secret, or PKCE verifier/challenge. Plant one
    (positive control) and prove the scan sees it first.
13. **No refusal sends the home path or a flag name to a caller.** Rail it by INDUCING the fault and
    asserting the door's BODY, not what the code throws. `test/server/oauth-token.test.ts` +
    `test/server/oauth-revoke.test.ts`: induce a lock fault (503) and assert the body says "lock"
    without leaking the home path or a flag name; give every negative a positive control naming which
    branch answered (a 503 + "lock" separate this refusal from an unrelated 400).

## Rails

Declared at P3 when the tests exist and are RED. Rail files: `test/server/oauth-token.test.ts` and
`test/server/oauth-revoke.test.ts` — this phase owns both and shares neither (plan §1 rule i). It adds
no precondition to an earlier phase's railed door (rule ii): `/oauth/token` is new; revocation reads
the same records but adds the generation, a new field, not a new precondition on register or consent.

## Landing

Edit `spec/37-connectors.md`: add §37.5 (the token exchange and revocation) with a Provenance footer.
Add one `{says, spec, proof}` claim to §37's chapter in `demos/capabilities/chapters.mjs` or
`test/site/capabilities.test.ts` stays red. Archive T136 on landing. This phase completes §37.
