# The connector lands — §39 + §37 complete, one stacked night

**2026-08-02.** One overnight run took the connector feature from three open designs to a complete,
smoke-tested stack: **#321** (§39, T138 — a connection binds to a container, the inbox model),
**#322** (§37 phase 14 — the consent page), **#323** (§37 phase 15 — the token exchange and
revocation, completing all fifteen §37 phases). Myk merges the stack bottom-up; the auto-mode
classifier blocks a `gh pr merge` from the model, and per the standing rule a mechanical block means
STACK, never work around.

This entry records what its PRs cannot: two chat rulings realized, one ruling extended by a P5
finding, and what the first real boot of the whole flow taught.

## The three T138 seams, as settled and as built

Myk settled the premortem's three held decisions in chat (2026-08-01): negation closure is
container-wide ("the inbox is always in the gathered set — in the gathered set = in play"); the
append door rides existing machinery; a random disconnect must never nuke the container — only an
explicit drop drops it.

Two implementation notes worth the record:

- **The auth path came out cleaner than the spec's own recommendation.** The premortem suggested
  "the pool's operator is the owner." Verified against the code, pools are seeded with the STORE's
  operator seed (`openSeparate`), and changing that would touch every lifecycle-retraction signing
  site. Not needed: `grantHeld` already recurses, so the operator provisions the owner's ADMIN grant
  in the pool's own ground once, the owner authors the connection's WRITE grant, and the chain
  resolves connection-write → owner-admin → operator. Zero changes to `accounts.ts`. The premortem's
  vocabulary worry (store grant vs inbox grant distinguishable only by an id) dissolved the same
  way: the inbox grant lives in the POOL's own reactor, so ground isolation does what a vocabulary
  marker would have.
- **Decision 3 grew a tooth in P5.** The suppression lens found that `inbox.detach()` — kept for
  handle symmetry — marked the pool inactive without purging it, so a strike a connection wrote
  stopped being gathered and a primary claim it retracted resolved LIVE again: silent
  un-suppression across the pool boundary. The fix follows Myk's ruling to its conclusion: an inbox
  is durable, its lifecycle is bind / revoke / drop, and detach REFUSES, naming the two operations
  that do belong. Red-before-green confirmed by reverting the refusal.

## What independent P5 caught that green bars did not

Three loam lenses on T138, a neutral security review each on phases 14 and 15. Every finding was in
a RAIL or a seam the author could not see from inside the ticket's premise:

- T138: the detach resurrection (above); a criterion with no positive control (an empty gather would
  have passed it); a drop rail whose byte-proof was delegated to the code under test.
- Phase 14: the consent GET slid the session before validating params — switched to a non-sliding
  read, closing a cross-site session-slide. And one genuine design question surfaced for Myk rather
  than decided: consent gates on ANY session, so an actor-role user can approve a connector (F1 in
  #322's body).
- Phase 15: the credential-minting core confirmed clean on all seven security items, and the one
  defect was a VACUOUS RAIL — the revoke fault-leak check asserted on a channel the locked path
  never writes. Re-pointed at the caller-facing result; red-before-green by injecting a leak.

The pattern holds from the 2026-07-21 audits: independence is the active ingredient, and what it
finds is mostly rails that could not fail.

## The first real boot

The full flow ran against a real store before the stack was even merged: init → user create →
serve → discovery documents → the MCP 401 challenge → RFC 7591 registration → login → the consent
page (warning copy verified: "retract claims the operator wrote") → approve → 302 with the code →
PKCE redemption → the code BURNS on second use → MCP `initialize` with the minted bearer → `loam
grant list` → `loam grant revoke` → 401 on the very next request of the same process, past deltas
keeping their author.

What the boot taught that no rail had said: the login form's field is `user` (a scripted login that
sends `username` gets the uniform refusal, correctly opaque); the `__Host-`/`Secure` cookies refuse
plain http, so a local scripted test carries cookies by hand while a browser over the Funnel URL
sees nothing unusual; and the token door opens only when BOTH the connector flags and a created
user are present — `credentials.json`'s existence is the switch that turns on `/login`, and with it
the whole OAuth path.

**Provenance.** The stack #321/#322/#323 against `main`, built and prosecuted 2026-08-01/02.
