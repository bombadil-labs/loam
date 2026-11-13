import { describe, expect, it } from "vitest";
import { makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "3c".repeat(32);
const PEER_SEED = "4d".repeat(32);

const boot = (seed: string): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: seed,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

async function fern(gw: Gateway): Promise<{ height: number | null; tag: string[] }> {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null; tag: string[] } }).plant;
}

const ids = (deltas: readonly Delta[]): Set<string> => new Set(deltas.map((d) => d.id));

describe("the federation offer drops erased ids", () => {
  it("an erased claim whose bytes remain is not offered; the bystander is", async () => {
    const gw = await boot(OP_SEED);
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    expect(ids(gw.offeredDeltas()).has(claim.id)).toBe(true);

    await gw.append([signClaims(eraseClaims(claim.id, op, op, 2000), OP_SEED)]);
    expect(gw.reactor.get(claim.id)).toBeDefined();

    const offered = ids(gw.offeredDeltas());
    expect(offered.has(claim.id)).toBe(false);
    expect(offered.has(bystander.id)).toBe(true);

    const peer = await boot(PEER_SEED);
    await peer.federate(gw.offeredDeltas());
    expect(peer.reactor.get(claim.id)).toBeUndefined();
    expect(await fern(peer)).toEqual({ height: null, tag: ["shade"] });
    await Promise.all([gw.close(), peer.close()]);
  });

  it("an erased strike takes its target with it while the strike's bytes remain", async () => {
    const gw = await boot(OP_SEED);
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike = signClaims(makeNegationClaims(op, 2000, claim.id), OP_SEED);
    await gw.append([strike]);
    await gw.append([signClaims(eraseClaims(strike.id, op, op, 3000), OP_SEED)]);
    expect(gw.reactor.get(strike.id)).toBeDefined();

    const offered = ids(gw.offeredDeltas());
    expect(offered.has(strike.id)).toBe(false);
    expect(offered.has(claim.id)).toBe(false);
    expect(offered.has(bystander.id)).toBe(true);

    const peer = await boot(PEER_SEED);
    await peer.federate(gw.offeredDeltas());
    expect(await fern(peer)).toEqual({ height: null, tag: ["shade"] });
    await Promise.all([gw.close(), peer.close()]);
  });

  it("withholds a claim whose erased strike is itself counterstruck, by design", async () => {
    const gw = await boot(OP_SEED);
    const op = gw.operatorAuthor!;
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike = signClaims(makeNegationClaims(op, 2000, claim.id), OP_SEED);
    const counter = signClaims(makeNegationClaims(op, 2500, strike.id), OP_SEED);
    await gw.append([strike, counter]);
    expect(await fern(gw)).toEqual({ height: 30, tag: ["shade"] });
    await gw.append([signClaims(eraseClaims(strike.id, op, op, 3000), OP_SEED)]);
    expect(gw.reactor.get(strike.id)).toBeDefined();

    const offered = ids(gw.offeredDeltas());
    expect(offered.has(strike.id)).toBe(false);
    expect(offered.has(claim.id)).toBe(false);
    expect(offered.has(counter.id)).toBe(true);
    expect(offered.has(bystander.id)).toBe(true);
    await gw.close();
  });
});
