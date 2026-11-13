/* eslint-disable @typescript-eslint/require-await */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { open, rename, rm } from "node:fs/promises";

const WRITE_POOL = 16;

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

function fanEntries(root: string): { name: string; walkable: boolean }[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.isFile())
    .map((e) => ({ name: e.name, walkable: e.isDirectory() }));
}

function holdsNothing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const DELTA_ID = /^1e20[0-9a-f]{64}$/;
export class ArchiveBackend implements StoreBackend {
  private closed = false;
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
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
      const canon = canonicalDelta(d);
      if (this.onDisk.has(canon.id) || seen.has(canon.id)) continue;
      seen.add(canon.id);
      fresh.push(canon);
    }
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

  private async writeOne(d: Delta): Promise<number> {
    const target = this.fileFor(d.id);
    if (existsSync(target)) {
      this.onDisk.add(d.id);
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
      await rm(tmp, { force: true });
      throw err;
    }
    this.onDisk.add(d.id);
    return 1;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    const seenIds = new Set<string>();
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
    const entries = fanEntries(this.root);
    const namesByFan = new Map<string, readonly string[]>();
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
    const dead = new Set(ids);
    const found = new Set<string>();
    const unremoved: string[] = [];
    for (const { name: fan, walkable } of entries) {
      for (const name of namesByFan.get(fan) ?? []) {
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut <= 0) continue;
        const id = name.slice(0, cut);
        if (!dead.has(id)) continue;
        if (!walkable) {
          unremoved.push(
            `${join(fan, name)} lies behind an entry the sweep will not delete through`,
          );
          continue;
        }
        try {
          rmSync(join(this.root, fan, name), { force: true, maxRetries: 5, retryDelay: 100 });
          found.add(id);
        } catch (err) {
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
    if (existsSync(this.fileFor(id))) return true;
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
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

  async holdsAny(): Promise<boolean> {
    this.assertOpen();
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        if (holdsNothing(err)) continue;
        throw err;
      }
      for (const name of names) {
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut > 0 && DELTA_ID.test(name.slice(0, cut))) return true;
      }
    }
    return false;
  }

  async ids(): Promise<Set<string>> {
    this.assertOpen();
    const out = new Set<string>();
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        if (holdsNothing(err)) continue;
        throw err;
      }
      for (const name of names) {
        const cut = name.endsWith(".json")
          ? name.length - ".json".length
          : name.endsWith(".tmp")
            ? name.indexOf(".json.")
            : -1;
        if (cut > 0 && DELTA_ID.test(name.slice(0, cut))) out.add(name.slice(0, cut));
      }
    }
    return out;
  }

  async heldAmong(ids: Iterable<string>): Promise<Set<string>> {
    this.assertOpen();
    const want = new Set(ids);
    const held = new Set<string>();
    if (want.size === 0) return held;
    for (const id of want) if (existsSync(this.fileFor(id))) held.add(id);
    if (held.size === want.size) return held;
    for (const { name: fan } of fanEntries(this.root)) {
      let names: readonly string[];
      try {
        names = readdirSync(join(this.root, fan));
      } catch (err) {
        if (holdsNothing(err)) continue;
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
