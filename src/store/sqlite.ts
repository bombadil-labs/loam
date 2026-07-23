// The durable driver: one deltas table keyed by content-addressed id (UNIQUE is the CRDT dedup),
// WAL + busy-timeout as the multi-handle provision, one IMMEDIATE transaction per append batch.
// Ids are marked durable only AFTER commit — a rollback undoes rows, never a Set, and an id
// marked durable-but-rolled-back would be skipped forever after.
//
// better-sqlite3 is synchronous inside; the methods are `async` so every failure — SQLITE_BUSY,
// a closed handle, a refused delta — arrives as a rejected promise, exactly as the seam
// promises. Claims travel as canonical JSON; rehydration recomputes each id from its claims. A
// row that no longer recomputes, or whose signature no longer verifies, is not laundered onward
// as healthy data — but neither does it brick the read (SPEC §25): it is SET ASIDE into the
// quarantine and the read PROCEEDS, so one bad row never darkens the whole store. What the
// quarantine holds is surfaced and settled by `loam repair`.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw (SQLITE_BUSY, a closed handle, a refused delta) into the
   rejected promise the seam promises. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  claimsToJson,
  computeId,
  makeDelta,
  parseClaims,
  verifyDelta,
  type Delta,
} from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import { canonicalDelta } from "./canon.js";
import { admit, previewOf, type QuarantinedRow, type RepairableBackend } from "./quarantine.js";

interface DeltaRow {
  readonly id: string;
  readonly claims: string;
  readonly sig: string | null;
}

export class SqliteBackend implements StoreBackend, RepairableBackend {
  private readonly db: Database.Database;
  // Ids known durable (read or written by this handle) — the cheap fast-path; UNIQUE(id) is the
  // real guard, and the count returned always comes from actual insert changes.
  private readonly onDisk = new Set<string>();
  // Rows the most recent read set aside (SPEC §25): recomputed on every deltasSince from the
  // table's own bytes, never a stored countdown. `loam repair` reads this back.
  private lastQuarantine: QuarantinedRow[] = [];
  // The ids whose rows were deleted under a WAL that could not be truncated — their pre-delete
  // page images may still be legible in the `-wal` sidecar. A SET, not a flag, because the debt
  // belongs to those ids alone: a handle-wide latch made every later purge refusable and every
  // later erasure un-completable while any unrelated reader held the WAL, failing erasures for
  // records this store never even had.
  //
  // AS DURABLE AS THE ERASURE IT BELONGS TO. The obligation outlives the handle: a crash between
  // the refused checkpoint and the operator's retry hands the new handle a clean-looking store
  // whose sidecar still carries the plaintext, and a debt that lived only in memory would let the
  // retry be refused as `nothing to erase` — the stranding this ticket exists to delete, moved
  // across a process boundary. So the set is mirrored into a one-row `meta` table (best-effort on
  // set, cleared when a checkpoint finally lands) and read back at open.
  private truncationOwed = new Set<string>();

  private readonly insertDelta: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    // WAL + busy timeout + NORMAL syncs: concurrent handles wait their turn; a crash loses at
    // most the last uncommitted transaction, which the CRDT tolerates (the writer re-sends).
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    // §11 is a promise about BYTES, not rows (ticket T40). SQLite's `secure_delete` defaults OFF,
    // so a DELETE unlinks the row while its content stays legible in freelist pages — after a
    // COMPLETED erasure, `strings store.db` still yielded the delta's claims. Every erasure rail we
    // had asserted at the API level (`get(id)` is undefined), which stays true across that leak,
    // which is why it survived until an audit read the file. ON makes SQLite zero the freed pages
    // as it frees them: the cost is paid on delete, which is rare here, rather than on every read.
    this.db.pragma("secure_delete = ON");
    // ...but `secure_delete` is CONNECTION-level and governs only pages freed FROM NOW ON. A store
    // that erased anything before this shipped keeps that plaintext in its freelist forever, and no
    // amount of future purging scrubs it — probed: reopening such a store and running fresh
    // appends/purges/checkpoints still yields the old content; only VACUUM clears it. Shipping a
    // §11 fix that leaves every existing store in violation is not a fix, so rebuild once when
    // there is inherited freelist to scrub. `freelist_count` is a cheap header read and is 0 on a
    // fresh store, so this is a no-op for anything created after this change. The cost is a
    // one-time rebuild on first open of a store that has erased before; correctness wins.
    const freelist = this.db.pragma("freelist_count", { simple: true }) as number;
    if (freelist > 0) this.db.exec("VACUUM");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deltas (
        seq    INTEGER PRIMARY KEY AUTOINCREMENT,
        id     TEXT NOT NULL UNIQUE,
        claims TEXT NOT NULL,
        sig    TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.insertDelta = this.db.prepare(
      "INSERT OR IGNORE INTO deltas (id, claims, sig) VALUES (?, ?, ?)",
    );
    this.selectAll = this.db.prepare("SELECT id, claims, sig FROM deltas ORDER BY seq");
    // A previous handle's unfinished truncation is this handle's debt from the first moment.
    const owed = this.db
      .prepare("SELECT value FROM meta WHERE key = 'truncation-outstanding'")
      .get() as { value: string } | undefined;
    if (owed !== undefined) {
      try {
        const ids = JSON.parse(owed.value) as unknown;
        if (Array.isArray(ids))
          for (const i of ids) if (typeof i === "string") this.truncationOwed.add(i);
      } catch {
        /* an unreadable debt row cannot name its ids; the purge path below re-earns or clears it */
      }
    }
  }

  private assertOpen(): void {
    if (!this.db.open) throw new Error("this store is closed");
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
      // The gate runs on EVERY delta, before the dedup fast-path: a forgery wearing a known id
      // is still a forgery, and it refuses the whole batch — never a silent skip.
      const canon = canonicalDelta(d);
      if (this.onDisk.has(canon.id) || seen.has(canon.id)) continue;
      seen.add(canon.id);
      fresh.push(canon);
    }
    if (fresh.length === 0) return 0;

    const stored: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const d of fresh) {
        const info = this.insertDelta.run(
          d.id,
          JSON.stringify(claimsToJson(d.claims)),
          d.sig ?? null,
        );
        if (info.changes > 0) stored.push(d.id);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      // Some failures (SQLITE_FULL/IOERR) auto-roll-back, making this ROLLBACK itself throw
      // "no transaction is active" — swallow that so the ORIGINAL error propagates.
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw err;
    }
    for (const id of stored) this.onDisk.add(id); // durable only after the commit
    return stored.length;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    const quarantine: QuarantinedRow[] = [];
    for (const row of this.selectAll.all() as DeltaRow[]) {
      // Parse the claims JSON up front so a row of pure garbage cannot throw past the admission
      // check — the whole point is that the read survives it.
      let rawClaims: unknown;
      try {
        rawClaims = JSON.parse(row.claims);
      } catch {
        quarantine.push({ key: row.id, reason: "unparseable", preview: previewOf(row.claims) });
        continue;
      }
      // The id column is the only id a table row carries, so it plays both filed and claimed id.
      const verdict = admit(row.id, row.id, rawClaims, row.sig ?? undefined, {
        parseClaims,
        computeId,
        makeDelta,
        verifyDelta,
      });
      if (!verdict.ok) {
        quarantine.push({
          key: row.id,
          reason: verdict.reason,
          preview: previewOf(row.claims),
          ...(verdict.negates !== undefined ? { negates: verdict.negates } : {}),
        });
        continue;
      }
      this.onDisk.add(row.id);
      if (knownIds.has(row.id)) continue;
      out.push(verdict.delta);
    }
    this.lastQuarantine = quarantine;
    return out;
  }

  // The rows the last read set aside (SPEC §25) — recomputed each deltasSince, never stored.
  async quarantine(): Promise<QuarantinedRow[]> {
    this.assertOpen();
    return this.lastQuarantine;
  }

  // Remove a quarantined row's bytes from the table (repair discard). A quarantined row is never
  // a lawful fact in the ground, so this is mechanical removal, not an erasure (§11).
  async discardRow(key: string): Promise<boolean> {
    this.assertOpen();
    const info = this.db.prepare("DELETE FROM deltas WHERE id = ?").run(key);
    if (info.changes > 0) {
      this.onDisk.delete(key);
      this.lastQuarantine = this.lastQuarantine.filter((r) => r.key !== key);
      return true;
    }
    return false;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    const remove = this.db.prepare("DELETE FROM deltas WHERE id = ?");
    const batch = [...ids];
    const deletedNow: string[] = []; // the ids whose images the WAL may hold if truncation fails
    let removed = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of batch) {
        if (remove.run(id).changes > 0) {
          removed += 1;
          deletedNow.push(id);
        }
        this.onDisk.delete(id); // and never mark a purged id durable
      }
      this.db.exec("COMMIT");
      // `secure_delete` zeroes the freed pages in the DATABASE; in WAL mode the delete is first
      // recorded in the -wal file, which still holds the pre-delete page images until a checkpoint
      // folds them in. So a purge is not complete until the WAL is checkpointed and TRUNCATED —
      // otherwise the bytes we just promised to forget sit beside the store in a file any backup
      // copies. TRUNCATE rather than PASSIVE: we want the -wal emptied, not merely applied.
      //
      // And CHECK THE RESULT. `wal_checkpoint` does not throw on contention — it RETURNS
      // `{busy, log, checkpointed}`, and a discarded return value is hazard H7 verbatim: an
      // operation with two outcomes reporting only the happy one. Probed with a second handle
      // holding a read transaction: `busy_timeout` is honored, then it gives up with `busy: 1`,
      // and the plaintext stays in `store.db-wal` while `purge` cheerfully returns its count.
      // §11 does not permit reporting a completeness we did not deliver, so this refuses loudly.
      // The rows ARE already deleted by then, so the message says exactly that — the caller holds
      // a partial erasure to retry, not a failed one to redo.
      //
      // ATTEMPTED unconditionally, but FAILING only for the ids that actually owe a truncation.
      // Gating the attempt on `removed > 0` was self-defeating — the retry finds nothing to delete
      // and skips the very checkpoint it exists to perform. Failing unconditionally was worse the
      // other way: pools and boot sweeps purge ids this store never held, and a busy checkpoint
      // there failed erasures that had completed everywhere they mattered. And a handle-wide latch
      // was worse again — once ANY erasure owed a truncation, every later purge on the handle
      // refused while any unrelated reader held the WAL, forever, across restarts. The debt
      // belongs to the ids whose pre-delete images the sidecar may hold: this call's deletions,
      // plus any prior owed id this call was asked about.
      const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      const busy = status !== undefined && status.busy !== 0;
      if (!busy) {
        // The sidecar is empty; nothing is owed by anyone — in memory and on disk.
        this.truncationOwed.clear();
        this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
      } else {
        for (const id of deletedNow) this.truncationOwed.add(id);
        const owedHere = deletedNow.length > 0 || batch.some((id) => this.truncationOwed.has(id));
        if (owedHere) {
          // Survives the throw AND the process: a crash before the retry hands the next handle a
          // clean-looking table over a sidecar still carrying the plaintext. Best-effort — if this
          // write also fails, the in-memory set still guards this handle, and the enclosing throw
          // already tells the operator the erasure is incomplete.
          try {
            this.db
              .prepare(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('truncation-outstanding', ?)",
              )
              .run(JSON.stringify([...this.truncationOwed]));
          } catch {
            /* the loud throw below is the primary signal */
          }
          throw new Error(
            `purge: the write-ahead log could not be truncated (a concurrent reader held it past ` +
              `busy_timeout). ${
                removed > 0
                  ? "The rows are deleted, but their plaintext may remain in the -wal sidecar"
                  : "No rows matched here — the outstanding work is an EARLIER purge's truncation, " +
                    "whose plaintext may remain in the -wal sidecar"
              }, so this erasure is INCOMPLETE (§11). Retry once the other handle is idle.`,
          );
        }
      }
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw err;
    }
    return removed;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    // An id whose truncation is owed is an id whose pre-delete page images may still sit in the
    // `-wal` sidecar: byte-presence is unprovable for THAT id, and unprovable answers TRUE (H9:
    // "could not check" must never read as "it is gone"). Scoped to the owing ids — a debt owed
    // by one erasure must not make every other record unprovable. This is also what un-strands
    // the post-restart retry: the tombstone anchors it, `holds` lets it through, and the retry's
    // own purge drives the checkpoint that clears the debt.
    if (this.truncationOwed.has(id)) return true;
    // A targeted lookup, not a scan: erasures are rare and the id is the primary key. This asks the
    // TABLE rather than `onDisk`, which is an index of what this handle wrote — a second handle's
    // row is still a row this store holds.
    return this.db.prepare("SELECT 1 FROM deltas WHERE id = ?").get(id) !== undefined;
  }

  async close(): Promise<void> {
    // Discharge the debt where it is actually discharged. Closing the last connection checkpoints
    // and unlinks the sidecar anyway — that is WHY a graceful shutdown settles the obligation —
    // but done implicitly it left the persisted debt row behind, and the reopened handle carried a
    // phantom: `holds` true over provably-absent bytes, and a second `erase` of a cleanly-erased
    // id riding that phantom through the retry bypass to a completion report for no work. So the
    // checkpoint runs explicitly, and only a SUCCESS clears the record — a busy checkpoint at
    // close leaves the debt standing, which is the honest state of a sidecar still unfolded.
    if (this.truncationOwed.size > 0 && this.db.open) {
      try {
        const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
        if (status === undefined || status.busy === 0) {
          this.truncationOwed.clear();
          this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
        }
      } catch {
        /* close() must still close; the debt row stays, which is the fail-closed direction */
      }
    }
    this.db.close();
  }
}
