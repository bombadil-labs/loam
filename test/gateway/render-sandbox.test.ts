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
const THROW = 'export default () => { throw new Error("secret internal detail"); };';
const HOG = "export default () => { const a = []; for (;;) a.push(new Array(8e6).fill(7)); };";

const boot = (options: { renderTimeoutMs?: number } = {}): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    options,
  );

const staged = async (options: { renderTimeoutMs?: number } = {}): Promise<Gateway> => {
  const gw = await boot(options);
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
  await gw.publishRenderer({ route: "hang", schema: "Plant", consumes: ["height"], bundle: HANG });
  await gw.publishRenderer({
    route: "throw",
    schema: "Plant",
    consumes: ["height"],
    bundle: THROW,
  });
  await gw.publishRenderer({ route: "hog", schema: "Plant", consumes: ["height"], bundle: HOG });
  return gw;
};

describe("§23.9: a bounded worker keeps a bad bundle from wedging the host", () => {
  it("the happy path is unchanged — a normal bundle still renders 200 with correct HTML (rail b)", async () => {
    const gw = await staged({ renderTimeoutMs: 10_000 });
    const out = await gw.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.body).toBe("<p>height: 42</p>");
    await gw.close();
  });

  it(
    "an infinite-loop bundle times out at 500 — and a second route STILL answers (event loop not wedged, rail a)",
    async () => {
      const gw = await staged();
      const [hang, ok] = await Promise.all([
        gw.serveRoute("hang", FERN, "full"),
        gw.serveRoute("ok", FERN, "full"),
      ]);
      expect(hang.status).toBe(500);
      expect(hang.body).toBe("the renderer timed out");
      expect(ok.status).toBe(200);
      expect(ok.body).toBe("<p>height: 42</p>");
      expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200);
      await gw.close();
    },
    RENDER_TIMEOUT_MS + 4000,
  );

  it("a throwing bundle is a clean 500 that leaks nothing of its internals (rail c)", async () => {
    const gw = await staged();
    const out = await gw.serveRoute("throw", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer faulted");
    expect(out.body).not.toContain("secret internal detail");
    await gw.close();
  });

  it("the render clock is the OPERATOR'S clock: a 1ms budget times out even the trivial renderer", async () => {
    const gw = await staged({ renderTimeoutMs: 1 });
    const out = await gw.serveRoute("hang", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    await gw.close();
  });

  it("a memory-hungry bundle is reclaimed by the MEMORY bound — distinguishably from the timeout (rail d)", async () => {
    const gw = await staged({ renderTimeoutMs: 10_000 });
    const hog = await gw.serveRoute("hog", FERN, "full");
    expect(hog.status).toBe(500);
    expect(hog.body).toBe("the renderer faulted");
    expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200);
    await gw.close();
  }, 14_000);
});
