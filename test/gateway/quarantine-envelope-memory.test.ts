import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { DEFAULT_QUARANTINE_ENVELOPE, envelopeClaims } from "../../src/gateway/envelope.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const TIGHT = "loam:pool:tight";
const ROOMY = "loam:pool:roomy";

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
    { renderTimeoutMs: 20000 },
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
    expect(squeezed.body).not.toContain("allocated");
    expect(gw.envelopeReports().find((r) => r.pool === TIGHT)!.faulted).toBe(1);
    await tight.drop();

    const roomy = await gw.openContainer({ name: ROOMY });
    const served = await roomy.gateway!.serveRoute("greedy", FERN, "full");
    expect(served.status).toBe(200);
    expect(served.body).toContain("allocated 48");
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
