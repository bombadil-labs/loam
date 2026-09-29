# Step 6 host trial: results

Date: 2026-09-29. Branch `claude/step6-host-trial`, unmerged. Plan: `refactor/audit/step6-host-trial.md`.
Package: `@bombadil/rhizomatic@0.11.0-next.6-trial.7e7f098` (tarball SHA-256
`09efcf77676cd7fe69d30bb28633d306f9ad911ed1cea0b80709717886e96ee4`, rhizomatic commit
`7e7f098205f40cc040cd95486decf6f189cc3995`).

## What the branch does

- `src/store/peer-image.ts`, `memory.ts`, `sqlite.ts`: a `DurablePeerStore` per backend object.
  The sqlite adapter commits the image and the new rows in one `BEGIN IMMEDIATE` transaction.
  Empty-image creation checks for rows in the same step.
- `src/gateway/peer-admission.ts`: open from the image; local append (atomic, origin `local`);
  federation receive (individual, origin `unattributed`). One commit queue per peer.
- `Gateway.open` takes an explicit `peerStore` option. Only a host passes it. The incarnation
  marker enters through local admission. `LOAM_PEER_TRIAL=1` makes `Gateway.boot` pass it for
  every host (`boot` is host-only; pools use `open`).
- Erasure is not routed to Loam's purge path: the image returns `unsupported-erasure`.

## Test suite (3887 tests)

| run | passed | failed | skipped |
| --- | --- | --- | --- |
| new package, switch off | 3879 | 6 | 2 |
| new package, `LOAM_PEER_TRIAL=1` | 3626 | 253 | 8 |

The 6 with the switch off are the package alone: `makeDelta` now refuses a lone surrogate with
"cbor: text is not well-formed Unicode", before Loam's own check (`test/store/contract.test.ts`
expects /lone surrogate/). The delta is still refused.

The 247 trial-only failures, by cause:

| count | cause | verdict |
| --- | --- | --- |
| 202 | erasure refused by the image (`unsupported-erasure`) | expected in this trial |
| 16 | recovery: the image orders arrivals in one transfer by id, not batch order | finding 1 |
| 14 | unsigned deltas ingested into the reactor around the door; the image refuses them | expected; the image is stricter |
| 7 | rows written before the image existed (fixtures, pre-0.11 store) | expected (rows-without-image) |
| 3 | rows purged by Loam's erase path after the image admitted them | expected; erasure is off-path |
| 2 | faults injected into `backend.append`, which the trial path does not call | test harness |
| 2 | a raw row written into the file is no longer reported as unreadable | behaviour change, see finding 4 |
| 1 | recording moved: another operator key is another peer | expected, see below |

The full list is in `failures.txt`.

## Recordings

36 of 37 recordings are unchanged on the trial path. `principal.gateway-operator` moved
(`principal.gateway-operator.trial.diff`): rebooting a store with a stranger's operator seed is
now refused ("rows but no peer image"), because that key is another peer with no image. Before,
the store booted and reported the stranger as operator.

## Per-append timing

One delta per append, 40 samples, after pre-filling in batches of 200.
`node refactor/trial/append-timing.mjs`.

| driver | path | deltas held | median ms | p90 ms |
| --- | --- | --- | --- | --- |
| memory | today | 42 | 3.77 | 5.70 |
| memory | today | 1042 | 3.27 | 3.96 |
| memory | today | 4042 | 3.11 | 4.04 |
| memory | image | 42 | 11.39 | 17.16 |
| memory | image | 1042 | 285.39 | 296.55 |
| memory | image | 4042 | 1165.53 | 1211.09 |
| sqlite | today | 42 | 3.15 | 4.63 |
| sqlite | today | 1042 | 3.24 | 4.45 |
| sqlite | today | 4042 | 3.25 | 4.49 |
| sqlite | image | 42 | 11.54 | 16.98 |
| sqlite | image | 1042 | 296.76 | 308.03 |
| sqlite | image | 4042 | 1222.03 | 1337.80 |

The image path grows linearly: about 0.29 ms per held delta for each append. A CPU profile of a
2,000-delta store puts the time in two places, both in each commit:

- `planPermanentCommit` → `validate` / `validateState` re-verifies the signature of every
  admitted delta (`verifyDelta`, 51% of the time).
- `encodePeerState` re-encodes the whole image (42%).

## Findings

1. **In-transfer arrival order.** The image records arrivals in one transfer sorted by id, not in
   batch order. Loam's recovery barrier needs a cut manifest to arrive before the recovery record,
   in the same append. After a reopen the order changes, and the host's cut no longer reads as
   committed. Either the image keeps offered order within a transfer, or Loam must not rely on it
   (for example, a separate append for the manifest).
2. **Per-commit cost.** Full-state signature re-verification and full re-encoding on every commit.
   This matches the known limit; the numbers are above.
3. **Commit races are Loam's to serialize.** Loam has two writers per peer (the door and the
   write-through for derived deltas). Without one queue, a lost compare-and-set dropped a write
   (`conflict`). The branch serializes them; the substrate reported the conflict correctly.
4. **Rows outside the image become invisible.** Quarantine and "unreadable record" reports read
   raw rows. On the image path those rows are neither served nor reported.
5. **A seedless open bypasses the image.** `Gateway.open` without a seed takes today's path and
   replays raw rows, even over a store that has an image. The trial does not guard this.
6. **Lone surrogates.** `makeDelta` now throws the CBOR error first (package, not trial).

## Trial rails

`test/gateway/peer-image-host.test.ts`, 14 cases, green with the switch on and off. Revert probes:
removing the missing-row guard turns its case red; removing the commit queue turns the
write-through case red (3 of 3 runs).
