import { describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { readSlates } from "../../src/gateway/slate-law.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "d3".repeat(32);

describe("reading slates in a store with none takes no snapshot of the store", () => {
  it("a store with no slate record answers empty without a snapshot, on a read and on a write", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    const snapshot = vi.spyOn(gw.reactor, "snapshot");

    expect(readSlates(gw.reactor, gw.validityNow(), authorForSeed(OP_SEED), Date.now())).toEqual(
      [],
    );
    expect(snapshot).not.toHaveBeenCalled();

    await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    await gw.query(`mutation { plant(entity: "${FERN}", height: 31) { height } }`);
    const fromSlates = snapshot.mock.calls.length;
    expect(fromSlates, "readSlates and readClosedIds must not snapshot").toBe(0);
    await gw.close();
  });
});

async function erasedStore(erasures: number): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  const facts = Array.from({ length: erasures }, (_, n) =>
    observed(`plant:gone-${n}`, "height", n, 1000 + n, OP_SEED),
  );
  await gw.append([observed(FERN, "height", 30, 900, OP_SEED), ...facts]);
  for (const d of facts) await gw.erase(d.id);
  return gw;
}

describe("the slate probe does not walk erasure orders", () => {
  it("a store that erased 12 facts probes exactly as much as one that erased none", async () => {
    const probe = async (erasures: number) => {
      const gw = await erasedStore(erasures);
      const get = vi.spyOn(gw.reactor, "get");
      expect(readSlates(gw.reactor, gw.validityNow(), authorForSeed(OP_SEED), Date.now())).toEqual(
        [],
      );
      const calls = get.mock.calls.length;
      await gw.close();
      return calls;
    };
    expect(await probe(12)).toBe(await probe(0));
  }, 120_000);
});
