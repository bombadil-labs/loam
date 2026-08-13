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
// ~64MB per iteration against the 128MB old-gen ceiling: TWO allocations breach it, so the memory
// bound needs almost no CPU to fire. At ~8MB per iteration the hog needed ~16 scheduler slices, and
// under full-suite load the wall-clock timer starved it out and won the race — the T73 flake. The
// bound under test is CPU-work racing wall-clock; the rail's job is to make the CPU side's win
// nearly free, not to assume an idle machine.
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
    // A generous clock, same reasoning as the memory rail below: this observes that a GOOD bundle
    // renders correctly, not that it beats the default 500ms — and 500ms includes worker SPAWN, which
    // under full-suite CPU contention can eat the whole window and 500 a legitimate render (T75). The
    // timeout bound itself is proven by the hang rail (default clock) and the 1ms rail; giving the
    // happy path room is removing a competing bound to observe the one under test, not weakening it.
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

  it("the render clock is the OPERATOR'S clock: a 1ms budget times out even the trivial renderer", async () => {
    // The plumbing rail, born of its own failure: the first version of `renderTimeoutMs` fed one
    // of the two render call sites and the flake it existed to fix kept firing — a control knob
    // that silently reaches nothing reads exactly like a fix that didn't work. One millisecond
    // against a trivial bundle can only time out if the knob genuinely governs the worker.
    const gw = await staged({ renderTimeoutMs: 1 });
    const out = await gw.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    await gw.close();
  });

  it("a memory-hungry bundle is reclaimed by the MEMORY bound — distinguishably from the timeout (rail d)", async () => {
    // The CONTROL: a 10s clock, so the only bound in the frame is the memory one. Wall-clock
    // racing CPU-starved work is nondeterministic under load however cheap the work — the two
    // earlier de-flake attempts (re-arming the clock at `online`, a hog that breaches in two
    // allocations) each cut the failure rate and neither killed it. Lengthening this clock is
    // not weakening the timeout rail (the hang rail above keeps the default); it is removing
    // the competing bound to observe the one under test — and if the memory bound ever
    // regresses, the long timer fires, the body reads "timed out", and this rail goes red
    // exactly as it should.
    const gw = await staged({ renderTimeoutMs: 10_000 });
    const hog = await gw.serveRoute("hog", FERN, "full");
    expect(hog.status).toBe(500); // bounded, never a crash
    // The two bounds have DIFFERENT signatures, and this asserts the memory one: a worker the
    // resourceLimits reclaim dies on the error/exit path and folds to "the renderer faulted";
    // only the timer produces "the renderer timed out". The hog allocates ~8MB per iteration
    // against a 128MB old-gen ceiling, so V8 kills it well inside the 500ms timer — if the
    // timer had won the race instead, this assertion reads "timed out" and fails. That is the
    // §23.9 claim ("memory bounds so a bundle cannot OOM the host") actually observed, not
    // inferred from a status code both paths share. (Two clocks guard the race: the render's
    // budget starts at worker `online`, not construction — spawn time under load was eating the
    // whole window — and the hog breaches the ceiling in two allocations, so the kill needs
    // almost no CPU. Both halves were needed; each alone still flaked.)
    expect(hog.body).toBe("the renderer faulted");
    expect((await gw.serveRoute("ok", FERN, "full")).status).toBe(200); // the host is unharmed
    await gw.close();
  }, 14_000);
});
