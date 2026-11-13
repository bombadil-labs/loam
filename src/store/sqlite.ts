/* eslint-disable @typescript-eslint/require-await */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  claimsToJson,
  computeId,
  makeDelta,
  parseClaims,
  verifyDelta,
  type Delta,
  type DurableOrdinaryJournalStore,
} from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import type { PoolKeySource } from "./peer-image.js";
import { canonicalDelta } from "./canon.js";
import {
  admit,
  previewOf,
  type QuarantinedRow,
  type QuarantineReason,
  type RepairableBackend,
} from "./quarantine.js";

interface DeltaRow {
  readonly id: string;
  readonly claims: string;
  readonly sig: string | null;
}

const ADMISSION = { parseClaims, computeId, makeDelta, verifyDelta };

export interface SqliteOptions {
  readonly onScrubDeferred?: (reason: string) => void;
}

export class SqliteBackend implements StoreBackend, RepairableBackend {
  private readonly db: Database.Database;
  private readonly onDisk = new Set<string>();
  private lastQuarantine: QuarantinedRow[] = [];
  private truncationOwed = new Set<string>();
  private truncationUnknown = false;
  private deferredScrub: string | undefined;

  private readonly insertDelta: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(
    readonly filePath: string,
    private readonly opts: SqliteOptions = {},
  ) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new Database(filePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("secure_delete = ON");
    const freelist = this.db.pragma("freelist_count", { simple: true }) as number;
    if (freelist > 0) {
      try {
        this.db.exec("VACUUM");
        const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
        if (status === undefined || status.busy !== 0) {
          this.deferScrub(
            "the rebuilt pages could not be folded into the main file — a concurrent reader held " +
              "the write-ahead log past busy_timeout. The rebuild COMMITTED, so `freelist_count` " +
              "now reads 0 and a reopen will NOT retry this on its own; the pages remain in the " +
              "`-wal` sidecar until a later checkpoint folds them.",
          );
        }
      } catch (err) {
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
      CREATE TABLE IF NOT EXISTS journal_head (
        peer TEXT PRIMARY KEY,
        head TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal_checkpoint (
        peer       TEXT PRIMARY KEY,
        checkpoint BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS journal_rebase_debt (
        peer   TEXT NOT NULL,
        target TEXT NOT NULL,
        PRIMARY KEY (peer, target)
      );
      CREATE TABLE IF NOT EXISTS journal_frames (
        peer  TEXT NOT NULL,
        n     INTEGER NOT NULL,
        frame BLOB NOT NULL,
        PRIMARY KEY (peer, n)
      );
    `);
    this.insertDelta = this.db.prepare(
      "INSERT OR IGNORE INTO deltas (id, claims, sig) VALUES (?, ?, ?)",
    );
    this.selectAll = this.db.prepare("SELECT id, claims, sig FROM deltas ORDER BY seq");
    let owed = this.db
      .prepare("SELECT value FROM meta WHERE key = 'truncation-outstanding'")
      .get() as { value: string } | undefined;
    if (owed !== undefined && !existsSync(`${filePath}-wal`)) {
      this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
      owed = undefined;
    }
    if (owed !== undefined) {
      try {
        const ids = JSON.parse(owed.value) as unknown;
        if (Array.isArray(ids)) {
          for (const i of ids) {
            if (typeof i === "string") this.truncationOwed.add(i);
            else this.truncationUnknown = true;
          }
        } else {
          this.truncationUnknown = true;
        }
      } catch {
        this.truncationUnknown = true;
      }
    }
  }

  get scrubDeferred(): string | undefined {
    return this.deferredScrub;
  }

  private deferScrub(reason: string): void {
    this.deferredScrub =
      `sqlite: the one-time freelist scrub of ${this.filePath} is DEFERRED — ${reason} The store ` +
      `is open and correct, but plaintext from erasures older than \`secure_delete\` may still be ` +
      `legible in the file (§11).`;
    try {
      this.opts.onScrubDeferred?.(this.deferredScrub);
    } catch {}
  }

  private assertOpen(): void {
    if (!this.db.open) throw new Error("this store is closed");
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
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
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
    for (const id of stored) this.onDisk.add(id);
    return stored.length;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    const quarantine: QuarantinedRow[] = [];
    for (const row of this.selectAll.all() as DeltaRow[]) {
      let rawClaims: unknown;
      try {
        rawClaims = JSON.parse(row.claims);
      } catch {
        quarantine.push({ key: row.id, reason: "unparseable", preview: previewOf(row.claims) });
        continue;
      }
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

  async quarantine(): Promise<QuarantinedRow[]> {
    this.assertOpen();
    return this.lastQuarantine;
  }

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

  private admissible(id: string, claimsJson: string, sig: string | null): boolean {
    let raw: unknown;
    try {
      raw = JSON.parse(claimsJson);
    } catch {
      return false;
    }
    return admit(id, id, raw, sig ?? undefined, ADMISSION).ok;
  }

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
          continue;
        }
        const claims = JSON.stringify(claimsToJson(canon.claims));
        const sig = canon.sig ?? null;
        if (!this.admissible(canon.id, claims, sig)) continue;
        const row = read.get(canon.id) as Pick<DeltaRow, "claims" | "sig"> | undefined;
        if (row === undefined) continue;
        if (this.admissible(canon.id, row.claims, row.sig)) continue;
        if (replace.run(claims, sig, canon.id).changes > 0) restored.push(canon.id);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
    for (const id of restored) this.onDisk.add(id);
    const done = new Set(restored);
    this.lastQuarantine = this.lastQuarantine.filter((r) => !done.has(r.key));
    return restored;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    const remove = this.db.prepare("DELETE FROM deltas WHERE id = ?");
    const batch = [...ids];
    const deletedNow: string[] = [];
    let removed = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const id of batch) {
        if (remove.run(id).changes > 0) {
          removed += 1;
          deletedNow.push(id);
        }
        this.onDisk.delete(id);
      }
      if (deletedNow.length > 0) {
        for (const id of deletedNow) this.truncationOwed.add(id);
        this.db
          .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('truncation-outstanding', ?)")
          .run(JSON.stringify([...this.truncationOwed]));
      }
      this.db.exec("COMMIT");
      const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      const busy = status === undefined || status.busy !== 0;
      if (!busy) {
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
      } catch {}
      throw err;
    }
    return removed;
  }

  private holdsNow(id: string): boolean {
    if (this.truncationUnknown || this.truncationOwed.has(id)) return true;
    const debt = this.db
      .prepare("SELECT value FROM meta WHERE key = 'truncation-outstanding'")
      .get() as { value: string } | undefined;
    if (debt !== undefined) {
      try {
        const ids = JSON.parse(debt.value) as unknown;
        if (!Array.isArray(ids) || ids.includes(id) || ids.some((x) => typeof x !== "string")) {
          return true;
        }
      } catch {
        return true;
      }
    }
    return this.db.prepare("SELECT 1 FROM deltas WHERE id = ?").get(id) !== undefined;
  }

  setAside(rows: readonly { id: string; reason: string }[]): void {
    const preview = this.db.prepare("SELECT claims FROM deltas WHERE id = ?");
    const out: QuarantinedRow[] = [];
    for (const { id, reason } of rows) {
      const r = preview.get(id) as { claims: string } | undefined;
      if (r === undefined) continue;
      const why: QuarantineReason = /unparseable/i.test(reason)
        ? "unparseable"
        : /sig/i.test(reason)
          ? "invalid-signature"
          : "id-mismatch";
      out.push({ key: id, reason: why, preview: previewOf(r.claims) });
    }
    this.lastQuarantine = out;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    if (this.truncationUnknown || this.truncationOwed.has(id)) return true;
    return this.db.prepare("SELECT 1 FROM deltas WHERE id = ?").get(id) !== undefined;
  }

  async revision(): Promise<string> {
    this.assertOpen();
    return String(this.db.pragma("data_version", { simple: true }));
  }

  async holdsAny(): Promise<boolean> {
    this.assertOpen();
    if (this.truncationUnknown || this.truncationOwed.size > 0) return true;
    return (
      (await this.holdsAnyRow()) ||
      this.db.prepare("SELECT 1 FROM journal_head LIMIT 1").get() !== undefined ||
      this.db.prepare("SELECT 1 FROM journal_frames LIMIT 1").get() !== undefined ||
      this.db.prepare("SELECT 1 FROM journal_checkpoint LIMIT 1").get() !== undefined
    );
  }

  async holdsAnyRow(): Promise<boolean> {
    this.assertOpen();
    if (this.truncationUnknown || this.truncationOwed.size > 0) return true;
    return this.db.prepare("SELECT 1 FROM deltas LIMIT 1").get() !== undefined;
  }

  async discardJournals(): Promise<void> {
    this.assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "journal_frames",
        "journal_checkpoint",
        "journal_head",
        "journal_rebase_debt",
      ]) {
        this.db.prepare(`DELETE FROM ${table}`).run();
      }
      this.db.prepare("DELETE FROM meta WHERE key = 'rebase-wal-outstanding'").run();
      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw err;
    }
    const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
    if (status === undefined || status.busy !== 0) {
      throw new Error("the journal was discarded, but its pages may still sit in the -wal sidecar");
    }
  }

  async ids(): Promise<Set<string>> {
    this.assertOpen();
    if (this.truncationUnknown)
      throw new Error(
        "this store owes a truncation whose ids it cannot name: its inventory is unprovable",
      );
    const out = new Set<string>(this.truncationOwed);
    for (const row of this.db.prepare("SELECT id FROM deltas").all() as { id: string }[])
      out.add(row.id);
    return out;
  }

  private store: DurableOrdinaryJournalStore | undefined;

  async journalPeers(): Promise<string[]> {
    this.assertOpen();
    return (this.db.prepare("SELECT peer FROM journal_head").all() as { peer: string }[]).map(
      (r) => r.peer,
    );
  }

  journalStore(): DurableOrdinaryJournalStore {
    const headOf = (peer: string): string | undefined =>
      (
        this.db.prepare("SELECT head FROM journal_head WHERE peer = ?").get(peer) as
          { head: string } | undefined
      )?.head;
    const hasRows = (): boolean =>
      this.db.prepare("SELECT 1 FROM deltas LIMIT 1").get() !== undefined;
    const rowFor = this.db.prepare("SELECT id, claims, sig FROM deltas WHERE id = ?");
    const settleRebaseWal = (): void => {
      if (
        this.db.prepare("SELECT 1 FROM meta WHERE key = 'rebase-wal-outstanding'").get() ===
        undefined
      ) {
        return;
      }
      const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
      if (status !== undefined && status.busy === 0) {
        this.db.prepare("DELETE FROM meta WHERE key = 'rebase-wal-outstanding'").run();
      }
    };
    const rollback = (): void => {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
    };
    const commitFrame = (
      peerId: string,
      nextHead: string,
      frame: Uint8Array | null,
      rows: readonly Delta[],
    ): string[] => {
      const stored: string[] = [];
      for (const d of rows) {
        const info = this.insertDelta.run(
          d.id,
          JSON.stringify(claimsToJson(d.claims)),
          d.sig ?? null,
        );
        if (info.changes > 0) stored.push(d.id);
      }
      if (frame !== null) {
        const next = (
          this.db
            .prepare("SELECT COALESCE(MAX(n), -1) + 1 AS n FROM journal_frames WHERE peer = ?")
            .get(peerId) as { n: number }
        ).n;
        this.db
          .prepare("INSERT INTO journal_frames (peer, n, frame) VALUES (?, ?, ?)")
          .run(peerId, next, Buffer.from(frame));
      }
      this.db
        .prepare("INSERT OR REPLACE INTO journal_head (peer, head) VALUES (?, ?)")
        .run(peerId, nextHead);
      return stored;
    };
    return (this.store ??= {
      readJournal: async (peerId) => {
        this.assertOpen();
        return this.db.transaction(() => {
          const head = headOf(peerId);
          if (head === undefined) {
            return hasRows()
              ? ({ status: "rows-without-journal" } as const)
              : ({ status: "empty" } as const);
          }
          const frames = (
            this.db
              .prepare("SELECT frame FROM journal_frames WHERE peer = ? ORDER BY n")
              .all(peerId) as { frame: Buffer }[]
          ).map((r) => new Uint8Array(r.frame));
          const cp = this.db
            .prepare("SELECT checkpoint FROM journal_checkpoint WHERE peer = ?")
            .get(peerId) as { checkpoint: Buffer } | undefined;
          return cp === undefined
            ? ({ status: "journal", head, frames } as const)
            : ({
                status: "journal",
                head,
                frames,
                checkpoint: new Uint8Array(cp.checkpoint),
              } as const);
        })();
      },
      readAdmittedRows: async (_peerId, ids) => {
        this.assertOpen();
        const out: Delta[] = [];
        for (const id of ids) {
          const row = rowFor.get(id) as DeltaRow | undefined;
          if (row === undefined) continue;
          try {
            const claims = parseClaims(JSON.parse(row.claims));
            out.push(
              row.sig === null ? { id: row.id, claims } : { id: row.id, claims, sig: row.sig },
            );
          } catch {
            continue;
          }
        }
        return out;
      },
      readAdmittedRowsDegraded: async (_peerId, ids) => {
        this.assertOpen();
        return ids.map((id) => {
          const row = rowFor.get(id) as DeltaRow | undefined;
          if (row === undefined) return { id, fault: "missing" };
          try {
            const claims = parseClaims(JSON.parse(row.claims));
            return { id, row: row.sig === null ? { id, claims } : { id, claims, sig: row.sig } };
          } catch {
            return { id, fault: "unparseable" };
          }
        });
      },
      readHead: async (peerId) => {
        this.assertOpen();
        const head = headOf(peerId);
        return head === undefined ? { status: "missing" } : { status: "head", head };
      },
      compareAndAppendErasure: async (
        peerId,
        expectedHead,
        nextHead,
        frame,
        newlyAdmitted,
        assertedAbsentTargetIds,
      ) => {
        this.assertOpen();
        const batch = newlyAdmitted.map(canonicalDelta);
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (headOf(peerId) !== expectedHead) {
            this.db.exec("ROLLBACK");
            return { status: "conflict" };
          }
          const held = assertedAbsentTargetIds.find((id) => this.holdsNow(id));
          if (held !== undefined) {
            this.db.exec("ROLLBACK");
            return { status: "absence-refuted", targetId: held };
          }
          commitFrame(peerId, nextHead, frame, batch);
          const debt = this.db.prepare(
            "INSERT OR IGNORE INTO journal_rebase_debt (peer, target) VALUES (?, ?)",
          );
          for (const d of batch) {
            for (const p of d.claims.pointers) {
              if (p.role === "erases" && p.target.kind === "delta") {
                debt.run(peerId, p.target.deltaRef.delta);
              }
            }
          }
          this.db.exec("COMMIT");
        } catch (err) {
          rollback();
          throw err;
        }
        for (const d of batch) this.onDisk.add(d.id);
        return { status: "durable" };
      },
      compareAndRebase: async (peerId, expectedHead, nextHead, checkpoint) => {
        this.assertOpen();
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (headOf(peerId) !== expectedHead) {
            this.db.exec("ROLLBACK");
            return { status: "conflict" };
          }
          this.db.prepare("DELETE FROM journal_frames WHERE peer = ?").run(peerId);
          this.db
            .prepare("INSERT OR REPLACE INTO journal_checkpoint (peer, checkpoint) VALUES (?, ?)")
            .run(peerId, Buffer.from(checkpoint));
          this.db
            .prepare("INSERT OR REPLACE INTO journal_head (peer, head) VALUES (?, ?)")
            .run(peerId, nextHead);
          this.db.prepare("DELETE FROM journal_rebase_debt WHERE peer = ?").run(peerId);
          this.db
            .prepare(
              "INSERT OR REPLACE INTO meta (key, value) VALUES ('rebase-wal-outstanding', ?)",
            )
            .run(peerId);
          this.db.exec("COMMIT");
        } catch (err) {
          rollback();
          throw err;
        }
        settleRebaseWal();
        return { status: "durable" };
      },
      compareAndSettlePurge: async (peerId, expectedHead, nextHead, frame, targetId) => {
        this.assertOpen();
        settleRebaseWal();
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (headOf(peerId) !== expectedHead) {
            this.db.exec("ROLLBACK");
            return { status: "conflict" };
          }
          const refuted =
            this.holdsNow(targetId) ||
            this.db
              .prepare("SELECT 1 FROM journal_rebase_debt WHERE peer = ? AND target = ?")
              .get(peerId, targetId) !== undefined ||
            this.db.prepare("SELECT 1 FROM meta WHERE key = 'rebase-wal-outstanding'").get() !==
              undefined;
          if (refuted) {
            this.db.exec("ROLLBACK");
            return { status: "absence-refuted", targetId };
          }
          commitFrame(peerId, nextHead, frame, []);
          this.db.exec("COMMIT");
        } catch (err) {
          rollback();
          throw err;
        }
        return { status: "durable" };
      },
      compareAndAppend: async (peerId, expectedHead, nextHead, frame, newlyAdmitted) => {
        this.assertOpen();
        const batch = newlyAdmitted.map(canonicalDelta);
        const stored: string[] = [];
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const head = headOf(peerId);
          const matches =
            expectedHead === null ? head === undefined && !hasRows() : head === expectedHead;
          if (!matches) {
            this.db.exec("ROLLBACK");
            return { status: "conflict" };
          }
          for (const d of batch) {
            const info = this.insertDelta.run(
              d.id,
              JSON.stringify(claimsToJson(d.claims)),
              d.sig ?? null,
            );
            if (info.changes > 0) stored.push(d.id);
          }
          if (frame !== null) {
            const next = (
              this.db
                .prepare("SELECT COALESCE(MAX(n), -1) + 1 AS n FROM journal_frames WHERE peer = ?")
                .get(peerId) as { n: number }
            ).n;
            this.db
              .prepare("INSERT INTO journal_frames (peer, n, frame) VALUES (?, ?, ?)")
              .run(peerId, next, Buffer.from(frame));
          }
          this.db
            .prepare("INSERT OR REPLACE INTO journal_head (peer, head) VALUES (?, ?)")
            .run(peerId, nextHead);
          this.db.exec("COMMIT");
        } catch (err) {
          try {
            this.db.exec("ROLLBACK");
          } catch {}
          throw err;
        }
        for (const id of stored) this.onDisk.add(id);
        return { status: "durable" };
      },
    });
  }

  poolKeys(): PoolKeySource {
    const path = `${this.filePath}.poolkeys.json`;
    const read = (): Record<string, string> =>
      existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>) : {};
    return {
      load: (pool) => read()[pool],
      create: (pool) => {
        const all = read();
        const seed = randomBytes(32).toString("hex");
        all[pool] = seed;
        writeFileSync(`${path}.tmp`, JSON.stringify(all), { mode: 0o600 });
        renameSync(`${path}.tmp`, path);
        return seed;
      },
    };
  }

  async close(): Promise<void> {
    if ((this.truncationOwed.size > 0 || this.truncationUnknown) && this.db.open) {
      try {
        const [status] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number }>;
        if (status !== undefined && status.busy === 0) {
          this.truncationOwed.clear();
          this.truncationUnknown = false;
          this.db.prepare("DELETE FROM meta WHERE key = 'truncation-outstanding'").run();
        }
      } catch {}
    }
    this.db.close();
  }
}
