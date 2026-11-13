import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { RENDER_TIMEOUT_MS } from "../../src/gateway/render-worker.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OK = "export default (n) => `<p>height: ${n.view.height}</p>`;";
const HANG = "export default () => { while (true) {} };";

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
  await gw.declarePublic(["Plant"]);
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
      expect(statuses).toEqual([500, 500, 503]);
      const busy = [a, b, c].find((r) => r.status === 503)!;
      expect(busy.body).not.toMatch(/hang|Plant|entity|worker/i);
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
      expect((await gw.serveRoute("ok", FERN, "public")).status).toBe(200);
    }
    await gw.close();
  });

  it("the full (token) door is not the anonymous fan: it renders past the public cap", async () => {
    const gw = await boot({ maxPublicRenders: 1 });
    const spinning = gw.serveRoute("hang", FERN, "public");
    expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200);
    await spinning;
    await gw.close();
  });
});
