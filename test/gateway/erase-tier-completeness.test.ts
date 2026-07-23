// §11 completeness under a MIRROR — the verdict must inspect the same tiers the promise covers.
// Under `MirrorBackend`, `deltasSince` returns the PRIMARY only and `purge` returns the MAX of
// the two counts, so neither can carry the verdict: one tier's honest removal hides the other's
// silent retention. Every rail here plants retention on a specific tier and asks what `erase`
// reports — never `get(id) === undefined`, which stays true through a byte-at-rest leak.
//
// The two silent-retention rails necessarily drive a FAKE tier: no shipped driver returns 0 while
// keeping the row (sqlite throws, the archive throws, memory cannot). They prove the VERDICT.
// `holds` against the real drivers is proven in test/store/contract.test.ts, and the archive's
// straggler-awareness in test/store/archive.test.ts. Both levels, never one.

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { isTombstone, readTombstones } from "../../src/gateway/erase.js";
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
  for (const r of roots)
    rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
// delta stays in the set — the read-only-mount / silently-refusing-driver shape. `holds` tells
// the truth, because a double that lied there would defeat the very rail it stands in.
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
    // `deltasSince` on a mirror returns the primary's deltas, and the primary really did forget
    // — a read-based verdict sees a clean store while the plaintext sits on the other tier.
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
    // `MirrorBackend.purge` returns Math.max(primary, mirror), so a mirror that legitimately
    // removed something reports 1 for the pair — a count-gated verdict would skip the scan and
    // miss the retaining primary.
    const primaryInner = new MemoryBackend();
    const mirror = new MemoryBackend();
    const backend = new MirrorBackend(retaining(primaryInner), mirror);
    const { gateway, fact } = await groveOn(backend);

    // NOTHING is purged before the erase: a setup purge would consume the mirror's copy — the
    // very condition this fixture exists to create. Left alone, the mirror still holds the
    // target when `erase` runs, so its purge removes one, the retaining primary removes none,
    // and `MirrorBackend.purge` reports max(0, 1) = 1 — the positive aggregate under test.
    expect(await primaryInner.holds(fact.id)).toBe(true);
    expect(await mirror.holds(fact.id)).toBe(true);

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    // The primary is what kept it — name the tier, so a pass cannot come from the wrong side.
    expect(await primaryInner.holds(fact.id)).toBe(true);
    expect(await mirror.holds(fact.id)).toBe(false); // the mirror did its job
    await gateway.close();
  });

  it("a `.tmp` straggler the sweep missed makes erase refuse, though no read on any tier can see it", async () => {
    // `deltasSince` is DEFINED to skip `<id>.json.<pid>.tmp` — correct for reads, and the reason
    // a read can never answer §11. The `shallow` double sweeps only the canonical name, so the
    // straggler survives its purge; the verdict has to catch what the sweep missed, or the
    // operator is told a crash-left copy is gone.
    const root = scratch();
    roots.push(root);
    const primary = new MemoryBackend();
    const vault = new ArchiveBackend(root);
    const shallow: StoreBackend = {
      append: (d) => vault.append(d),
      deltasSince: (k) => vault.deltasSince(k),
      holds: (id) => vault.holds(id),
      close: () => vault.close(),
      // Sweeps only the canonical `<id>.json`; leaves `<id>.json.*.tmp` behind.
      purge: (ids) => {
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
        return Promise.resolve(removed);
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
    // error: a store whose cold half is offline cannot PROVE the bytes went, so it must not say
    // so. A characterization pin, not evidence of the verdict (`MirrorBackend.purge` already
    // rejects here) — it guards against a per-tier probe that treats unprovable as clean (H9).
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
    // The erasure log is append-only: a failed sweep leaves exactly one tombstone behind, and
    // the operator's re-run finishes the job without growing the log.
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

// The retry anchor is a SURVIVING tombstone, and "surviving" is the whole of the rule. A struck
// tombstone is forgiveness — `readTombstones` drops it and the id may return — so reusing one as an
// anchor would purge the bytes while the dead set says the record was pardoned.
describe("the retry anchor honors forgiveness", () => {
  const strike = async (gateway: Gateway, targetId: string): Promise<void> => {
    const tomb = [...gateway.reactor.snapshot()].find(
      (d) =>
        isTombstone(d.claims) &&
        d.claims.pointers.some(
          (p) => p.target.kind === "delta" && p.target.deltaRef.delta === targetId,
        ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, tomb!.id), OP_SEED)]);
  };

  it("erasing again AFTER forgiveness mints a SECOND tombstone rather than reusing the struck one", async () => {
    const primary = new MemoryBackend();
    const { gateway, fact, tombstones } = await groveOn(
      new MirrorBackend(primary, new MemoryBackend()),
    );
    await gateway.erase(fact.id, { reason: "the subject asked" });
    expect(tombstones()).toBe(1);

    await strike(gateway, fact.id); // forgiveness: the id may return
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(false);
    await gateway.append([fact]); // ...and it does

    // A second request. Anchoring on the STRUCK tombstone would purge the bytes and append
    // nothing, leaving the dead set saying `fact` was pardoned while the data is in fact gone:
    // admission would re-admit it and `forgottenSince` would confess nothing.
    await gateway.erase(fact.id, { reason: "asked again, after the pardon" });
    expect(tombstones()).toBe(2);
    expect(readTombstones(gateway.reactor, OPERATOR).has(fact.id)).toBe(true);
    expect(await primary.holds(fact.id)).toBe(false);
    await gateway.close();
  });

  it("a struck tombstone is not a licence to report a completion: erase with no target REFUSES", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await gateway.erase(fact.id, { reason: "the subject asked" });
    await strike(gateway, fact.id); // forgiven, and NOT re-admitted — the store holds nothing

    // Without the surviving-tombstone rule this returns `{ erased }` for work never done (H7).
    await expect(gateway.erase(fact.id)).rejects.toThrow(/nothing to erase/);
    await gateway.close();
  });
});

// The retry bypass is bounded by "is there anything left to sweep": a surviving tombstone from a
// completed erasure months ago must not suppress the existence guard forever — that would return
// `{ erased }` for work never done (H7). So these two cases must differ.
describe("the retry bypass is for an OUTSTANDING erasure, not for any tombstone", () => {
  it("a second erase of a CLEANLY erased id still refuses", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    // Nothing is left anywhere: the tombstone survives, but the erasure does not.
    await expect(gateway.erase(fact.id)).rejects.toThrow(/nothing to erase/);
    await gateway.close();
  });

  it("...while a retry with bytes still on a tier is let through", async () => {
    // The case the bypass exists for, pinned beside the case it must not cover — a plain
    // presence guard would look correct against the rail above alone.
    const primary = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    let retain = true;
    const flaky: StoreBackend = {
      append: (d) => mirrorInner.append(d),
      deltasSince: (k) => mirrorInner.deltasSince(k),
      holds: (id) => mirrorInner.holds(id),
      close: () => mirrorInner.close(),
      purge: (ids) => (retain ? Promise.resolve(0) : mirrorInner.purge(ids)),
    };
    const { gateway, fact, tombstones } = await groveOn(new MirrorBackend(primary, flaky));

    await expect(gateway.erase(fact.id)).rejects.toThrow(/STILL HELD/);
    expect(await primary.holds(fact.id)).toBe(false); // the reactor has lost the target...
    expect(await mirrorInner.holds(fact.id)).toBe(true); // ...but the bytes are still out there

    retain = false;
    await expect(gateway.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    expect(tombstones()).toBe(1);
    await gateway.close();
  });

  it("the manifest never cites the erasure's own tombstone, on the first call or a retry", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    const first = await gateway.erase(fact.id, { reason: "the subject asked" });
    // The tombstone names the id in an `erases` pointer, so a naive citation filter picks it up on
    // any call where it is already in the ground — and a caller cascading on citations would then
    // try to erase the cut itself and be refused by the append-only guard.
    for (const cited of first.citations) {
      expect(
        isTombstone(
          gateway.reactor.get(cited)?.claims ?? { timestamp: 0, author: "", pointers: [] },
        ),
      ).toBe(false);
    }
    await gateway.close();
  });

  it("...but a STRUCK tombstone from an earlier, forgiven erasure IS a citation", async () => {
    // The exclusion is by IDENTITY (the one tombstone this cut mints or reuses), not by shape. A
    // struck tombstone from a pardoned earlier erasure is a surviving delta dangling at the hole —
    // exactly what the manifest exists to enumerate for a cascading caller — and a shape filter
    // would silently drop it from the audit of what the cut leaves behind.
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await gateway.erase(fact.id, { reason: "first request" });
    const struck = [...gateway.reactor.snapshot()].find((d) => isTombstone(d.claims))!;
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, struck.id), OP_SEED)]);
    await gateway.append([fact]); // forgiven, and returned

    const second = await gateway.erase(fact.id, { reason: "second request" });
    expect(second.citations).toContain(struck.id); // the pardoned cut is a hole the new cut leaves
    const fresh = [...gateway.reactor.snapshot()].find(
      (d) => isTombstone(d.claims) && d.id !== struck.id,
    )!;
    expect(second.citations).not.toContain(fresh.id); // the cut itself never is
    await gateway.close();
  });
});
