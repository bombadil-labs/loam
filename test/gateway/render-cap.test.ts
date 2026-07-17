// §23.9's render cap (ticket T18, audit-2 MED) — every rendered-route hit spawns a worker thread
// (~160MB ceiling each), and the route is reachable ANONYMOUSLY with an attacker-chosen entity. The
// codebase's own standard says this is bounded: the sibling anonymous SSE door caps in-flight work
// (`maxPublicStreams`), and a render is strictly more expensive than a stream. These rails pin the
// cap: over the limit the door refuses cleanly (a 503-shaped refusal that leaks nothing), under it
// the door serves, and — the obvious way to get it wrong — a completed render RELEASES its slot.
//
// Written BEFORE the build (P3): the concurrent-refusal and release rails failed on pre-cap code.

import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { RENDER_TIMEOUT_MS } from "../../src/gateway/render-worker.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";
const HANG = "export default () => { while (true) {} };"; // occupies its slot for the full timeout

const boot = async (opts: { maxPublicRenders?: number } = {}): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    opts,
  );
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
  await gw.publishRenderer({ route: "hang", schema: "Plant", consumes: ["height"], bundle: HANG });
  await gw.declarePublic(["Plant"]); // the anonymous door is the door under discipline
  return gw;
};

describe("§23.9: the anonymous render fan is capped", () => {
  it(
    "the (N+1)th CONCURRENT public render is refused cleanly while N are in flight — and the host survives",
    async () => {
      const gw = await boot({ maxPublicRenders: 2 });
      const [a, b, c] = await Promise.all([
        gw.serveRoute("hang", FERN, "public"),
        gw.serveRoute("hang", FERN, "public"),
        gw.serveRoute("hang", FERN, "public"),
      ]);
      const statuses = [a.status, b.status, c.status].sort();
      expect(statuses).toEqual([500, 500, 503]); // two spin to the timeout; the third is refused NOW
      const busy = [a, b, c].find((r) => r.status === 503)!;
      expect(busy.body).not.toMatch(/hang|Plant|entity|worker/i); // the refusal leaks nothing
      // The host is unharmed and the slots came back: a normal render serves.
      expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
      await gw.close();
    },
    RENDER_TIMEOUT_MS * 3 + 8000,
  );

  it("an under-cap load serves normally on the public door", async () => {
    const gw = await boot({ maxPublicRenders: 2 });
    const [a, b] = await Promise.all([
      gw.serveRoute("ok", FERN, "public"),
      gw.serveRoute("ok", FERN, "public"),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    await gw.close();
  });

  it("a completed render RELEASES its slot: cap+1 renders, run sequentially, all succeed", async () => {
    const gw = await boot({ maxPublicRenders: 2 });
    for (let i = 0; i < 3; i += 1) {
      expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200); // the leak-the-slot rail
    }
    await gw.close();
  });

  it("the full (token) door is not the anonymous fan: it renders past the public cap", async () => {
    const gw = await boot({ maxPublicRenders: 1 });
    // Occupy the public slot; the operator's own door still serves (the cap is public-door-scoped,
    // following maxPublicStreams' precedent — the threat is the anonymous fan, not the operator).
    const spinning = gw.serveRoute("hang", FERN, "public");
    expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200);
    await spinning;
    await gw.close();
  });
});
