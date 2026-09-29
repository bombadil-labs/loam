# Step 6: each new pool under its own key (plan)

Status: plan, 2026-09-29. No code. It stages the Loam work of Sol's step 6 contract
(`step6-inventory.md`, #647) and handoff criterion 17 (`step6-handoff.md`).

## The promise

A pool created after this work is a peer under its own key K_p. Its own law (cuts, outcomes,
owner grants, strikes, arrival stamps, its incarnation) is signed by K_p. Host deltas copied into
it stay host testimony. It reads them only where it explicitly selects the host for that law. User
facts stay the host's. A person sees no change: the pool answers as before.

An existing pool keeps the host key. It moves only by the barriered handoff (`step6-handoff.md`).
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

No reader treats {host, pool} as one governor. A reader asks for one context and gets the key
for that context, or the pair `own` + selected `hostLaw` where both may author it (auto-bless
excludes both, `channel.ts:663`).

## Stages

1. **The seam (no behaviour change).** Add the policy to `GatewayOptions`, set by the three
   child constructors (`attachChannelPool`, `bindConnectionImpl`/`resumeInboxesImpl`, quarantine
   pools). Each of the 34 inventory reads stops reading `gw.operatorAuthor` and asks the policy for
   its tagged source: own pool law, selected host law, host user ground, or peer-local erasure
   state. While `own` equals the host key, every answer is the same as today. The rail: the full
   suite and the recordings do not move. One PR per inventory table (admission, serving, other),
   so each stays readable.
2. **New pools get K_p.** Mint K_p when a pool is created. Store it durably beside the pool's
   backend (a key file under the home for a durable pool; in memory for a transient one), and
   load it on resume. A pool with no key file is an existing pool: it keeps the host key. The host
   never signs the pool's law again; a host command writes pool law through the pool's own signer
   (inventory pattern 4). Rails: handoff criterion 17, and a two-sided rail for each tag (a pool
   reads its own law under K_p; a seeded host copy binds only in a selected context).
3. **New pools on an empty journal under K_p.** `OrdinaryJournalPeer.open(store, K_p)` creates
   the empty journal; the backend checks for rows atomically (Sol, 2026-09-29). This joins the
   host trial branch and merges with it, after the substrate's erasure through the journal.

Stages 1 and 2 need no new substrate API. Stage 3 and the handoff of existing pools do.

## Open points for review

- Where a durable pool's key file lives, and what a lost key file means (refuse to open, like a
  lost user seed, rather than fall back to the host key).
- Whether a channel pool selects the host for grants at all, or only for the container table and
  registrations.
