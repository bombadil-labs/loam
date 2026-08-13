// §24.5's hard constraint (ticket T34), and the rail the whole ticket exists for: THE QUARANTINE'S
// BUDGET MUST NOT DEGRADE THE PRIMARY STORE'S DOORS. A stranger's app may burn its entire envelope —
// every slot held, every clock run out — and the primary must keep answering at full speed.
//
// WHAT THE SATURATING BUNDLE DOES, and why it is not a spin loop. §24.5 claims slot-holding, a wall
// clock, and a per-worker memory ceiling. It does NOT claim CPU scheduling: an operator who declares
// many slots can still burn many cores, and that is their stated decision. So the saturating bundle
// PARKS — it holds its slot for the pool's whole clock while burning nothing — and these rails then
// measure the property the section actually claims. A spin loop here would be measuring the OS
// scheduler on whatever host CI gave us, and the honest bound for that is not a rail.
//
// WHAT TURNS THESE RED, probed: deleting the envelope gate from serveRoute reddens tests 1 and 3, and
// giving every pool one shared counter object reddens test 3.
//
// WHAT TEST 2 DOES AND DOES NOT PIN, stated so no one over-reads it. It measures an AWAITED primary
// public render (which yields to the event loop and spawns its own worker) plus a synchronous view
// read. The synchronous half is the weaker one and is kept only as a second observation: nothing a
// worker thread does can delay a call that never yields. The bound sees the failure §24.5 names —
// "the primary blocked until the quarantine's timer fired". It is NOT a CPU-isolation rail and
// cannot be one, because §24.5d does not claim CPU scheduling. The in-flight assertions bracketing
// the measurement are what stop it passing against work that blocked the loop and finished early.

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
// Holds its slot until the pool's clock terminates the worker, and burns no CPU doing it:
// Atomics.wait blocks the thread in a futex, and worker.terminate() still interrupts it.
const PARK = `export default () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
  return "<p>late</p>";
};`;

const POOL_CLOCK = 4000; // the quarantine's own timeout; the primary must never wait on it
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
    // The primary's OWN anonymous fan is squeezed to one slot on purpose: if a pool render charged
    // the primary's counter, the primary's next public render would meet a 503 rather than a worker.
    // Left at its default the assertion below would hold whatever the envelope did.
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

// Fill every slot of a pool and DO NOT await: the returned promises settle when the pool's own clock
// fires. Resolves once the workers are actually occupying their slots.
async function saturate(gw: Gateway, pool: Gateway): Promise<Promise<unknown>[]> {
  const held = Array.from({ length: POOL_SLOTS }, () => pool.serveRoute("park", FERN, "full"));
  const deadline = Date.now() + 3000;
  while (gw.envelopeReports().every((r) => r.inFlight < POOL_SLOTS) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return held;
}

// A read through the PRIMARY's public door — the surface §24.5 promises stays fast.
const doorRead = (gw: Gateway): unknown => gw.surface("public")!.hooks.resolve("Plant", FERN);

describe("T34: a saturated quarantine does not degrade the primary's doors", () => {
  it("the primary keeps its OWN render slots while every pool slot is held", async () => {
    const gw = await primary();
    const pool = await gw.openQuarantine();
    const held = await saturate(gw, pool.gateway);

    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS); // the pool really is full
    expect(gw.publicRendersInFlight).toBe(0); // …and it cost the primary nothing

    const served = await gw.serveRoute("ok", FERN, "public");
    expect(served.status).toBe(200);
    expect(served.body).toContain("42");
    expect(gw.publicRendersInFlight).toBe(0); // the primary's own slot came back

    await Promise.all(held);
    await pool.drop();
    await gw.close();
  }, 30000);

  it("a primary door READ under full quarantine load stays within an order of magnitude of idle", async () => {
    const gw = await primary();
    const pool = await gw.openQuarantine();

    // The measured act is an AWAITED public render, not only the synchronous view read: it crosses
    // the event loop and spawns a worker of its own, so a main thread held by the quarantine, or a
    // host the quarantine had exhausted, would show here. The synchronous read is asserted too, but
    // it is the weaker half — nothing a worker does can delay a call that never yields.
    const t0 = Date.now();
    for (let i = 0; i < 3; i += 1) {
      expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
      doorRead(gw);
    }
    const baseline = (Date.now() - t0) / 3;

    const held = await saturate(gw, pool.gateway);
    // The pool is genuinely full AT THE MOMENT OF MEASUREMENT, before and after. Without this the
    // rail would also pass against a render that blocked the main thread and finished before the
    // read was taken — the exact failure the latency bound is here to catch.
    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS);
    const t1 = Date.now();
    const rendered = await gw.serveRoute("ok", FERN, "public");
    const answer = doorRead(gw);
    const underLoad = Date.now() - t1;
    expect(gw.envelopeReports()[0]!.inFlight).toBe(POOL_SLOTS);

    expect(rendered.status).toBe(200);
    expect(rendered.body).toContain("42");
    expect(answer).toBeDefined();
    // The failure this catches is "the primary blocked until the quarantine's timeout fired" — an
    // order-of-magnitude effect, not a percentage one. The floor keeps a sub-millisecond baseline
    // from making the bound absurdly tight, and the whole bound sits far under POOL_CLOCK.
    expect(underLoad).toBeLessThan(Math.max(baseline * 12, 750));
    // And absolutely, not only relatively: whatever the baseline turned out to be on this host, the
    // primary must not have waited on the quarantine's clock.
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

    // The busy pool is refusing its own callers…
    expect((await busy.gateway.serveRoute("ok", FERN, "full")).status).toBe(503);
    // …and the neighbour, on its own envelope, is untouched.
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
