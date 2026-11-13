import type { Delta, DurableOrdinaryJournalStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";
import { holdsJournals, holdsPoolKeys, type PoolKeySource } from "./peer-image.js";
import {
  DELTA_ID_LENGTH,
  isRepairable,
  type QuarantinedRow,
  type RepairableBackend,
} from "./quarantine.js";

export interface MirrorOptions {
  readonly onLag?: (err: unknown) => void;
}

export interface HealReport {
  readonly toMirror: number;
  readonly toPrimary: number;
  readonly purgedPrimary: number;
  readonly purgedMirror: number;
  readonly purgeFailures: readonly string[];
}

export interface RestoreReport {
  readonly restored: readonly string[];
  readonly stranded: readonly string[];
  readonly replantWithheld: readonly string[];
}

interface SettledSquatters {
  readonly report: RestoreReport;
  readonly plant: readonly Delta[];
}

export class MirrorBackend implements StoreBackend, RepairableBackend {
  #lagging = false;
  #lagEpoch = 0;
  #lastRestore: RestoreReport | undefined;

  constructor(
    private readonly primary: StoreBackend,
    private readonly mirror: StoreBackend,
    private readonly opts: MirrorOptions = {},
  ) {}

  get lagging(): boolean {
    return this.#lagging;
  }

  get lastRestore(): RestoreReport | undefined {
    return this.#lastRestore;
  }

  #journal: DurableOrdinaryJournalStore | undefined;

  async journalRowIds(): Promise<Set<string>> {
    if (!holdsJournals(this.primary))
      throw new Error("mirror: the primary tier keeps no peer journal");
    return this.primary.ids();
  }

  async holdsAnyRow(): Promise<boolean> {
    const primary = holdsJournals(this.primary)
      ? await this.primary.holdsAnyRow()
      : await this.primary.holdsAny?.();
    if (primary !== false) return true;
    return (await this.mirror.holdsAny?.()) !== false;
  }

  async discardJournals(): Promise<void> {
    if (!holdsJournals(this.primary)) return;
    await this.primary.discardJournals();
  }

  keepsJournals(): boolean {
    return holdsJournals(this.primary);
  }

  async journalPeers(): Promise<string[]> {
    return holdsJournals(this.primary) ? this.primary.journalPeers() : [];
  }

  journalStore(): DurableOrdinaryJournalStore {
    if (!holdsJournals(this.primary)) {
      throw new Error("mirror: the primary tier keeps no peer journal");
    }
    const inner = this.primary.journalStore();
    const shadow = async (rows: readonly Delta[]): Promise<void> => {
      if (rows.length === 0) return;
      try {
        await this.mirror.append(rows);
      } catch (err) {
        this.#lagging = true;
        this.#lagEpoch += 1;
        this.opts.onLag?.(err);
      }
    };
    const headIs = async (peerId: string, expected: string): Promise<boolean> => {
      const read = await inner.readHead(peerId);
      return read.status === "head" && read.head === expected;
    };
    const refuted = async (peerId: string, expected: string, targetId: string) =>
      (await headIs(peerId, expected))
        ? { status: "absence-refuted" as const, targetId }
        : { status: "conflict" as const };
    return (this.#journal ??= {
      ...inner,
      compareAndAppend: async (peerId, expected, next, frame, rows) => {
        const write = await inner.compareAndAppend(peerId, expected, next, frame, rows);
        if (write.status === "durable") await shadow(rows);
        return write;
      },
      compareAndAppendErasure: async (peerId, expected, next, frame, rows, absent) => {
        if (!(await headIs(peerId, expected))) return { status: "conflict" };
        for (const id of absent) {
          if (await this.mirror.holds(id)) return refuted(peerId, expected, id);
        }
        const write = await inner.compareAndAppendErasure!(
          peerId,
          expected,
          next,
          frame,
          rows,
          absent,
        );
        if (write.status === "durable") await shadow(rows);
        return write;
      },
      compareAndSettlePurge: async (peerId, expected, next, frame, targetId, generation) => {
        if (!(await headIs(peerId, expected))) return { status: "conflict" };
        if (await this.mirror.holds(targetId)) return refuted(peerId, expected, targetId);
        return inner.compareAndSettlePurge!(peerId, expected, next, frame, targetId, generation);
      },
    });
  }

  poolKeys(): PoolKeySource | undefined {
    return holdsPoolKeys(this.primary) ? this.primary.poolKeys() : undefined;
  }

  setAside(rows: readonly { id: string; reason: string }[]): void {
    if (holdsJournals(this.primary)) this.primary.setAside?.(rows);
  }

  async append(deltas: Iterable<Delta>): Promise<number> {
    const batch = [...deltas];
    const stored = await this.primary.append(batch);
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

  async holdsAny(): Promise<boolean> {
    const ask = (tier: StoreBackend, label: string): Promise<boolean> =>
      tier.holdsAny === undefined
        ? Promise.reject(new Error(`the ${label} tier offers no whole-store byte probe`))
        : tier.holdsAny();
    const results = await Promise.allSettled([
      ask(this.primary, "primary"),
      ask(this.mirror, "mirror"),
    ]);
    for (const r of results) {
      if (r.status === "rejected")
        throw new Error(`a tier could not be proven empty: ${String(r.reason)}`, {
          cause: r.reason,
        });
    }
    return results.some((r) => r.status === "fulfilled" && r.value);
  }

  async ids(): Promise<Set<string>> {
    const ask = (tier: StoreBackend, label: string): Promise<Set<string>> =>
      tier.ids === undefined
        ? Promise.reject(new Error(`the ${label} tier offers no inventory`))
        : tier.ids();
    const results = await Promise.allSettled([
      ask(this.primary, "primary"),
      ask(this.mirror, "mirror"),
    ]);
    const out = new Set<string>();
    for (const r of results) {
      if (r.status === "rejected")
        throw new Error(`a tier could not be listed: ${String(r.reason)}`, { cause: r.reason });
      for (const id of r.value) out.add(id);
    }
    return out;
  }

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

  async quarantine(): Promise<QuarantinedRow[]> {
    return isRepairable(this.primary) ? this.primary.quarantine() : [];
  }

  async discardRow(key: string): Promise<boolean> {
    return isRepairable(this.primary) ? this.primary.discardRow(key) : false;
  }

  async purge(ids: Iterable<string>): Promise<number> {
    const batch = [...ids];
    const results = await Promise.allSettled([this.primary.purge(batch), this.mirror.purge(batch)]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
    const counts = results.map((r) => (r as PromiseFulfilledResult<number>).value);
    return Math.max(...counts);
  }

  async heal(exclude?: ReadonlySet<string>): Promise<HealReport> {
    const epoch = this.#lagEpoch;
    this.#lastRestore = undefined;
    const dead = exclude ?? new Set<string>();
    const all = await this.primary.deltasSince(new Set());
    const alive = all.filter((d) => !dead.has(d.id));
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
    let settled: SettledSquatters;
    try {
      settled = await this.settleSquatters(replant, dead);
    } catch (err) {
      settled = {
        report: {
          restored: [],
          stranded: [
            `the §25 pen could not be settled at all — ${err instanceof Error ? err.message : String(err)}. ` +
              `Any corrupt row is still set aside, so a negation it carries may read LIVE (H1).`,
          ],
          replantWithheld: [],
        },
        plant: [],
      };
    }
    this.#lastRestore = settled.report;
    const toPrimary = await this.primary.append(settled.plant);
    const survivor = (label: string, id: string): string =>
      `${label} still holds ${id} after purge — bytes at rest (§11 verdict)`;
    const unprovable = (label: string, id: string, why: string): string =>
      `${label} could not confirm ${id} is forgotten: ${why}`;
    const verify = async (tier: StoreBackend, label: string): Promise<void> => {
      if (ids.length === 0) return;
      if (tier.heldAmong) {
        try {
          for (const id of await tier.heldAmong(ids)) purgeFailures.push(survivor(label, id));
        } catch (err) {
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

  private async settleSquatters(
    offered: readonly Delta[],
    dead: ReadonlySet<string>,
  ): Promise<SettledSquatters> {
    const replant = offered.filter((d) => !dead.has(d.id));
    const primary = this.primary;
    const clear: RestoreReport = { restored: [], stranded: [], replantWithheld: [] };
    if (!isRepairable(primary)) return { report: clear, plant: replant };
    let penned = await primary.quarantine();
    const idOf = (key: string): string => key.slice(-DELTA_ID_LENGTH);
    const restored: string[] = [];
    const offeredIds = new Set(replant.map((d) => d.id));
    const squatting = replant.filter((d) => penned.some((r) => idOf(r.key) === d.id));
    if (squatting.length > 0) {
      const claimed =
        primary.restoreQuarantined === undefined ? [] : await primary.restoreQuarantined(squatting);
      const admitted = new Set((await primary.deltasSince(new Set())).map((d) => d.id));
      for (const id of claimed) if (admitted.has(id)) restored.push(id);
      penned = await primary.quarantine();
    }
    const stillPenned = penned.filter((r) => r.reason !== "foreign-key");
    const stranded = stillPenned.map((r) => {
      const id = idOf(r.key);
      if (!offeredIds.has(id)) {
        return (
          `the primary still sets aside ${r.key} (${r.reason}) and the mirror offered no healthy copy ` +
          `of it — nothing this heal can do will settle it, so any negation it carries reads LIVE (H1). ` +
          `Re-federate the delta, or settle the row with \`loam repair discard\`.`
        );
      }
      return primary.restoreQuarantined === undefined
        ? `the primary still sets aside ${r.key} and this driver cannot replace a corrupt row — the ` +
            `mirror holds a healthy copy that nothing can plant over it, so any negation that row ` +
            `carries stays stranded (§25/H1). Settle it with \`loam repair discard\`, then heal again.`
        : `the primary still sets aside ${r.key} after the restore — the mirror's healthy copy did ` +
            `not take, so any negation that row carries stays stranded (§25/H1).`;
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
              `given is derived from READABLE deltas — so one of them may be an erasure nobody could ` +
              `see, and planting would resurrect what was erased (§11). Settle the unreadable row(s) ` +
              `(\`loam repair list\`, then discard or re-federate) and heal again.`,
          ],
        },
        plant: [],
      };
    }
    const strandedStrikes = new Set(stillPenned.flatMap((r) => r.negates ?? []));
    const withheld = replant.filter((d) => strandedStrikes.has(d.id));
    return {
      report: {
        restored,
        stranded,
        replantWithheld: withheld.map(
          (d) =>
            `${d.id} was NOT planted: a set-aside row in the primary claims to negate it, and that ` +
            `row could not be settled — planting the target while its negation stays stranded would ` +
            `serve a retracted fact as live (H1).`,
        ),
      },
      plant: replant.filter((d) => !strandedStrikes.has(d.id)),
    };
  }

  async close(): Promise<void> {
    const results = await Promise.allSettled([this.primary.close(), this.mirror.close()]);
    const failed = results.find((r) => r.status === "rejected");
    if (failed !== undefined) throw failed.reason;
  }
}
