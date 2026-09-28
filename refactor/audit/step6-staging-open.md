# Step 6: the read-only staging open (design note)

Status: design note, reviewed by Sol (#651), 2026-09-28. No code. It details the constructor obligation in
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

## Import happens inside the commit

Durable import, the new peer's acknowledgement, and the transfer of ownership are ONE effect (the
handoff contract, #648, step 4). So the staged peer's verified candidates, with the qualified
refusals, the obligations, the policy and the admitted holdings, become durable as PART of the
substrate's import, ack and commit [SUBSTRATE], never in a Loam step after it. If the commit could
release the old peer before the new peer's state were durable, a crash between them would leave
no responsible state.

On one backend the substrate's import, ack and ownership CAS share one transaction. Loam does not
rely on sharing it: its own marker may join the committed import only if the adapter makes it part
of that import explicitly.

## Opening on the proof

`openStaged(descriptor)` [LOAM, calling SUBSTRATE]. The descriptor is typed: the attempt id, the
old and new PeerIds, the old state version, and both digests. Digests alone are replay-ambiguous,
and a Loam staged object is not the substrate's business.

1. Ask the substrate to validate the descriptor against its durable commit and the imported state
   [SUBSTRATE]. Any "no" returns a refusal and changes nothing.
2. Then build the Gateway runtime over the committed state, CLOSED to ordinary admission and
   serving: write K_p's incarnation marker where the committed import did not already hold it,
   wire persistence, replay registrations under the committed policy, and advance to now.
3. Then drain the old peer's hold queue, in order, through the new peer's admission boundary
   (handoff step 5). A fresh append waits: every held item has priority, so none is overtaken, and
   the arrival testimony keeps the held order.
4. Only then open ordinary admission and serving.

Steps 2 to 4 are an idempotent pass: a rerun after a crash writes no second marker, admits nothing
twice, and resumes the drain where it stopped. A mismatch, or a missing import after the commit, fails closed, and is repaired from the
committed state, never by a raw replay of the backend.

A failed validation at step 1 leaves the backend byte-identical: no marker, no replay into an
admitted set, no materialization, no admission, and no serving.

## Rails (with the handoff's criterion 13)

- A staged peer over a store with a missing, forged, or mismatched proof: the store's bytes are
  identical before and after (a MemoryBackend dump, and the sqlite file's hash), and no K_p marker
  exists. `test/gateway/handoff-staging.test.ts`
- The read-only wrapper throws on `append`, `purge` and repair calls.
  `test/gateway/handoff-staging.test.ts`
- A row on the backend that the holdings list does not name is not admitted after a valid open, and
  a refused-but-held row stays refused. `test/gateway/handoff-holdings.test.ts`
- Opening twice on the same descriptor admits nothing twice and writes one marker; a missing
  import after the commit fails closed and is not repaired by raw replay.
  `test/gateway/handoff-staging.test.ts`

## Settled with Sol

1. The commit check takes a typed handoff descriptor (attempt, old and new PeerIds, old state
   version, both digests), not a Loam staged object and not digests alone.
2. On one backend, the substrate's import, ack and ownership CAS can share a transaction. Loam's
   runtime construction and registration replay run afterwards, as an idempotent pass.
