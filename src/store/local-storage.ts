/* eslint-disable @typescript-eslint/require-await */
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
import {
  admit,
  isDeltaId,
  previewOf,
  type QuarantinedRow,
  type RepairableBackend,
} from "./quarantine.js";

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SEED_SUFFIX = "seed";

const ADMISSION = { parseClaims, computeId, makeDelta, verifyDelta };

interface WireRow {
  readonly id: string;
  readonly claims: unknown;
  readonly sig?: string;
}

export class LocalStorageBackend implements StoreBackend, RepairableBackend {
  private readonly prefix: string;
  private readonly storage: StorageLike;
  private closed = false;
  private lastQuarantine: QuarantinedRow[] = [];

  constructor(
    readonly store: string,
    storage?: StorageLike,
  ) {
    if (store.includes(":")) {
      throw new Error(`store name "${store}" contains ":" — the key format's own separator`);
    }
    const ambient = (globalThis as { localStorage?: StorageLike }).localStorage;
    const chosen = storage ?? ambient;
    if (chosen === undefined) {
      throw new Error("no localStorage on this host — pass a Storage to LocalStorageBackend");
    }
    this.storage = chosen;
    this.prefix = `loam:${store}:`;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("this store is closed");
  }

  private keyFor(id: string): string {
    return this.prefix + id;
  }

  private ownedKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key !== null && key.startsWith(this.prefix) && key !== this.prefix + SEED_SUFFIX) {
        keys.push(key);
      }
    }
    return keys;
  }

  private deltaKeys(): string[] {
    return this.ownedKeys().filter((key) => isDeltaId(key.slice(this.prefix.length)));
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    const fresh: Delta[] = [];
    const seen = new Set<string>();
    for (const d of deltas) {
      const canon = canonicalDelta(d);
      if (seen.has(canon.id) || this.storage.getItem(this.keyFor(canon.id)) !== null) continue;
      seen.add(canon.id);
      fresh.push(canon);
    }

    const written: string[] = [];
    try {
      for (const d of fresh) {
        const row: WireRow = {
          id: d.id,
          claims: claimsToJson(d.claims),
          ...(d.sig === undefined ? {} : { sig: d.sig }),
        };
        this.storage.setItem(this.keyFor(d.id), JSON.stringify(row));
        written.push(d.id);
      }
    } catch (err) {
      for (const id of written) this.storage.removeItem(this.keyFor(id));
      throw err;
    }
    return written.length;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    const quarantine: QuarantinedRow[] = [];
    for (const key of this.ownedKeys()) {
      const suffix = key.slice(this.prefix.length);
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      if (!isDeltaId(suffix)) {
        quarantine.push({ key, reason: "foreign-key", preview: previewOf(raw) });
        continue;
      }
      let row: WireRow;
      try {
        row = JSON.parse(raw) as WireRow;
      } catch {
        quarantine.push({ key, reason: "unparseable", preview: previewOf(raw) });
        continue;
      }
      const verdict = admit(suffix, row.id, row.claims, row.sig, ADMISSION);
      if (!verdict.ok) {
        quarantine.push({
          key,
          reason: verdict.reason,
          preview: previewOf(raw),
          ...(verdict.negates !== undefined ? { negates: verdict.negates } : {}),
        });
        continue;
      }
      if (knownIds.has(verdict.delta.id)) continue;
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
    if (this.storage.getItem(key) === null) return false;
    this.storage.removeItem(key);
    this.lastQuarantine = this.lastQuarantine.filter((r) => r.key !== key);
    return true;
  }

  private admissible(id: string, raw: string): boolean {
    let row: WireRow;
    try {
      row = JSON.parse(raw) as WireRow;
    } catch {
      return false;
    }
    return admit(id, row.id, row.claims, row.sig, ADMISSION).ok;
  }

  async restoreQuarantined(deltas: Iterable<Delta>): Promise<readonly string[]> {
    this.assertOpen();
    const restored: string[] = [];
    for (const d of deltas) {
      let canon: Delta;
      try {
        canon = canonicalDelta(d);
      } catch {
        continue;
      }
      const row: WireRow = {
        id: canon.id,
        claims: claimsToJson(canon.claims),
        ...(canon.sig === undefined ? {} : { sig: canon.sig }),
      };
      const value = JSON.stringify(row);
      if (!this.admissible(canon.id, value)) continue;
      const key = this.keyFor(canon.id);
      const raw = this.storage.getItem(key);
      if (raw === null) continue;
      if (this.admissible(canon.id, raw)) continue;
      this.storage.setItem(key, value);
      restored.push(canon.id);
    }
    const done = new Set(restored.map((id) => this.keyFor(id)));
    this.lastQuarantine = this.lastQuarantine.filter((r) => !done.has(r.key));
    return restored;
  }

  async holds(id: string): Promise<boolean> {
    this.assertOpen();
    if (id === SEED_SUFFIX) return false;
    return this.storage.getItem(this.keyFor(id)) !== null;
  }

  async holdsAny(): Promise<boolean> {
    this.assertOpen();
    for (const key of this.ownedKeys()) if (this.storage.getItem(key) !== null) return true;
    return false;
  }

  async ids(): Promise<Set<string>> {
    this.assertOpen();
    const out = new Set<string>();
    for (const key of this.ownedKeys()) {
      const suffix = key.slice(this.prefix.length);
      if (isDeltaId(suffix) && this.storage.getItem(key) !== null) out.add(suffix);
    }
    return out;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    let removed = 0;
    for (const id of ids) {
      if (id === SEED_SUFFIX) continue;
      if (this.storage.getItem(this.keyFor(id)) === null) continue;
      this.storage.removeItem(this.keyFor(id));
      removed += 1;
    }
    return removed;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
