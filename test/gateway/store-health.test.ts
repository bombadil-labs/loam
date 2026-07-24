// T70 (health) — erasure is a PROMISE THAT SETTLES, and health is where the settling is visible.
// This store is eventually consistent: an erasure is decided the moment the tombstone lands, but
// the bytes leave each tier on that tier's own time (a lagging mirror, a locked WAL, a pool that
// was offline). Myk's call (2026-07-24): that gap is a HEALTH state, not a fault — serve keeps
// serving, and `health()` answers, live, whether the store's promises have all settled to bytes.
//
// Object level: the verdict is the backend's own byte probe over the LIVE tombstone set — never
// a count, never a boot-time snapshot that goes stale as new erasures land. Both of healthImpl's
// probe paths are railed here: the per-id `holds` fallback (MemoryBackend has no batch probe) and
// the batch `heldAmong` path (a MirrorBackend-backed gateway, which also pins that `lagging`
// reaches the report). Named seam: no test assembles the full production stack — /health over a
// real MirrorBackend(sqlite, archive) on disk; the closing rail is an integration test that boots
// that stack, erases, and polls the door.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { isTombstone } from "../../src/gateway/erase.js";
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
    expect("lagging" in health).toBe(false); // no mirror, no lag field — absence is the signal
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
    expect(settled.erasure.promised).toBe(1); // the promise is remembered...
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

  it("a batch-probing backend is asked in ONE pass, its lag reaches the report, and a mirror-side byte counts", async () => {
    // The wiring rail: healthImpl must PREFER the backend's batch probe — deleting that branch
    // leaves every MemoryBackend test green while quietly restoring one archive sweep per dead id
    // on a real deployment. So the gateway runs over a MirrorBackend (which offers `heldAmong`),
    // the combinator's own per-id `holds` is instrumented, and the verdict must arrive without it.
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

    // The byte sneaks back onto the MIRROR tier only — §11 covers both tiers, and the report
    // must see through the combinator's union, via the batch probe, never the per-id fallback.
    // (Reset the spy here: erase's OWN holds-verdict legitimately probes per id — the flag pins
    // the HEALTH call's path, not erase's.)
    perIdAsked = false;
    await mirrorTier.append([target]);
    const settling = await gw.health();
    expect(settling.status).toBe("settling");
    expect(settling.erasure.outstanding).toContain(target.id);
    expect(perIdAsked).toBe(false); // the batch path answered; the fallback was never consulted

    // And the mirror's LAG is part of settling: scrub the byte so erasure settles, force the
    // lag flag with an append the mirror refuses, and the report must still say "settling",
    // carrying the flag — a settled erasure over a lagging mirror is not yet "ok".
    await mirrorTier.purge([target.id]);
    const realAppend = mirrorTier.append.bind(mirrorTier);
    mirrorTier.append = () => Promise.reject(new Error("mirror offline"));
    await gw.append([observed(FERN, "height", 31, 2000, OP_SEED)]);
    mirrorTier.append = realAppend;
    const lagged = await gw.health();
    expect(lagged.erasure.settled).toBe(true); // the erasure itself is fully kept...
    expect(lagged.lagging).toBe(true); // ...but the mirror is behind
    expect(lagged.status).toBe("settling"); // so the store is converging, not ok
    await gw.close();
  });

  it("the promise reaches every attached pool: retained bytes, owed delivery, and a mute pool all unsettle", async () => {
    // The erase fan-out and `erasureOutstanding` both define §11 over the quarantine pools — a
    // health that stopped at the backend would read "ok" over a replica still holding the
    // plaintext, the exact evasion channel the one-way glass must not open. Same fault model,
    // three shapes, each driven through a real attached pool.
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    const target = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([target]);
    await gw.erase(target.id);
    expect((await gw.health()).status).toBe("ok"); // settled locally, no pools yet

    // RETAINED BYTES: a pool that carries the tombstone but whose bytes never left — planted
    // behind its gateway, as a crash or a partial purge would leave them.
    const poolBackend = new MemoryBackend();
    const pool = await boot(poolBackend);
    const tombstone = (await backend.deltasSince(new Set())).find((d) => isTombstone(d.claims))!;
    await pool.append([tombstone]); // the promise arrived...
    await poolBackend.append([target]); // ...but the bytes are still at rest there
    gw.quarantinePools.add(pool);
    const retained = await gw.health();
    expect(retained.status).toBe("settling");
    expect(retained.erasure.outstanding).toContain(target.id);

    // OWED DELIVERY: a pool that never received the tombstone holds no bytes — and is STILL
    // outstanding, because a replica that has not heard the promise cannot be keeping it.
    gw.quarantinePools.clear();
    const deaf = await boot(new MemoryBackend());
    gw.quarantinePools.add(deaf);
    const owed = await gw.health();
    expect(owed.status).toBe("settling");
    expect(owed.erasure.outstanding).toContain(target.id);

    // A MUTE POOL: one whose bytes cannot be examined is unproven, never laundered to ok (H9).
    gw.quarantinePools.clear();
    const muteBackend = new MemoryBackend();
    const mute = await boot(muteBackend);
    await mute.append([tombstone]);
    muteBackend.holds = () => Promise.reject(new Error("pool offline"));
    gw.quarantinePools.add(mute);
    const unproven = await gw.health();
    expect(unproven.status).toBe("unproven");
    expect(unproven.erasure.unproven).toBe(true);

    gw.quarantinePools.clear();
    await Promise.all([gw.close(), pool.close(), deaf.close(), mute.close()]);
  });
});
