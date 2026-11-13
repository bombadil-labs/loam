import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";
const PARK = `export default () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  return "<p>late</p>";
};`;

const POOL_CLOCK = 4000;
const POOL_SLOTS = 3;

async function primary(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { maxPublicRenders: 1 },
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
  await gw.publishRenderer({ route: "park", schema: "Plant", consumes: ["height"], bundle: PARK });
  await gw.declarePublic(["Plant"]);
  await gw.append([
    signClaims(
      envelopeClaims(
        ENVELOPE_ANY,
        { maxConcurrentRenders: POOL_SLOTS, renderTimeoutMs: POOL_CLOCK },
        OP,
        9001,
      ),
      OP_SEED,
    ),
  ]);
  return gw;
}

async function saturate(gw: Gateway, pool: Gateway): Promise<Promise<unknown>[]> {
  const held = Array.from({ length: POOL_SLOTS }, () => pool.serveRoute("park", FERN, "full"));
  const deadline = Date.now() + 3000;
  while (gw.envelopeReports().every((r) => r.inFlight < POOL_SLOTS) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return held;
}

const doorRead = (gw: Gateway): unknown => gw.surface("public")!.hooks.resolve("Plant", FERN);

describe("T34: a saturated quarantine does not degrade the primary's doors", () => {
  it("the primary keeps its OWN render slots while every pool slot is held", async () => {
    const gw = await primary();
    const pool = await gw.openQuarantine();
    const held = await saturate(gw, pool.gateway);

    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS);
    expect(gw.publicRendersInFlight).toBe(0);

    const served = await gw.serveRoute("ok", FERN, "public");
    expect(served.status).toBe(200);
    expect(served.body).toContain("42");
    expect(gw.publicRendersInFlight).toBe(0);

    await Promise.all(held);
    await pool.drop();
    await gw.close();
  }, 30000);

  it("a primary door READ under full quarantine load stays within an order of magnitude of idle", async () => {
    const gw = await primary();
    const pool = await gw.openQuarantine();

    const t0 = Date.now();
    for (let i = 0; i < 3; i += 1) {
      expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
      doorRead(gw);
    }
    const baseline = (Date.now() - t0) / 3;

    const held = await saturate(gw, pool.gateway);
    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS);
    const t1 = Date.now();
    const rendered = await gw.serveRoute("ok", FERN, "public");
    const answer = doorRead(gw);
    const underLoad = Date.now() - t1;
    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS);

    expect(rendered.status).toBe(200);
    expect(rendered.body).toContain("42");
    expect(answer).toBeDefined();
    expect(underLoad).toBeLessThan(Math.max(baseline * 12, 750));
    expect(underLoad).toBeLessThan(POOL_CLOCK / 2);

    await Promise.all(held);
    await pool.drop();
    await gw.close();
  }, 30000);

  it("two pools cannot borrow each other's budget", async () => {
    const gw = await primary();
    const busy = await gw.openQuarantine();
    const quiet = await gw.openQuarantine();
    const held = await saturate(gw, busy.gateway);

    expect((await busy.gateway.serveRoute("ok", FERN, "full")).status).toBe(503);
    const neighbours = await Promise.all([
      quiet.gateway.serveRoute("ok", FERN, "full"),
      quiet.gateway.serveRoute("ok", FERN, "full"),
      quiet.gateway.serveRoute("ok", FERN, "full"),
    ]);
    expect(neighbours.map((r) => r.status)).toEqual([200, 200, 200]);

    const rows = gw.envelopeReports();
    expect(rows.find((r) => r.inFlight === POOL_SLOTS)!.refusedForSlots).toBe(1);
    expect(rows.find((r) => r.inFlight === 0)!.refusedForSlots).toBe(0);

    await Promise.all(held);
    await busy.drop();
    await quiet.drop();
    await gw.close();
  }, 30000);
});
