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

const READERS: readonly {
  readonly name: string;
  readonly read: (gw: Gateway) => unknown;
  readonly expect: (answer: never) => void;
}[] = [
  {
    name: "readTrustPolicy",
    read: (gw) => readTrustPolicy(gw.reactor, gw.validityNow(), OP),
    expect: (a: never) => {
      const p = a as unknown as { mode: string; roster: ReadonlySet<string> };
      expect(p.mode).toBe("roster");
      expect([...p.roster]).toEqual([GARDENER]);
    },
  },
  {
    name: "readBudgetPolicy",
    read: (gw) => readBudgetPolicy(gw.reactor, gw.validityNow(), OP),
    expect: (a: never) => {
      const m = a as unknown as ReadonlyMap<string, { maxAppends?: number }>;
      expect(m.get(GARDENER)?.maxAppends).toBe(500);
    },
  },
  {
    name: "readPublicSchemas",
    read: (gw) => readPublicSchemas(gw.reactor, gw.validityNow(), OP),
    expect: (a: never) => expect([...(a as unknown as ReadonlySet<string>)]).toEqual(["Plant"]),
  },
  {
    name: "readArtifactRoutes",
    read: (gw) => readArtifactRoutes(gw.reactor, gw.validityNow(), OP),
    expect: (a: never) => expect([...(a as unknown as ReadonlySet<string>)]).toEqual(["board"]),
  },
];

describe("T37 — a constitutional read costs the same in a big store as in a small one", () => {
  for (const reader of READERS) {
    it(`${reader.name} does no work proportional to unrelated ground`, async () => {
      const small = await build(0);
      const big = await build(200);

      const smallTouched = meter(small);
      const bigTouched = meter(big);
      const smallAnswer = reader.read(small);
      const bigAnswer = reader.read(big);

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
      expect(negated(s.struck.id)).toBe(true);
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
