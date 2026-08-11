// The render worker's TWO clocks carry TWO budgets — SPEC §23.9, T139. A bundle cannot run before the
// worker is `online`, so everything before that moment is host scheduling: thread start, isolate init,
// first schedule. Charging it against the bundle's budget made a loaded host refuse a healthy render that
// never executed a line (measured: spawn alone cost ~0.8s at load 200 on 16 cores, against a 500ms
// budget). The repair splits the BUDGETS, not just the timers, and these rails pin both halves: the spawn
// window reads the spawn number, the render window reads the operator's number, and widening the spawn
// ceiling does NOT widen the window in which a wedged bundle is allowed to spin.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: that a real render survives a real slow spawn. Node offers
// no seam to make thread start slow on demand, and a rail that manufactured host load would be the flake
// it is meant to close. That direction is measured by hand and recorded in the PR; rail (a) below stands
// in for it by proving the spawn clock reads its own number rather than the render's.

import { describe, expect, it } from "vitest";
import { RENDER_SPAWN_TIMEOUT_MS, renderInWorker } from "../../src/gateway/render-worker.js";

const OK = "export default (n) => `<p>height: ${n.height}</p>`;";
const HANG = "export default () => { while (true) {} };";
const NODE = { height: 42 };

describe("§23.9 / T139: spawn and render are bounded by SEPARATE budgets", () => {
  it("the SPAWN window reads the spawn budget, not the render budget (rail a)", async () => {
    // 1ms of spawn against a 10s render budget. No thread starts in a millisecond, so this can only
    // refuse — and it can only refuse if the spawn clock is armed with the spawn number. Sharing one
    // budget (the pre-T139 code) arms 10s here and this renders 200.
    const out = await renderInWorker(OK, NODE, 10_000, 1);
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start"); // the host failed to start it; it never ran
  });

  it("the RENDER window still reads the operator's budget (rail b)", async () => {
    // The mirror: a generous spawn ceiling cannot buy the bundle time. 1ms against a trivial bundle
    // can only pass if the render clock stopped governing the worker.
    const out = await renderInWorker(OK, NODE, 1, 10_000);
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out"); // it ran, and it overran — a different cause
  });

  it("a healthy bundle renders when both budgets are honest (rail c)", async () => {
    const out = await renderInWorker(OK, NODE, RENDER_SPAWN_TIMEOUT_MS, RENDER_SPAWN_TIMEOUT_MS);
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.body).toBe("<p>height: 42</p>");
  });

  it("a generous SPAWN ceiling does not widen the wedge window for a hanging bundle (rail d)", async () => {
    // The security half. §23.9's whole claim is that author-provided code cannot spin unbounded; a
    // spawn ceiling of 10s must not become the hang's allowance. A wedged bundle gets 200ms and no
    // more, so the call returns in spawn + 200ms — nowhere near the 10s ceiling.
    const t0 = Date.now();
    const out = await renderInWorker(HANG, NODE, 200, RENDER_SPAWN_TIMEOUT_MS);
    const elapsed = Date.now() - t0;
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    // Half the spawn ceiling: code that fed the spawn budget to the render window sits here for 10s+.
    expect(elapsed).toBeLessThan(RENDER_SPAWN_TIMEOUT_MS / 2);
  }, 30_000);
});
