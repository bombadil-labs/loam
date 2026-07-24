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
import { isRepairable, type QuarantinedRow, type RepairableBackend } from "./quarantine.js";

export interface MirrorOptions {
  // Called when a mirror write fails (the append itself still succeeds). Wire this to a log:
  // lag is safe, but unnoticed lag is a backup that isn't there when recovery is needed.
  readonly onLag?: (err: unknown) => void;
}

export interface HealReport {
  readonly toMirror: number; // deltas the mirror was missing, now archived
  readonly toPrimary: number; // deltas the primary was missing, now replanted
  readonly purgedPrimary: number; // dead ids the primary actually removed
  readonly purgedMirror: number; // dead ids the mirror actually removed
  readonly purgeFailures: readonly string[]; // sweeps that refused — reported, never swallowed
}

export class MirrorBackend implements StoreBackend, RepairableBackend {
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

  // BOTH tiers, because §11's promise covers both. Reads answer from the primary — a mirror is a
  // shadow, not a second voice — but byte-presence is not a read: a delta the primary forgot and
  // the mirror kept is a delta this store still HOLDS.
  // Failures compose as `purge`'s do: both sides attempted, then the first refusal reported. A
  // tier that cannot answer has proven nothing, so this REJECTS rather than resolving false (H9).
  // The refusal names its tier, and the driver's own error survives as `cause`.
  async holds(id: string): Promise<boolean> {
    const results = await Promise.allSettled([this.primary.holds(id), this.mirror.holds(id)]);
    const tiers = ["primary", "mirror"] as const;
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        throw new Error(
          `the ${tiers[i]} tier could not be proven clean of ${id}: ` +
            `${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
          { cause: r.reason },
        );
      }
    }
    return results.some((r) => (r as PromiseFulfilledResult<boolean>).value);
  }

  // Reads answer from the primary, so its quarantine (SPEC §25) is the store's quarantine — a
  // corrupt row set aside on the hot side. A primary that cannot quarantine (a bare memory tier)
  // holds nothing to repair, so the pen is empty.
  async quarantine(): Promise<QuarantinedRow[]> {
    return isRepairable(this.primary) ? this.primary.quarantine() : [];
  }

  async discardRow(key: string): Promise<boolean> {
    return isRepairable(this.primary) ? this.primary.discardRow(key) : false;
  }

  // Physical removal on BOTH sides — forgetting must be verified, so purge is loud where
  // append was forgiving: a failure on either side rejects (after both were attempted), and
  // a later heal(exclude) can finish what an unreachable side missed.
  async purge(ids: Iterable<string>): Promise<number> {
    const batch = [...ids];
    const results = await Promise.allSettled([this.primary.purge(batch), this.mirror.purge(batch)]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
    // Evidence that ANY tier removed bytes, composed the same way failures are. Returning the
    // primary's count alone answers "how many the hot tier held", which is not what a caller
    // weighing completeness is asking — a mirror that removed the last straggler would read as 0.
    const counts = results.map((r) => (r as PromiseFulfilledResult<number>).value);
    return Math.max(...counts);
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
    // Purge runs whenever there is anything dead — it is NOT gated on a read having seen the
    // corpse. `deltasSince` is defined to skip what `purge` exists to find: a crash-left
    // `<id>.json.<pid>.tmp`, a misfiled copy, a WAL image, a freelist page. Asking a read whether
    // the work is outstanding conflates readability with byte-presence, which is the one conflation
    // §11 forbids, and it made the straggler sweep unreachable on every tier.
    // A purge failure here must NOT abort the heal. Heal runs on the boot path with the whole
    // accumulated tombstone set, so a single file held by a backup agent or a WAL a concurrent
    // reader will not release would otherwise make the store refuse to start — trading a leak for
    // an outage. Best-effort-and-loud: the sweep continues, and the report carries what failed so
    // the operator is told rather than the error being swallowed.
    const ids = [...dead];
    const purgeFailures: string[] = [];
    const sweep = async (tier: StoreBackend): Promise<number> => {
      if (ids.length === 0) return 0;
      try {
        return await tier.purge(ids);
      } catch (err) {
        purgeFailures.push(err instanceof Error ? err.message : String(err));
        return 0;
      }
    };
    const purgedPrimary = await sweep(this.primary);
    const toMirror = await this.mirror.append(alive);
    const fromMirror = await this.mirror.deltasSince(new Set(alive.map((d) => d.id)));
    const replant = fromMirror.filter((d) => !dead.has(d.id));
    const purgedMirror = await sweep(this.mirror);
    const toPrimary = await this.primary.append(replant);
    // The BYTE verdict (§11, hazard H7). A purge's count is EVIDENCE OF WORK, never proof: a tier
    // can report success while a freelist page, a `.tmp` straggler, or a WAL image still holds the
    // plaintext — the exact readability-vs-byte-presence conflation §11 forbids and T40 caught at the
    // door. So after the sweep, ASK each tier whether any dead id is still held. A survivor — or a
    // tier that cannot answer (H9: silence is not proof it forgot) — routes to `purgeFailures`
    // alongside a refused sweep, because both mean the same thing: the erasure did not verifiably
    // finish, and the boot path already surfaces that channel loudly rather than serving as if clean.
    const verify = async (tier: StoreBackend, label: string): Promise<void> => {
      for (const id of ids) {
        try {
          if (await tier.holds(id)) {
            purgeFailures.push(
              `${label} still holds ${id} after purge — bytes at rest (§11 verdict)`,
            );
          }
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          purgeFailures.push(`${label} could not confirm ${id} is forgotten: ${why}`);
        }
      }
    };
    await verify(this.primary, "primary");
    await verify(this.mirror, "mirror");
    if (this.#lagEpoch === epoch) this.#lagging = false;
    return { toMirror, toPrimary, purgedPrimary, purgedMirror, purgeFailures };
  }

  async close(): Promise<void> {
    // Close BOTH sides even if one refuses — a mirror abandoned open is a leaked handle — then
    // report the first refusal.
    const results = await Promise.allSettled([this.primary.close(), this.mirror.close()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
}
