// The cold driver — the seed vault. An archive is a directory of canonical delta files,
// `<root>/<id[0..2)>/<id>.json`, each holding `{ claims, sig? }` in the JSON profile. The
// FILENAME is the content address, which buys the three properties a backup wants:
//
//   - The layout is stable and inert: rsync it, tar it, mail it — plain file tools are backup
//     tools, and copying files between two archives IS replication (union by name).
//   - A file cannot be forged by renaming: a row that does not recompute to its own name is
//     corruption, refused at read like every other driver refuses it.
//   - Writes are idempotent for free: the same delta is the same filename is the same bytes.
//
// Stray files are tolerated where humans leave them (the root, non-.json clutter in the fan) —
// a README in the vault should not poison the vault. But a `.json` file inside the fan claims
// to be a delta, and one that cannot be read back is corruption, never skipped. Refused, never
// repaired extends to never OVERWRITING: a corrupt file squatting on an id's name makes a
// re-append of the genuine delta a skip (the name exists), so the operator's move is to delete
// the bad file — the next heal rewrites it from the primary's healthy copy.
//
// Batch atomicity, honestly: VALIDATION is atomic (the whole batch is gated before any file is
// written), matching the contract's refusal semantics. An IO failure mid-batch may leave a
// prefix of files behind — which union semantics render harmless: re-appending is a no-op.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw into the rejected promise the seam promises. */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
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

interface ArchiveRow {
  readonly claims: unknown;
  readonly sig?: string;
}

export class ArchiveBackend implements StoreBackend {
  private closed = false;
  // Ids known on disk (read or written by this handle) — the cheap fast-path; the filesystem
  // itself is the real guard, re-walked on every read like sqlite re-selects.
  private readonly onDisk = new Set<string>();

  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("this store is closed");
  }

  private fileFor(id: string): string {
    return join(this.root, id.slice(0, 2), `${id}.json`);
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    // Gate the WHOLE batch before touching the disk: one refused delta refuses the lot, and
    // nothing of a refused batch is ever written.
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
      const canon = canonicalDelta(d);
      if (this.onDisk.has(canon.id) || seen.has(canon.id)) continue;
      seen.add(canon.id);
      fresh.push(canon);
    }
    let stored = 0;
    for (const d of fresh) {
      const target = this.fileFor(d.id);
      if (existsSync(target)) {
        this.onDisk.add(d.id); // another handle got here first — same name, same bytes
        continue;
      }
      mkdirSync(join(this.root, d.id.slice(0, 2)), { recursive: true });
      const row: ArchiveRow = {
        claims: claimsToJson(d.claims),
        ...(d.sig !== undefined && { sig: d.sig }),
      };
      // Write, FSYNC, then rename: the bytes are durable before the real name exists, so
      // neither a process crash nor a power loss leaves a half-written delta wearing a real
      // name — at worst a `.tmp` straggler, which reads ignore (and nothing yet collects).
      // The rename's own directory entry rides the OS's rename durability, which is the same
      // honesty sqlite's `synchronous = NORMAL` keeps: a crash can lose the newest delta, never
      // corrupt an older one — and a lost newest is exactly what union tolerates.
      const tmp = `${target}.${process.pid}.tmp`;
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, `${JSON.stringify(row)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, target);
      this.onDisk.add(d.id);
      stored += 1;
    }
    return stored;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    // A misfiled copy (a delta file hand-placed in the wrong fan) is still the same delta —
    // union tolerates it — but the read must stay a SET: first encounter wins, per id.
    const seenIds = new Set<string>();
    // Only the fan holds deltas; the root is porch — a README or a stray file lives there
    // unbothered. Inside the fan, only `.json` is a delta claim.
    const fans = readdirSync(this.root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .map((f) => f.name)
      .sort();
    for (const fan of fans) {
      for (const name of readdirSync(join(this.root, fan)).sort()) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        if (seenIds.has(id)) continue;
        const path = join(this.root, fan, name);
        let row: ArchiveRow;
        try {
          row = JSON.parse(readFileSync(path, "utf8")) as ArchiveRow;
        } catch (err) {
          throw new Error(
            `archive corruption: ${path} is not a readable delta file (${err instanceof Error ? err.message : String(err)}) — refusing to read`,
          );
        }
        let delta: Delta;
        try {
          const claims = parseClaims(row.claims);
          if (computeId(claims) !== id) {
            throw new Error("its claims do not recompute to its filename");
          }
          if (row.sig !== undefined && typeof row.sig !== "string") {
            throw new Error("its signature field is not a string");
          }
          delta = makeDelta(claims, row.sig);
        } catch (err) {
          throw new Error(
            `archive corruption: ${path} — ${err instanceof Error ? err.message : String(err)}; refusing to read`,
          );
        }
        // The signature is part of the file's integrity: one that does not verify is
        // corruption, refused like any other — never handed onward as healthy data.
        if (verifyDelta(delta) === "invalid") {
          throw new Error(
            `archive corruption: ${path} carries a signature that does not verify — refusing to read`,
          );
        }
        seenIds.add(id);
        this.onDisk.add(id);
        if (knownIds.has(id)) continue;
        out.push(delta);
      }
    }
    return out;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    // Purge hunts EVERY fan, not just the canonical one: a misfiled copy that stays readable
    // means the delta was never forgotten. Purges are rare; the walk is cheap enough to be
    // thorough.
    const fans = readdirSync(this.root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .map((f) => f.name);
    let removed = 0;
    for (const id of ids) {
      let found = false;
      for (const fan of fans) {
        const target = join(this.root, fan, `${id}.json`);
        if (existsSync(target)) {
          rmSync(target, { force: true, maxRetries: 5, retryDelay: 100 });
          found = true;
        }
      }
      if (found) removed += 1;
      this.onDisk.delete(id);
    }
    return removed;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
