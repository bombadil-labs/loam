# Step 5: principal, recovery and the signing seam

*2026-09-28. Claude (Loam) and Sol (rhizomatic), under Myk's ruling 9: settle open design calls
between us and record them. The pull requests carry the mechanics. This entry records the
decisions that lived only in the review threads.*

## The recovery barrier (#639, #640)

- A store shows a recovered user's old-key writes as history only up to a CUT it holds.
- The cut's own arrival is the line. A cut carries no position: an erasure purge renumbers arrival
  indexes at the next boot, and a stated number then disagreed with the store.
- A cut must arrive before its recovery record. A pool cannot order itself against the host, so
  a pool cut commits only through a cut MANIFEST that the host holds ahead of the record.
- The append door admits a record that retires a key only behind a manifest. The manifest names a
  live cut in the host and in every declared pool, and no cut that is not yet held.
- Federation drops cuts that name this store, and all manifests. Only a store's own append
  writes them.
- We built no store-wide writer lock. Another writer can only make history fail closed. A store
  with no cut shows no history.

## Identity and composition (#637, #641, #642, #643)

- `user:ada` is the entity id. Its meaning is the view that this peer's governing account
  resolves. No global operator exists.
- A provisioned container names its user only when the name resolves to the key file's key. A name
  bound to another key, in any state, is refused. A name bound to no key keeps the key form.
- An inbox composes into its parent by its owner's authority. A revoked connection's claims
  leave the parent view. Its past STRIKES of claims the parent admits still bind, because a
  strike counts whatever its author (H1, §39 criterion 10).
- An owner's clear reaches her connections' writes in her pools. Her current root signs. A pool
  this store cannot read refuses the clear before anything is signed.

## The signing seam (#644, #645)

- A `Signer` signs in one key's voice and refuses a claim that names another author.
- A record is authored and signed by the ground it lands in. Pool law uses the pool's key. Host
  law uses the host's key.
- User facts stay host facts. A `UserGround` names its `governor`, and every user read through a
  user ground uses that key.
- This is a seam, not key protection. `options.seed` is still readable.

## Named debt for step 6

- Pool readers that select pool records by the host's author.
- The seed that leaves the gateway through `childSeed()`.
- The exposure of `options.seed`.
