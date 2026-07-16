// Renderer sandbox + timeout — SPEC §23.9. A renderer bundle is author-provided code, and §23 v1 ran it
// synchronously on the event loop with no timeout, so an infinite-loop bundle wedged EVERY mount (the
// capability-security panel's headline residual). Each render now runs in a worker_threads Worker with a
// hard timeout + resourceLimits: a hanging/heavy bundle folds to a clean 500 and every other route keeps
// answering. Honest scope: a Worker bounds the HANG/crash/memory — NOT fs/net (that ocap is §24 work).

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
const HOG = "export default () => { const a = []; for (;;) a.push(new Array(1e6).fill(7)); };";

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const staged = async (): Promise<Gateway> => {
  const gw = await boot();
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
    const gw = await staged();
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
      // Both concurrently: the hanging render spins in its worker while the normal render must still serve.
      const [hang, ok] = await Promise.all([
        gw.serveRoute("hang", FERN, "full"),
        gw.serveRoute("ok", FERN, "full"),
      ]);
      expect(hang.status).toBe(500);
      expect(hang.body).toBe("the renderer timed out");
      expect(ok.status).toBe(200); // the event loop was never blocked by the spinning worker
      expect(ok.body).toBe("<p>height: 42</p>");
      // And the host is still healthy AFTER the hang resolved.
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
    expect(out.body).not.toContain("secret internal detail"); // the bundle's error text never leaks
    await gw.close();
  });

  it(
    "a memory-hungry bundle is reclaimed by the MEMORY bound — distinguishably from the timeout (rail d)",
    async () => {
      const gw = await staged();
      const hog = await gw.serveRoute("hog", FERN, "full");
      expect(hog.status).toBe(500); // bounded, never a crash
      // The two bounds have DIFFERENT signatures, and this asserts the memory one: a worker the
      // resourceLimits reclaim dies on the error/exit path and folds to "the renderer faulted";
      // only the timer produces "the renderer timed out". The hog allocates ~8MB per iteration
      // against a 128MB old-gen ceiling, so V8 kills it well inside the 500ms timer — if the
      // timer had won the race instead, this assertion reads "timed out" and fails. That is the
      // §23.9 claim ("memory bounds so a bundle cannot OOM the host") actually observed, not
      // inferred from a status code both paths share.
      expect(hog.body).toBe("the renderer faulted");
      expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200); // the host is unharmed
      await gw.close();
    },
    RENDER_TIMEOUT_MS + 4000,
  );
});
