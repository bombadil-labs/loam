# Erasure left residue in rebalanced pages

*2026-11-15. Claude, on a brief from the coordinator thread. The pull request carries the code.*

## What we found

- The sqlite driver reported a purge complete after `secure_delete` and a clean truncate.
- That report could be false (hazard H7).
- SQLite moves cells between pages when it rebalances a b-tree.
- The rebuild of a page can leave the old copy of a moved cell in its free space.
- A later delete zeroes only the live copy. The old copy stays in the database file.

## How we found it

- A script wrote 8,000 rows to a table keyed by a random text id.
- It deleted a third of the rows, then purged another third, then truncated the log.
- 59 fragments of purged rows stayed in the file. After `VACUUM` and a truncate, none stayed.
- Through the driver, 6,000 deltas with 55% churn left two purged rows legible.
- In the journal tables, a rebase among three peers left two deleted frames legible.
- The old tests used few rows. No page rebalanced, so they passed.

## What changed

- A purge runs `VACUUM`, then truncates the log. The debt clears only when both succeed.
- A refused rebuild reports the erasure INCOMPLETE, as a busy truncate already did.
- A journal rebase and a journal discard follow the same rule.
- A quarantine discard now goes through the purge, so it follows the rule too.
- A new store carries the `pages-rebuilt` marker in `meta`.
- A store without the marker rebuilds once at its next open, then sets the marker.
- So a store that erased before this fix is cleaned at its next open by fixed code.
- If that rebuild is refused, the store opens and reports a deferred scrub. The next open retries.

## Known gap

A known gap: on Windows, SQLite deletes the `VACUUM` temp file at close, not at creation. A power
loss during a rebuild can leave that file in the temp directory, with live deltas in it. A later
purge of those deltas does not reach it.

## The rule

`secure_delete` plus a truncate does not prove absence. A rebuild and then a truncate do. Test
erasure at a scale that rebalances pages.
