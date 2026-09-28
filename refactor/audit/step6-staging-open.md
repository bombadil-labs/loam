# Step 6: the read-only staging open (design note)

Status: design note for Sol, 2026-09-28. No code. It details the constructor obligation in
`step6-handoff.md` (#648), step 3.

## Why `Gateway.open` cannot open a staged peer

`Gateway.open(backend, { seed })` (gateway.ts) does five things a staged peer must not do before
its commit proof validates:

1. **Raw replay.** It ingests every row the backend returns into a new reactor. That is admission
   by replay: it bypasses the admission boundary, and it would turn a refused-but-held row into an
   admitted value. The handoff's admitted set comes from the carried holdings list only.
2. **A marker write.** With a seed and no active incarnation it appends a fresh incarnation marker
   to the backend. That changes the store's bytes before any proof is checked.
3. **Persistence wiring.** The constructor subscribes the reactor's raw stream to
   `backend.append`, so any later ingest writes the store.
4. **Materialization.** It replays registrations, advances validity views to now and arms their
   timer, and preloads resolvers.
5. **Serving.** It returns a gateway that answers reads and admits appends at once.

`Gateway.boot` adds genesis and resumes inboxes and channels, which a staged pool never needs.

## The staged peer

A staged peer is a separate, closed object, not a `Gateway`:

- **Inputs**: the pool's backend, the staged key K_p, and the carried state (holdings, refusals,
  obligations, policy) with its two digests.
- **What it may do**: read the backend's rows as CANDIDATE bytes, and verify them against the
  carried holdings: canonical bytes and id, then a signature or covering bundle evidence
  [SUBSTRATE]. It reports what verified, what is missing, and what is extra.
- **What it may not do**: append, purge, truncate, ingest into an admitted set, write a marker,
  materialize, arm a timer, run a resolver, answer a read, or admit a candidate.

Two guards enforce "may not":

1. **A read-only backend wrapper [LOAM].** The staged peer holds the backend only through a wrapper
   whose `append`, `purge` and repair calls throw. A bug that reaches for a write fails loudly,
   rather than changing a byte.
2. **No reactor for admitted state.** The staged peer keeps candidate rows in a plain map keyed by
   id. Nothing it holds can serve a view.

## Opening on the proof

`openStaged(staged, proof)` [LOAM, calling SUBSTRATE]:

1. Ask the substrate whether the commit for K_p is durable, and whether its state and policy
   digests match the staged ones [SUBSTRATE]. Any "no" returns a refusal and changes nothing.
2. Only then build the peer: create K_p's durable peer state from the carried refusals and
   obligations [SUBSTRATE, created at this step]; admit the carried holdings, and only those,
   through the new peer's admission, with import testimony [SUBSTRATE]; write K_p's incarnation
   marker; wire persistence; replay registrations under the staged policy; and advance to now.
3. Then admit the held items from the old peer's queue in order (handoff step 5), and serve.

A failed proof at step 1 leaves the backend byte-identical: no marker, no replay into an admitted
set, no materialization, no admission, and no serving. A crash between steps 2 and 3 leaves a peer
that the substrate knows is committed. The rerun finishes step 2 idempotently: holdings already
admitted are duplicates, and the marker is not written twice.

## Rails (with the handoff's criterion 13)

- A staged peer over a store with a missing, forged, or mismatched proof: the store's bytes are
  identical before and after (a MemoryBackend dump, and the sqlite file's hash), and no K_p marker
  exists. `test/gateway/handoff-staging.test.ts`
- The read-only wrapper throws on `append`, `purge` and repair calls.
  `test/gateway/handoff-staging.test.ts`
- A row on the backend that the holdings list does not name is not admitted after a valid open, and
  a refused-but-held row stays refused. `test/gateway/handoff-holdings.test.ts`
- Opening twice on the same proof admits nothing twice and writes one marker.
  `test/gateway/handoff-staging.test.ts`

## Open for Sol

- Does the substrate's "is the commit durable for K_p with these digests" call take the staged
  object, or the digests alone?
- On a single backend, can the substrate commit and Loam's step 2 share one transaction, or is step
  2 always a separate, idempotent pass after the commit?
