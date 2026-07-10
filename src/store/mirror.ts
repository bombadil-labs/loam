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
  // lag is safe, but unnoticed lag is a backup that isn't there when recovery is needed.
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

  // Physical removal on BOTH sides — forgetting must be verified, so purge is loud where
  // append was forgiving: a failure on either side rejects (after both were attempted), and
  // a later heal(exclude) can finish what an unreachable side missed.
  async purge(ids: Iterable<string>): Promise<number> {
    const batch = [...ids];
    const results = await Promise.allSettled([this.primary.purge(batch), this.mirror.purge(batch)]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
    return (results[0] as PromiseFulfilledResult<number>).value;
  }

  // Two-way union: each side receives what only the other holds. Idempotent — a whole pair
  // heals to { 0, 0 }. Both directions run even when nothing lagged: heal is how a fresh
  // primary is restored from the mirror's memory after the original is lost. Heal clears
  // `lagging` only when no append lagged WHILE it ran — a delta that landed after heal's
  // snapshot may still be missing from the mirror, and the flag must not say otherwise.
  //
  // `exclude` is the law reaching down (SPEC §11): ids the gateway has tombstoned are never
  // carried in EITHER direction, and a straggler found on either side is purged — heal
  // finishes the forgetting on whatever tier the purge originally missed.
  async heal(exclude?: ReadonlySet<string>): Promise<HealReport> {
    const epoch = this.#lagEpoch;
    const dead = exclude ?? new Set<string>();
    const all = await this.primary.deltasSince(new Set());
    const alive = all.filter((d) => !dead.has(d.id));
    if (alive.length < all.length) await this.primary.purge([...dead]);
    const toMirror = await this.mirror.append(alive);
    const fromMirror = await this.mirror.deltasSince(new Set(alive.map((d) => d.id)));
    const replant = fromMirror.filter((d) => !dead.has(d.id));
    if (replant.length < fromMirror.length) await this.mirror.purge([...dead]);
    const toPrimary = await this.primary.append(replant);
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
