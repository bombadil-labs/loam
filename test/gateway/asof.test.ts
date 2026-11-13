import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { handleRest } from "../../src/surface/rest.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OP_SEED);

async function bootPlant(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
    }),
  );
}

async function readGql(
  gateway: Gateway,
  asOf?: number,
): Promise<{ height: number | null; asOf: number | null; forgotten: number[] | null }> {
  const arg = asOf === undefined ? "" : `, asOf: ${asOf}`;
  const res = await gateway.query(`{ plant(entity: "${FERN}"${arg}) { height _asOf _forgotten } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  const plant = (res.data as { plant: Record<string, unknown> }).plant;
  return {
    height: plant["height"] as number | null,
    asOf: plant["_asOf"] as number | null,
    forgotten: plant["_forgotten"] as number[] | null,
  };
}

function tombstoneFor(gateway: Gateway, id: string): Delta {
  const tomb = [...gateway.reactor.snapshot()].find((d) =>
    d.claims.pointers.some((p) => p.target.kind === "delta" && p.target.deltaRef.delta === id),
  );
  expect(tomb).toBeDefined();
  return tomb!;
}

describe("the past is a reading, not an archive (SPEC §26)", () => {
  it("resolves the ground as it stood at T — an older pick, and the present unchanged", async () => {
    const gateway = await bootPlant();
    await gateway.append([observed(FERN, "height", 10, 1000, GARDENER_SEED)]);
    await gateway.append([observed(FERN, "height", 20, 2000, GARDENER_SEED)]);

    expect((await readGql(gateway, 1500)).height).toBe(10);
    expect((await readGql(gateway, 2500)).height).toBe(20);
    expect((await readGql(gateway, 500)).height).toBeNull();
    expect((await readGql(gateway)).height).toBe(20);

    const past = await readGql(gateway, 1500);
    expect(past.asOf).toBe(1500);
    expect(past.forgotten).toEqual([]);
    const now = await readGql(gateway);
    expect(now.asOf).toBeNull();
    expect(now.forgotten).toBeNull();
    await gateway.close();
  });

  it("honors negation order: a retraction not yet spoken at T leaves the fact standing", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 10, 1000, GARDENER_SEED);
    await gateway.append([fact]);
    await gateway.append([signClaims(makeNegationClaims(GARDENER, 3000, fact.id), GARDENER_SEED)]);

    expect((await readGql(gateway, 2000)).height).toBe(10);
    expect((await readGql(gateway, 4000)).height).toBeNull();
    expect((await readGql(gateway)).height).toBeNull();
    await gateway.close();
  });
});

describe("erasure wins even in the past (SPEC §26 / §11) — in every door", () => {
  it("a purged delta never reappears — not at a T after its birth, not one strictly before", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 50, 1000, GARDENER_SEED);
    await gateway.append([fact]);

    expect((await readGql(gateway, 2000)).height).toBe(50);

    await gateway.erase(fact.id);

    expect((await readGql(gateway, 2000)).height).toBeNull();
    expect((await readGql(gateway, 500)).height).toBeNull();

    for (const t of [2000, 500]) {
      const rest = await handleRest(
        gateway,
        "full",
        "GET",
        ["v1", "Plant", FERN],
        undefined,
        OP_SEED,
        String(t),
      );
      expect(rest.status).toBe(200);
      const view = (rest.body as { view: { height?: number } }).view;
      expect(view.height ?? null).toBeNull();
    }
    await gateway.close();
  });
});

describe("the erasure annotation — the exception is visible even when its content is not", () => {
  it("flags and enumerates a fact forgotten SINCE the moment; a settled past needs no mark", async () => {
    const gateway = await bootPlant();
    const fact = observed(FERN, "height", 50, 1000, GARDENER_SEED);
    await gateway.append([fact]);

    expect((await readGql(gateway, 2000)).forgotten).toEqual([]);

    await gateway.erase(fact.id);
    const forgotAt = tombstoneFor(gateway, fact.id).claims.timestamp;

    const past = await readGql(gateway, 2000);
    expect(past.height).toBeNull();
    expect(past.forgotten).toEqual([forgotAt]);

    expect((await readGql(gateway, forgotAt)).forgotten).toEqual([]);
    await gateway.close();
  });
});
