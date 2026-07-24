// T70 (health) — erasure is a PROMISE THAT SETTLES, and health is where the settling is visible.
// This store is eventually consistent: an erasure is decided the moment the tombstone lands, but
// the bytes leave each tier on that tier's own time (a lagging mirror, a locked WAL, a pool that
// was offline). Myk's call (2026-07-24): that gap is a HEALTH state, not a fault — serve keeps
// serving, and `health()` answers, live, whether the store's promises have all settled to bytes.
//
// Object level: the verdict is the backend's own byte probe (heldAmong/holds) over the LIVE
// tombstone set — never a count, never a boot-time snapshot that goes stale as new erasures land.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);

const boot = (backend: MemoryBackend): Promise<Gateway> =>
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
    expect(health.erasure).toMatchObject({ settled: true, pending: 0, outstanding: [] });
    await gw.close();
  });

  it("a fully-executed erasure settles; a byte that RESURFACES on a tier reopens the debt", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);

    // The erasure executed: tombstone landed, bytes purged — the promise has settled.
    const settled = await gw.health();
    expect(settled.status).toBe("ok");
    expect(settled.erasure.tombstones).toBe(1); // the promise is remembered...
    expect(settled.erasure.pending).toBe(0); // ...and fully kept

    // A tier that had not heard delivers the bytes back (behind the gateway — the eventually-
    // consistent shape: a lagging replica syncing up). The promise is now UNSETTLED again, and
    // health must say so without waiting for any boot-time snapshot to be rebuilt.
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
});
