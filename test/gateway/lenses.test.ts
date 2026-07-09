// The substrate adoption (rhizomatic 0.2.0): chain orders and inView reflective predicates,
// through Loam's whole stack. These are the tests the interims waited for — "trusted, then
// latest" becomes expressible, and the heckler's veto ends where a trust-aware mask begins.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MALLORY_SEED = "ee".repeat(32);
const SURVEYOR = authorForSeed(SURVEYOR_SEED);

describe("chain orders: trusted, then latest (the lexById surprise dies)", () => {
  it("picks the trusted author's LATEST claim over a stranger's newer one", async () => {
    const gateway = await Gateway.open(new MemoryBackend()); // ungoverned: lens is the point
    gateway.register(
      { ...PLANT, name: "Trusted" },
      {
        props: new Map([
          [
            "height",
            {
              kind: "pick",
              order: {
                kind: "chain",
                orders: [
                  { kind: "byAuthorRank", authors: [GARDENER] },
                  { kind: "byTimestamp", dir: "desc" },
                ],
              },
            },
          ],
        ]),
        default: pickLatest,
      },
      [FERN],
    );
    await gateway.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED), // trusted, older
      observed(FERN, "height", 31, 2000, GARDENER_SEED), // trusted, LATEST — must win
      observed(FERN, "height", 99, 9000, MALLORY_SEED), // stranger, newest of all
    ]);
    const read = await gateway.query(`{ trusted(entity: "${FERN}") { height } }`);
    // byAuthorRank alone would tie the gardener's two claims and fall to lexById (arbitrary);
    // pick-latest alone would take the stranger's 99. The chain says exactly what we mean.
    expect((read.data as { trusted: { height: number } }).trusted.height).toBe(31);
    await gateway.close();
  });
});

describe("governedGatherBody: the heckler's veto ends here", () => {
  async function guardedWorld(): Promise<Gateway> {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1), OPERATOR_SEED),
      signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 2), OPERATOR_SEED),
    ]);
    // two lenses over the SAME root: the plain drop-bodied Plant, and the trust-masked Guarded
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    gateway.register(
      { name: "Guarded", alg: 1, body: governedGatherBody(OPERATOR) },
      PLANT_POLICY,
      [FERN],
    );
    await gateway.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(FERN, "height", 34, 2000, SURVEYOR_SEED),
    ]);
    return gateway;
  }
  const heightThrough = async (gateway: Gateway, lens: string): Promise<number> => {
    const read = await gateway.query(`{ ${lens}(entity: "${FERN}") { height } }`);
    return (read.data as Record<string, { height: number }>)[lens]!.height;
  };

  it("a federated stranger's strike suppresses the drop lens and NOT the governed one", async () => {
    const gateway = await guardedWorld();
    const struck = [...gateway.reactor.snapshot()].find(
      (d) => d.claims.author === SURVEYOR && d.claims.timestamp === 2000,
    )!;
    // Mallory's strike arrives by federation — no standing asked, union is union
    await gateway.federate([
      signClaims(makeNegationClaims(authorForSeed(MALLORY_SEED), 3000, struck.id), MALLORY_SEED),
    ]);
    expect(await heightThrough(gateway, "plant")).toBe(30); // drop: the veto lands
    expect(await heightThrough(gateway, "guarded")).toBe(34); // trust mask: inert stranger
    await gateway.close();
  });

  it("a grantee's strike binds; revoking their grant un-binds it — the trusted set is a live view", async () => {
    const gateway = await guardedWorld();
    const struck = [...gateway.reactor.snapshot()].find(
      (d) => d.claims.author === SURVEYOR && d.claims.timestamp === 2000,
    )!;
    // the gardener (a grantee) strikes the surveyor's claim: the community's negations bind
    await gateway.append([
      signClaims(makeNegationClaims(GARDENER, 3000, struck.id), GARDENER_SEED),
    ]);
    expect(await heightThrough(gateway, "guarded")).toBe(30);

    // the operator revokes the gardener's grant → she leaves the trusted set → her strike
    // stops binding, with NO new negation-of-negation — the lens simply re-resolves
    const gardenerGrant = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === GARDENER,
      ),
    )!;
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 4000, gardenerGrant.id), OPERATOR_SEED),
    ]);
    expect(await heightThrough(gateway, "guarded")).toBe(34); // the claim breathes again
    await gateway.close();
  });
});
