# Step 6 host trial: results (ordinary journal)

Date: 2026-09-29. Branch `claude/step6-host-trial`, unmerged. Plan: `refactor/audit/step6-host-trial.md`.
Package: `@bombadil/rhizomatic@0.11.0-next.6-trial.0efe140` (tarball SHA-256
`53fccd0bcc7c2a1adf9bd4ab7f6fe80e438577d12834d2422939d50f18822f15`, rhizomatic PR #53 at
`0efe140`). The first trial ran on the full-image API at `7e7f098`; its numbers are in the
branch history.

## What the branch does

- `src/store/memory.ts`, `sqlite.ts`: a `DurableOrdinaryJournalStore` per backend object. Sqlite
  keeps a head table and a frame table. A frame is inserted once and never updated. The head, the
  frame and the new rows commit in one `BEGIN IMMEDIATE` transaction. `readJournal` reads the
  head and the frames in one read transaction. `readAdmittedRows` returns the stored rows as
  they are; the journal's open compares them with its verified frames.
- `src/gateway/peer-admission.ts`: `OrdinaryJournalPeer.open`, local append (atomic, origin
  `local`), federation receive (individual, origin `unattributed`). One commit queue per peer.
- `Gateway.open` takes an explicit `peerStore` option. Only a host passes it. The incarnation
  marker enters through local admission. `LOAM_PEER_TRIAL=1` makes `Gateway.boot` pass it for
  every host.
- **The recovery barrier follows SPEC-6 §3.** `loam user recover` writes the host cut and the
  manifest in one append, and the record in a later append. The door admits a manifest only if
  every cut it names is held (here or in an attached pool) or is in its own append. It admits a
  retiring record only behind a HELD manifest. A manifest beside its record is refused. The test
  fixtures follow the same rule. This change also runs on today's path, where it passes.
- Erasure is not routed to Loam's purge path: the journal returns `unsupported-erasure`.

## Test suite (3890 tests)

| run | passed | failed | skipped |
| --- | --- | --- | --- |
| new package, switch off | 3882 | 6 | 2 |
| new package, `LOAM_PEER_TRIAL=1` | 3636 | 246 | 8 |

The 6 with the switch off are the lone-surrogate message change (intended upstream).

The 240 trial-only failures, by cause:

| count | cause | verdict |
| --- | --- | --- |
| 203 | erasure refused by the journal (`unsupported-erasure`) | expected in this trial |
| 14 | unsigned deltas ingested into the reactor around the door | expected; the journal is stricter |
| 8 | faults injected into `backend.append`, which this path never calls | test harness |
| 7 | rows written before the journal existed | expected (rows-without-journal) |
| 3 | rows purged by Loam's erase path after admission | expected; erasure is off-path |
| 2 | a second writer on the same store gets `conflict` and does not reopen | finding 2 |
| 2 | a raw row written into the file is no longer reported as unreadable | Loam-side, finding 4 |
| 1 | recording moved: another operator key is another peer | expected |

The recovery failures of the first trial (16, id-ordered arrivals) are gone.
Every failure is listed in `failures.txt`.

## Recordings

36 of 37 are unchanged. `principal.gateway-operator` moves as in the first trial: a reboot with a
stranger's operator seed is refused, because that key is another peer (`recordings.trial.diff`).

## Timing

`node refactor/trial/append-timing.mjs`. One delta per append, 40 samples, after pre-filling in
batches of 200. Reopen is a second gateway booted over the same stored data, start to ready. The
numbers vary by 20 to 50 percent between runs on this machine.

| driver | path | deltas held | append median ms | append p90 ms | reopen ms |
| --- | --- | --- | --- | --- | --- |
| memory | today | 42 | 3.90 | 5.41 | 124 |
| memory | today | 1042 | 2.95 | 3.40 | 1565 |
| memory | today | 4042 | 3.24 | 5.54 | 8343 |
| memory | journal | 42 | 11.44 | 17.63 | 369 |
| memory | journal | 1042 | 7.04 | 9.21 | 9789 |
| memory | journal | 4042 | 9.20 | 13.79 | 13907 |
| sqlite | today | 42 | 3.89 | 5.30 | 143 |
| sqlite | today | 1042 | 3.05 | 5.22 | 3495 |
| sqlite | today | 4042 | 3.14 | 5.22 | 13650 |
| sqlite | journal | 42 | 6.58 | 12.87 | 155 |
| sqlite | journal | 1042 | 7.08 | 8.37 | 3168 |
| sqlite | journal | 4042 | 8.42 | 10.94 | 12386 |

- Append no longer grows with the store: about 6 to 9 ms at every size, against about 3 ms today.
  The first trial took 1.2 s at 4,042.
- Reopen on sqlite matches today's path. Reopen on memory adds about 5.5 s at 4,042: the journal's
  verified replay.
- Reopen is slow on BOTH paths: about 3 ms per held delta in Loam's own boot. That is Loam's.
- Substrate open alone, sqlite, 4,000 deltas in 22 frames: 12.1 s while the adapter re-verified
  every row's signature. The adapter now returns stored rows unverified, and the journal's own
  comparison catches a changed row (`test/gateway/peer-image-host.test.ts`).

## Findings

1. **Reopen cost.** The journal's open verifies every admitted delta (about 1.5 ms each here), and
   Loam's boot then ingests each one again. A reader that trusts its own committed frames could
   skip the first, or hand Loam the verified set so that Loam skips the second.
2. **More than one writer per store.** A CLI command against a store that a server holds open is
   two writers. The second writer's head is stale, so it gets `conflict`, and the API requires a
   reopen. Loam must either reopen and retry, or allow one writer per peer. Today two sqlite
   handles can both append.
3. **Loam serializes its own commits per peer** (door and write-through). Unchanged from trial 1.
4. **Rows outside the journal become invisible** (Loam-side): the quarantine report and the
   "unreadable record" report read raw rows.
5. **A seedless open bypasses the journal** (Loam-side, unchanged).
6. **A new crash point in `loam user recover`:** between the barrier append and the record's
   append. The record never landed, so the command aborts, which is correct. No test covers it yet.

## Trial rails

`test/gateway/peer-image-host.test.ts`, 17 cases, green with the switch on and off. It includes a
row whose signature changed in the file, and a stale-head append. The barrier's two new door rules
are in `test/gateway/recovery-history.test.ts`. Revert probes on this build: each new door rule
turns its case red when removed, and so does the commit queue (3 of 3 runs). The missing-row check
is now the substrate's own (`admitted row mismatch`), so Loam has no guard of its own to probe.
