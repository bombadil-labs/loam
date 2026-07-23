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
// a README in the vault should not spoil the vault. But a `.json` file inside the fan claims
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
      try {
        renameSync(tmp, target);
      } catch (err) {
        // A failed rename must not leave the temp file behind: it holds a FULL delta under a name
        // no read returns, which is exactly the byte-at-rest shape `holds` and §11 exist to hunt —
        // and wherever the write landed (a bad target puts it in the process CWD), the next
        // `git add -A` offers it to history, where no purge can ever reach it. That is not a
        // hypothetical: a mutation run once committed this repo's own erasure canary that way.
        rmSync(tmp, { force: true });
        throw err;
      }
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
    // Read each fan ONCE, not once per id. `heal` passes the entire accumulated tombstone set as
    // `dead` (mirror.ts), so a store with 1,000 historical erasures would otherwise do ~256,000
    // directory reads per heal, growing forever. A fan that vanishes between listing and reading is
    // tolerated — the old `existsSync` path was ENOENT-safe and this must stay so.
    const namesByFan = new Map<string, readonly string[]>();
    for (const fan of fans) {
      try {
        namesByFan.set(fan, readdirSync(join(this.root, fan)));
      } catch {
        namesByFan.set(fan, []);
      }
    }
    // Walk the FILES once and ask each whether its id is dead — not the ids once and search every
    // fan for each. The two answer identically (both visit every file in every fan), but the
    // id-outer form costs ids × fans stat calls plus ids × files string comparisons, and `heal`
    // hands this the whole accumulated tombstone set on every boot. At 1,000 erasures over 10,000
    // archived deltas that is ~256,000 `existsSync` and ~10M `startsWith` per start, growing
    // forever because tombstones are append-only. File-outer is one Set lookup per file.
    //
    // Note what is NOT used: `onDisk`. It is an index of what this handle believes it wrote, and a
    // purge that consulted it would see only what the bookkeeping knows — while the whole point of
    // the sweep is the bytes it does NOT know about (a crash between fsync and rename, a misfiled
    // copy). Index the work you have COMPLETED, never the data you expect to FIND.
    const dead = new Set(ids);
    const found = new Set<string>();
    for (const fan of fans) {
      for (const name of namesByFan.get(fan) ?? []) {
        // `<id>.json` — the canonical file. `<id>.json.<pid>.tmp` — a straggler `append` left when
        // it fsynced and then died before the rename (ticket T40). Reads ignore the latter, which
        // is the right bound for correctness and the WRONG one for §11: the promise is that the
        // byte is REMOVED, not that it is unread, and a `.tmp` is a plain file any backup sweeps up.
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut <= 0) continue;
        const id = name.slice(0, cut);
        if (!dead.has(id)) continue;
        rmSync(join(this.root, fan, name), { force: true, maxRetries: 5, retryDelay: 100 });
        found.add(id);
      }
    }
    for (const id of dead) this.onDisk.delete(id);
    return found.size;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    // Fast path: a delta at its canonical name is held, one stat, no walk. Only the POSITIVE
    // answer may short-circuit — absence still pays the exhaustive sweep below, because the bytes
    // worth finding are exactly the ones not at their canonical name (a crash-left `.tmp`, a
    // misfiled copy), and a fast path that answered "absent" from one stat would hollow the
    // straggler rails outright.
    if (existsSync(this.fileFor(id))) return true;
    // The same reach as `purge`, deliberately: every fan (a misfiled copy is still the bytes) and
    // both name shapes (`<id>.json` and the `<id>.json.<pid>.tmp` a crash leaves between fsync and
    // rename). NOT `deltasSince`, which skips the straggler by design, and NOT `onDisk`, which
    // knows only what this handle wrote — the bytes worth finding are the ones no bookkeeping
    // recorded. Purges and probes are rare; the walk is cheap enough to be thorough.
    const fans = readdirSync(this.root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .map((f) => f.name);
    for (const fan of fans) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        // ENOENT only: a fan that vanished between listing and reading genuinely holds nothing.
        // Anything else — EACCES on a vault whose mode changed or that a container opened under a
        // different uid, EIO on a failing disk, EMFILE under load — means this fan was NOT
        // examined, and a fan that could not be read may still hold the bytes. Answering `false`
        // there would hand `erase` a clean verdict over an unread directory, which is this
        // ticket's own bug wearing a different tier. `purge` may swallow the same error because
        // its output is evidence of work; this one IS the verdict, so it refuses.
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        continue;
      }
      for (const name of names) {
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut > 0 && name.slice(0, cut) === id) return true;
      }
    }
    return false;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
