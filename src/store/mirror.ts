// The backup combinator: one StoreBackend fronting two — a PRIMARY that is the store, and a
// MIRROR that shadows it (a cold archive, a second disk, another driver entirely). The CRDT is
// what makes this small: deltas are immutable and merge is union, so a copy can only ever be
// BEHIND, never wrong, and catching up is a set-difference. Backup needs no log shipping, no
// point-in-time consistency — just "eventually holds the same set."
//
// The doctrine, stated plainly:
//   - The primary is authoritative. Its failures reject; its rows answer every read; its count
//     is the count append reports.
//   - A mirror failure does NOT fail the append — the record is durably held where reads look —
//     but it is never silent: `lagging` flips true and `onLag` fires with the error. Lag is a
//     deliberate, documented exception to the seam's every-failure-rejects rule: refusing a
//     write the primary already holds would turn a backup outage into a store outage.
//   - `heal()` is repair and restore in ONE operation: two-way union. A lagging mirror catches
//     up; a replaced (empty, or partial) primary is replanted from the mirror's memory. Heal is
//     a deliberate act, so ITS failures reject loudly.
//
// One writing gateway per store still holds: the mirror is a shadow of one primary, not a
// second live node. Two live nodes are federation's job.

import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export interface MirrorOptions {
  // Called when a mirror write fails (the append itself still succeeds). Wire this to a log:
  // lag is safe, but unnoticed lag is a backup that isn't there when the fire comes.
  readonly onLag?: (err: unknown) => void;
}

export interface HealReport {
  readonly toMirror: number; // deltas the mirror was missing, now archived
  readonly toPrimary: number; // deltas the primary was missing, now replanted
}

export class MirrorBackend implements StoreBackend {
  #lagging = false;
  #lagEpoch = 0; // counts lag events, so a heal only clears the lag it actually saw

  constructor(
    private readonly primary: StoreBackend,
    private readonly mirror: StoreBackend,
    private readonly opts: MirrorOptions = {},
  ) {}

  // True after any mirror write has failed; heal() clears it. Reads stay healthy throughout.
  get lagging(): boolean {
    return this.#lagging;
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    // Materialize ONCE: a generator consumed by the primary would hand the mirror an empty
    // batch and call it success.
    const batch = [...deltas];
    const stored = await this.primary.append(batch); // authoritative — rejections propagate
    try {
      await this.mirror.append(batch);
    } catch (err) {
      this.#lagging = true;
      this.#lagEpoch += 1;
      this.opts.onLag?.(err);
    }
    return stored;
  }

  async deltasSince(knownIds: ReadonlySet<string>): Promise<Delta[]> {
    return this.primary.deltasSince(knownIds);
  }

  // Two-way union: each side receives what only the other holds. Idempotent — a whole pair
  // heals to { 0, 0 }. Both directions run even when nothing lagged: heal is how a fresh
  // primary is restored from the mirror's memory after the original is lost. Heal clears
  // `lagging` only when no append lagged WHILE it ran — a delta that landed after heal's
  // snapshot may still be missing from the mirror, and the flag must not say otherwise.
  async heal(): Promise<HealReport> {
    const epoch = this.#lagEpoch;
    const all = await this.primary.deltasSince(new Set());
    const toMirror = await this.mirror.append(all);
    const fromMirror = await this.mirror.deltasSince(new Set(all.map((d) => d.id)));
    const toPrimary = await this.primary.append(fromMirror);
    if (this.#lagEpoch === epoch) this.#lagging = false;
    return { toMirror, toPrimary };
  }

  async close(): Promise<void> {
    // Close BOTH sides even if one refuses — a mirror abandoned open is a leaked handle — then
    // report the first refusal.
    const results = await Promise.allSettled([this.primary.close(), this.mirror.close()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
}
