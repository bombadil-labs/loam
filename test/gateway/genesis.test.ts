import { describe, expect, it } from "vitest";
import {
  VOCAB_PREFIX,
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_READING, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

describe("registrations as deltas: the surface is a function of the store", () => {
  it("publishRegistration persists the registration; a reopened store serves it uncoded", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const result = await reopened.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(result.errors).toBeUndefined();
    expect((result.data as { plant: { height: number } }).plant.height).toBe(30);
    await gateway.close();
    await reopened.close();
  });

  it("only the operator may publish a registration (it is constitutional)", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
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
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
    });
    const gateway = await Gateway.boot(backend, genesis);

    const empty = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(empty.errors).toBeUndefined();

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
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    });
    const definition = genesis.deltas.find((d) =>
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.hyperschema.defines`),
    );
    expect(definition).toBeDefined();
    const registration = genesis.deltas.find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "loam.registration",
      ),
    );
    expect(registration).toBeDefined();
    expect(
      registration!.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.id === "hyperschema:Plant",
      ),
    ).toBe(true);
    expect(JSON.stringify(registration!.claims)).not.toContain('"group"');
  });

  it("boot passes options through: a lensed store can be born with one call", async () => {
    const lens = parseTerm({
      op: "select",
      pred: { not: { hasPointer: { context: { exact: "grumbles" } } } },
      in: { op: "mask", policy: "drop", in: "input" },
    });
    const gateway = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OPERATOR_SEED }),
      { offeredLens: lens },
    );
    await gateway.append([
      signClaims(
        {
          timestamp: 1,
          validFrom: 1,
          author: OPERATOR,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "colony:1", context: "grumbles" } },
            },
            { role: "value", target: { kind: "primitive", value: "kept home" } },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    const offered = gateway.offeredDeltas();
    expect(offered.some((d) => JSON.stringify(d.claims).includes("grumbles"))).toBe(false);
    expect(offered.length).toBeGreaterThan(0);
    await gateway.close();
  });

  it("boot is idempotent: booting the same genesis onto a live store adds nothing", async () => {
    const backend = new MemoryBackend();
    const genesis = assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [],
    });
    const first = await Gateway.boot(backend, genesis);
    await first.flush();
    const before = (await backend.deltasSince(new Set())).length;
    const second = await Gateway.boot(backend, genesis);
    await second.flush();
    const after = (await backend.deltasSince(new Set())).length;
    expect(after).toBe(before);
    await first.close();
    await second.close();
  });
});

describe("genesis ids are golden: a drive-by constant cannot re-mint the constitution (T74)", () => {
  const GOLDEN_HS: HyperSchema = {
    name: "GoldenType",
    alg: 1,
    body: parseTerm({ op: "mask", policy: "drop", in: "input" }),
  };
  const GOLDEN_ROOT = "golden:root";
  const goldenGenesis = () =>
    assembleGenesis({
      operatorSeed: OPERATOR_SEED,
      registrations: [
        {
          hyperschema: GOLDEN_HS,
          schema: { props: new Map(), default: pickLatest },
          roots: [GOLDEN_ROOT],
        },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
    });

  it("the marker id is fixed by the operator alone — pins the marker's timestamp", () => {
    const marker = goldenGenesis().deltas[0]!;
    expect(marker.id).toBe("1e208c8e789157512e9ff8a7f78b5eea9e9e79476aaf34b275d681771715a5a8e8de");
  });

  it("every genesis delta id, in order — pins the clock base and the whole constitution", () => {
    const ids = goldenGenesis().deltas.map((d) => d.id);
    expect(ids).toEqual([
      "1e208c8e789157512e9ff8a7f78b5eea9e9e79476aaf34b275d681771715a5a8e8de",
      "1e20254aac5c179c9c9559a97a0fb6c0ebf5406b565a12030b6f1291465f3726416d",
      "1e2081df71b7eb87e9dc4fe1f684d64a62de02c91c274f808c396bd87070a9421696",
      "1e206d4e4a9f072b084c91ec9fb8d6444b886234701d03313492454d6f013a881709",
      "1e205acd66ec82624c3004d8d38190e458a12b62dc411732eddd7d3efe0c90060f41",
      "1e20db1fe4205979bfc16f2528f30e5122913bac8a17cbb08d02aae4d6d0a59a9c53",
    ]);
  });
});

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
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2), OPERATOR_SEED),
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
    expect(after.plant.height).toBe(30);
    expect(after.plant.tag ?? []).toEqual([]);
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
    const definition = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.hyperschema.defines`),
    );
    expect(definition).toBeDefined();
    await gateway.append([
      signClaims(
        { ...makeNegationClaims(OPERATOR, Date.now() + 10, definition!.id), validFrom: Date.now() },
        OPERATOR_SEED,
      ),
    ]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await expect(reopened.query(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /nothing is registered/,
    );
    await gateway.close();
    await reopened.close();
  });

  it("an identical republish binds nothing new: same generation, same materialization", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const before = gateway.materializationFor("Plant");
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    expect(gateway.materializationFor("Plant")).toBe(before);
    await gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN]);
    expect(gateway.materializationFor("Plant")).not.toBe(before);
    await gateway.close();
  });

  it("policy-and-roots evolution: same body, a republished reference reshapes the fields", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    const heightOnly = { props: new Map([["height", pickLatest]]), default: pickLatest };
    await gateway.publishRegistration(PLANT, heightOnly, [FERN]);
    const narrow = await gateway.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect(narrow.errors?.join(" ")).toMatch(/Cannot query/);

    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const wide = await gateway.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect(wide.errors).toBeUndefined();
    expect((wide.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    await gateway.close();
  });

  it("a live stream keeps the shape it subscribed to; a new reader sees the evolution", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    await gateway.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
    );
    const stream = await gateway.subscribe(
      `subscription { plant(entity: "${FERN}") { height tag } }`,
    );
    const snapshot = (await stream.next()).value as { plant: { height: number; tag: string[] } };
    expect(snapshot.plant).toMatchObject({ height: 30, tag: ["shade"] });

    await gateway.publishRegistration(
      PLANT_V2,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
    );
    const evolved = await gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((evolved.data as { plant: { tag: string[] | null } }).plant.tag ?? []).toEqual([]);

    await gateway.query(`mutation { plant(entity: "${FERN}", height: 44) { height } }`);
    const patch = (await stream.next()).value as { plant: { height: number; tag: string[] } };
    expect(patch.plant.height).toBe(44);
    expect(patch.plant.tag).toEqual(["shade"]);
    await stream.return(undefined);
    await gateway.close();
  });

  it("a store registration colliding with a manual name persists but does not bind — and says so", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const out = await gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN]);
    expect(out.persisted).toBe(true);
    expect(out.bound).toBe(false);
    expect(out.reason).toMatch(/DIFFERENT bodies|collides/i);
    await gateway.close();
  });

  it("a seedless gateway cannot publish; an ungoverned one binds any actor's registration", async () => {
    const seedless = await Gateway.open(new MemoryBackend());
    await expect(seedless.publishRegistration(PLANT, PLANT_POLICY, [FERN])).rejects.toThrow(
      /no signing seed/,
    );
    await seedless.close();

    const ungoverned = await Gateway.open(new MemoryBackend());
    await ungoverned.publishRegistration(PLANT, PLANT_POLICY, [FERN], { actor: GARDENER_SEED });
    const answer = await ungoverned.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    await ungoverned.close();
  });

  it("a body that cannot materialize is refused BEFORE anything persists", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const dsetSort: HyperSchema = {
      name: "Poison",
      alg: 1,
      body: parseTerm({ op: "mask", policy: "drop", in: "input" }),
    };
    await gateway.flush();
    const before = (await backend.deltasSince(new Set())).length;
    await expect(gateway.publishRegistration(dsetSort, PLANT_POLICY, [FERN])).rejects.toThrow(
      /hyperview/,
    );
    await gateway.flush();
    expect((await backend.deltasSince(new Set())).length).toBe(before);
    await gateway.close();
  });

  it("a hand-planted unmaterializable definition leaves its type unbound, never a crashed boot", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const { registrationDeltaClaims } = await import("../../src/gateway/registration.js");
    const dsetBody = parseTerm({ op: "mask", policy: "drop", in: "input" });
    const { living, snapshot, binding } = registrationDeltaClaims(
      "hyperschema:Poison",
      "Poison",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 2,
    );
    await gateway.append([
      signClaims(
        publishHyperSchemaClaims(
          { name: "Poison", alg: 1, body: dsetBody },
          "hyperschema:Poison",
          OPERATOR,
          1,
        ),
        OPERATOR_SEED,
      ),
      signClaims(living, OPERATOR_SEED),
      signClaims(snapshot, OPERATOR_SEED),
      signClaims(binding, OPERATOR_SEED),
    ]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await expect(reopened.query(`{ poison(entity: "x") { _hex } }`)).rejects.toThrow(
      /nothing is registered/,
    );
    await gateway.close();
    await reopened.close();
  });

  it("a NUL in a schema name is refused at publish", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await expect(
      gateway.publishRegistration(
        { ...PLANT, name: `Plant${String.fromCharCode(0)}x` },
        PLANT_POLICY,
        [FERN],
      ),
    ).rejects.toThrow(/NUL/);
    await gateway.close();
  });

  it("a granted writer's rival definition LANDS (writes are open) and reshapes nothing", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const rival = signClaims(
      {
        ...publishHyperSchemaClaims(PLANT_V2, "schema:Plant", GARDENER, Date.now() + 9_000_000),
        validFrom: Date.now(),
      },
      GARDENER_SEED,
    );
    await expect(gateway.append([rival])).resolves.toMatchObject({ accepted: 1 });
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const result = await reopened.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((result.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
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
        reading: "Plant",
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
      registrations: [
        {
          hyperschema: BED_SCHEMA,
          schema: { props: new Map(), default: pickLatest },
          roots: [BED],
        },
        { hyperschema: PLANT, schema: PLANT_READING, roots: [FERN], writable: [...PLANT_WRITABLE] },
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
