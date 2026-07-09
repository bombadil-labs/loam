// The durable driver: one deltas table keyed by content-addressed id (UNIQUE is the CRDT dedup),
// WAL + busy-timeout as the multi-handle provision, one IMMEDIATE transaction per append batch.
// Ids are marked durable only AFTER commit — a rollback undoes rows, never a Set, and an id
// marked durable-but-rolled-back would be skipped forever after.
//
// better-sqlite3 is synchronous inside; the methods are `async` so every failure — SQLITE_BUSY,
// a closed handle, a refused delta — arrives as a rejected promise, exactly as the seam
// promises. Claims travel as canonical JSON; rehydration recomputes each id from its claims and
// REFUSES a row whose id does not recompute — corruption is an error, never a quiet new delta.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw (SQLITE_BUSY, a closed handle, a refused delta) into the
   rejected promise the seam promises. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { claimsToJson, computeId, makeDelta, parseClaims, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import { canonicalDelta } from "./canon.js";

interface DeltaRow {
  readonly id: string;
  readonly claims: string;
  readonly sig: string | null;
}

export class SqliteBackend implements StoreBackend {
  private readonly db: Database.Database;
  // Ids known durable (read or written by this handle) — the cheap fast-path; UNIQUE(id) is the
  // real guard, and the count returned always comes from actual insert changes.
  private readonly onDisk = new Set<string>();

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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deltas (
        seq    INTEGER PRIMARY KEY AUTOINCREMENT,
        id     TEXT NOT NULL UNIQUE,
        claims TEXT NOT NULL,
        sig    TEXT
      );
    `);
    this.insertDelta = this.db.prepare(
      "INSERT OR IGNORE INTO deltas (id, claims, sig) VALUES (?, ?, ?)",
    );
    this.selectAll = this.db.prepare("SELECT id, claims, sig FROM deltas ORDER BY seq");
  }

  private assertOpen(): void {
    if (!this.db.open) throw new Error("this store is closed");
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
      if (this.onDisk.has(d.id) || seen.has(d.id)) continue;
      seen.add(d.id);
      fresh.push(canonicalDelta(d)); // refuses a forged id before anything touches the disk
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
    for (const row of this.selectAll.all() as DeltaRow[]) {
      const claims = parseClaims(JSON.parse(row.claims));
      if (computeId(claims) !== row.id) {
        throw new Error(
          `store corruption: row ${row.id} does not recompute from its claims — refusing to read`,
        );
      }
      this.onDisk.add(row.id);
      if (knownIds.has(row.id)) continue;
      out.push(makeDelta(claims, row.sig ?? undefined));
    }
    return out;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
