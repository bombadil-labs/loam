// The browser driver (SPEC §15): one key per delta — `loam:<store>:<id>`, the value the
// delta's canonical wire JSON. Per-delta keys make append O(batch) not O(store), purge a
// `removeItem`, and two handles on one origin convergent by construction — and in devtools the
// store reads as what it is: content-addressed facts, one per row, the id in the key.
//
// Write-through, no snapshot tier: localStorage is synchronous, so durability is the same
// instant as acceptance. Quota is this disk's edge — a QuotaExceededError mid-batch removes
// the keys the batch already wrote, then rejects the whole batch, atomically. Reads recompute
// every id and verify every signature; a row edited in devtools no longer recomputes, but it does
// not brick the read (SPEC §25) — it is SET ASIDE into the quarantine and the read PROCEEDS, so
// one poked key never darkens the whole tab. The prefix is a SHARED namespace on a shared origin,
// so a key under it whose suffix is not a delta id (and is not the seed) was written by someone
// else: it is FOREIGN, quarantined and ignored on the read path, never mistaken for corruption
// that aborts the boot. The seed lives at its own key (`loam:<store>:seed`), never in the delta
// set — no export of deltas can carry key material by accident. What quarantine holds is
// surfaced and settled by `loam repair`.

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
import {
  admit,
  isDeltaId,
  previewOf,
  type QuarantinedRow,
  type RepairableBackend,
} from "./quarantine.js";

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

export class LocalStorageBackend implements StoreBackend, RepairableBackend {
  private readonly prefix: string;
  private readonly storage: StorageLike;
  private closed = false;
  // Rows the most recent read set aside (SPEC §25): recomputed on every deltasSince from the
  // origin's own keys, never a stored countdown. `loam repair` reads this back.
  private lastQuarantine: QuarantinedRow[] = [];

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

  // Every key under this store's owned prefix except the seed, snapshotted before any read or
  // write walks them. A key here is EITHER one of our deltas (its suffix a delta id) or a foreign
  // key someone else landed under the shared prefix — deltasSince tells them apart structurally.
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

  // Only the delta keys — those whose suffix is a delta id. Append and purge walk these; a
  // foreign key under the prefix is never a delta this driver wrote, so they never touch it.
  private deltaKeys(): string[] {
    return this.ownedKeys().filter((key) => isDeltaId(key.slice(this.prefix.length)));
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
    const quarantine: QuarantinedRow[] = [];
    for (const key of this.ownedKeys()) {
      const suffix = key.slice(this.prefix.length);
      const raw = this.storage.getItem(key);
      if (raw === null) continue; // removed between snapshot and read — nothing to say
      // A key whose suffix is not a delta id was never one of ours: foreign, set aside so repair
      // can see it, ignored on the read path. This is the tutorial's `loam:tutorial:ui:pins`
      // brick, disarmed — a UI writer's key under the shared prefix no longer aborts boot.
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
      // The suffix is the id the row is FILED under; row.id is the id the row's own bytes CLAIM.
      // Admission recomputes from the claims and requires both to agree — a row relocated to a
      // key that lies about its id is id-mismatch, quarantined, never laundered by relocation.
      const verdict = admit(suffix, row.id, row.claims, row.sig, {
        parseClaims,
        computeId,
        makeDelta,
        verifyDelta,
      });
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

  // The rows the last read set aside (SPEC §25) — recomputed each deltasSince, never stored.
  async quarantine(): Promise<QuarantinedRow[]> {
    this.assertOpen();
    return this.lastQuarantine;
  }

  // Remove a quarantined row's bytes from the origin (repair discard) — the same `removeItem`
  // the tutorial's healStrayKeys reached for, now driven deliberately per key rather than swept
  // blindly on boot. A quarantined row is never a lawful fact, so this is mechanical removal, not
  // an erasure (§11). The key is the full storage key `loam repair list` reported.
  async discardRow(key: string): Promise<boolean> {
    this.assertOpen();
    if (this.storage.getItem(key) === null) return false;
    this.storage.removeItem(key);
    this.lastQuarantine = this.lastQuarantine.filter((r) => r.key !== key);
    return true;
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
