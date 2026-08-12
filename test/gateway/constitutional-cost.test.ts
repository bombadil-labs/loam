// T37 — the constitutional readers answer from the INDEX, not from a whole-store scan (hazard H8).
//
// A constitutional reader asks one question: "what does the operator's law at entity E say right
// now?" The declarations that answer it are typically ONE delta. The old shape walked every delta
// in the store to find them, twice — once to build `lawfulNegated`'s id set and once to iterate —
// on a path that runs per request, over ground that is append-only and therefore only ever grows.
//
// TWO RAILS HERE, and neither of them is a clock:
//
//   1. THE COST INVARIANT — the work one read does is INDEPENDENT of how much unrelated ground the
//      store holds. Asserted by COUNTING the deltas the reader touches, exactly as
//      `closure-cost.test.ts` does for T51. A timing assertion would be flaky, and a flaky rail is
//      worse than none. The count is not pinned to a number; two stores that differ ONLY in
//      unrelated volume must cost the same, whatever affordance provides that.
//   2. A FLOOR — the reader must still have DONE the work. A reader that answers nothing would
//      satisfy a pure cost assertion (H10), so every cost case also asserts the ANSWER.
//
// The EQUIVALENCE rail — indexed answer identical to scanned answer across every mutation that can
// change it — lives in `constitutional-equivalence.test.ts`. That is the rail that matters most:
// H8's second half says an index that can go stale is worse than the scan it replaced, because a
// safety decision reading a stale index is silently wrong, and these reads decide what is LAWFUL.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readTrustPolicy, trustClaims } from "../../src/gateway/trust.js";
import { readBudgetPolicy, budgetClaims } from "../../src/gateway/budget.js";
import { readPublicSchemas, publicClaims } from "../../src/gateway/public.js";
import { readArtifactRoutes, artifactClaims } from "../../src/gateway/artifact.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

// Count the DELTAS one read has to touch. A whole-store scan counts every delta it visits; an
// index lookup counts the handful it resolves. Deterministic — no clock is involved anywhere here.
function meter(gw: Gateway): () => number {
  let touched = 0;
  const r = gw.reactor as unknown as {
    snapshot: () => { size: number };
    get: (id: string) => Delta | undefined;
    byTarget: (id: string) => string[];
    negationsOf: (id: string) => string[];
  };
  const snapshot = r.snapshot.bind(r);
  const get = r.get.bind(r);
  const byTarget = r.byTarget.bind(r);
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
  r.byTarget = (id) => {
    const ids = byTarget(id);
    touched += ids.length;
    return ids;
  };
  r.negationsOf = (id) => {
    touched += 1;
    return negationsOf(id);
  };
  return () => touched;
}

// A governed store carrying every constitutional declaration this file reads, plus `padding`
// deltas of ordinary, unrelated ground. The DECLARATIONS are identical at every padding — only
// the volume they are buried in differs.
async function build(padding: number): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  await gw.append([
    signClaims(trustClaims("roster", [GARDENER], OP, 9001), OP_SEED),
    signClaims(budgetClaims(GARDENER, 500, OP, 9002), OP_SEED),
    signClaims(publicClaims(["Plant"], OP, 9003), OP_SEED),
    signClaims(artifactClaims(["board"], OP, 9004), OP_SEED),
  ]);
  if (padding > 0) {
    await gw.append(
      Array.from({ length: padding }, (_, i) => observed(FERN, "readings", i, 20000 + i, OP_SEED)),
    );
  }
  return gw;
}

// Each case names its reader and the answer it must still produce — the floor that stops a
// reader which does nothing from passing the cost assertion.
const READERS: readonly {
  readonly name: string;
  readonly read: (gw: Gateway) => unknown;
  readonly expect: (answer: never) => void;
}[] = [
  {
    name: "readTrustPolicy",
    read: (gw) => readTrustPolicy(gw.reactor, OP),
    expect: (a: never) => {
      const p = a as unknown as { mode: string; roster: ReadonlySet<string> };
      expect(p.mode).toBe("roster");
      expect([...p.roster]).toEqual([GARDENER]);
    },
  },
  {
    name: "readBudgetPolicy",
    read: (gw) => readBudgetPolicy(gw.reactor, OP),
    expect: (a: never) => {
      const m = a as unknown as ReadonlyMap<string, { maxAppends?: number }>;
      expect(m.get(GARDENER)?.maxAppends).toBe(500);
    },
  },
  {
    name: "readPublicSchemas",
    read: (gw) => readPublicSchemas(gw.reactor, OP),
    expect: (a: never) => expect([...(a as unknown as ReadonlySet<string>)]).toEqual(["Plant"]),
  },
  {
    name: "readArtifactRoutes",
    read: (gw) => readArtifactRoutes(gw.reactor, OP),
    expect: (a: never) => expect([...(a as unknown as ReadonlySet<string>)]).toEqual(["board"]),
  },
];

describe("T37 — a constitutional read costs the same in a big store as in a small one", () => {
  for (const reader of READERS) {
    it(`${reader.name} does no work proportional to unrelated ground`, async () => {
      const small = await build(0);
      const big = await build(200); // identical law, 200 deltas more ground

      const smallTouched = meter(small);
      const bigTouched = meter(big);
      const smallAnswer = reader.read(small);
      const bigAnswer = reader.read(big);

      // The floor: it must still have answered. A reader that returns nothing would satisfy a
      // pure cost assertion (H10).
      reader.expect(smallAnswer as never);
      reader.expect(bigAnswer as never);

      expect(
        bigTouched(),
        `${reader.name} touched ${bigTouched()} deltas in the padded store and ${smallTouched()} ` +
          `in the small one — its cost scales with the STORE rather than with the law it reads ` +
          `(hazard H8). This path runs per request over ground that only ever grows.`,
      ).toBe(smallTouched());

      await small.close();
      await big.close();
    });
  }
});

describe("T37 — the negation algebra itself is index-bound", () => {
  it("lawfulNegated costs the same however much unrelated ground the store holds", async () => {
    const { lawfulNegated } = await import("../../src/gateway/registration.js");
    // The fixture carries BOTH answers — a survivor and a struck delta. A floor that only asserts
    // `false` is satisfied by `() => () => false`, which is also perfectly cheap, so it would pass
    // the cost assertion beside it with the predicate deleted (H10).
    const build2 = async (
      padding: number,
    ): Promise<{ gw: Gateway; survivor: Delta; struck: Delta }> => {
      const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
      const survivor = observed(FERN, "height", 30, 1000, OP_SEED);
      const struck = observed(FERN, "width", 12, 1001, OP_SEED);
      await gw.append([survivor, struck]);
      await gw.append([signClaims(makeNegationClaims(OP, 1100, struck.id), OP_SEED)]);
      if (padding > 0) {
        await gw.append(
          Array.from({ length: padding }, (_, i) =>
            observed(FERN, "readings", i, 20000 + i, OP_SEED),
          ),
        );
      }
      return { gw, survivor, struck };
    };
    const small = await build2(0);
    const big = await build2(200);

    const smallTouched = meter(small.gw);
    const bigTouched = meter(big.gw);
    for (const s of [small, big]) {
      const negated = lawfulNegated(s.gw.reactor, OP);
      expect(negated(s.survivor.id)).toBe(false);
      expect(negated(s.struck.id)).toBe(true); // the other direction — a do-nothing predicate fails
    }

    expect(
      bigTouched(),
      `building the lawful-negation predicate and asking it one question touched ` +
        `${bigTouched()} deltas in the padded store and ${smallTouched()} in the small one. ` +
        `Every constitutional reader stands on this predicate, so a scan here multiplies.`,
    ).toBe(smallTouched());

    await small.gw.close();
    await big.gw.close();
  });
});
