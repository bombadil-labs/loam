# T47: the public-pin chain, and a prosecutor that railed the half I didn't

**2026-07-21.** First ticket of the overnight churn, and the first to run P3 in its
proper order from a clean start: rails frozen and failing before a line of the fix.

## The bug

An anonymous over-disclosure in two links, composing with no malice — the sharpest
of the H6 family the T63 brands were built to surface.

- **Link 1**: `freezePublicEntry` indexed `registrationVersions().filter(byPROGRAM)[N-1]`.
  Under §21.7 coexistence the program filter interleaves every reading over the
  hyperschema, so `Plant@v2` could freeze a *sibling* reading's version — opening a
  door the operator never declared. The sibling of `publishRendererImpl` already
  froze by lens; this was the outlier. Now `lensOf`, and `name` is typed `LensName`
  so the regression is a compile error (T63 paying out exactly as designed).
- **Link 2**: the route door gated on the pair `isPublicPin(schemaName, versionId)`
  then resolved by `versionId` alone. `rest.ts:319` already checked both halves; the
  two renderer sites were the outliers. Both now carry `&& lensOf(v) === schemaName`.

## What the prosecutor caught, and why it mattered

The independent security pass confirmed the fix complete across every pin-by-address
door and with no single-reading regression — but it caught that my rail only pinned
*link 1*. A deltaId is unique per delta, so `find(v => v.deltaId === versionId)`
already returns the right version; reverting the renderers.ts conjuncts left the test
green. The renderers.ts change was defense-in-depth my rail never exercised — the
exact "could this pass with the fix reverted?" gap the whole day was about.

The mismatched (lens, version) state is reachable via a raw `/append` binding plus a
raw `@<hash>` declaration, which the module header explicitly contemplates. So it was
railable, not hypothetical: the added rail crafts that binding and asserts the door
404s rather than serving the sibling. Probed — reverting the conjunct turns it red.

## The lesson that finally stuck

I probed the new rail *after committing*, so the `git checkout` that restored the
production file pulled from HEAD, not from nothing. Twice earlier today the same
checkout on uncommitted work deleted real work. Committing before a destructive probe
is the guard, and inside the loop it held.

**Provenance.** Landed by the overnight churn (branch `fix/t47-public-pin-chain`).
Repair of stated §17/§23.8 behavior; both links fixed, both levels railed, the
renderers.ts half railed on a second prosecutor pass. Rails: `test/gateway/public-pin-chain.test.ts`.
