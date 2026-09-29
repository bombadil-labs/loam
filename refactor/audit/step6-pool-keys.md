# Step 6: each new pool under its own key (plan)

Status: plan, 2026-09-29. No code. It stages the Loam work of Sol's step 6 contract
(`step6-inventory.md`, #647) and handoff criterion 17 (`step6-handoff.md`).

## The promise

A pool created after this work is a peer under its own key K_p. Its own law (cuts, outcomes,
owner grants, strikes, arrival stamps, its incarnation) is signed by K_p. Host deltas copied into
it stay host testimony. It reads them only where it explicitly selects the host for that law. User
facts stay the host's. A person sees no change: the pool answers as before.

An existing pool is not handed off (ruling 10). When pool keys switch on, a store holding one
will be refused at boot.
Replacing `childSeed()` alone is invalid (Sol's contract).

## The law policy of a child

Every child gateway gets one explicit policy, set by its opener before the child replays:

- `own`: the key that signs and governs the child's own law. Today it is the host key. After
  stage 2 it is K_p for a new pool.
- `hostLaw`: the host key, and the law contexts where the child selects it as a trusted author.
  An inbox pool selects none. A quarantine, channel or separate pool selects the seeded contexts
  the inventory names: the container table, registrations, trust and grants, renderer twins.
- `users`: the host's user ground, read through `usersGovernor`. This already exists (#644).
- `erasure`: the host erasure governor, pinned only where the contract allows it (a host order
  that names this child). Until the substrate's erasure API lands, pool erasure reads stay as
  they are, and are marked.

- `review`: who may block a promotion. `promoteImpl` (adopt.ts:253) counts review strikes with
  `dataStrikeWitnesses(source, …, source.operator)`: a governor and its surviving grantees, over
  negations, which carry no law context. So promotion gets its own rule, not a context lookup. A
  review strike counts if the pool's own law under `own` authors it (its governor or a surviving
  pool grantee), or if the host or one of its surviving host grantees authors it, where the pool
  selects the host as a reviewer. A channel or quarantine pool selects the host; its own grants
  stay K_p law.

No reader treats {host, pool} as one governor. A reader asks for one context and gets the key
for that context, or the pair `own` + selected `hostLaw` where both may author it (auto-bless
excludes both, `channel.ts:663`). Promotion uses the `review` rule above.

## Stages

1. **The seam (no behaviour change).** Add the policy to `GatewayOptions`, set by the three
   child constructors (`attachChannelPool`, `bindConnectionImpl`/`resumeInboxesImpl`, quarantine
   pools). Each of the 34 inventory reads stops reading `gw.operatorAuthor` and asks the policy for
   its tagged source: own pool law, selected host law, host user ground, or peer-local erasure
   state. While `own` equals the host key, every answer is the same as today. The rail: the full
   suite and the recordings do not move. One PR per inventory table (admission, serving, other),
   so each stays readable.
2. **K_p custody (prepared, not active).** Mint K_p when a pool is created, and keep it in a key
   source the opener supplies: the CLI keeps it under the home; an embedder with no home must pass
   its own source, or the pool cannot take its own key. A missing key file is NOT a marker of an
   existing pool, because a lost key looks the same. Neither is a missing journal alone: a new
   pool is journal-less between minting K_p and creating its journal. So the HOST records the
   pool's key id first: a durable, store-local host record naming the pool and K_p's public key,
   written before K_p is used. On resume, a pool the host names with K_p must have its key (else
   it is refused) and its journal: an empty store with no journal resumes creation and gets its
   empty journal; a store with rows and no journal is refused. Only a pool the host never named
   with a key is an existing pool; under ruling 10 its store will be refused at boot. A pool whose journal
   names K_p is refused if its key is missing, never reopened under the host key. The host never
   signs the pool's law again; a host command writes pool law through the pool's own signer
   (inventory pattern 4). This stage lands behind the trial switch and activates nothing.
3. **Activation: new pools on an empty journal under K_p.** `OrdinaryJournalPeer.open(store, K_p)`
   creates the empty journal; the backend checks for rows atomically (Sol, 2026-09-29). Only now
   does a new pool serve under K_p, because only now does a host erasure copied into it go through
   the pool's own admission and erasure boundary (a child-targeted order under a pinned host
   governor), rather than being ignored or taken as a pool refusal. Handoff criterion 17 is met
   here. This joins the host trial branch and merges with it, after the substrate's erasure
   through the journal. Rails: criterion 17; a two-sided rail per tag (a pool reads its own law
   under K_p; a seeded host copy binds only in a selected context); a host or host-grantee review
   strike still blocks promotion; a K_p pool with its key missing refuses to open.

Stages 1 and 2 need no new substrate API. Stage 3 does. The handoff of existing pools is retired
(ruling 10).
Nothing serves under K_p before stage 3.

## Stage 1b-ii: grants and registrations (plan)

Stage 1b-i (#661) gave each pool its `ChildLaw` and moved trust, mount grants and renderers onto
it. The host trial measured what the rest costs: with pool keys on, 37 failures read grants and 19
read registrations with the pool key alone. Both readers take ONE operator today, through shared
helpers. This stage lets them read the pool's own law and its selected host law, without treating
the two as one governor.

- **Grants.** `grantHeld` walks a chain of admin grants back to one root key, and judges strikes
  with that root's authority. A pool's standing counts if a chain rooted at its own key holds, or
  a chain rooted at a host key it selects for `grants` holds, each judged with its own root's
  strikes. The union is over whole chains; a link issued under one root never extends a chain
  rooted at the other. Sites: `authorize` (both doors), `holdsGrant`, `survivingWriteGrantIds`,
  and the grant readers the inventory lists for a pool.
- **Registrations.** `readRegistrations` runs once per governor in `lawAuthors("registrations")`.
  The results merge per lens name: the pool's own surviving registration wins; a selected host
  copy fills a name the pool has not registered. Within one governor, today's rules hold
  (latest-per-lens, §21.7). The binding policy (§47) is single-valued, so it follows the trust
  rule: the nearest governor that declares one governs, and it resolves only that governor's
  contested names.
- **Where it applies.** Only a pool reads more than one governor. A root store's `lawAuthors` is
  its own key alone, so every answer there is unchanged. While a pool's key equals its host's key,
  the list has one entry and every answer is unchanged too.
- **Rails.** Two-key rails in the style of `child-law.test.ts`: a host-rooted write grant lets a
  writer into a seeded pool, and not into an inbox; a pool's own strike of a host-rooted grant does
  not end it (it is the host chain's to strike) while the host's strike does; a pool's own
  registration shadows a host copy of the same lens name; a host copy fills a name the pool lacks.

## Settled in review (2026-09-29)

- A durable pool's key lives in stable pool identity custody. Key loss is a hard refusal, marked
  by the host's key-id record and the pool's journal, never inferred from a missing file or a
  missing journal.
- A channel pool selects host grants for host-governed review strikes. Its own grants remain K_p
  law.
