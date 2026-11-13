import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { isErasure } from "../../src/gateway/erase-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import type { StoreBackend } from "../../src/store/backend.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);

const boot = (backend: StoreBackend): Promise<Gateway> =>
  Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

describe("T70: gateway.health() — the live byte verdict over every erasure promised", () => {
  it("a store with no erasures is settled, and says so", async () => {
    const gw = await boot(new MemoryBackend());
    const health = await gw.health();
    expect(health.status).toBe("ok");
    expect(health.erasure).toEqual({
      settled: true,
      promised: 0,
      pending: 0,
      outstanding: [],
      unproven: false,
    });
    expect("lagging" in health).toBe(false);
    await gw.close();
  });

  it("a fully-executed erasure settles; a byte that RESURFACES on a tier reopens the debt", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);

    const settled = await gw.health();
    expect(settled.status).toBe("ok");
    expect(settled.erasure.promised).toBe(1);
    expect(settled.erasure.pending).toBe(0);

    await backend.append([target]);
    const settling = await gw.health();
    expect(settling.status).toBe("settling");
    expect(settling.erasure.settled).toBe(false);
    expect(settling.erasure.pending).toBe(1);
    expect(settling.erasure.outstanding).toContain(target.id);
    await gw.close();
  });

  it("a tier that cannot answer is UNPROVEN, never reported settled (H9)", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);

    const realHolds = backend.holds.bind(backend);
    backend.holds = () => Promise.reject(new Error("tier offline"));
    const health = await gw.health();
    expect(health.status).toBe("unproven");
    expect(health.erasure.settled).toBe(false);
    expect(health.erasure.unproven).toBe(true);
    backend.holds = realHolds;
    await gw.close();
  });

  it("a batch-probing backend is asked in ONE pass, its lag reaches the report, and a mirror-side byte counts", async () => {
    const primaryTier = new MemoryBackend();
    const mirrorTier = new MemoryBackend();
    const backend = new MirrorBackend(primaryTier, mirrorTier);
    let perIdAsked = false;
    const realHolds = backend.holds.bind(backend);
    backend.holds = (id: string) => {
      perIdAsked = true;
      return realHolds(id);
    };
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);

    perIdAsked = false;
    await mirrorTier.append([target]);
    const settling = await gw.health();
    expect(settling.status).toBe("settling");
    expect(settling.erasure.outstanding).toContain(target.id);
    expect(perIdAsked).toBe(false);

    await mirrorTier.purge([target.id]);
    const realAppend = mirrorTier.append.bind(mirrorTier);
    mirrorTier.append = () => Promise.reject(new Error("mirror offline"));
    await gw.append([observed(FERN, "height", 31, 2000, OP_SEED)]);
    mirrorTier.append = realAppend;
    const lagged = await gw.health();
    expect(lagged.erasure.settled).toBe(true);
    expect(lagged.lagging).toBe(true);
    expect(lagged.status).toBe("settling");
    await gw.close();
  });

  it("the promise reaches every attached pool: retained bytes, owed delivery, and a mute pool all unsettle", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);
    expect((await gw.health()).status).toBe("ok");

    const poolBackend = new MemoryBackend();
    const pool = await boot(poolBackend);
    const erasure = (await backend.deltasSince(new Set())).find((d) => isErasure(d.claims))!;
    await pool.append([erasure]);
    expect((await pool.health()).erasure.promised).toBe(1);
    await poolBackend.append([target]);
    gw.quarantinePools.add(pool);
    const retained = await gw.health();
    expect(retained.status).toBe("settling");
    expect(retained.erasure.outstanding).toContain(target.id);

    gw.quarantinePools.clear();
    const deaf = await boot(new MemoryBackend());
    gw.quarantinePools.add(deaf);
    const owed = await gw.health();
    expect(owed.status).toBe("settling");
    expect(owed.erasure.outstanding).toContain(target.id);

    gw.quarantinePools.clear();
    const muteBackend = new MemoryBackend();
    const mute = await boot(muteBackend);
    await mute.append([erasure]);
    muteBackend.holds = () => Promise.reject(new Error("pool offline"));
    gw.quarantinePools.add(mute);
    const unproven = await gw.health();
    expect(unproven.status).toBe("unproven");
    expect(unproven.erasure.unproven).toBe(true);

    gw.quarantinePools.clear();
    await Promise.all([gw.close(), pool.close(), deaf.close(), mute.close()]);
  });
});
