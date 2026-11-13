import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { RENDER_SPAWN_TIMEOUT_MS, renderInWorker } from "../../src/gateway/render-worker.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

const OP_SEED = "0e".repeat(32);
const OK = "export default (n) => `<p>height: ${n.height ?? n.view.height}</p>`;";
const HANG = "export default () => { while (true) {} };";
const SLOW =
  "export default () => { const end = Date.now() + 200; while (Date.now() < end); return `<p>slow</p>`; };";
const NODE = { height: 42 };

describe("§23.9 / T139: spawn and render are bounded by SEPARATE budgets", () => {
  it("the SPAWN window reads the spawn budget, not the render budget (rail a)", async () => {
    const out = await renderInWorker(OK, NODE, 10_000, { spawnTimeoutMs: 1 });
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start");
  });

  it("the RENDER window still reads the operator's budget, not the spawn budget (rail b)", async () => {
    const out = await renderInWorker(SLOW, NODE, 1, { spawnTimeoutMs: 10_000 });
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
  });

  it("CONTROL: a healthy bundle renders when both budgets are honest (rail c)", async () => {
    const out = await renderInWorker(OK, NODE, RENDER_SPAWN_TIMEOUT_MS, {
      spawnTimeoutMs: RENDER_SPAWN_TIMEOUT_MS,
    });
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.body).toBe("<p>height: 42</p>");
  });

  it("a generous SPAWN ceiling does not widen the wedge window for a hanging bundle (rail d)", async () => {
    const t0 = Date.now();
    const out = await renderInWorker(HANG, NODE, 200, { spawnTimeoutMs: RENDER_SPAWN_TIMEOUT_MS });
    const elapsed = Date.now() - t0;
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    expect(elapsed).toBeLessThan(RENDER_SPAWN_TIMEOUT_MS / 2);
  }, 30_000);
});

describe("§23.9 / T139: the split reaches the DOOR, and the spawn budget is the operator's", () => {
  const boot = (options: {
    renderTimeoutMs?: number;
    renderSpawnTimeoutMs?: number;
  }): Promise<Gateway> =>
    Gateway.boot(
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
      options,
    );

  const staged = async (options: {
    renderTimeoutMs?: number;
    renderSpawnTimeoutMs?: number;
  }): Promise<Gateway> => {
    const gw = await boot(options);
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
    await gw.publishRenderer({
      route: "slow",
      schema: "Plant",
      consumes: ["height"],
      bundle: SLOW,
    });
    return gw;
  };

  it("a 1ms SPAWN budget refuses at the door — the knob reaches the worker (rail e)", async () => {
    const gw = await staged({ renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 1 });
    const out = await gw.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start");
    await gw.close();
  });

  it("the PUBLIC door carries the spawn budget too (rail g)", async () => {
    const gw = await staged({ renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 1 });
    await gw.declarePublic(["Plant"]);
    const out = await gw.serveRoute("ok", FERN, "public");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start");
    await gw.close();
  });

  it("a generous SPAWN budget does not lift the door's RENDER budget (rail f)", async () => {
    const gw = await staged({ renderTimeoutMs: 1, renderSpawnTimeoutMs: 10_000 });
    const out = await gw.serveRoute("slow", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    await gw.close();
  });
});

describe("§23.9 × §24.5 / T139: a metered pool's spawn window is its OWN clock", () => {
  const pooled = async (poolRenderMs: number): Promise<Gateway> => {
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
      { renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 10_000 },
    );
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
    await gw.publishRenderer({
      route: "hang",
      schema: "Plant",
      consumes: ["height"],
      bundle: HANG,
    });
    await gw.append([
      signClaims(
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 1, renderTimeoutMs: poolRenderMs },
          authorForSeed(OP_SEED),
          9001,
        ),
        OP_SEED,
      ),
    ]);
    return gw;
  };

  it("a wedged pool render gives its slot back on the POOL's clock (rail h)", async () => {
    const gw = await pooled(300);
    const pool = await gw.openQuarantine();
    const t0 = Date.now();
    const out = await pool.gateway.serveRoute("hang", FERN, "full");
    const elapsed = Date.now() - t0;
    expect(out.status).toBe(500);
    expect(elapsed).toBeLessThan(3000);
    expect(gw.envelopeReports()[0]!.inFlight).toBe(0);
    await gw.close();
  });

  it("CONTROL: the same pool renders a healthy bundle on an honest clock", async () => {
    const gw = await pooled(10_000);
    const pool = await gw.openQuarantine();
    const out = await pool.gateway.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(200);
    expect(gw.envelopeReports()[0]!.faulted).toBe(0);
    await gw.close();
  });
});
