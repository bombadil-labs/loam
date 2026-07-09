// Step 7's genesis + registrations-as-deltas. A registration is a delta: schema, policy, and
// roots, filed as data — so the GraphQL surface is a function of the store and survives reopen
// with no re-registration code. A genesis is the bootstrap delta-set every store is born from;
// Gateway.boot opens a fresh store already governed and registered.

import { describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims, membershipClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const GARDEN = "tenant:garden";

describe("registrations as deltas: the surface is a function of the store", () => {
  it("publishRegistration persists the registration; a reopened store serves it uncoded", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]);
    await gateway.flush();

    // reopen: NO register() call — the store remembers its own shape
    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const result = await reopened.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as { plant: { height: number } }).plant.height).toBe(30);
    await gateway.close();
    await reopened.close();
  });

  it("only the operator may publish a registration (it is constitutional)", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    // a non-operator actor cannot register through the store
    await expect(
      gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN], { actor: GARDENER_SEED }),
    ).rejects.toThrow(/only the operator/);
    await gateway.close();
  });
});

describe("genesis: a fresh store, born governed and registered", () => {
  it("Gateway.boot opens a store already able to answer and enforce", async () => {
    const backend = new MemoryBackend();
    const genesis = assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [{ schema: PLANT, policy: PLANT_POLICY, roots: [FERN] }],
      grants: [
        membershipClaims(GARDEN, FERN, OPERATOR, 1),
        grantClaims(GARDEN, GARDENER, "write", OPERATOR, 2),
      ],
    });
    const gateway = await Gateway.boot(backend, genesis);

    // registered: it answers without a register() call
    const empty = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(empty.errors).toBeUndefined();

    // governed: the gardener may write, a stranger may not
    const allowed = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      { actor: GARDENER_SEED },
    );
    expect(allowed.errors).toBeUndefined();
    const denied = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
      undefined,
      { actor: "e4".repeat(32) },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("boot is idempotent: booting the same genesis onto a live store adds nothing", async () => {
    const backend = new MemoryBackend();
    const genesis = assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [{ schema: PLANT, policy: PLANT_POLICY, roots: [FERN] }],
      grants: [],
    });
    const first = await Gateway.boot(backend, genesis);
    await first.flush();
    const before = (await backend.deltasSince(new Set())).length;
    const second = await Gateway.boot(backend, genesis); // same genesis, live store
    await second.flush();
    const after = (await backend.deltasSince(new Set())).length;
    expect(after).toBe(before); // genesis deltas are content-addressed: the same seed twice is one
    await first.close();
    await second.close();
  });
});
