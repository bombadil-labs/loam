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
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

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
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 2)],
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
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    });
    const definition = genesis.deltas.find((d) =>
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.hyperschema.defines`),
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
    expect(offered.length).toBeGreaterThan(0); // the marker still crosses
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
    // Standing first, writes second: a batch cannot bootstrap its own permissions.
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
      d.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.hyperschema.defines`),
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

  it("an identical republish binds nothing new: same generation, same materialization", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const before = gateway.materializationFor("Plant");
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]); // same shape, new deltas
    expect(gateway.materializationFor("Plant")).toBe(before); // no rebind
    await gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN]); // a REAL evolution
    expect(gateway.materializationFor("Plant")).not.toBe(before); // rebinds
    await gateway.close();
  });

  it("policy-and-roots evolution: same body, a republished reference reshapes the fields", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedGarden(gateway);
    const heightOnly = { props: new Map([["height", pickLatest]]), default: pickLatest };
    await gateway.publishRegistration(PLANT, heightOnly, [FERN]);
    const narrow = await gateway.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect(narrow.errors?.join(" ")).toMatch(/Cannot query/); // no tag field yet

    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]); // same body, wider policy
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
    ); // evolve: heights only
    const evolved = await gateway.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((evolved.data as { plant: { tag: string[] | null } }).plant.tag ?? []).toEqual([]);

    // the OLD stream still fires, and still gathers tags — the shape it promised its reader
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 44) { height } }`);
    const patch = (await stream.next()).value as { plant: { height: number; tag: string[] } };
    expect(patch.plant.height).toBe(44);
    expect(patch.plant.tag).toEqual(["shade"]);
    await stream.return(undefined);
    await gateway.close();
  });

  it("a store registration colliding with a manual name persists but does not bind — and says so", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE); // manual, this process's own
    await expect(gateway.publishRegistration(PLANT_V2, PLANT_POLICY, [FERN])).rejects.toThrow(
      /did not bind/,
    );
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
      // canonical and loadable — but select yields a delta set, not a hyperview
      body: parseTerm({ op: "mask", policy: "drop", in: "input" }),
    };
    await gateway.flush();
    const before = (await backend.deltasSince(new Set())).length;
    await expect(gateway.publishRegistration(dsetSort, PLANT_POLICY, [FERN])).rejects.toThrow(
      /hyperview/,
    );
    await gateway.flush();
    expect((await backend.deltasSince(new Set())).length).toBe(before); // nothing landed
    await gateway.close();
  });

  it("a hand-planted unmaterializable definition leaves its type unbound, never a crashed boot", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    // the operator plants the poison by hand, past publishRegistration's guard
    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const { registrationClaims } = await import("../../src/gateway/registration.js");
    const dsetBody = parseTerm({ op: "mask", policy: "drop", in: "input" });
    await gateway.append([
      signClaims(
        publishHyperSchemaClaims(
          { name: "Poison", alg: 1, body: dsetBody },
          "schema:Poison",
          OPERATOR,
          1,
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        registrationClaims("schema:Poison", PLANT_POLICY, [FERN], OPERATOR, 2),
        OPERATOR_SEED,
      ),
    ]);
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED }); // boots — the poison is unbound
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
    await seedGarden(gateway); // the gardener holds write standing
    await gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

    // the gardener publishes a NEWER definition at the operator's own schema entity — under
    // open writes it lands as data; under operator-filtered reads it binds nothing
    const { publishHyperSchemaClaims } = await import("@bombadil/rhizomatic");
    const rival = signClaims(
      publishHyperSchemaClaims(PLANT_V2, "schema:Plant", GARDENER, Date.now() + 9_000_000),
      GARDENER_SEED,
    );
    await expect(gateway.append([rival])).resolves.toMatchObject({ accepted: 1 });
    await gateway.flush();

    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const result = await reopened.query(`{ plant(entity: "${FERN}") { tag } }`);
    // the operator's v1 body still gathers tags — the gardener's heights-only rival never bound
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
        {
          hyperschema: BED_SCHEMA,
          schema: { props: new Map(), default: pickLatest },
          roots: [BED],
        },
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
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
