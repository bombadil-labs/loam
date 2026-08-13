// §24.5's memory dimension (ticket T34), asserted TWO-SIDED so it cannot be decorative. A declared
// ceiling that never reaches the Worker's `resourceLimits` would print in `envelopeReports()` and
// bound nothing — an operator lowers it to contain a leaking bundle and nothing changes. That is a
// report that can be false, which is the failure class this repo pays for most (H7).
//
// So: the SAME allocating bundle is refused in a pool whose declared ceiling is small, and SERVED in
// a pool on the built-in ceiling. One side alone would pass with the feature deleted (refuse
// everything, or serve everything).

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container.js";
import { DEFAULT_QUARANTINE_ENVELOPE, envelopeClaims } from "../../src/gateway/envelope.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const TIGHT = "loam:pool:tight";
const ROOMY = "loam:pool:roomy";

// Holds live, un-collectable data until it is over a declared 32MB ceiling and under the built-in
// 128MB one. THE SHAPE OF THE FILLER IS LOAD-BEARING, and two obvious ones do not work: an
// ArrayBuffer's backing store is EXTERNAL memory, and a few very large strings land in large-object
// space — measured, both sail past a 32MB `maxOldGenerationSizeMb` untouched. Many small ordinary
// objects are what the old-generation ceiling actually bounds, so that is what this allocates. A
// filler that could not be refused would make this whole rail assert nothing while looking thorough.
// MEASURED BOUNDARY for this filler, with the generations splitting the declared total: it faults at
// a 64MB ceiling and serves at 80MB. So the 32MB side has headroom below and the 128MB default has
// headroom above — the margins are stated rather than hoped, because the failure direction on the
// serving side is a red bar on a loaded machine.
const GREEDY = `export default () => {
  const keep = [];
  for (let i = 0; i < 48; i += 1) {
    keep.push(Array.from({ length: 12000 }, (_, j) => ({ a: i, b: j, c: "z" + j })));
  }
  return "<p>allocated " + keep.length + "</p>";
};`;

async function primary(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { renderTimeoutMs: 20000 }, // the primary's clock is not what this file measures
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({
    route: "greedy",
    schema: "Plant",
    consumes: ["height"],
    bundle: GREEDY,
  });
  await gw.append([
    signClaims(
      containerClaims({ container: TIGHT, trust: "untrusted", posture: "separate" }, OP, 9001),
      OP_SEED,
    ),
    signClaims(
      containerClaims({ container: ROOMY, trust: "untrusted", posture: "separate" }, OP, 9002),
      OP_SEED,
    ),
    // Only the TIGHT pool is squeezed; ROOMY runs on the built-in ceiling. Both get a long clock so
    // the wall-clock bound never wins the race and mimics a memory refusal (the T73 lesson).
    signClaims(
      envelopeClaims(TIGHT, { maxMemoryMb: 32, renderTimeoutMs: 20000 }, OP, 9003),
      OP_SEED,
    ),
    signClaims(envelopeClaims(ROOMY, { renderTimeoutMs: 20000 }, OP, 9004), OP_SEED),
  ]);
  return gw;
}

describe("T34: the declared memory ceiling reaches the Worker", () => {
  it("the same allocating bundle is refused under a small ceiling and served under the default", async () => {
    const gw = await primary();
    expect(DEFAULT_QUARANTINE_ENVELOPE.maxMemoryMb).toBeGreaterThan(32);

    const tight = await gw.openContainer({ name: TIGHT });
    const squeezed = await tight.gateway!.serveRoute("greedy", FERN, "full");
    expect(squeezed.status).toBe(500);
    expect(squeezed.body).not.toContain("allocated"); // it never finished
    expect(gw.envelopeReports().find((r) => r.pool === TIGHT)!.faulted).toBe(1);
    await tight.drop();

    const roomy = await gw.openContainer({ name: ROOMY });
    const served = await roomy.gateway!.serveRoute("greedy", FERN, "full");
    expect(served.status).toBe(200);
    expect(served.body).toContain("allocated 48");
    // The serving side's REPORT is asserted too, not just its status: a pool that served cleanly
    // must read as clean, or the counters are only ever checked in the direction that fires.
    const roomyRow = gw.envelopeReports().find((r) => r.pool === ROOMY)!;
    expect([
      roomyRow.faulted,
      roomyRow.timedOut,
      roomyRow.malformed,
      roomyRow.refusedForSlots,
    ]).toEqual([0, 0, 0, 0]);
    await roomy.drop();

    await gw.close();
  }, 60000);
});
