import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { isErasure, readErasures } from "../../src/gateway/erase-law.js";
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

async function groveOn(
  backend: StoreBackend,
): Promise<{ gateway: Gateway; fact: Delta; erasures: () => number }> {
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
    erasures: () => [...gateway.reactor.snapshot()].filter((d) => isErasure(d.claims)).length,
  };
}

function retaining(inner: MemoryBackend): StoreBackend {
  return {
    append: (d) => inner.append(d),
    deltasSince: (k) => inner.deltasSince(k),
    purge: () => Promise.resolve(0),
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
  };
}

const unreachable = (): StoreBackend => ({
  append: () => Promise.reject(new Error("cold store unreachable")),
  deltasSince: () => Promise.reject(new Error("cold store unreachable")),
  purge: () => Promise.reject(new Error("cold store unreachable")),
  holds: () => Promise.reject(new Error("cold store unreachable")),
  close: () => Promise.resolve(),
});

describe("erase is complete only when every TIER is clean", () => {
  it("the MIRROR keeps the byte while the primary is clean: erase refuses", async () => {
    const primary = new MemoryBackend();
    const mirrorInner = new MemoryBackend();
    const backend = new MirrorBackend(primary, retaining(mirrorInner));
    const { gateway, fact } = await groveOn(backend);

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    expect(await mirrorInner.holds(fact.id)).toBe(true);
    expect(await primary.holds(fact.id)).toBe(false);
    await gateway.close();
  });

  it("the PRIMARY keeps the byte while the mirror removes a straggler: the aggregate count says 1, and erase still refuses", async () => {
    const primaryInner = new MemoryBackend();
    const mirror = new MemoryBackend();
    const backend = new MirrorBackend(retaining(primaryInner), mirror);
    const { gateway, fact } = await groveOn(backend);

    expect(await primaryInner.holds(fact.id)).toBe(true);
    expect(await mirror.holds(fact.id)).toBe(true);

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    expect(await primaryInner.holds(fact.id)).toBe(true);
    expect(await mirror.holds(fact.id)).toBe(false);
    await gateway.close();
  });

  it("a `.tmp` straggler the sweep missed makes erase refuse, though no read on any tier can see it", async () => {
    const root = scratch();
    roots.push(root);
    const primary = new MemoryBackend();
    const vault = new ArchiveBackend(root);
    const shallow: StoreBackend = {
      append: (d) => vault.append(d),
      deltasSince: (k) => vault.deltasSince(k),
      holds: (id) => vault.holds(id),
      close: () => vault.close(),
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

    const fan = join(root, fact.id.slice(0, 2));
    writeFileSync(join(fan, `${fact.id}.json.4242.tmp`), "{}\n");

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    await gateway.close();
  });

  it("an UNREACHABLE tier makes erase refuse rather than report a completion it cannot prove", async () => {
    const backend = new MirrorBackend(new MemoryBackend(), unreachable());
    const { gateway, fact } = await groveOn(backend);
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /unreachable/i,
    );
    await gateway.close();
  });

  it("POSITIVE CONTROL: the same fixture with nothing retained completes normally", async () => {
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

  it("a refused erase still records the erasure, and the re-run after repair mints no second one", async () => {
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
    const { gateway, fact, erasures } = await groveOn(new MirrorBackend(primary, flakyMirror));

    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).rejects.toThrow(
      /STILL HELD|not complete/i,
    );
    expect(erasures()).toBe(1);

    retain = false;
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    expect(erasures()).toBe(1);
    await gateway.close();
  });
});

describe("the retry anchor honors negation", () => {
  const strike = async (gateway: Gateway, targetId: string): Promise<void> => {
    const tomb = [...gateway.reactor.snapshot()].find(
      (d) =>
        isErasure(d.claims) &&
        d.claims.pointers.some(
          (p) => p.target.kind === "delta" && p.target.deltaRef.delta === targetId,
        ),
    );
    await gateway.append([signClaims(makeNegationClaims(OPERATOR, 9000, tomb!.id), OP_SEED)]);
  };

  it("after its erasure is negated the id stays refused at append", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await gateway.erase(fact.id, { reason: "the subject asked" });
    await strike(gateway, fact.id);
    expect(readErasures(gateway.reactor, gateway.validityNow(), OPERATOR).has(fact.id)).toBe(false);
    await expect(gateway.append([fact])).rejects.toThrow(/erased/);
    await gateway.close();
  });

  it("a struck erasure is not a licence to report a completion: erase with no target REFUSES", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await gateway.erase(fact.id, { reason: "the subject asked" });
    await strike(gateway, fact.id);

    await expect(gateway.erase(fact.id)).rejects.toThrow(/nothing to erase/);
    await gateway.close();
  });
});

describe("the retry bypass is for an OUTSTANDING erasure, not for any erasure", () => {
  it("a second erase of a CLEANLY erased id still refuses", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    await expect(gateway.erase(fact.id, { reason: "the subject asked" })).resolves.toMatchObject({
      erased: fact.id,
    });
    await expect(gateway.erase(fact.id)).rejects.toThrow(/nothing to erase/);
    await gateway.close();
  });

  it("...while a retry with bytes still on a tier is let through", async () => {
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
    const { gateway, fact, erasures } = await groveOn(new MirrorBackend(primary, flaky));

    await expect(gateway.erase(fact.id)).rejects.toThrow(/STILL HELD/);
    expect(await primary.holds(fact.id)).toBe(false);
    expect(await mirrorInner.holds(fact.id)).toBe(true);

    retain = false;
    await expect(gateway.erase(fact.id)).resolves.toMatchObject({ erased: fact.id });
    expect(erasures()).toBe(1);
    await gateway.close();
  });

  it("the manifest never cites the erasure's own erasure, on the first call or a retry", async () => {
    const { gateway, fact } = await groveOn(
      new MirrorBackend(new MemoryBackend(), new MemoryBackend()),
    );
    const first = await gateway.erase(fact.id, { reason: "the subject asked" });
    for (const cited of first.citations) {
      expect(
        isErasure(
          gateway.reactor.get(cited)?.claims ?? {
            timestamp: 0,
            validFrom: 0,
            author: "",
            pointers: [],
          },
        ),
      ).toBe(false);
    }
    await gateway.close();
  });
});
