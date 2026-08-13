// WHICH SPAWN BUDGET REACHES WHICH DOOR — SPEC §23.9 × §24.5, T139. The behavioural rails in
// render-spawn-clock.test.ts prove the two clocks are separate and that each door refuses on a 1ms
// budget. They cannot see the question this file asks, and a probe proved it: pointing the metered
// quarantine site at the HOST's 10s spawn ceiling reddens NOTHING there, because the render window
// re-arms at `online` and stops a wedged bundle on the pool's own clock anyway. The 10s only
// materialises when SPAWN ITSELF is slow — a loaded host — and Node offers no seam to make thread
// start slow on demand. A wall-clock rail for it would be the flake this ticket exists to close.
//
// So this file asserts the SEAM instead of the symptom: it replaces `renderInWorker` and records
// which spawn budget each of the three call sites hands it. That is the whole content of the bug —
// a site forwarding the wrong number, or none — and it is deterministic.
//
// The split it pins is deliberate and asymmetric:
//   - token door, public door → the OPERATOR'S ceiling. Spawn measures the host, and the host is
//     the operator's to bound.
//   - quarantine pool → the POOL'S OWN declared clock. A pool holds its slot across BOTH windows,
//     so the host's 10s here would let a pool that declared 120ms occupy its slot for 10120ms: a
//     ceiling the operator never declared and cannot read in `envelopeReports()`. §24.5 promises
//     the envelope is the pool's whole bill.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: that the budgets, once forwarded, are enforced.
// `renderInWorker` is replaced here, so nothing real runs. Enforcement is render-spawn-clock.test.ts.
// Neither file is sufficient alone, which is the point of having both.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const calls: { timeoutMs: number | undefined; spawnTimeoutMs: number | undefined }[] = [];

vi.mock("../../src/gateway/render-worker.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/gateway/render-worker.js")>();
  return {
    ...real,
    renderInWorker: (
      _bundle: string,
      _node: unknown,
      timeoutMs?: number,
      opts?: { spawnTimeoutMs?: number },
    ) => {
      calls.push({ timeoutMs, spawnTimeoutMs: opts?.spawnTimeoutMs });
      return Promise.resolve({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<p>recorded</p>",
      });
    },
  };
});

const OP_SEED = "0e".repeat(32);
const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";

// Three numbers that cannot be confused for one another: a site forwarding the wrong one names
// itself in the failure message rather than coinciding with the right answer (H10).
const HOST_SPAWN = 7777;
const HOST_RENDER = 8888;
const POOL_RENDER = 333;

const staged = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { renderTimeoutMs: HOST_RENDER, renderSpawnTimeoutMs: HOST_SPAWN },
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
  return gw;
};

describe("§23.9 / T139: every door forwards a spawn budget, and it is the right one", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("the TOKEN door hands the worker the operator's spawn ceiling", async () => {
    const gw = await staged();
    expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200);
    expect(calls).toEqual([{ timeoutMs: HOST_RENDER, spawnTimeoutMs: HOST_SPAWN }]);
    await gw.close();
  });

  it("the PUBLIC door hands the worker the operator's spawn ceiling", async () => {
    // The door where it matters most: the spawn window is what really bounds how long one
    // anonymous request may hold a `maxPublicRenders` slot.
    const gw = await staged();
    await gw.declarePublic(["Plant"]);
    expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
    expect(calls).toEqual([{ timeoutMs: HOST_RENDER, spawnTimeoutMs: HOST_SPAWN }]);
    await gw.close();
  });

  it("a QUARANTINE POOL hands the worker its OWN clock, never the host's ceiling", async () => {
    // The rail no behavioural test can stand in for. Pointing this site at HOST_SPAWN passes every
    // wall-clock rail in render-spawn-clock.test.ts — measured, not assumed — because the render
    // window re-arms at `online` and stops a wedged bundle on the pool's clock regardless. The
    // difference shows only under slow spawn, and it shows as a slot held 23x its declared budget.
    const gw = await staged();
    await gw.append([
      signClaims(
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 1, renderTimeoutMs: POOL_RENDER },
          authorForSeed(OP_SEED),
          9001,
        ),
        OP_SEED,
      ),
    ]);
    const pool = await gw.openQuarantine();
    expect((await pool.gateway.serveRoute("ok", FERN, "full")).status).toBe(200);
    expect(calls).toEqual([{ timeoutMs: POOL_RENDER, spawnTimeoutMs: POOL_RENDER }]);
    await gw.close();
  });

  it("no door leaves the spawn budget undefined", async () => {
    // The cheap sweep the three rails above would each miss individually: a site that drops the key
    // falls back to RENDER_SPAWN_TIMEOUT_MS, which is a working default and therefore silent.
    const gw = await staged();
    await gw.declarePublic(["Plant"]);
    await gw.serveRoute("ok", FERN, "full");
    await gw.serveRoute("ok", FERN, "public");
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.spawnTimeoutMs).toBeTypeOf("number");
    await gw.close();
  });
});
