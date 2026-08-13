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
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { RENDER_SPAWN_TIMEOUT_MS, renderInWorker } from "../../src/gateway/render-worker.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

const OP_SEED = "0e".repeat(32);
// The function-level rails feed the node straight to the bundle; the door wraps it in a §23.7
// envelope, so the door's bundle reads `n.view.height`.
const OK = "export default (n) => `<p>height: ${n.height ?? n.view.height}</p>`;";
const HANG = "export default () => { while (true) {} };";
// The 1ms rails need a bundle that cannot finish inside their window and CAN finish inside a wide
// one. HANG proves neither direction (any clock stops it); OK proves neither reliably — it finishes
// in well under a millisecond, so a 1ms window is a coin flip on scheduling, measured red on a
// windows runner and green 5/5 on linux. 200ms of busy-wait refuses at 1ms every time and renders
// at 10s every time, which is exactly the pair of outcomes the mutant has to separate.
const SLOW =
  "export default () => { const end = Date.now() + 200; while (Date.now() < end); return `<p>slow</p>`; };";
const NODE = { height: 42 };

describe("§23.9 / T139: spawn and render are bounded by SEPARATE budgets", () => {
  it("the SPAWN window reads the spawn budget, not the render budget (rail a)", async () => {
    // 1ms of spawn against a 10s render budget. No thread starts in a millisecond, so this can only
    // refuse — and it can only refuse if the spawn clock is armed with the spawn number. Sharing one
    // budget (the pre-T139 code) arms 10s here and this renders 200.
    const out = await renderInWorker(OK, NODE, 10_000, { spawnTimeoutMs: 1 });
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start"); // the host failed to start it; it never ran
  });

  it("the RENDER window still reads the operator's budget, not the spawn budget (rail b)", async () => {
    // The mirror of (a), and NARROWER than it: the mutant this kills is a render window re-armed
    // with `spawnTimeoutMs` (10s), which would render this 200. It does NOT go red on a full revert
    // to one shared budget — pre-T139 both clocks fired the same `timedOut` body, so 1ms refuses
    // here either way. Rail (a) is the revert-probe; this one guards the direction (a) cannot see.
    // SLOW, not OK: 200ms of work is the only thing that tells a 1ms window from a 10s one.
    const out = await renderInWorker(SLOW, NODE, 1, { spawnTimeoutMs: 10_000 });
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out"); // it ran, and it overran — a different cause
  });

  it("CONTROL: a healthy bundle renders when both budgets are honest (rail c)", async () => {
    // Named a control because it holds under the pre-T139 code and under a build with the spawn
    // budget deleted outright. It observes that the split did not break the happy path; it
    // constrains nothing about the split itself.
    const out = await renderInWorker(OK, NODE, RENDER_SPAWN_TIMEOUT_MS, {
      spawnTimeoutMs: RENDER_SPAWN_TIMEOUT_MS,
    });
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.body).toBe("<p>height: 42</p>");
  });

  it("a generous SPAWN ceiling does not widen the wedge window for a hanging bundle (rail d)", async () => {
    // The wedge-window half, and it constrains ONE direction: a render window re-armed with the
    // spawn budget. It is not a revert probe — under one shared budget this returns in ~200ms and
    // passes — and its 25x margin sees no regression smaller than that. §23.9's unbounded-spin
    // guarantee is railed in render-sandbox.test.ts; what this adds is that a
    // generous spawn ceiling does not become the hang's allowance: a wedged bundle gets 200ms and
    // no more, so the call returns in spawn + 200ms, nowhere near the 10s ceiling.
    const t0 = Date.now();
    const out = await renderInWorker(HANG, NODE, 200, { spawnTimeoutMs: RENDER_SPAWN_TIMEOUT_MS });
    const elapsed = Date.now() - t0;
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    // The enforced bound is half the spawn ceiling, not the 200ms budget: the call also pays real
    // spawn, and pinning it tighter would re-create this ticket's flake. Code that fed the spawn
    // budget to the render window sits here for 10s+ and goes red.
    expect(elapsed).toBeLessThan(RENDER_SPAWN_TIMEOUT_MS / 2);
  }, 30_000);
});

describe("§23.9 / T139: the split reaches the DOOR, and the spawn budget is the operator's", () => {
  // The object-level half. Every rail above calls `renderInWorker` directly, and this file's own
  // history says that is not enough: the first `renderTimeoutMs` fed ONE of the two render call
  // sites and the flake it existed to fix kept firing (render-sandbox.test.ts). A door-collapse
  // mutant — a call site in renderers.ts handing `renderTimeoutMs` to BOTH parameters, i.e. the
  // pre-T139 single budget restored at the seam — leaves the function-level rails green.
  //
  // renderers.ts calls `renderInWorker` at THREE sites, and each one needs its own rail: the token
  // door, the public door, and the metered quarantine pool. One rail per site, because a site that
  // stops forwarding the budget is invisible to the other two — which is this file's own recited
  // history, one door over. Rails (e)/(f) take the token door, (g) the public door; (h), in the
  // describe below, takes the pool — where the budget is the pool's own, not the host's. Behaviour
  // only: which number each site FORWARDS is railed at the seam in render-spawn-forwarding.test.ts,
  // because one of these mutants is invisible to every wall clock.
  const boot = (options: {
    renderTimeoutMs?: number;
    renderSpawnTimeoutMs?: number;
  }): Promise<Gateway> =>
    Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
      options,
    );

  const staged = async (options: {
    renderTimeoutMs?: number;
    renderSpawnTimeoutMs?: number;
  }): Promise<Gateway> => {
    const gw = await boot(options);
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
    await gw.publishRenderer({
      route: "slow",
      schema: "Plant",
      consumes: ["height"],
      bundle: SLOW,
    });
    return gw;
  };

  it("a 1ms SPAWN budget refuses at the door — the knob reaches the worker (rail e)", async () => {
    // 1ms of spawn against a 10s render budget. Only a door that carries the spawn budget through
    // can answer this; a door that passed `renderTimeoutMs` to both parameters renders 200.
    const gw = await staged({ renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 1 });
    const out = await gw.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start");
    await gw.close();
  });

  it("the PUBLIC door carries the spawn budget too (rail g)", async () => {
    // The second of three call sites, and the one where the budget matters most: on the anonymous
    // door the spawn window is what really bounds how long one stranger's request may hold a
    // `maxPublicRenders` slot. Deleting `spawnTimeoutMs` from that site leaves every other rail in
    // this file green, so the site earns its own.
    const gw = await staged({ renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 1 });
    await gw.declarePublic(["Plant"]);
    const out = await gw.serveRoute("ok", FERN, "public");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer could not start");
    await gw.close();
  });

  it("a generous SPAWN budget does not lift the door's RENDER budget (rail f)", async () => {
    // The mirror at the door: 1ms of render under a 10s spawn ceiling still refuses, and refuses
    // with the RENDER cause. A door that fed the spawn budget to the render window renders 200.
    const gw = await staged({ renderTimeoutMs: 1, renderSpawnTimeoutMs: 10_000 });
    const out = await gw.serveRoute("slow", FERN, "full");
    expect(out.status).toBe(500);
    expect(out.body).toBe("the renderer timed out");
    await gw.close();
  });
});

describe("§23.9 × §24.5 / T139: a metered pool's spawn window is its OWN clock", () => {
  // The THIRD call site, and the one place §23.9's spawn ceiling deliberately does not reach. A
  // pool holds its slot across BOTH windows, so the host's 10s ceiling here would let a pool that
  // declared a 120ms render clock occupy its slot for 10120ms — invisible in `envelopeReports()`
  // and never declared. §24.5 promises the envelope is the pool's whole bill. This rail proves the
  // pool's clock BOUNDS a wedge; it cannot prove which number was forwarded, and that half lives in
  // render-spawn-forwarding.test.ts.
  const pooled = async (poolRenderMs: number): Promise<Gateway> => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
      // A host ceiling 10000x the pool's clock. If the pool ever reads it, the rail below hangs
      // past its own budget instead of refusing.
      { renderTimeoutMs: 10_000, renderSpawnTimeoutMs: 10_000 },
    );
    await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
    await gw.publishRenderer({ route: "ok", schema: "Plant", consumes: ["height"], bundle: OK });
    await gw.publishRenderer({
      route: "hang",
      schema: "Plant",
      consumes: ["height"],
      bundle: HANG,
    });
    await gw.append([
      signClaims(
        envelopeClaims(
          ENVELOPE_ANY,
          { maxConcurrentRenders: 1, renderTimeoutMs: poolRenderMs },
          authorForSeed(OP_SEED),
          9001,
        ),
        OP_SEED,
      ),
    ]);
    return gw;
  };

  it("a wedged pool render gives its slot back on the POOL's clock (rail h)", async () => {
    // The bill, measured: one slot, a 300ms declared clock, a bundle that never finishes, and the
    // slot back inside 3s.
    //
    // WHAT IT DOES NOT CATCH, stated because an earlier draft of this comment claimed it did: a
    // pool reading the HOST's 10s spawn ceiling passes this rail. Probed, not assumed. The render
    // window re-arms at `online` and stops the wedge on the pool's clock however spawn was armed,
    // so the 10s shows only under slow spawn — which no rail can force. The forwarding itself is
    // railed at the seam in render-spawn-forwarding.test.ts, which does redden on that mutant.
    const gw = await pooled(300);
    const pool = await gw.openQuarantine();
    const t0 = Date.now();
    const out = await pool.gateway.serveRoute("hang", FERN, "full");
    const elapsed = Date.now() - t0;
    expect(out.status).toBe(500);
    expect(elapsed).toBeLessThan(3000); // real spawn included; 10x under the host ceiling
    expect(gw.envelopeReports()[0]!.inFlight).toBe(0); // the slot came back
    await gw.close();
  });

  it("CONTROL: the same pool renders a healthy bundle on an honest clock", async () => {
    // Without this, rail (h) passes on a build where every pool render is broken outright.
    const gw = await pooled(10_000);
    const pool = await gw.openQuarantine();
    const out = await pool.gateway.serveRoute("ok", FERN, "full");
    expect(out.status).toBe(200);
    expect(gw.envelopeReports()[0]!.faulted).toBe(0);
    await gw.close();
  });
});
