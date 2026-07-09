// Step 7's genesis + registrations-as-deltas. A registration is a delta: schema, policy, and
// roots, filed as data — so the GraphQL surface is a function of the store and survives reopen
// with no re-registration code. A genesis is the bootstrap delta-set every store is born from;
// Gateway.boot opens a fresh store already governed and registered.

import { describe, expect, it } from "vitest";
import {
  VOCAB_PREFIX,
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims, membershipClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";

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

  it("genesis emits definitions + references: the registration delta carries no schema body", () => {
    const genesis = assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [{ schema: PLANT, policy: PLANT_POLICY, roots: [FERN] }],
    });
    const definition = genesis.deltas.find((d) =>
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.schema.defines`),
    );
    expect(definition).toBeDefined(); // the schema is DEFINED by a schema-schema delta
    const registration = genesis.deltas.find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
      ),
    );
    expect(registration).toBeDefined();
    // the registration references the schema entity; the body travels only in the definition
    expect(
      registration!.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.id === "schema:Plant",
      ),
    ).toBe(true);
    expect(JSON.stringify(registration!.claims)).not.toContain('"group"');
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

// The v2 body gathers heights only — tags fall out of the hyperview, so evolution is
// observable through an unchanged policy: the DEFINITION drove the change.
const HEIGHTS_ONLY = parseTerm({
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { context: { exact: "height" } } },
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  },
});
const PLANT_V2: HyperSchema = { name: "Plant", alg: 1, body: HEIGHTS_ONLY };

describe("evolution is append: the surface follows the surviving definitions", () => {
  const seedGarden = async (gateway: Gateway): Promise<void> => {
    // Constitution first, writes second: a batch cannot bootstrap its own permissions.
    await gateway.append([
      signClaims(membershipClaims(GARDEN, FERN, OPERATOR, 1), OPERATOR_SEED),
      signClaims(grantClaims(GARDEN, GARDENER, "write", OPERATOR, 2), OPERATOR_SEED),
    ]);
    await gateway.append([
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
      observed(FERN, "tag", "shade", 1500, GARDENER_SEED),
    ]);
  };

  it("republishing at the same schema entity reshapes the RUNNING gateway — no restart", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const v1 = await gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const before = v1.data as { plant: { height: number; tag: string[] } };
    expect(before.plant.height).toBe(30);
    expect(before.plant.tag).toEqual(["shade"]);

    await gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN]);
    const v2 = await gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect(v2.errors).toBeUndefined();
    const after = v2.data as { plant: { height: number; tag: string[] | null } };
    expect(after.plant.height).toBe(30); // heights still gather
    expect(after.plant.tag ?? []).toEqual([]); // tags no longer do: the new body binds, live
    await gateway.close();
  });

  it("a reopened store serves the evolved shape (replay reads the latest definition)", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const result = await reopened.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const plant = (result.data as { plant: { height: number; tag: string[] | null } }).plant;
    expect(plant.height).toBe(30);
    expect(plant.tag ?? []).toEqual([]);
    await gateway.close();
    await reopened.close();
  });

  it("deprecation is negation: a store whose definition was negated reopens without the type", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    // find the definition delta in the store and negate it, operator-signed
    const definition = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.schema.defines`),
    );
    expect(definition).toBeDefined();
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, Date.now() + 10, definition!.id), OPERATOR_SEED),
    ]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED }); // no crash
    await expect(reopened.query(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /nothing is registered/,
    );
    await gateway.close();
    await reopened.close();
  });

  it("a schema that refs another registers through the replay fixpoint, whatever the order", async () => {
    const BED = "bed:shade";
    const BED_SCHEMA: HyperSchema = {
      name: "BedWithPlants",
      alg: 1,
      body: parseTerm({
        op: "expand",
        role: { exact: "plant" },
        schema: "Plant",
        in: {
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "drop", in: "input" },
          },
        },
      }),
    };
    const genesis = assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      // Bed FIRST: its ref must wait for Plant — the fixpoint, not the order, resolves it
      registrations: [
        { schema: BED_SCHEMA, policy: { props: new Map(), default: pickLatest }, roots: [BED] },
        { schema: PLANT, policy: PLANT_POLICY, roots: [FERN] },
      ],
    });
    const gateway = await Gateway.boot(new MemoryBackend(), genesis);
    expect((await gateway.query(`{ plant(entity: "${FERN}") { height } }`)).errors).toBeUndefined();
    expect(
      (await gateway.query(`{ bedWithPlants(entity: "${BED}") { _hex } }`)).errors,
    ).toBeUndefined();
    await gateway.close();
  });
});
