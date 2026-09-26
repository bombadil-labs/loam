# Loam's principal readers, before step 5

Step 5 gives rhizomatic principals: roots, key bindings, succession and delegation. Loam then
asks `authorsForPrincipal(root, now)`, `associatedKeys(root)` and the `actsFor` term instead of
comparing one key. This file lists every place Loam decides "is this delta by this person?", so
that the swap is mechanical. It also lists what was found while reading them.

Audited tree: `main` at `63117fdf`, with `@bombadil/rhizomatic` 0.11.0-next.3. Every row was read
in code. Line numbers are after the seam change on this branch.

## The seam

`src/gateway/principal.ts` holds one reference type and two readers. Both return exactly the one
root key today. Step 5 edits their bodies, and also the callers named below that must pass a user's
root in place of a connection key.

- `PrincipalRef = { root }`. A user's root is their own key (README ruling 5), so today a user
  reference and a bare key coincide. A connection's signing key is not a root: a caller holding
  one must pass the user's root. After step 5, Loam resolves a user to its current root through
  the governed operator read.
- `keysActingFor(reactor, now, who, scope)`: the present question. Step 5: `authorsForPrincipal`
  at `now` with `scope` under the prefix policy. `grantHeld` passes its tenant; the dashboard
  passes `"*"`.
- `keysEverOf(reactor, now, who)`: the history question. Step 5: `associatedKeys` at `now`, reading
  negations of the evidence under `rootOrSameAuthor`.

Not one body alone: the grant subjects and membership terms that name a key today become user
references in step 5 (PLAN step 5, "Grants and memberships name the Loam user").

## Rows

**Read time** says whether the site already has an explicit `now` in scope. **Routed** means the
site now asks the seam.

### A. A grant's subject matched to an author (present standing)

| # | site | question | keys compared | now | step 5 | routed |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | `accounts.ts:484` `grantHeld` | does a grant naming `subject` cover `author` | grant subject vs author | yes | `authorsForPrincipal(root(subject), now)` | yes |
| A2 | `accounts.ts:546` `grantsHeldBy` | which grants name `author` | grant subject vs author | yes | split first (see finding 1) | no |
| A3 | `container.ts:2087` `survivingWriteGrantIds` | which write grants to strike for this key | grant subject vs key | yes | replaced by negating the delegation | no |
| A4 | `cli.ts` `survivingGrantClaimIds` (callers `:3022`, `:3894`) | which grants `remove-role` strikes | grant subject vs key from a file | yes | the user's grants name the user; strike those | no |
| A5 | `cli.ts` `grantStanding` (pen create, `:3150`, `:3216`) | which grants a pen key holds | grant subject vs pen key | yes | stays (a pen is one key) | no |
| A6 | `cli.ts:3606` `groundGrants` and the ledger (`:3780`, `:3791`) | which named identity holds a grant | grant subject vs keys read from files | yes | the ledger names users through their records | no |

A1 is the door. Every `authorize`, `holdsGrant`, `standsFor` admin check, tenant membership check
and grant-issuer check goes through it. So these callers inherit the seam with no edit:
`http.ts:1372` and `:1383` (whoami write standing), `container.ts:1174` `openerStands`,
`container.ts:2187` and `:2198` (`bindConnectionImpl`), `admin-federation.ts:167`, `:602`, `:617`
and `:857`, `renderers.ts:1322` (pen standing), and `cli.ts:3159` and `:3799`.

### B. "Your own" deltas (history)

| # | site | question | keys compared | now | step 5 | routed |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | `mutate.ts:126` `retract` | which contributions the caller may retract | entry author vs the signing key | no | `associatedKeys(root)` | yes |
| B2 | `translate.ts:376` `translate` | which stale renderings the translator retracts | rendering author vs translator key | yes | `associatedKeys(root)` | yes |
| B3 | `adopt.ts:242` `promoteImpl` | did the source author retract this output | strike author vs target author | yes | open (foreign author) | no |
| B4 | `adopt-law.ts:287` `survivalOver` | did the shipper withdraw this law | strike author vs target author | yes | open (foreign author) | no |
| B5 | `adopt-law.ts:702` | which negations in a manifest count | strike author vs target author | no | open (foreign author) | no |
| B6 | `renderer-selection.ts:205` | a held self-negation with no receipt | strike author vs target author | no | open (foreign author) | no |
| B7 | `adopt.ts` `readAdoptions`, `renderers.ts` `readForeignRenderers` | own-author withdrawal (negation-readers rows 26, 35) | strike author vs record author | yes | open (foreign author) | no |
| B8 | `erase.ts:198`, `:281`, `:340` | does `spoken-by` name the target's author | target author vs a recorded key | no | stays; forgetting tier (step 9) | no |

B3 to B7 compare a strike's author with its target's author, and both keys are usually a peer's.
No Loam user record names them. Whether a foreign principal's other keys count is a step-5 or
step-6 decision, so they stay literal.

### C. Which keys speak for a Loam user

| # | site | question | source of the key | now | step 5 | routed |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `admin.ts:247` dashboard | which authors' looked markers are this user's | the user's seed file, plus the operator | yes | `authorsForPrincipal(root(user), now)` | yes |
| C2 | `admin.ts` `postLooked` | whose voice records a look | the user's seed file | no | the user's current root | no (signing) |
| C3 | `session.ts:1165`, `:1215` | whose key a session token signs with | the user's seed file | no | the user record's root | no |
| C4 | `oauth.ts:1543`, `:1685`; `oauth-file.ts:338` | which key a connection token signs with | `oauth.json` | no | the connection's delegation | no |
| C5 | `http.ts:552`, `:584`, `:1346` | the author a token names, for standing | the token's actor seed | no | stays (a token names one key) | no |
| C6 | `http.ts:1364` | is this caller the connector | token actor vs `oauth.json` actor | no | stays (token table) | no |
| C7 | `http.ts:3391` | a bound connection appends only its own deltas | delta author vs the connection key | no | stays (a connection is one key) | no |
| C8 | `provision.ts:70` `ensureUserKey` | which key the new write grant names | a fresh seed file | no | the grant names the user | no |
| C9 | `cli.ts:2645`, `:2948` `assign-role operator` | which key the admin grant names | a fresh random key | no | the grant names the user | no |
| C10 | `admin-pages.ts:136` | the membership suggested for a user | the user's seed file | no | a term naming the user | no |

C2 to C10 find a user's key through a file. The seam has no `rootOf(user)` reader yet, on
purpose: the ground holds no user-to-key link today, so such a reader would only wrap a file read.
Step 5 adds the root pointer to the operator-signed user record, and these sites read it.

### D. Membership terms that name a key (signed data, not changed)

| # | site | term | step 5 |
| --- | --- | --- | --- |
| D1 | `provision.ts:32` `authoredBy`, used by `declareOwned` (`:141`) | `author eq <user key>` | names the user; lowered to `actsFor` at the read time |
| D2 | `admin-pages.ts:72` `authoredBy` (a second copy) | same shape, as a form suggestion | same |
| D3 | `container.ts:2144` `bindConnectionImpl` | `author eq <connection key>` and `timestamp gt boundAt` | stays key-literal, or `actsFor` over the connection key |
| D4 | `gather.ts:60` `entityGatherBody({ authoredBy })`, used by `userHyperSchema` (`users.ts:161`) | `author eq <operator>` | stays (the operator is pinned) |
| D5 | `accounts.ts:184`-`:212`, `trust.ts:161`-`:178`, `users.ts:167` | trust masks on the operator | stays (the operator is pinned) |

`channel.ts:616` and `http.ts:829` match the author `"\u0000none"`. That is a closed membership,
not an identity question.

### E. The operator (pinned; stays)

Step 5 keeps the operator pinned from local config (PLAN step 5, "The operator"). These compare
an author with the operator key and do not move: `accounts.ts:408` (`standsFor`), `:446`,
`:494`, `:547`, `:724` (`authorize`); `registration.ts:816`, `:890`; `negation.ts:16`, `:50`;
`container.ts:349`, `:501`; `slate.ts:270`, `:416`, `:1830`; `erase.ts:187`, `:276`, `:336`,
`:392`, `:838`, `:989`; `channel.ts:661`, `:697`, `:1114`, `:1138`, `:2353`;
`local-channel-events.ts:125`, `:368`, `:369`; `runner.ts:143`; `repair.ts:58`;
`binding-policy.ts:216`; `adopt.ts:147`; `adopt-law.ts:1381`; `attention.ts:136`;
`renderers.ts:423`; `admin-federation.ts:128`; `ingest.ts:359` (the operator half); `budget.ts:203`
(the operator half); `cli.ts:2791`, `:2847`, `:2879`. The actor-is-operator refusals ask the same
question of a request's actor: `public.ts:128`, `artifact.ts:167`, `renderers.ts:633`,
`lifecycle.ts:1110`. That is 45 sites.

### F. Peer identity (step 6, not step 5)

| # | site | question |
| --- | --- | --- |
| F1 | `receive-policy.ts:163` | did the receiver sign this decision |
| F2 | `receive-snapshot.ts:88` | did the source sign the pinned registration |
| F3 | `ingest.ts:359` `admitForImpl` | is the author on the trust roster |

### G. Accounting per key (stays; a Loam decision)

`budget.ts:181` `countHeldBy` and the budget subjects, and `soup-meter.ts:63` streams, count per
key. A recovered user starts a fresh budget and a fresh stream. Metering per principal would be a
new promise, so it is Myk's call.

## Counts

| class | rows | routed |
| --- | --- | --- |
| A. grant subject vs author | 6 (A1 carries 11 callers) | 1 |
| B. your own | 8 | 2 |
| C. keys for a user | 10 | 1 |
| D. membership terms | 5 | 0 (data) |
| E. operator | 45 sites | 0 (pinned) |
| F. peer | 3 | 0 (step 6) |
| G. accounting | 2 | 0 (Loam's call) |

## `options.seed` reads (the census)

The ratchet counts 63. Each is one of two jobs.

- **IDENTITY (5).** They decide who the operator is.
  - `gateway.ts:475` (two reads): `operatorAuthor` is derived from the seed.
  - `gateway.ts:533`, `:537`: the boot check finds the operator's marker id from the seed.
  - `container.ts:1658`: a separate pool opens with the parent's seed, so the pool's operator is
    the same key. This read also signs.
  Step 5 keeps the operator pinned from local config, so these become the pinned root. They do not
  leave the gateway.
- **SIGNING (58).** Loam's own job, and they stay.
  - 36 sign a delta with the operator seed: `channel.ts` (10), `admin.ts` (6), `container.ts` (6),
    `adopt.ts` (2), `provision.ts` (2), `http.ts` (2), and one each in `adopt-law.ts`, `ingest.ts`,
    `slate.ts`, `erase.ts`, `admin-federation.ts`, `listing.ts`, `runner.ts` and
    `client/index.ts` (the client's own key).
  - 13 are "can this store sign?" guards before signing: `provision.ts:49`, `:131`, `adopt.ts:194`,
    `admin.ts:603`, `channel.ts:1783`, `:2336`, `ingest.ts:107`, `listing.ts:545`,
    `container.ts:1525`, `:1543`, `:1570`, `:2103`, `adopt-law.ts:1157`.
  - 9 are `actorSeed ?? gw.options.seed` or `context?.actor ?? gw.options.seed`: the five
    `mutate.ts` verbs and `public.ts:124`, `artifact.ts:163`, `lifecycle.ts:1103`,
    `renderers.ts:629`. The seed signs. `retract` also derives "your own" from it; that is B1.

## Recording: key recovery

`recordings/principal.recording.test.ts` gains `principal.recovery`. Ada's first key K1 is lost.
The operator re-points her to K2 in today's form: a new write grant for K2. The first key had
bound a connection C to her container. Two worlds: K1's store grant kept, and struck.

| | K1 grant kept | K1 grant struck | step 5 should |
| --- | --- | --- | --- |
| K2 write standing | yes | yes | yes |
| K2 clears K1's tag | no; the tag stays | no | yes (`associatedKeys`) |
| K1 still writes | yes | refused | refused |
| C writes into its pool | yes | yes | no (K1-rooted delegation) |
| K1 admin in the pool | yes | yes | no |
| container `ada` gathers K2's writes | no | no | yes (`actsFor`) |

## Findings

Each is CONFIRMED in code or in the recording. None is fixed here.

1. **`grantsHeldBy` answers two questions.** The door reads it for standing (`registerPrefixesOf`,
   `federateContainersOf`). `loam client revoke` (`cli.ts:4208`) and the ledger (`cli.ts:3753`)
   read it to select what to strike or list. After step 5 the two differ: "keys acting for the
   grant's subject" would make revoking a connection key strike its user's own grants. Split it
   into a standing reader and a literal selection before step 5. It is not routed for this reason.
2. **Striking the lost key at the store does not stop its connections.** The inbox pool holds its
   own grant chain: operator to K1 admin, then K1 to C write. The store strike does not reach the
   pool. The recording shows C still writes. Today nothing revokes a lost key's delegations.
3. **The container scope carries the pool's law.** The scope of `ada` includes K1's delegation
   grant to C (`tenant+subject+verb`), because the inbox composes into its parent. A reader of
   "ada's data" sees a grant.
4. **Two copies of `authoredBy`.** `provision.ts:32` and `admin-pages.ts:72` build the same term.
   The step-5 lowering must change both, or a suggested membership drifts from a provisioned one.
5. **A recovered user loses a budget and a metronome history** (class G), and B3 to B7 keep
   judging a foreign peer by one key. Neither is decided by the step-5 design.
6. **The seam is on the hot path.** `grantHeld` allocates one set per grant it reads. That is fine
   for the one-key body. A step-5 body that resolves a root per grant needs a memo keyed by
   `(subject, now)` for the length of one `authorize`.
