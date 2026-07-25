// T66's SAFETY half — what the recovery must refuse to do. `corrupt-row-recovery.test.ts` rails the
// repair; this file rails the four ways a repair can do harm, each one found by a P5 lens reading the
// diff without the author's reasoning:
//
//   1. §11 — a restore WRITES bytes under an id `holds()` answers for, so it is one of the few places
//      in the store that can make an ERASED delta readable again. Unlike a purge, that mistake is not
//      recoverable by re-running anything.
//   2. §11 — the condemned set heal is handed is derived from READABLE deltas, so an unreadable pen row
//      may be a lawful tombstone nobody can see. Planting under that uncertainty resurrects what an
//      operator erased; withholding is recoverable on the next boot.
//   3. H1 — planting a target while the strike on it stays set aside is carry-without-the-strike,
//      produced by a repair. T57 put the struck ids on the pen; this is the first consumer that acts.
//   4. H9 — a heal that could not finish must not answer for the pen at all, and a restore that refuses
//      must not take an already-collected §11 refusal down with it.
//
// Every case is TWO-SIDED: alongside the thing that must not happen, a named delta that must still be
// repaired, planted, or reported — so no rail here can pass by heal having simply done nothing.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import type { QuarantinedRow, RepairableBackend } from "../../src/store/quarantine.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { retraction } from "../gateway/narrowing.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20000 });

const OP_SEED = "3d".repeat(32);
const OP = authorForSeed(OP_SEED);

const height = observed(FERN, "height", 30, 1000, OP_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, OP_SEED);
const strike = retraction(height.id, OP, OP_SEED, 2000);
const arrival = observed(FERN, "tag", "fronds", 1600, OP_SEED);

const tmp = mkdtempSync(join(tmpdir(), "loam-t66-safety-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;

interface Row {
  readonly claims: string;
  readonly sig: string | null;
}

const rowOf = (path: string, id: string): Row | undefined => {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT claims, sig FROM deltas WHERE id = ?").get(id) as Row | undefined;
  } finally {
    db.close();
  }
};

const corruptSig = (path: string, id: string): void => {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), id);
  db.close();
};

// A primary + on-disk archive holding the healthy world, then closed.
async function plantedPair(): Promise<{ path: string; vault: string }> {
  const dir = join(tmp, `w-${n++}`);
  const path = join(dir, "store.sqlite");
  const vault = join(dir, "archive");
  const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
  const gw = await Gateway.boot(store, assembleGenesis({ operatorSeed: OP_SEED }));
  await gw.append([height, bystander, strike]);
  await gw.close();
  return { path, vault };
}

describe("T66/§11: the restore can never resurrect a condemned id", () => {
  it("a squatter on a TOMBSTONED id is not restored, while a live squatter beside it is", async () => {
    const { path, vault } = await plantedPair();
    // Two squatters: one on an id the operator has condemned, one on an ordinary retraction.
    corruptSig(path, height.id);
    corruptSig(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal(new Set([height.id]));
    await store.close();

    // The condemned id is GONE, not repaired — the sweep reached it and the restore did not undo it.
    expect(rowOf(path, height.id)).toBeUndefined();
    expect(store.lastRestore?.restored).not.toContain(height.id);
    // TWO-SIDED: the un-condemned squatter beside it WAS restored in the same call, so this cannot
    // pass by the restore having done nothing at all.
    expect(store.lastRestore?.restored).toEqual([strike.id]);
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig);
  });

  it("a condemned id is never even OFFERED to the driver — §11 re-asserted inside, not trusted", async () => {
    // The caller filters `dead` out of the offer; this proves the settle step filters it AGAIN. Without
    // the inner filter, a refactor handing it the raw mirror offer would UPDATE an erased delta's bytes
    // back into a table whose row a failed purge had left behind, and every other rail would stay
    // green. The observable is what the driver is ASKED, so no purge behaviour is involved.
    const asked: string[] = [];
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const penned = new Set([height.id, strike.id]);
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => !penned.has(d.id)),
      purge: () => Promise.resolve(0), // removes NOTHING: the condemned row survives, as after a fault
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve(
          [...penned].map((id) => ({
            key: id,
            reason: "invalid-signature" as const,
            preview: "…",
          })),
        ),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: (deltas) => {
        for (const d of deltas) asked.push(d.id);
        return Promise.resolve([]);
      },
    };
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    await store.heal(new Set([height.id]));

    expect(asked).toEqual([strike.id]); // the condemned id never reached the driver
    await store.close();
  });
});

describe("T66: heal WITHHOLDS a plant it cannot prove safe", () => {
  // A repairable primary with a fixed pen and NO restore capability, so a penned row stays penned and
  // the withholding decision is what is under test rather than the repair.
  const stuckPrimary = (
    inner: StoreBackend,
    pen: readonly QuarantinedRow[],
  ): RepairableBackend => ({
    append: (d) => inner.append(d),
    deltasSince: async (k) =>
      (await inner.deltasSince(k)).filter((d) => !pen.some((r) => r.key === d.id)),
    purge: (ids) => inner.purge(ids),
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
    quarantine: () => Promise.resolve([...pen]),
    discardRow: () => Promise.resolve(false),
  });

  it("an UNREADABLE pen row withholds the WHOLE plant — it may be a tombstone nobody can read", async () => {
    const inner = new MemoryBackend();
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "unparseable", preview: "{not json" },
    ]);
    const vault = new MemoryBackend();
    await vault.append([arrival, bystander]); // the archive offers deltas the primary never held
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal();

    expect(report.toPrimary).toBe(0); // nothing planted
    expect(await inner.holds(arrival.id)).toBe(false); // ...at the bytes, not merely in the count
    expect(store.lastRestore?.replantWithheld.length).toBe(1);
    expect(store.lastRestore?.replantWithheld[0]).toMatch(/tombstone|erased/i);
    await store.close();
  });

  it("the withholding LIFTS once the row is settled — recoverable, not a permanent stop", async () => {
    // TWO-SIDED against the rail above: withholding is only defensible because it is temporary. Settle
    // the unreadable row and the very next heal plants everything it declined.
    const inner = new MemoryBackend();
    const pen: QuarantinedRow[] = [{ key: strike.id, reason: "unparseable", preview: "{not json" }];
    const primary = stuckPrimary(inner, pen);
    const vault = new MemoryBackend();
    await vault.append([arrival, bystander]);
    const store = new MirrorBackend(primary, vault);

    await store.heal();
    expect(await inner.holds(arrival.id)).toBe(false);

    pen.length = 0; // `loam repair discard` settled it
    const second = await store.heal();

    expect(second.toPrimary).toBe(2);
    expect(await inner.holds(arrival.id)).toBe(true);
    expect(store.lastRestore?.replantWithheld).toEqual([]);
    await store.close();
  });

  it("a target whose STRIKE is still set aside is withheld BY NAME, and its siblings still land", async () => {
    // T57 records what a penned row claims to strike; this is the first consumer that can act on it.
    // Planting the target while the strike stays stranded is carry-without-the-strike (H1) — produced,
    // ironically, by a repair. The sibling proves the withholding is targeted, not a blanket stop.
    const inner = new MemoryBackend();
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "invalid-signature", preview: "…", negates: [height.id] },
    ]);
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal();

    expect(await inner.holds(height.id)).toBe(false); // the struck TARGET was not planted
    expect(await inner.holds(bystander.id)).toBe(true); // ...the unrelated delta was
    expect(await inner.holds(strike.id)).toBe(true); // ...and so was the STRIKE itself
    expect(report.toPrimary).toBe(2); // withheld by name: one delta, not the batch
    expect(store.lastRestore?.replantWithheld.some((m) => m.includes(height.id))).toBe(true);
    await store.close();
  });

  it("a penned row the mirror has NO copy of is still named — the case heal cannot fix", async () => {
    // The row nothing in heal can repair is the row that PERSISTS, so its silence would be permanent.
    // It is not a candidate (no copy was offered), so a report built only from candidates would show a
    // clean boot over a store serving with a stranded strike.
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const primary = stuckPrimary(inner, [
      { key: strike.id, reason: "invalid-signature", preview: "…", negates: [height.id] },
    ]);
    const vault = new MemoryBackend();
    await vault.append([bystander]); // the archive never received the strike
    const store = new MirrorBackend(primary, vault);

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    expect(store.lastRestore?.stranded[0]).toMatch(/no healthy copy/i);
    await store.close();
  });
});

describe("T66/H9: a heal that cannot finish never speaks for the pen", () => {
  it("a REJECTED heal clears the previous heal's verdict rather than repeating it", async () => {
    // `lastRestore` is read after `heal()` returns, and a caller that CATCHES a rejection must not be
    // handed the last successful run's answer — that is "a heal looked and found nothing corrupt" said
    // about a run that never opened the pen.
    const { path, vault } = await plantedPair();
    corruptSig(path, strike.id);
    const cold = new ArchiveBackend(vault);
    let broken = false;
    const flaky: StoreBackend = {
      append: (d) => (broken ? Promise.reject(new Error("archive gone")) : cold.append(d)),
      deltasSince: (k) => cold.deltasSince(k),
      purge: (ids) => cold.purge(ids),
      holds: (id) => cold.holds(id),
      close: () => cold.close(),
    };
    const store = new MirrorBackend(new SqliteBackend(path), flaky);

    await store.heal();
    expect(store.lastRestore?.restored).toEqual([strike.id]); // heal #1 really did restore

    broken = true;
    await expect(store.heal()).rejects.toThrow(/archive gone/);
    expect(store.lastRestore).toBeUndefined(); // heal #2 never reached the pen, and says so
    await store.close();
  });

  it("a restore that REJECTS keeps the erasure refusals the sweep already collected (§11)", async () => {
    // `purgeFailures` escapes only through heal's resolved value, and the restore sits between the
    // sweep and that return. Letting a SQLITE_BUSY there propagate would lose a "this erasure is
    // INCOMPLETE" the operator must hear — the sweep states the opposite contract for itself.
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => d.id !== strike.id),
      purge: () => Promise.reject(new Error("this erasure is INCOMPLETE (§11)")),
      holds: () => Promise.resolve(false),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve([{ key: strike.id, reason: "invalid-signature" as const, preview: "…" }]),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: () => Promise.reject(new Error("database is locked")),
    };
    const vault = new MemoryBackend();
    await vault.append([bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    const report = await store.heal(new Set([height.id]));

    // The §11 refusal survived...
    expect(report.purgeFailures.some((m) => m.includes("INCOMPLETE"))).toBe(true);
    // ...and the restore's own failure is reported rather than swallowed or thrown.
    expect(store.lastRestore?.stranded.some((m) => m.includes("database is locked"))).toBe(true);
    // Nothing was proven about the pen, so nothing was planted on that uncertainty either.
    expect(report.toPrimary).toBe(0);
    await store.close();
  });
});
