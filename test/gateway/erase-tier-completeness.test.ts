// §11 completeness under a MIRROR — the verdict must inspect the same tiers the promise covers
// (ticket T67). The leak these rails close is that `erase` decided completeness from
// `deltasSince` behind a `removed === 0` gate, and under `MirrorBackend` both halves are
// tier-blind: `deltasSince` returns the PRIMARY only, and `purge` returns the MAX of the two
// counts, so one tier's honest removal hides the other tier's silent retention.
//
// So these rails assert at the TIER. Every one of them plants retention on a specific side and
// asks what `erase` reports — never `get(id) === undefined`, which stayed true through every
// erasure leak this repo has paid for (T40, T55) and would stay true through this one too.
//
// The two silent-retention rails necessarily drive a FAKE tier: no shipped driver returns 0 while
// keeping the row (sqlite throws, the archive throws, memory cannot). They prove the VERDICT.
// `holds` against the real drivers is proven in test/store/contract.test.ts, and the archive's
// straggler-awareness in test/store/archive.test.ts. Both levels, never one.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { isTombstone } from "../../src/gateway/erase.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);

const scratch = (): string => mkdtempSync(join(tmpdir(), "loam-t67-"));
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// A governed grove whose store is the supplied backend — the same shape as erase.test.ts's
// `grove`, opened over a mirror so the tiers are addressable from the test.
async function groveOn(
  backend: StoreBackend,
): Promise<{ gateway: Gateway; fact: Delta; tombstones: () => number }> {
  const gateway = await Gateway.open(backend, { seed: OP_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OP_SEED),
  ]);
  const fact = observed(FERN, "height", 30, 1000, GARDENER_SEED);
  await gateway.append([fact]);
  return {
    gateway,
    fact,
    tombstones: () => [...gateway.reactor.snapshot()].filter((d) => isTombstone(d.claims)).length,
  };
}

// A tier that ACCEPTS the removal order and quietly keeps the bytes: `purge` reports 0 and the
// delta stays in the set. The read-only-mount / silently-refusing-driver shape. It is honest about
// what it holds — `holds` tells the truth — because a double that lied there would defeat the very
// rail it is standing in (premortem C1).
function retaining(inner: MemoryBackend): StoreBackend {
  return {
    append: (d) => inner.append(d),
    deltasSince: (k) => inner.deltasSince(k),
    purge: () => Promise.resolve(0), // ordered to forget; keeps everything
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
  };
}

// A tier that refuses every call — the cold archive on an unmounted disk.
const unreachable = (): StoreBackend => ({
  append: () => Promise.reject(new Error("cold store unreachable")),
  deltasSince: () => Promise.reject(new Error("cold store unreachable")),
  purge: () => Promise.reject(new Error("cold store unreachable")),
  holds: () => Promise.reject(new Error("cold store unreachable")),
  close: () => Promise.resolve(),
});

describe("erase is complete only when every TIER is clean", () => {
  it("the MIRROR keeps the byte while the primary is clean: erase refuses", async () => {
    // The first leak in T67. `deltasSince` on a mirror returns the primary's deltas, and the
    // primary really did forget — so the old scan saw a clean store and reported success while the
    // plaintext sat on the other tier.
    const primary = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    const backend = new MirrorBackend(primary, retaining(mirrorInner));
    const { gateway, fact } = await groveOn(backend);

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    // And the byte really is where the rail says it is — otherwise this passes for the wrong reason.
    expect(await mirrorInner.holds(fact.id)).toBe(true);
    expect(await primary.holds(fact.id)).toBe(false);
    await gateway.close();
  });

  it("the PRIMARY keeps the byte while the mirror removes a straggler: the aggregate count says 1, and erase still refuses", async () => {
    // The second leak, and the subtler one. `MirrorBackend.purge` returns Math.max(primary, mirror),
    // so a mirror that legitimately removed something reports 1 for the pair — which satisfied the
    // old `removed === 0` gate and SKIPPED the scan entirely, even though scanning the primary
    // would have found the retained byte immediately.
    const primaryInner = new MemoryBackend();
    const mirror = new MemoryBackend();
    const backend = new MirrorBackend(retaining(primaryInner), mirror);
    const { gateway, fact } = await groveOn(backend);

    // The mirror holds a straggler of its own, so its purge returns a positive count for this batch.
    expect(await backend.purge([fact.id])).toBe(1);
    expect(await primaryInner.holds(fact.id)).toBe(true); // ...and the primary kept it anyway

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    await gateway.close();
  });

  it("a `.tmp` straggler the sweep missed makes erase refuse, though no read on any tier can see it", async () => {
    // `deltasSince` is DEFINED to skip `<id>.json.<pid>.tmp` — correct for reads, and the reason a
    // read can never answer §11. Here the archive's sweep is rolled back to its pre-T40 behavior
    // (canonical name only), so the straggler survives the purge; the verdict has to catch what the
    // sweep missed, or the operator is told a crash-left copy is gone.
    const root = scratch();
    roots.push(root);
    const primary = new MemoryBackend();
    const vault = new ArchiveBackend(root);
    const shallow: StoreBackend = {
      append: (d) => vault.append(d),
      deltasSince: (k) => vault.deltasSince(k),
      holds: (id) => vault.holds(id),
      close: () => vault.close(),
      // The regression: sweep `<id>.json` and leave `<id>.json.*.tmp` behind.
      purge: async (ids) => {
        let removed = 0;
        for (const fan of readdirSync(root, { withFileTypes: true }).filter((f) =>
          f.isDirectory(),
        )) {
          for (const name of readdirSync(join(root, fan.name))) {
            for (const id of ids) {
              if (name === `${id}.json`) {
                rmSync(join(root, fan.name, name), { force: true });
                removed += 1;
              }
            }
          }
        }
        return removed;
      },
    };
    const backend = new MirrorBackend(primary, shallow);
    const { gateway, fact } = await groveOn(backend);

    // Plant the straggler BEHIND the seam — a raw write, never an append. A `holds` built on the
    // driver's own bookkeeping could not see this, which is what makes the rail able to fail.
    const fan = join(root, fact.id.slice(0, 2));
    writeFileSync(join(fan, `${fact.id}.json.4242.tmp`), "{}\n");

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    await gateway.close();
  });

  it("an UNREACHABLE tier makes erase refuse rather than report a completion it cannot prove", async () => {
    // An intended availability consequence, pinned so it is never "fixed" by swallowing the tier
    // error: a store whose cold half is offline cannot PROVE the bytes went, so it must not say so.
    //
    // HONEST NOTE: this rail is GREEN before the fix — `MirrorBackend.purge` already rejects when a
    // side rejects, so `erase` already throws here. It is a characterization pin, not evidence that
    // T67's fix works, and it must not be counted as one. What it protects is the future: adding a
    // per-tier probe is exactly the change that tempts someone to catch a tier's error and treat an
    // unprovable tier as a clean one.
    const backend = new MirrorBackend(new MemoryBackend(), unreachable());
    const { gateway, fact } = await groveOn(backend);
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /unreachable/i,
    );
    await gateway.close();
  });

  it("POSITIVE CONTROL: the same fixture with nothing retained completes normally", async () => {
    // Without this, every rail above would pass just as happily against an `erase` that always
    // threw. This is what makes the four refusals mean something.
    const primary = new MemoryBackend();
    const mirror = new MemoryBackend();
    const backend = new MirrorBackend(primary, mirror);
    const { gateway, fact } = await groveOn(backend);

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    expect(await primary.holds(fact.id)).toBe(false);
    expect(await mirror.holds(fact.id)).toBe(false);
    await gateway.close();
  });

  it("a refused erase still records the tombstone, and the re-run after repair mints no second one", async () => {
    // Retry safety survives the verdict change: the erasure log is append-only, so a failed sweep
    // must leave exactly one tombstone behind and the operator's re-run must finish the job
    // without growing the log. Deleting the `removed === 0` gate must not cost this.
    const primary = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    let retain = true;
    const flakyMirror: StoreBackend = {
      append: (d) => mirrorInner.append(d),
      deltasSince: (k) => mirrorInner.deltasSince(k),
      holds: (id) => mirrorInner.holds(id),
      close: () => mirrorInner.close(),
      purge: (ids) => (retain ? Promise.resolve(0) : mirrorInner.purge(ids)),
    };
    const { gateway, fact, tombstones } = await groveOn(new MirrorBackend(primary, flakyMirror));

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    expect(tombstones()).toBe(1);

    retain = false; // the operator fixed the mount and re-ran, exactly as the error instructs
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    expect(tombstones()).toBe(1); // still ONE — a fresh timestamp would have minted a second
    await gateway.close();
  });
});
