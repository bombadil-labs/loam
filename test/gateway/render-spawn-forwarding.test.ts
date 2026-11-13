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
    const gw = await staged();
    await gw.declarePublic(["Plant"]);
    expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
    expect(calls).toEqual([{ timeoutMs: HOST_RENDER, spawnTimeoutMs: HOST_SPAWN }]);
    await gw.close();
  });

  it("a QUARANTINE POOL hands the worker its OWN clock, never the host's ceiling", async () => {
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
    const gw = await staged();
    await gw.declarePublic(["Plant"]);
    await gw.serveRoute("ok", FERN, "full");
    await gw.serveRoute("ok", FERN, "public");
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.spawnTimeoutMs).toBeTypeOf("number");
    await gw.close();
  });
});
