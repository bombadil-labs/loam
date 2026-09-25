# Principals, keys and authorship: where Loam builds around rhizomatic

I changed no files. Every `file:line` below is code I read.

## Findings (most important first)

**1. Operator identity comes from a local file, not from signed data**
- **Loam does:** `Gateway` takes the operator key straight from its seed: `operatorAuthor = authorForSeed(options.seed)` (`src/gateway/gateway.ts:461`). The genesis marker (`src/gateway/genesis.ts:43-57`) is self-signed with a fixed `timestamp: 0`. Boot only checks that the marker has not been quarantined (`gateway.ts:514-526`). The marker is never *read* to learn who the operator is. Every constitutional test compares `claims.author === operator` (`accounts.ts:334,372,462`, `erase.ts:188`, `migrate.ts:77`, `channel.ts:517`, `adopt.ts:144`, `runner.ts:141`). The CLI says it outright: "PROOF OF OPERATORSHIP IS HOME ACCESS, ALONE" (`src/cli/cli.ts:406`).
- **Substrate gap:** SPEC-6 §3 has `PeerId = public key` but no signed statement "key K governs peer P". NOTE-12 §2 says an instance must "declare its authors", but defines no vocabulary for it.
- **vNext candidate:** a self-certifying root-identity delta (`rhizomatic.principal.root`) that names the peer's key. Readers would resolve the operator from ground data. The "operator" role stays Loam's.
- **Class:** rhizomatic contract. **Tier:** principal. **Confidence:** CONFIRMED.

**2. Key→user is mapped by file name only**
- **Loam does:**
  - A user is `user:<name>` with name and role deltas, and no key pointer (`src/server/users.ts:99-133`).
  - The user's key lives only in `user.<name>.seed` (`src/cli/config.ts:116`).
  - `assign-role operator` makes a new key and files `grantClaims(STORE_ENTITY, subject=<key>, "admin")`. That grant names only the key and never the user entity (`cli.ts:2611-2617`, `accounts.ts:116-136`).
  - Revoking a role finds the grant through the key file ("when the key file can still name it", `cli.ts:410`).
  - The admin page gets a user's author by reading their seed (`admin-pages.ts:134-136`).
  - Spec §36.8 claims "two operators are now distinguishable in the ground". They are distinguishable only as keys: no reader can resolve key→person.
- **Substrate gap:** SPEC-1 §5 defines `author` as a key and nothing more. NOTE-12 §2's "these public keys are mine" claim was never specified.
- **vNext candidate:** a signed key-binding delta ("key K acts for principal P", signed by P or by the root). Readers and the whoami answer would use it.
- **Class:** rhizomatic contract. **Tier:** principal. **Confidence:** CONFIRMED.

**3. Key rotation is revoke plus re-mint, with no link between the two keys**
- **Loam does:**
  - The recovery path is `remove-role` then `assign-role`, which makes a new key and a new grant (`cli.ts:409-415`).
  - "Retract your own" matches the key exactly (`mutate.ts:96-127`). After a rotation, a user cannot retract claims made under their old key.
  - The translator names the failure: renderings "stranded" because of "a rotated seed" (`federation/translate.ts:254-259,371-374`).
  - Law adoption checks `producedBy !== law.author` by key equality (`renderer-selection.ts:281`). So do the budget and rate meters (`budget.ts:177`, `soup-meter.ts:63`), which a new key resets.
- **Substrate gap:** SPEC-6 §9 lists this as an open question: "vocabulary for 'key B succeeds key A'".
- **vNext candidate:** a key-succession delta signed by the old key, the root, or both. Author-equality checks would compare *principals*, resolved through the succession.
- **Class:** rhizomatic contract. **Tier:** principal. **Confidence:** CONFIRMED.

**4. The server holds and signs with every user's and connection's key**
- **Loam does:**
  - Session tokens carry `{ actor: <user seed>, operator: true }` (`session.ts:1165,1214-1216`).
  - OAuth grants store `actorSeed` in `oauth.json` (`oauth.ts:1675-1690`). `resolve` returns the seed as `actor` (`oauth.ts:1543`).
  - A §57 client's bearer resolves to its seed (`http.ts:1203-1213`).
  - `TokenIdentity.actor` is "a signing seed" (`http.ts:103`). The header comment calls the server "a custodian of their signing authority" (`http.ts:21`).
- **Substrate gap:** nothing in rhizomatic lets a principal *delegate* signing to a server-held key. So Loam holds the principal's own key instead.
- **vNext candidate:** a signed delegation chain (connection key → user → container → host), so that a user's root key never has to leave their custody. Whether custody stays server-side is Loam's call.
- **Class:** decision for Myk. **Tier:** principal. **Confidence:** CONFIRMED.

**5. Delegation is a Loam grant lattice walked by host code, not a substrate chain**
- **Loam does:**
  - `grantHeld` recurses through operator→admin→… grants and strike survival (`accounts.ts:398-431`). `grantsHeldBy` (`:460-490`) and `authorize` (`:630-640`) build on it. Subjects are raw key strings.
  - A §58 pool chain has the operator grant admin to the user key, and the user key grant write to the connection key (spec/58 §58.3).
  - A lens can't do this walk because `inView` is limited to depth 1 (hazard H2, `SUBSTRATE-HAZARDS.md:73-99`).
- **Substrate gap:** the substrate has no delegation primitive. SPEC-2 `inView` cannot recurse (H2).
- **vNext candidate:** a principal-tier chain resolver: "does K act for P, through a surviving chain". Loam keeps its verbs (write, admin, register, federate) as policy on top.
- **Class:** rhizomatic contract (the chain); Loam policy (the verbs). **Tier:** principal. **Confidence:** CONFIRMED.

**6. The link from connection key to person and container lives only in `oauth.json`**
- **Loam does:** the grant record `{clientId, user, container, inbox, actorSeed, standing}` is a local file (`oauth.ts:1683-1720`). `resolve` builds `binding.user` from it (`oauth.ts:1530-1545`). The pool's grant deltas bind key to key. No signed data says "this key is ada's Claude connection".
- **Substrate gap:** same as #2 and #5, one level further down the chain.
- **vNext candidate:** carry the binding as a signed delegation delta, signed by the user key, naming client and container.
- **Class:** rhizomatic contract. **Tier:** principal. **Confidence:** CONFIRMED.

**7. A container belongs to a person by naming convention**
- **Loam does:** a person's reach is "the container named exactly after them" plus its descendants (`src/server/subtree.ts:1-31`). `declareOwned` signs the container with the *store's* seed, with membership `authoredBy(<user key>)` (`provision.ts:138-151`). Pool tokens `inbox` and `channel` are reserved names so the convention cannot collide (`users.ts:62-83`).
- **Substrate gap:** a container is meant to be a peer, but it has no key of its own. Quarantine pools share the operator seed by design (`quarantine-pool.ts:18-22`, spec/24:33). SPEC-6 §3 would require a distinct PeerId.
- **vNext candidate:** per-container peer keys, with container→user ownership as a signed delegation.
- **Class:** decision for Myk (the ruling says a container is a peer). **Tier:** principal / federation. **Confidence:** CONFIRMED.

**8. "Operator" means two different things**
- **Loam does:**
  - In the ground, "operator" is the store seed's key.
  - At the doors, it is a role binding on `user:<name>` (`users.ts:36,144-160`), read only when signed by the store seed.
  - An operator-role session signs as the user's own key but opens operator doors (`session.ts:1192-1196`). Constitutional acts it triggers are still signed by the store seed (`admin.ts:304,354,806`; 47 `options.seed!` / `operatorAuthor!` sites).
  - §36.8: "a per-operator key buys attribution, never privilege separation".
- **Substrate gap:** none. This is the ruled "operator is a Loam-only role, like sudo".
- **vNext candidate:** none — Loam policy. Recording it matters, because every rewired site must keep the split.
- **Class:** Loam policy. **Tier:** principal. **Confidence:** CONFIRMED.

**9. "Same operator" really means "same seed": authority moves by copying the key**
- **Loam does:** spec/15:83-87 says to move a store by running `loam init --seed <hex>` with the browser's seed, so "the operator marker is the same delta" and "THE LAW BINDS". A foreign operator's law is inert, and "authority never does" travel.
- **Substrate gap:** there is no signed continuity or delegation between two operator keys (SPEC-6 §9).
- **vNext candidate:** succession or delegation (#3) lets a new peer inherit law without reusing the key.
- **Class:** rhizomatic contract. **Tier:** principal. **Confidence:** CONFIRMED.

**10. Tombstone `spoken-by` and sealed authorship record keys, not principals**
- **Loam does:**
  - `eraseClaims` puts `spoken-by` = the target's author key (`erase.ts:66-89`). `eraseDefect` checks that value against the live target (`:188-193`) and allows only the operator (`:185`).
  - `sealCommitment` = `sha256(salt‖author)` over the key string (`erase.ts:729-733`). Revealing the preimage proves a key, not a person.
  - spec/11:55-63 says anonymous reassertion drops earned ranking "BY DESIGN".
- **Substrate gap:** SPEC-1 §5 has keys only. There is no standard for commit-to-principal, and no forgetting vocabulary.
- **vNext candidate:** move `spoken-by` and the seal into the forgetting tier, optionally committing to a principal id. That would let a revealed seal carry across a key rotation.
- **Class:** rhizomatic contract. **Tier:** forgetting. **Confidence:** CONFIRMED.

**11. Trust rosters and author admission are sets of keys**
- **Loam does:** `trustClaims` holds `admit-author` keys (`trust.ts:38-59`). `admitForImpl` tests `author === operator || roster.has(author)` (`ingest.ts:327-332`).
- **Substrate gap:** SPEC-6 §3 keeps transport trust and claim trust separate, but both are keyed on raw authors. After a rotation, the roster silently stops admitting the person's new key.
- **vNext candidate:** admission and `byAuthorRank` that can name principals, resolved through succession and delegation.
- **Class:** rhizomatic contract. **Tier:** federation / principal. **Confidence:** CONFIRMED.

**12. A channel peer is named by URL and bearer token, not by key**
- **Loam does:** arrival stamps record `from` as an address string (`channel.ts:341-366`), signed by the operator (`:437`). A re-connect is matched against a recorded *address* (`channel.ts:64-72`). Pulls use a channel token file (`config.ts:151-175`).
- **Substrate gap:** SPEC-6 §3 identifies a peer by its public key. NOTE-12 §2 suggests origin annotations naming the instance id.
- **vNext candidate:** arrival and relay provenance names the peer's key, with an optional signed locator claim (a registry) that maps key to URL.
- **Class:** rhizomatic contract. **Tier:** federation. **Confidence:** CONFIRMED (that `from` is an address); PLAUSIBLE (that nothing else checks peer keys).

**13. Whoami answers from the server's own token table, not from signed data**
- **Loam does:** its answer kinds come from `identify` (`http.ts:1219-1263`, whoami at `:1302`). The connector case gives `{clientId, actor}` from `oauth.json` (`oauth.ts:1552-1566`). The standing it reports is read from the ground.
- **Substrate gap:** follows from #2 and #6. "Who am I" has no principal to return beyond a key.
- **vNext candidate:** whoami returns the resolved principal and its delegation path.
- **Class:** Loam policy, which becomes derivable once the principal tier exists. **Tier:** principal. **Confidence:** CONFIRMED.

## Recording targets

These are pure or near-pure decision functions. Record their outputs over fixed data sets before anything moves.

- **`authorize`, `grantsHeldBy`, `tenantOf`** (`src/gateway/accounts.ts`).
  - Inputs: delta sets with operator, admin chains, self-appointed admin cycles, struck strikes, and `register` with and without a prefix.
  - Record with operator set and unset.
- **`dataStruck`** (`accounts.ts:231`) and **`lawfulNegated`** (`src/gateway/registration.ts:815`).
  - Inputs: negations by the operator, an admin, a writer and a stranger, plus negations of negations.
- **`resolveUserView`, `rolesOf`, `userNameDefect`, `reservedNameDefect`** (`src/server/users.ts`).
  - Inputs: user and role deltas signed by the operator and by a stranger, and struck bindings.
- **`eraseDefect`, `readTombstones`/`tombstonesIn`, `sealCommitment`** (`src/gateway/erase.ts`).
  - Inputs: well-formed and malformed tombstones, a `spoken-by` mismatch, non-operator tombstones, and struck tombstones.
- **`readTrustPolicy`, `trustDefect`, `admitForImpl`** (`src/gateway/trust.ts`, `src/gateway/ingest.ts:327`).
  - Inputs: open, roster and closed declarations, stranger declarations, and struck declarations.
- **`operatorMarkerClaims`, `assembleGenesis`** (`src/gateway/genesis.ts`).
  - Inputs: fixed seeds.
  - Record the ids byte for byte. Content-address stability is what "same operator" relies on.
- **`subtreeOf`, `bindableOf`** (`src/server/subtree.ts`).
  - Inputs: container tables with parent and `inboxOf` edges and name collisions.
- **The token door's `resolve`/`describe` and `resolveClientBearer`** (`src/server/oauth.ts:1520-1566`, `src/server/http.ts:1203`).
  - These are pure given an `OAuthFile` or `clients.json` value.
  - Inputs: generation bumps, a token with no user, a grant that is not standing, and multi-user grants for one client.
- **The `retract` target selection** (`src/gateway/mutate.ts:113-130`).
  - It is pure given an hview and an author.
  - Inputs: mixed-author entries, including a rotated key for the same person.
