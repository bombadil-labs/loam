// T51 — `withNegationClosure` answers from the INDEX, not from a materialized store (hazard H8).
//
// The closure needs one thing from the ground: given an id, the deltas that negate it. The reactor
// already answers that with two O(1) index lookups (`negationsOf`, then `get`). Materializing the
// whole store to build a private id→delta map instead costs a pass over every delta AND a content
// re-address of each one (`Reactor.snapshot()` is `DeltaSet.from`, which verifies ids on insert) —
// on a path six callers share, one of which (`watch`) runs it per accepted delta per watcher.
//
// TWO RAILS, and the split is deliberate:
//
//   1. BEHAVIOR IS UNCHANGED — the closure is forward-only, transitive, and still skips a negation
//      the store no longer holds (a purged strike; the hole is the point, SPEC §11).
//   2. THE COST INVARIANT — the work one call does is INDEPENDENT of how much unrelated ground the
//      store holds. Asserted by COUNTING the deltas the closure touches, never by timing: a clock
//      assertion here would be flaky, and a flaky rail is worse than none. The count is deliberately
//      not "zero snapshot calls" — that pins one implementation. It compares two stores that differ
//      only in unrelated volume and requires the same amount of work from both, which is the
//      property, whatever affordance provides it.
//
// WHAT THIS FILE DOES NOT ASSERT: the closure reads the LOCAL ground, so a caller handing it a batch
// not derived from this store would under-close. That is the inbound-federation case, and it has its
// own batch-scoped closure and its own rail (`closure-inbound.test.ts`).

import { describe, expect, it } from "vitest";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { withNegationClosure } from "../../src/gateway/ingest.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { retraction } from "./narrowing.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

// Count the DELTAS one closure call has to touch. A whole-store materialization counts every delta
// it visits; an index lookup counts one. Deterministic — no clock is involved anywhere here.
function meter(gw: Gateway): () => number {
  let touched = 0;
  const r = gw.reactor as unknown as {
    snapshot: () => { size: number };
    get: (id: string) => Delta | undefined;
    negationsOf: (id: string) => string[];
  };
  const snapshot = r.snapshot.bind(r);
  const get = r.get.bind(r);
  const negationsOf = r.negationsOf.bind(r);
  r.snapshot = () => {
    const s = snapshot();
    touched += s.size;
    return s;
  };
  r.get = (id) => {
    touched += 1;
    return get(id);
  };
  r.negationsOf = (id) => {
    touched += 1;
    return negationsOf(id);
  };
  return () => touched;
}

describe("T51 — the closure's behavior is unchanged", () => {
  it("is transitive and forward-only over the local ground", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const outsider = observed(FERN, "tag", "elsewhere", 1010, OP_SEED);
    await gw.append([claim, outsider]);
    const strike = retraction(claim.id, OP, OP_SEED, 1100);
    await gw.append([strike]);
    const counter = retraction(strike.id, OP, OP_SEED, 1200);
    await gw.append([counter]);
    const strikesOutsider = retraction(outsider.id, OP, OP_SEED, 1300);
    await gw.append([strikesOutsider]);

    const ids = new Set(withNegationClosure(gw, [claim]).map((d) => d.id));
    expect(ids.has(claim.id)).toBe(true);
    expect(ids.has(strike.id)).toBe(true); // one link
    expect(ids.has(counter.id)).toBe(true); // and the next — a struck strike revives
    expect(ids.has(outsider.id)).toBe(false); // never backward, into what was not admitted
    expect(ids.has(strikesOutsider.id)).toBe(false);
    await gw.close();
  });

  it("skips a negation the store no longer HOLDS — the purge hole survives the change", () => {
    // Reached with a stub ground: the reactor's negation index can name a strike whose bytes are
    // gone (§11), and no gateway-level fixture can hold that state open, since an erase replays the
    // reactor from what remains. The branch is the one thing a private id→delta map and a `get`
    // both had to get right, so it is pinned directly.
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const purged = retraction(claim.id, OP, OP_SEED, 1100);
    const held = retraction(claim.id, OP, OP_SEED, 1200);
    const stub = {
      reactor: {
        negationsOf: (id: string) => (id === claim.id ? [purged.id, held.id] : []),
        get: (id: string) => (id === held.id ? held : undefined),
        snapshot: () => new Set([claim, held]),
      },
    } as unknown as Gateway;

    const ids = new Set(withNegationClosure(stub, [claim]).map((d) => d.id));
    expect(ids.has(held.id)).toBe(true);
    expect(ids.has(purged.id)).toBe(false); // gone is gone; the closure does not invent it
  });
});

describe("T51 — one closure call costs the same in a big store as in a small one", () => {
  it("does no work proportional to unrelated ground", async () => {
    const build = async (padding: number): Promise<{ gw: Gateway; claim: Delta }> => {
      const gw = await boot();
      const claim = observed(FERN, "height", 30, 1000, OP_SEED);
      await gw.append([claim]);
      await gw.append([retraction(claim.id, OP, OP_SEED, 1100)]);
      if (padding > 0) {
        await gw.append(
          Array.from({ length: padding }, (_, i) =>
            observed(FERN, "readings", i, 2000 + i, OP_SEED),
          ),
        );
      }
      return { gw, claim };
    };

    const small = await build(0);
    const big = await build(200); // identical closure work, 200 deltas more ground

    const smallTouched = meter(small.gw);
    const bigTouched = meter(big.gw);
    const smallOut = withNegationClosure(small.gw, [small.claim]);
    const bigOut = withNegationClosure(big.gw, [big.claim]);

    // It must still have DONE the closure — an implementation that touches nothing would pass a
    // pure cost assertion.
    expect(smallOut).toHaveLength(2);
    expect(bigOut).toHaveLength(2);

    expect(
      bigTouched(),
      `the closure touched ${bigTouched()} deltas in the padded store and ${smallTouched()} in the ` +
        `small one — its cost scales with the STORE, not with what it was asked to close over ` +
        `(hazard H8). Six callers share this path and one of them runs it per accepted delta per ` +
        `watcher.`,
    ).toBe(smallTouched());
    await small.gw.close();
    await big.gw.close();
  });
});
