// The browser driver (SPEC §15): one key per delta — `loam:<store>:<id>`, the value the
// delta's canonical wire JSON. Per-delta keys make append O(batch) not O(store), purge a
// `removeItem`, and two handles on one origin convergent by construction — and in devtools the
// store reads as what it is: content-addressed facts, one per row, the id in the key.
//
// Write-through, no snapshot tier: localStorage is synchronous, so durability is the same
// instant as acceptance. Quota is this disk's edge — a QuotaExceededError mid-batch removes
// the keys the batch already wrote, then rejects the whole batch, atomically. Reads recompute
// every id and verify every signature: a row edited in devtools is corruption, refused,
// exactly as a tampered sqlite row is. The seed lives at its own key (`loam:<store>:seed`),
// never in the delta set — no export of deltas can carry key material by accident.

/* eslint-disable @typescript-eslint/require-await -- the async keyword is load-bearing: it
   turns every synchronous throw (quota, a closed handle, a refused delta) into the rejected
   promise the seam promises. */
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

// The slice of the DOM Storage interface the driver stands on — injectable, so the driver
// runs against the page's localStorage, a test shim, or any synchronous key-value witness.
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// The one key under the delta prefix that is never a delta.
const SEED_SUFFIX = "seed";

interface WireRow {
  readonly id: string;
  readonly claims: unknown;
  readonly sig?: string;
}

export class LocalStorageBackend implements StoreBackend {
  private readonly prefix: string;
  private readonly storage: StorageLike;
  private closed = false;

  constructor(
    readonly store: string,
    storage?: StorageLike,
  ) {
    // `:` is the key format's own separator — a store named "app:v2" would sit inside store
    // "app"'s prefix, and each would read the other's rows as corruption. Refused at birth.
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

  // Every delta key this store holds, snapshotted before any read or write walks them.
  private deltaKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key !== null && key.startsWith(this.prefix) && key !== this.prefix + SEED_SUFFIX) {
        keys.push(key);
      }
    }
    return keys;
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    this.assertOpen();
    // Canonicalize the WHOLE batch before touching the origin: one refused delta refuses the
    // lot. The gate runs on EVERY delta, before the dedup fast-path — a forgery wearing a
    // known id is still a forgery.
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
      // Quota (or any other refusal) mid-batch: take back what this batch already wrote, so
      // the failure is all-or-nothing, then let the ORIGINAL error surface — the gateway
      // latches its degradation on it.
      for (const id of written) this.storage.removeItem(this.keyFor(id));
      throw err;
    }
    return written.length;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    this.assertOpen();
    const out: Delta[] = [];
    for (const key of this.deltaKeys()) {
      const keyedId = key.slice(this.prefix.length);
      const raw = this.storage.getItem(key);
      if (raw === null) continue; // removed between snapshot and read — nothing to say
      let row: WireRow;
      let claims: Delta["claims"];
      try {
        row = JSON.parse(raw) as WireRow;
        claims = parseClaims(row.claims);
      } catch {
        throw new Error(`store corruption: row ${keyedId} is not a delta — refusing to read`);
      }
      if (computeId(claims) !== row.id || row.id !== keyedId) {
        throw new Error(
          `store corruption: row ${keyedId} does not recompute from its claims — refusing to read`,
        );
      }
      const delta = makeDelta(claims, row.sig);
      // The signature is part of the row's integrity: a sig that does not verify is
      // corruption, refused like any other — never handed onward as healthy data.
      if (verifyDelta(delta) === "invalid") {
        throw new Error(
          `store corruption: row ${keyedId} carries a signature that does not verify — refusing to read`,
        );
      }
      if (knownIds.has(delta.id)) continue;
      out.push(delta);
    }
    return out;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    this.assertOpen();
    let removed = 0;
    for (const id of ids) {
      if (id === SEED_SUFFIX) continue; // the seed key is not a delta and not purgeable as one
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
