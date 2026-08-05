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
import { existsSync, mkdirSync } from "node:fs";
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

// The rhizomatic authorities `admit` runs on. One object, so the read path and the restore door
// cannot drift on what "admissible" means — the whole value of the restore check is that it asks
// exactly the question the next boot's read will ask.
const ADMISSION = { parseClaims, computeId, makeDelta, verifyDelta };

export interface SqliteOptions {
  // Called when the one-time open scrub (below) could not be completed. Wire this to a log: the
  // store is open and correct either way, but a deferral means plaintext from erasures older than
  // `secure_delete` may still be legible in the file, and only saying so keeps that honest.
  readonly onScrubDeferred?: (reason: string) => void;
}

export class SqliteBackend implements StoreBackend, RepairableBackend {
  private readonly db: Database.Database;
  // Ids known durable (read or written by this handle) — the cheap fast-path; UNIQUE(id) is the
  // real guard, and the count returned always comes from actual insert changes.
  private readonly onDisk = new Set<string>();
  // Rows the most recent read set aside (SPEC §25): recomputed on every deltasSince from the
  // table's own bytes, never a stored countdown. `loam repair` reads this back.
  private lastQuarantine: QuarantinedRow[] = [];
  // Ids whose rows were deleted under a WAL that could not be truncated — their pre-delete page
  // images may still be legible in the `-wal` sidecar. A SET, not a handle-wide flag: the debt
  // belongs to those ids alone, so unrelated purges and erasures stay completable.
  // As durable as the erasure it belongs to — mirrored into the `meta` table and read back at
  // open, or a crash before the retry would leave a clean-looking store whose sidecar still
  // carries the plaintext and a retry refused as `nothing to erase`.
  private truncationOwed = new Set<string>();
  // Set when the persisted debt row exists but cannot be read: the debt is real and its ids are
  // unknown, so EVERY id is unprovable until a checkpoint lands (H9 — an unreadable debt must
  // never read as "nothing owed"). Cleared exactly where the owed set is.
  private truncationUnknown = false;
  // Why the one-time open scrub did not finish, or undefined if it finished (or was never owed).
  private deferredScrub: string | undefined;

  private readonly insertDelta: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(
    readonly filePath: string,
    private readonly opts: SqliteOptions = {},
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    // WAL + busy timeout + NORMAL syncs: concurrent handles wait their turn; a crash loses at
    // most the last uncommitted transaction, which the CRDT tolerates (the writer re-sends).
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    // §11 is a promise about BYTES, not rows (ticket T40). SQLite's `secure_delete` defaults OFF,
    // so a DELETE unlinks the row while its content stays legible in freelist pages — after a
    // COMPLETED erasure, `strings store.db` still yields the delta's claims. API-level erasure
    // rails (`get(id)` is undefined) stay true across that leak. ON makes SQLite zero the freed
    // pages as it frees them: the cost is paid on delete, which is rare here, rather than on every
    // read.
    this.db.pragma("secure_delete = ON");
    // ...but `secure_delete` is CONNECTION-level and governs only pages freed FROM NOW ON. A store
    // that erased anything before this shipped keeps that plaintext in its freelist forever, and no
    // amount of future purging scrubs it — only VACUUM clears it. Shipping a §11 fix that leaves
    // every existing store in violation is not a fix, so rebuild once when there is inherited
    // freelist to scrub. `freelist_count` is a cheap header read; the trigger is a PROXY, not a
    // detector — it fires after ANY delete (even pages `secure_delete` already zeroed, so a scrub
    // of a fresh store is harmless work) and it cannot tell inherited plaintext from a scrubbed
    // freelist. The cost is a rebuild on open of a store that has freed pages; correctness wins
    // either way.
    // ...and it is BEST-EFFORT, never open-blocking. VACUUM wants an exclusive write lock over the
    // whole file and this constructor is not async, so a second handle mid-append would turn
    // `new SqliteBackend(path)` into a synchronous SQLITE_BUSY — a throw the seam has no rejected
    // promise for, out of the one call that used to take no lock at all. A store that will not OPEN
    // is a worse §11 story than a scrub deferred to a later open. `freelist_count` re-triggers that
    // later scrub ONLY while the rebuild has not committed — a REFUSED VACUUM leaves the freelist
    // positive and self-heals. A COMMITTED VACUUM whose fold was deferred does NOT: it reads 0
    // through the WAL and this trigger goes blind to it (see the checkpoint branch below). Fully
    // closing that second case wants a durable scrub watermark — a decision tracked on T49, not
    // built here — so nothing is persisted yet.
    const freelist = this.db.pragma("freelist_count", { simple: true }) as number;
    if (freelist > 0) {
      try {
        this.db.exec("VACUUM");
        // In WAL mode the rebuilt pages land in the `-wal` sidecar and the main file keeps its
        // legible freelist until a checkpoint folds them in — so the scrub is not AT REST until
        // this lands, and a process killed before `close()` would leave the plaintext behind while
        // the handle's own `freelist_count` read 0. CHECKED, like the purge path's: `wal_checkpoint`
        // does not throw on contention, it RETURNS `busy`, and a discarded result is H7 verbatim.
        const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
        if (status === undefined || status.busy !== 0) {
          // The rebuild COMMITTED but its pages could not be folded in. This is NOT self-healing:
          // a committed VACUUM leaves `freelist_count` reading 0 through the WAL, so the next open's
          // `> 0` trigger skips the whole block — the rebuilt pages sit in the `-wal` sidecar until
          // some incidental checkpoint folds them, and a crash before then leaves the plaintext at
          // rest with nothing to re-detect it. Closing that needs a durable scrub watermark, which
          // this ticket defers to a decision (tracked on T49), not a §11 promise broken here.
          this.deferScrub(
            "the rebuilt pages could not be folded into the main file — a concurrent reader held " +
              "the write-ahead log past busy_timeout. The rebuild COMMITTED, so `freelist_count` " +
              "now reads 0 and a reopen will NOT retry this on its own; the pages remain in the " +
              "`-wal` sidecar until a later checkpoint folds them.",
          );
        }
      } catch (err) {
        // The rebuild never committed, so `freelist_count` stays positive and the next uncontended
        // open re-runs this scrub — self-healing, and the message says so.
        this.deferScrub(
          `the rebuild was refused — ${err instanceof Error ? err.message : String(err)}. ` +
            "`freelist_count` stays positive, so the next uncontended open retries this scrub.",
        );
      }
    }
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
    let owed = this.db
      .prepare("SELECT value FROM meta WHERE key = 'truncation-outstanding'")
      .get() as { value: string } | undefined;
    // A debt row whose sidecar no longer exists is provably moot — a later checkpoint truncated
    // and unlinked the -wal after the row was written. Trusting the stale row would make holds()
    // a permanent false positive for its ids and hand erase() a phantom to "complete".
    if (owed !== undefined && !existsSync(`${filePath}-wal`)) {
      this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
      owed = undefined;
    }
    if (owed !== undefined) {
      try {
        const ids = JSON.parse(owed.value) as unknown;
        // Braces are load-bearing: a dangling else here bound to the inner if, letting valid
        // non-array JSON owe nothing.
        if (Array.isArray(ids)) {
          for (const i of ids) {
            if (typeof i === "string") this.truncationOwed.add(i);
            else this.truncationUnknown = true; // a non-string entry is a debt it cannot name
          }
        } else {
          this.truncationUnknown = true; // a debt row that is not an id list still owes
        }
      } catch {
        // An unreadable debt row cannot name its ids — which makes every id unprovable, not
        // none of them (H9).
        this.truncationUnknown = true;
      }
    }
  }

  // Why the one-time open scrub was deferred — undefined when there was nothing to scrub or the
  // scrub completed. Set means the store is open and correct while inherited freelist plaintext may
  // still be legible in the file (§11). Whether an uncontended reopen re-triggers the scrub depends
  // on the branch, and the message says which — see `deferScrub`.
  get scrubDeferred(): string | undefined {
    return this.deferredScrub;
  }

  // The scrub could not finish. It is reported and not swallowed, on two surfaces because they have
  // different readers: the callback is the operator's line in the log, and `scrubDeferred` answers
  // an embedder that never wired one. A `catch {}` here would fix one silent outcome by introducing
  // another. The recovery story differs by branch, so each caller states its own in `reason` — this
  // frame carries only what is true of both.
  private deferScrub(reason: string): void {
    this.deferredScrub =
      `sqlite: the one-time freelist scrub of ${this.filePath} is DEFERRED — ${reason} The store ` +
      `is open and correct, but plaintext from erasures older than \`secure_delete\` may still be ` +
      `legible in the file (§11).`;
    try {
      this.opts.onScrubDeferred?.(this.deferredScrub);
    } catch {
      // A reporter that throws — stderr closed on the other end is an ordinary EPIPE — must not
      // wedge the open either, which is the whole point of getting here. The report survives on
      // `scrubDeferred`, the one surface that cannot fail.
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
      const verdict = admit(row.id, row.id, rawClaims, row.sig ?? undefined, ADMISSION);
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

  // Would a row with these bytes ADMIT — the same question the read path asks, asked of one row's
  // stored form. Unreadable bytes answer FALSE, which here means "do not treat this as healthy": on
  // the incoming side that refuses a write, and on the existing side it permits one. Both are the
  // direction that cannot launder damage.
  private admissible(id: string, claimsJson: string, sig: string | null): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(claimsJson);
    } catch {
      return false;
    }
    return admit(id, id, raw, sig ?? undefined, ADMISSION).ok;
  }

  // Replace a corrupt row that SQUATS on its id with a healthy copy of that same delta (T66/§25).
  // `id` is UNIQUE and `append` is INSERT OR IGNORE, so replanting the archive's good copy of a row
  // this driver set aside inserts nothing and reports 0 — and the strike such a row carries stays
  // stranded across every reboot. This is the door that moves it, and it decides from the TABLE on
  // every call, never from `lastQuarantine`: that pen is what the last read saw, and a second handle
  // may have repaired the row since.
  //
  //   (i)  the incoming delta must ADMIT — canonicalized (so its id recomputes and its strings are
  //        well-formed), then run through the very `admit` the read path runs, over the exact bytes
  //        about to be written. A delta that would not survive the next boot's read is never stored.
  //   (ii) the row currently filed under that id must NOT admit. An admitted row is never replaced,
  //        by any caller, for any reason — an UNSIGNED delta admits (`verifyDelta` answers
  //        "unsigned", not "invalid"), so without this check a "repair" could strip a verified
  //        signature off a good row.
  //
  // One IMMEDIATE transaction holds the (ii) read and the write together, so no concurrent handle
  // can repair a row inside that window. An UPDATE rather than DELETE+INSERT: `seq` survives so read
  // order does not churn, and no id leaves the table, leaving §11's `truncationOwed`/`holds`
  // bookkeeping untouched. The displaced bytes are NOT scrubbed from the WAL or a freed page —
  // deliberate parity with `discardRow`, since a quarantined row is not a lawful fact in the ground
  // and its removal carries no §11 completeness claim.
  //
  // A delta this refuses is SKIPPED, not thrown: the return value names what was replaced, so a
  // caller learns of every id that did not move (heal reports them as `restoreRefused`), and one
  // unwritable delta must not block the recovery of the rest of a boot's batch.
  async restoreQuarantined(deltas: Iterable<Delta>): Promise<readonly string[]> {
    this.assertOpen();
    const batch = [...deltas];
    if (batch.length === 0) return [];
    const read = this.db.prepare("SELECT claims, sig FROM deltas WHERE id = ?");
    const replace = this.db.prepare("UPDATE deltas SET claims = ?, sig = ? WHERE id = ?");
    const restored: string[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const d of batch) {
        let canon: Delta;
        try {
          canon = canonicalDelta(d);
        } catch {
          continue; // not storable as itself — refusing to write is the safe direction
        }
        const claims = JSON.stringify(claimsToJson(canon.claims));
        const sig = canon.sig ?? null;
        if (!this.admissible(canon.id, claims, sig)) continue; // (i)
        const row = read.get(canon.id) as Pick<DeltaRow, "claims" | "sig"> | undefined;
        if (row === undefined) continue; // nothing squatting — planting a delta is `append`'s job
        if (this.admissible(canon.id, row.claims, row.sig)) continue; // (ii)
        if (replace.run(claims, sig, canon.id).changes > 0) restored.push(canon.id);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw err;
    }
    // Durable only after the commit, exactly as `append` does it.
    for (const id of restored) this.onDisk.add(id);
    const done = new Set(restored);
    this.lastQuarantine = this.lastQuarantine.filter((r) => !done.has(r.key));
    return restored;
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
      // The debt rides the SAME transaction as the deletions it describes: written after COMMIT,
      // a crash in the gap would leave deleted rows whose WAL images no reopened handle knew to
      // distrust. Both land or neither does; the checkpoint below clears it on the happy path.
      if (deletedNow.length > 0) {
        for (const id of deletedNow) this.truncationOwed.add(id);
        this.db
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('truncation-outstanding', ?)")
          .run(JSON.stringify([...this.truncationOwed]));
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
      // Attempted unconditionally, but FAILING only for the ids that actually owe a truncation:
      // gating the attempt on `removed > 0` skips the very checkpoint a retry exists to perform,
      // while failing unconditionally fails erasures for ids this store never held (pools and
      // boot sweeps purge those routinely). The debt is this call's deletions plus any prior
      // owed id this call was asked about.
      const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      // A result this code cannot read is NOT a success — treating an absent row as "truncated"
      // would clear a real debt on evidence of nothing (H9).
      const busy = status === undefined || status.busy !== 0;
      if (!busy) {
        // The sidecar is empty; nothing is owed by anyone — in memory and on disk.
        this.truncationOwed.clear();
        this.truncationUnknown = false;
        this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
      } else {
        const owedHere =
          deletedNow.length > 0 ||
          this.truncationUnknown ||
          batch.some((id) => this.truncationOwed.has(id));
        if (owedHere) {
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
    // An id whose truncation is owed may still have pre-delete page images in the `-wal`
    // sidecar: byte-presence is unprovable for THAT id, and unprovable answers TRUE, never
    // false (H9). Scoped to the owing ids — one erasure's debt must not make every record
    // unprovable.
    if (this.truncationUnknown || this.truncationOwed.has(id)) return true;
    // Asks the TABLE, not `onDisk` — that index records only what this handle wrote, and a
    // second handle's row is still a row this store holds.
    return this.db.prepare("SELECT 1 FROM deltas WHERE id = ?").get(id) !== undefined;
  }

  async close(): Promise<void> {
    // Closing the last connection checkpoints and unlinks the sidecar anyway, but done
    // implicitly it leaves the persisted debt row behind — a phantom `holds` true over
    // provably-absent bytes. So checkpoint explicitly, and only a SUCCESS clears the record:
    // a busy checkpoint at close leaves the debt standing, the honest state of an unfolded sidecar.
    if ((this.truncationOwed.size > 0 || this.truncationUnknown) && this.db.open) {
      try {
        const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
        if (status !== undefined && status.busy === 0) {
          this.truncationOwed.clear();
          this.truncationUnknown = false;
          this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
        }
      } catch {
        /* close() must still close; the debt row stays, which is the fail-closed direction */
      }
    }
    this.db.close();
  }
}
