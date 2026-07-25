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
  // Ids whose CORRUPT primary row was replaced by the mirror's healthy copy (T66/§25) — a change to
  // the ground, so it is named rather than folded into `toPrimary`'s count.
  readonly restoredPrimary: readonly string[];
  // Squatters the mirror held a copy for and heal could NOT replace. Empty is a claim, not a
  // default: a strike may still be stranded, so silence here must mean "nothing was corrupt".
  readonly restoreRefused: readonly string[];
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

  // The batch probe, forwarded so its single-pass economy survives this combinator: a health poll
  // hands the WHOLE live tombstone set to the store the gateway actually holds — which is this —
  // and falling back to the composite per-id `holds` would pay one archive sweep per absent id,
  // the exact cliff `heldAmong` exists to avoid. Same composition as `holds`: both tiers asked
  // (each by its own batch probe if it offers one, else its cheap per-id `holds`), answers
  // unioned, and a tier that cannot answer rejects the whole probe (H9), naming itself.
  async heldAmong(ids: Iterable<string>): Promise<Set<string>> {
    const batch = [...ids];
    const ask = async (tier: StoreBackend): Promise<Set<string>> => {
      if (tier.heldAmong) return tier.heldAmong(batch);
      const held = new Set<string>();
      for (const id of batch) if (await tier.holds(id)) held.add(id);
      return held;
    };
    const results = await Promise.allSettled([ask(this.primary), ask(this.mirror)]);
    const tiers = ["primary", "mirror"] as const;
    for (const [i, r] of results.entries()) {
      if (r.status === "rejected") {
        throw new Error(
          `the ${tiers[i]} tier could not be proven clean: ` +
            `${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
          { cause: r.reason },
        );
      }
    }
    const held = new Set<string>();
    for (const r of results)
      for (const id of (r as PromiseFulfilledResult<Set<string>>).value) held.add(id);
    return held;
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

  // `restoreQuarantined` is deliberately NOT delegated. `quarantine`/`discardRow` are, because
  // `loam repair` reaches them through whatever the gateway holds; the restore is heal's own
  // mechanism and heal reaches the primary directly. A delegate would make the member ALWAYS present
  // on a mirror and vacuous whenever the inner primary lacks it — turning "this driver cannot
  // restore", which heal reports, into a silent empty answer, which is the shape this whole ticket
  // exists to remove.

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
    // `replant` is a MIXED set and the two halves need different tools, so BOTH run. `append` above
    // plants the deltas the primary never held — that is ordinary catch-up and it must keep running.
    // What it CANNOT do is move a delta whose id is already taken by a row the primary set aside:
    // append is dedup-by-id, so a corrupt row SQUATS and the healthy copy is silently ignored. Since
    // a quarantined row never joins `alive`, the mirror's copy of exactly that id is always here in
    // `replant`, which is why heal is where this recovery belongs (T66/§25).
    const { restoredPrimary, restoreRefused } = await this.restoreSquatters(replant);
    // The BYTE verdict (§11, hazard H7). A purge's count is EVIDENCE OF WORK, never proof: a tier
    // can report success while a freelist page, a `.tmp` straggler, or a WAL image still holds the
    // plaintext — the exact readability-vs-byte-presence conflation §11 forbids and T40 caught at the
    // door. So after the sweep, ASK each tier whether any dead id is still held. A survivor — or a
    // tier that cannot answer (H9: silence is not proof it forgot) — routes to `purgeFailures`
    // alongside a refused sweep, because both mean the same thing: the erasure did not verifiably
    // finish, and the boot path already surfaces that channel loudly rather than serving as if clean.
    const survivor = (label: string, id: string): string =>
      `${label} still holds ${id} after purge — bytes at rest (§11 verdict)`;
    const unprovable = (label: string, id: string, why: string): string =>
      `${label} could not confirm ${id} is forgotten: ${why}`;
    const verify = async (tier: StoreBackend, label: string): Promise<void> => {
      if (ids.length === 0) return;
      // Prefer the batch probe where a tier offers one: the archive's per-id `holds` is a full sweep
      // on absence, so asking one id at a time over the whole tombstone set is O(dead × files). A tier
      // without it (memory, sqlite) has a cheap `holds`, so the per-id fallback below costs nothing.
      if (tier.heldAmong) {
        try {
          for (const id of await tier.heldAmong(ids)) purgeFailures.push(survivor(label, id));
        } catch (err) {
          // The batch probe refused: the WHOLE set is unproven (H9), never silently clean.
          const why = err instanceof Error ? err.message : String(err);
          for (const id of ids) purgeFailures.push(unprovable(label, id, why));
        }
        return;
      }
      for (const id of ids) {
        try {
          if (await tier.holds(id)) purgeFailures.push(survivor(label, id));
        } catch (err) {
          const why = err instanceof Error ? err.message : String(err);
          purgeFailures.push(unprovable(label, id, why));
        }
      }
    };
    await verify(this.primary, "primary");
    await verify(this.mirror, "mirror");
    if (this.#lagEpoch === epoch) this.#lagging = false;
    return {
      toMirror,
      toPrimary,
      purgedPrimary,
      purgedMirror,
      purgeFailures,
      restoredPrimary,
      restoreRefused,
    };
  }

  // Of the deltas the mirror offered, which are SQUATTED by a corrupt primary row — and what came of
  // asking the primary to replace them (T66/§25).
  //
  // Candidate selection is HEAL'S OWN, drawn from the primary's pen (recomputed by the read at the
  // top of `heal`), so it does not depend on the optional `restoreQuarantined` existing. That matters:
  // a driver that cannot restore must be REPORTED, and a report whose only source is the missing
  // member would be empty exactly when it has something to say. A pen key is a row id (sqlite) or
  // `prefix + id` (localStorage), matched as `repair.ts` matches it.
  //
  // And the outcome is heal's own BYTE VERDICT, in both directions — the same doctrine its purge
  // sweep already runs. A driver's return value is EVIDENCE, never proof, so heal RE-READS the
  // primary (which recomputes admission from the primary's own bytes) and asks that read:
  //   - restored = claimed by the driver AND admitted by the re-read.
  //   - refused  = a candidate the re-read still will not admit.
  // So an over-reporting driver is dropped from `restoredPrimary` and named in `restoreRefused`, and
  // a driver that repairs some while mis-reporting others is split correctly. A candidate some OTHER
  // handle repaired between heal's two reads lands in neither: heal did not do it, and it is not
  // broken.
  private async restoreSquatters(
    replant: readonly Delta[],
  ): Promise<{ restoredPrimary: readonly string[]; restoreRefused: readonly string[] }> {
    const none = { restoredPrimary: [], restoreRefused: [] };
    const primary = this.primary;
    if (replant.length === 0 || !isRepairable(primary)) return none;
    const penned = await primary.quarantine();
    const squatting = replant.filter((d) =>
      penned.some((r) => r.key === d.id || r.key.endsWith(d.id)),
    );
    if (squatting.length === 0) return none;
    const claimed =
      primary.restoreQuarantined === undefined ? [] : await primary.restoreQuarantined(squatting);
    const admitted = new Set((await primary.deltasSince(new Set())).map((d) => d.id));
    const restoredPrimary = claimed.filter((id) => admitted.has(id));
    const restoreRefused = squatting
      .filter((d) => !admitted.has(d.id))
      .map((d) =>
        primary.restoreQuarantined === undefined
          ? `the primary still sets aside ${d.id} and this driver cannot replace a corrupt row — ` +
            `the mirror holds a healthy copy that nothing can plant over it, so any strike that row ` +
            `carries stays stranded (§25/H1). Settle it with \`loam repair discard\`, then heal again.`
          : `the primary still sets aside ${d.id} after the restore — the mirror's healthy copy did ` +
            `not take, so any strike that row carries stays stranded (§25/H1).`,
      );
    return { restoredPrimary, restoreRefused };
  }

  async close(): Promise<void> {
    // Close BOTH sides even if one refuses — a mirror abandoned open is a leaked handle — then
    // report the first refusal.
    const results = await Promise.allSettled([this.primary.close(), this.mirror.close()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
}
