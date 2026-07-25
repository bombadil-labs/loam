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
import {
  DELTA_ID_LENGTH,
  isRepairable,
  type QuarantinedRow,
  type RepairableBackend,
} from "./quarantine.js";

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

// What a heal did about corrupt rows SQUATTING on an id (§25). A SIBLING surface to `HealReport`
// rather than two more of its fields, and the reason is that these two answer a different question
// than the rest of that report: every `HealReport` member is about the two tiers CONVERGING — how
// many deltas moved which way, which sweeps refused. A squatter is about one tier being INTERNALLY
// unreadable, which convergence cannot describe and which the mirror only happens to be able to fix.
// So they ride `lastRestore` beside `lagging`, which is already a heal-touched signal living off the
// report for the same reason.
export interface RestoreReport {
  // Ids whose corrupt primary row was replaced by the mirror's healthy copy.
  readonly restored: readonly string[];
  // EVERY row still set aside after this heal, one line each, whatever the reason — a healthy copy
  // that did not take, a driver that cannot replace, or (the common one) no healthy copy offered at
  // all because the mirror never received that delta. One list because the reader acts identically on
  // all three: the store is serving with a set-aside row, so a strike it carries may read LIVE, and
  // `loam repair list` names the pen. Splitting them would only let the no-copy case — which nothing
  // in heal can fix, and which is therefore the one most likely to persist — reach the operator as
  // silence. Empty is a CLAIM: heal looked, and the pen is clear.
  readonly stranded: readonly string[];
  // Deltas the mirror offered that heal DECLINED to plant, and why. A withheld plant is a deliberate
  // refusal, never a silent skip: the condemned set heal is handed was derived from READABLE deltas,
  // so an unreadable row may be a tombstone nobody could see — and planting under that uncertainty
  // resurrects what an operator erased. Withholding is recoverable; resurrection is not.
  readonly replantWithheld: readonly string[];
}

// The restore's outcome plus what survived its scrutiny to be planted.
interface SettledSquatters {
  readonly report: RestoreReport;
  readonly plant: readonly Delta[];
}

export class MirrorBackend implements StoreBackend, RepairableBackend {
  #lagging = false;
  #lagEpoch = 0; // counts lag events, so a heal only clears the lag it actually saw
  #lastRestore: RestoreReport | undefined;

  constructor(
    private readonly primary: StoreBackend,
    private readonly mirror: StoreBackend,
    private readonly opts: MirrorOptions = {},
  ) {}

  // True after any mirror write has failed; heal() clears it. Reads stay healthy throughout.
  get lagging(): boolean {
    return this.#lagging;
  }

  // What the MOST RECENT heal did about squatters (§25), or `undefined` when no heal has run.
  // Undefined rather than an empty pair, deliberately: "nobody has asked" must never read as
  // "nothing was corrupt" (H9). Once a heal has run, an empty `refused` is a real claim, and the
  // caller that reads it is the one obligation this surface carries — a signal nobody reads is a
  // swallowed error with extra steps, so `cmdServe` reads it beside `purgeFailures`.
  get lastRestore(): RestoreReport | undefined {
    return this.#lastRestore;
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
  //
  // NOT SAFE ON A LIVE STORE, and nothing in the type says so. Heal reads, then writes, in several
  // steps; a gateway serving reads across those steps can observe the primary mid-restore. Every
  // shipped caller runs it BEFORE boot (`cli.ts`), which is why the seam has never needed a lock.
  async heal(exclude?: ReadonlySet<string>): Promise<HealReport> {
    const epoch = this.#lagEpoch;
    // Cleared BEFORE anything below can throw. A heal that rejects must not leave the PREVIOUS heal's
    // verdict standing: a caller that catches the rejection would read "a heal looked at the pen and
    // found nothing corrupt" out of a run that never opened it — the exact conversion the `undefined`
    // sentinel exists to refuse (H9). `lagging` keeps `#lagEpoch` for the same reason.
    this.#lastRestore = undefined;
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
    // `replant` is a MIXED set and the two halves need different tools, so BOTH run. The `append`
    // below plants the deltas the primary never held — ordinary catch-up, and it must keep running.
    // What it CANNOT do is move a delta whose id is already taken by a row the primary set aside:
    // append is dedup-by-id, so a corrupt row SQUATS and the healthy copy is silently ignored. Since
    // a quarantined row never joins `alive`, the mirror's copy of exactly that id is always here in
    // `replant`, which is why heal is where this recovery belongs (§25).
    //
    // THE RESTORE RUNS BEFORE THE PLANT, and the order carries two guarantees. It can CLEAR the pen
    // that the plant then consults, so one boot both repairs a strike and plants what was waiting
    // behind it; and it means a strike is never left set aside while heal plants its target live
    // beside it (H1 — carry-without-the-strike, produced by a repair).
    //
    // And it CANNOT cost an erasure refusal. `purgeFailures` escapes only through the resolved value
    // below, and a restore can genuinely reject (sqlite's `BEGIN IMMEDIATE` throws SQLITE_BUSY once
    // another handle holds the write lock past busy_timeout). Letting that propagate would drop a
    // §11 "this erasure is INCOMPLETE" the sweep had already collected, on the boot path, which is
    // the precise contract the sweep states for itself: best-effort-and-loud, never an outage.
    let settled: SettledSquatters;
    try {
      settled = await this.settleSquatters(replant, dead);
    } catch (err) {
      settled = {
        report: {
          restored: [],
          stranded: [
            `the §25 pen could not be settled at all — ${err instanceof Error ? err.message : String(err)}. ` +
              `Any corrupt row is still set aside, so a strike it carries may read LIVE (H1).`,
          ],
          replantWithheld: [],
        },
        // Nothing was proven about the pen, so nothing is proven safe to plant either (H9).
        plant: [],
      };
    }
    this.#lastRestore = settled.report;
    const toPrimary = await this.primary.append(settled.plant);
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
    return { toMirror, toPrimary, purgedPrimary, purgedMirror, purgeFailures };
  }

  // Settle the primary's §25 pen against what the mirror offered, then decide what is safe to plant.
  // Three questions, in this order, because each one's answer narrows the next:
  //
  //   1. WHICH offered deltas are squatted by a set-aside row, and does the primary replace them?
  //      Candidate selection is HEAL'S OWN, drawn from the pen rather than from the optional
  //      `restoreQuarantined` — a driver that cannot restore must be REPORTED, and a report whose only
  //      source is the missing member would be empty exactly when it has something to say.
  //      The outcome is heal's own BYTE VERDICT: a driver's return is EVIDENCE, never proof, so heal
  //      RE-READS the primary (recomputing admission from its own bytes) and believes that read. An
  //      over-reporting driver is dropped from `restored`; a driver that repairs some while
  //      mis-reporting others is split correctly; a row some OTHER handle repaired between the two
  //      reads is in neither list — heal did not do it, and it is not broken.
  //   2. WHAT IS STILL SET ASIDE afterwards? Every such row, not only the ones a copy was offered for.
  //      The pen row with NO copy in the mirror is the one heal can do nothing about, and therefore the
  //      one that persists — reporting only the candidates would let exactly that case reach the
  //      operator as a clean boot log.
  //   3. GIVEN what is still set aside, what must NOT be planted? Two ways a plant goes wrong, both
  //      of them H1/§11 and both invisible to `append`:
  //        - An UNPARSEABLE row could be a lawful TOMBSTONE nobody can read. The condemned set heal is
  //          handed is derived from READABLE deltas, so it may be missing that row's target — and
  //          planting then resurrects an erased delta at every door, with no strike anywhere. Withhold
  //          the whole plant: withholding is recoverable on the next boot, resurrection is not.
  //          (A row that PARSED but failed admission is not lawful authority either way, so it does not
  //          trigger this — T57's wording is the reason: such a row only CLAIMS to strike.)
  //        - A row that parsed carries the ids it strikes (T57 put them in the pen; this is the first
  //          consumer that can act on them). Planting a target while its strike stays set aside is
  //          carry-without-the-strike — H1, produced by a repair — so those ids are withheld by name.
  //
  // §11 is re-asserted HERE, not trusted from the caller: `dead` is filtered again inside. The restore
  // writes bytes under ids `holds()` answers for, so a future refactor that handed this the unfiltered
  // offer would otherwise UPDATE an erased delta back into the table.
  private async settleSquatters(
    offered: readonly Delta[],
    dead: ReadonlySet<string>,
  ): Promise<SettledSquatters> {
    const replant = offered.filter((d) => !dead.has(d.id));
    const primary = this.primary;
    const clear: RestoreReport = { restored: [], stranded: [], replantWithheld: [] };
    if (!isRepairable(primary)) return { report: clear, plant: replant };
    let penned = await primary.quarantine();
    // ONE pass over the pen, then one over the candidates — never `replant × penned` (H8). Both axes
    // grow, and worse, they grow TOGETHER in exactly the scenario this recovery exists for: a pen
    // accumulates corrupt rows until an operator settles them, while `replant` becomes the whole store
    // when a lost primary is replanted from the mirror's memory. It is also on the ordinary path — any
    // lagging catch-up has a non-empty `replant`.
    // A pen key is a row id (sqlite) or `prefix + id` (localStorage), and a delta id is fixed-width,
    // so a fixed-width suffix recovers the id from either — exactly what `endsWith` asked, asked once
    // per key instead of once per pair. A key too short to hold an id yields itself, which matches no
    // delta id; a foreign key that happens to end in one at worst offers a candidate the driver then
    // refuses on its own bytes.
    const idOf = (key: string): string => key.slice(-DELTA_ID_LENGTH);
    const restored: string[] = [];
    const offeredIds = new Set(replant.map((d) => d.id));
    const squatting = replant.filter((d) => penned.some((r) => idOf(r.key) === d.id));
    if (squatting.length > 0) {
      const claimed =
        primary.restoreQuarantined === undefined ? [] : await primary.restoreQuarantined(squatting);
      const admitted = new Set((await primary.deltasSince(new Set())).map((d) => d.id));
      for (const id of claimed) if (admitted.has(id)) restored.push(id);
      penned = await primary.quarantine(); // recomputed by the read above — the post-restore truth
    }
    // A foreign key is someone else's row under the shared prefix (§15): not a delta, so it strands no
    // strike and withholds nothing. Every OTHER surviving row is reported.
    const stillPenned = penned.filter((r) => r.reason !== "foreign-key");
    const stranded = stillPenned.map((r) => {
      const id = idOf(r.key);
      if (!offeredIds.has(id)) {
        return (
          `the primary still sets aside ${r.key} (${r.reason}) and the mirror offered no healthy copy ` +
          `of it — nothing this heal can do will settle it, so any strike it carries reads LIVE (H1). ` +
          `Re-federate the delta, or settle the row with \`loam repair discard\`.`
        );
      }
      return primary.restoreQuarantined === undefined
        ? `the primary still sets aside ${r.key} and this driver cannot replace a corrupt row — the ` +
            `mirror holds a healthy copy that nothing can plant over it, so any strike that row ` +
            `carries stays stranded (§25/H1). Settle it with \`loam repair discard\`, then heal again.`
        : `the primary still sets aside ${r.key} after the restore — the mirror's healthy copy did ` +
            `not take, so any strike that row carries stays stranded (§25/H1).`;
    });
    const unreadable = stillPenned.filter((r) => r.reason === "unparseable");
    if (unreadable.length > 0) {
      return {
        report: {
          restored,
          stranded,
          replantWithheld: [
            `${replant.length} delta(s) the mirror offered were NOT planted: ${unreadable.length} ` +
              `row(s) in the primary's pen cannot be read at all, and the condemned set this heal was ` +
              `given is derived from READABLE deltas — so one of them may be a tombstone nobody could ` +
              `see, and planting would resurrect what was erased (§11). Settle the unreadable row(s) ` +
              `(\`loam repair list\`, then discard or re-federate) and heal again.`,
          ],
        },
        plant: [],
      };
    }
    // Ids struck by a row that is STILL set aside. T57 records them on the pen; planting one now would
    // serve a target whose strike nothing can currently apply.
    const strandedStrikes = new Set(stillPenned.flatMap((r) => r.negates ?? []));
    const withheld = replant.filter((d) => strandedStrikes.has(d.id));
    return {
      report: {
        restored,
        stranded,
        replantWithheld: withheld.map(
          (d) =>
            `${d.id} was NOT planted: a set-aside row in the primary claims to strike it, and that ` +
            `row could not be settled — planting the target while its strike stays stranded would ` +
            `serve a retracted fact as live (H1).`,
        ),
      },
      plant: replant.filter((d) => !strandedStrikes.has(d.id)),
    };
  }

  async close(): Promise<void> {
    // Close BOTH sides even if one refuses — a mirror abandoned open is a leaked handle — then
    // report the first refusal.
    const results = await Promise.allSettled([this.primary.close(), this.mirror.close()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
}
