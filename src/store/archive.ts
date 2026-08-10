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
// written), matching the contract's refusal semantics. An IO failure mid-batch leaves every
// earlier chunk plus the failing chunk's fulfilled peers behind — a non-contiguous subset, not
// a prefix, since the pool lets in-flight writes settle before the batch refuses. Union
// semantics render either shape harmless: re-appending is a no-op.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw into the rejected promise the seam promises. */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";

// How many delta files may be mid-flush at once. Each still keeps write→fsync→rename order;
// the pool only overlaps the waiting. Sixteen holds the fd footprint small while collapsing a
// federation-sized batch's flush time from the sum of its fsyncs to roughly their depth (T155).
const WRITE_POOL = 16;

// Tmp names carry pid AND a per-process sequence: pid alone was enough while the write path was
// synchronous (one handle's write→fsync→rename could not interleave with another's), but the
// pooled path yields, and two same-process handles racing one id would open the SAME tmp — each
// "w" truncating the other, a rename able to promote a not-yet-fsynced file into the real name.
let tmpSeq = 0;
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

// Every entry at the vault root that might be a fan, paired with whether a SWEEP may walk it.
//
// The filter is `!isFile()`, never `isDirectory()`, and the difference is load-bearing: readdir does
// not follow links, so `isDirectory()` is FALSE for a symlink to a directory, and false again for a
// `DT_UNKNOWN` dirent on a mount that does not fill `d_type`. Filtering on it EXCLUDES those entries
// before anything opens them, which is the silent shape of H9 — a directory nobody examined counting
// as a directory that holds nothing. So they are listed, each caller opens them, and what cannot be
// opened is reported rather than dropped.
//
// `walkable` is what separates reading from removing. A verdict may read through any of these; a sweep
// may only DELETE inside an entry the filesystem calls a real directory, because `rm` through a link
// destroys whatever the link points at.
function fanEntries(root: string): { name: string; walkable: boolean }[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.isFile())
    .map((e) => ({ name: e.name, walkable: e.isDirectory() }));
}

// The only two readdir failures that ANSWER the question instead of leaving it open: the fan is not
// there (it vanished between the root's listing and its own read), or it is not a directory at all —
// the porch, where a README or any other human clutter lives unbothered. Everything else means the
// bytes were not looked at.
function holdsNothing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

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
    // The per-delta order is sacred — write, FSYNC, then rename, so the bytes are durable
    // before the real name exists and no crash leaves a half-written delta wearing one. What
    // is NOT sacred is running those flushes one at a time: an fsync is tens of milliseconds
    // on a cloud disk, and a federation-sized batch serialized on the event loop pays the sum
    // (T155 measured 200 deltas at 12s on a Windows runner). A bounded pool overlaps the
    // flushes; each file still keeps its own order, and the first failure still refuses the
    // batch loudly after the in-flight chunk settles.
    let stored = 0;
    for (let at = 0; at < fresh.length; at += WRITE_POOL) {
      const chunk = fresh.slice(at, at + WRITE_POOL);
      const settled = await Promise.allSettled(chunk.map((d) => this.writeOne(d)));
      for (const s of settled) {
        if (s.status === "fulfilled") stored += s.value;
        else throw s.reason;
      }
    }
    return stored;
  }

  /** One delta to disk, in the order the durability comment above demands. Returns 1 if this
   *  call stored it, 0 if another handle already had. */
  private async writeOne(d: Delta): Promise<number> {
    const target = this.fileFor(d.id);
    if (existsSync(target)) {
      this.onDisk.add(d.id); // another handle got here first — same name, same bytes
      return 0;
    }
    mkdirSync(join(this.root, d.id.slice(0, 2)), { recursive: true });
    const row: ArchiveRow = {
      claims: claimsToJson(d.claims),
      ...(d.sig !== undefined && { sig: d.sig }),
    };
    const tmp = `${target}.${process.pid}.${tmpSeq++}.tmp`;
    const fh = await open(tmp, "w");
    try {
      await fh.write(`${JSON.stringify(row)}\n`);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, target);
    } catch (err) {
      // A failed rename must not leave the temp file behind: it holds a FULL delta under a
      // name no read returns — the byte-at-rest shape `holds` and §11 exist to hunt — and a
      // bad target lands it in the process CWD, where the next `git add -A` offers it to
      // history, beyond any purge's reach.
      await rm(tmp, { force: true });
      throw err;
    }
    this.onDisk.add(d.id);
    return 1;
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
    const entries = fanEntries(this.root);
    // Read each fan ONCE, not once per id. `heal` passes the entire accumulated tombstone set as
    // `dead` (mirror.ts), so a store with 1,000 historical erasures would otherwise do ~256,000
    // directory reads per heal, growing forever. A fan that vanishes between listing and reading is
    // tolerated — the old `existsSync` path was ENOENT-safe and this must stay so.
    const namesByFan = new Map<string, readonly string[]>();
    // Two readdir failures are ANSWERS (`holdsNothing`): an absent fan, and an entry that is not a
    // directory at all — the porch a README lives on. Every other one (EACCES, EIO, EMFILE) leaves a
    // directory UNEXAMINED, and a count that omits it reads as "those ids are forgotten" — a
    // completeness never delivered (H9). Sweep what can be reached first, then refuse: the refusal is
    // the caller's to collect (`erase` files it as a fault, `heal` records it and keeps booting), and
    // stopping at the wall would strand the bytes in every fan behind it.
    const unexamined: string[] = [];
    let firstFailure: unknown;
    for (const { name: fan } of entries) {
      try {
        namesByFan.set(fan, readdirSync(join(this.root, fan)));
      } catch (err) {
        namesByFan.set(fan, []);
        if (holdsNothing(err)) continue;
        firstFailure ??= err;
        unexamined.push(`fan ${fan} could not be read (${message(err)})`);
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
    // Bytes this sweep saw and did not remove — a locked file, and a dead byte lying behind an entry
    // it refuses to delete THROUGH. Both are the same promise as `unexamined`: report what was not
    // achieved rather than a count that reads as achievement.
    const unremoved: string[] = [];
    for (const { name: fan, walkable } of entries) {
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
        if (!walkable) {
          // A dead byte read THROUGH an entry that is not a real directory — a symlink, or a dirent
          // the filesystem would not classify. The sweep reports it and DELIBERATELY does not delete
          // through it: an `rm` that follows a link deletes whatever the link points at, so a vault
          // entry aimed at a home directory would make forgetting one delta erase someone's life.
          // Widening the delete to reach here is a decision about what the store may destroy, not a
          // repair of a false report — so this refuses to claim completeness and stops there.
          unremoved.push(
            `${join(fan, name)} lies behind an entry the sweep will not delete through`,
          );
          continue;
        }
        try {
          rmSync(join(this.root, fan, name), { force: true, maxRetries: 5, retryDelay: 100 });
          found.add(id);
        } catch (err) {
          // `force` suppresses only "already gone". EPERM (an immutable file, a read-only mount),
          // EACCES, and a Windows sharing violation from a backup agent all still throw — and thrown
          // from here they would abandon every fan behind this one, in an order `readdirSync` does
          // not fix, so each retry would meet the same locked file and the removable copies would be
          // retained forever. Collected instead: the sweep converges on what it can reach, and the
          // refusal below names what it could not.
          firstFailure ??= err;
          unremoved.push(`${join(fan, name)} could not be removed (${message(err)})`);
        }
      }
    }
    for (const id of dead) this.onDisk.delete(id);
    const refusals = [...unexamined, ...unremoved];
    if (refusals.length > 0) {
      throw new Error(
        `archive purge swept ${found.size} file(s) under ${this.root} and cannot be reported ` +
          `complete — ${refusals.length} place(s) the content may still be:\n  ` +
          `${refusals.join("\n  ")}`,
        { cause: firstFailure },
      );
    }
    return found.size;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    // Fast path: a delta at its canonical name is held — one stat, no walk. Only the POSITIVE
    // answer may short-circuit: the bytes worth finding are exactly the ones NOT at their
    // canonical name (a crash-left `.tmp`, a misfiled copy), so absence pays the full sweep.
    if (existsSync(this.fileFor(id))) return true;
    // The same reach as `purge`: every fan (a misfiled copy is still the bytes) and both name
    // shapes (`<id>.json`, and the `<id>.json.<pid>.tmp` a crash leaves between fsync and
    // rename). NOT `deltasSince` (skips the straggler by design) and NOT `onDisk` (knows only
    // what this handle wrote). A verdict READS through an entry `purge` will not delete through: a
    // copy visible behind a symlink is still a copy, and reading one costs nothing irreversible.
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        // An absent fan and a non-directory hold nothing. Any other error (EACCES, EIO, EMFILE)
        // means this fan was NOT examined and may still hold the bytes, and a `false` from here
        // would license an erasure report — so it refuses rather than answer clean over an unread
        // directory (H9). `purge` draws the same line for the same reason: neither a verdict nor a
        // count may cover a directory nobody opened.
        if (holdsNothing(err)) continue;
        throw err;
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

  // The batch companion to `holds` (SPEC §11 byte verdict). `heal` asks its verdict about the whole
  // accumulated tombstone set at once; answering with per-id `holds` would pay a full sweep for every
  // ABSENT id (the common clean case), so O(dead × files) on the boot path. This walks the FILES ONCE
  // — the same file-outer inversion `purge` uses — and reports which requested ids are present. Same
  // reach as `holds`: every fan, both name shapes (`<id>.json` and the crash-left `<id>.json.<pid>.tmp`),
  // never `onDisk`. Same H9 fail-closed as `holds` and `purge`: a fan it cannot read (beyond the two
  // failures that answer) is bytes left unexamined, so it REJECTS rather than answer a false clean.
  // The difference from `purge` is only WHEN it gives up — a sweep finishes the fans it can reach
  // before refusing; a verdict has nothing to finish.
  async heldAmong(ids: Iterable<string>): Promise<Set<string>> {
    this.assertOpen();
    const want = new Set(ids);
    const held = new Set<string>();
    if (want.size === 0) return held;
    // `holds`'s canonical fast path, for the same reason and with the same asymmetry — only a
    // POSITIVE answer may short-circuit. It is not only speed: `existsSync` FOLLOWS a symlink where
    // a dirent does not, so without this probe the two verdicts could disagree about a canonical
    // file sitting inside a symlinked fan — and this is the one on the boot, health and settle
    // paths, where a disagreement reads as a clean bill of health.
    for (const id of want) if (existsSync(this.fileFor(id))) held.add(id);
    if (held.size === want.size) return held; // nothing left to prove ABSENT — the walk is for that
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        if (holdsNothing(err)) continue; // absent, or not a directory at all
        throw err;
      }
      for (const name of names) {
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut <= 0) continue;
        const id = name.slice(0, cut);
        if (want.has(id)) held.add(id);
      }
    }
    return held;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
