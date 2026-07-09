// Step 9's contract: federation. Two instances meet and merge — union, order-blind, conflict-
// free — over the authed HTTP surface. The load-bearing distinction: a peer's deltas ingest by
// VERIFICATION, not by local capability grants (capabilities gate the mutation surface;
// federation is union at the substrate, and trust is a read-time lens). A published lens
// restricts what a store offers; a forgery is refused at the boundary.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims, membershipClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { pullFrom } from "../../src/federation/pull.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OP_A = "0a".repeat(32);
const OP_B = "0b".repeat(32);
const OPERATOR_A = authorForSeed(OP_A);

const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  for (const g of gateways.splice(0)) await g.close().catch(() => {});
});

// An instance: a governed gateway (garden tenant, gardener may write) fronted by an HTTP server
// with a federation token, and an optional published lens.
async function instance(
  operatorSeed: string,
  opts: { lens?: ReturnType<typeof parseTerm> } = {},
): Promise<{ gateway: Gateway; url: string; token: string }> {
  const operator = authorForSeed(operatorSeed);
  const gateway = await Gateway.open(new MemoryBackend(), {
    seed: operatorSeed,
    ...(opts.lens === undefined ? {} : { offeredLens: opts.lens }),
  });
  await gateway.append([
    signClaims(membershipClaims("tenant:garden", FERN, operator, 1), operatorSeed),
    signClaims(grantClaims("tenant:garden", GARDENER, "write", operator, 2), operatorSeed),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  const token = `tok-${operatorSeed.slice(0, 4)}`;
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port: 0,
  });
  gateways.push(gateway);
  handles.push(handle);
  return { gateway, url: `${handle.url}/default`, token };
}

const height = (g: Gateway) =>
  g
    .query(`{ plant(entity: "${FERN}") { height } }`)
    .then((r) => (r.data as { plant: { height: number | null } }).plant.height);

describe("federation: two instances meet and merge", () => {
  it("a delta on A resolves on B after B pulls", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    // the gardener writes on A (both instances granted her write, so her delta is at home on both)
    await a.gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);
    expect(await height(b.gateway)).toBeNull(); // B has not heard yet

    const report = await pullFrom(b.gateway, a.url, a.token);
    expect(report.accepted).toBeGreaterThan(0);
    expect(await height(b.gateway)).toBe(42); // B resolves A's delta
  });

  it("union holds both ways: each keeps the other's writes, no conflict", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    await a.gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await b.gateway.append([observed(FERN, "tag", "shade", 1500, GARDENER_SEED)]);

    await pullFrom(a.gateway, b.url, b.token);
    await pullFrom(b.gateway, a.url, a.token);

    // both now resolve both facts; the views converge
    for (const g of [a.gateway, b.gateway]) {
      const view = await g.query(`{ plant(entity: "${FERN}") { height tag _hex } }`);
      const plant = (view.data as { plant: { height: number; tag: string[]; _hex: string } }).plant;
      expect(plant.height).toBe(30);
      expect(plant.tag).toEqual(["shade"]);
    }
    const ha = (
      (await a.gateway.query(`{ plant(entity: "${FERN}") { _hex } }`)).data as {
        plant: { _hex: string };
      }
    ).plant._hex;
    const hb = (
      (await b.gateway.query(`{ plant(entity: "${FERN}") { _hex } }`)).data as {
        plant: { _hex: string };
      }
    ).plant._hex;
    expect(ha).toBe(hb); // convergence: same deltas → same snapshot
  });

  it("a re-pull is idempotent: nothing new accepted the second time", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    await a.gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);
    const first = await pullFrom(b.gateway, a.url, a.token);
    const second = await pullFrom(b.gateway, a.url, a.token);
    expect(first.accepted).toBeGreaterThan(0);
    expect(second.accepted).toBe(0); // union: the same deltas do not re-accept
  });

  it("a published lens restricts what crosses", async () => {
    // A offers only height claims — its tags stay home
    const heightsOnly = parseTerm({
      op: "select",
      pred: { hasPointer: { context: { exact: "height" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    });
    const a = await instance(OP_A, { lens: heightsOnly });
    const b = await instance(OP_B);
    await a.gateway.append([
      observed(FERN, "height", 42, 1000, GARDENER_SEED),
      observed(FERN, "tag", "secret", 1100, GARDENER_SEED),
    ]);
    await pullFrom(b.gateway, a.url, a.token);
    const view = await b.gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const plant = (view.data as { plant: { height: number; tag: string[] | null } }).plant;
    expect(plant.height).toBe(42); // the height crossed
    expect(plant.tag ?? []).toEqual([]); // the tag did not
  });

  it("a forgery is refused at the boundary; honest deltas around it still land", async () => {
    const a = await instance(OP_A);
    const b = await instance(OP_B);
    const honest = observed(FERN, "height", 42, 1000, GARDENER_SEED);
    await a.gateway.append([honest]);
    // inject a forgery directly into A's reactor via a lens that would offer it — simulate a
    // hostile peer by pulling a hand-made bad delta straight into B's federate path
    const forged: Delta = { ...honest, id: `1e20${"00".repeat(32)}` };
    const report = await b.gateway.federate([forged, honest]);
    expect(report.rejected).toBe(1); // the forgery
    expect(report.accepted).toBeGreaterThan(0); // the honest delta
    expect(await height(b.gateway)).toBe(42);
    void OPERATOR_A;
  });
});
