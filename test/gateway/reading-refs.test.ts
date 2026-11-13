import { describe, expect, it } from "vitest";
import { parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_READING, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
const BED = "bed:shade";

const bedBody = (reading?: string) =>
  parseTerm({
    op: "expand",
    role: { exact: "plant" },
    schema: "Plant",
    ...(reading === undefined ? {} : { reading }),
    in: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  });

const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
const bedSchema = (name: string) => ({
  name,
  alg: 1,
  props: new Map([["plants", PICK]]),
  default: PICK,
});

const planting = signClaims(
  {
    timestamp: 1100,
    validFrom: 1100,
    author: GARDENER,
    pointers: [
      { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
      { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
    ],
  },
  GARDENER_SEED,
);

async function keeperGarden(named = true): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append([...garden, planting]);
  gateway.register(PLANT, named ? PLANT_READING : PLANT_POLICY, [FERN]);
  return gateway;
}

const bedPlants = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ bedWithPlants(entity: "${BED}") { plants } }`);
  expect(res.errors).toBeUndefined();
  return (res.data as { bedWithPlants: { plants: unknown } }).bedWithPlants.plants;
};

describe("expand reading refs bind at the door (issue #23)", () => {
  it("a bed naming a KNOWN reading publishes AND resolves its child through it", async () => {
    const gateway = await keeperGarden();
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBody("Plant") },
      bedSchema("BedWithPlants"),
      [BED],
      { actor: KEEPER_SEED },
    );
    expect(await bedPlants(gateway)).toMatchObject({ height: 34 });
    await gateway.close();
  });

  it("a bed naming an UNKNOWN reading is refused loudly at publish, not silently persisted", async () => {
    const gateway = await keeperGarden();
    await expect(
      gateway.publishRegistration(
        { name: "BedWithGhosts", alg: 1, body: bedBody("Ghost") },
        bedSchema("BedWithGhosts"),
        [BED],
        { actor: KEEPER_SEED },
      ),
    ).rejects.toThrow(/reading|Ghost/i);
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedWithGhosts")).toBe(
      false,
    );
    await gateway.close();
  });

  it("a bed whose expand names NO reading is refused too — the shape nothing else catches", async () => {
    const gateway = await keeperGarden();
    await expect(
      gateway.publishRegistration(
        { name: "BedLegacy", alg: 1, body: bedBody() },
        bedSchema("BedLegacy"),
        [BED],
        { actor: KEEPER_SEED },
      ),
    ).rejects.toThrow(/names no `reading`/i);
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedLegacy")).toBe(
      false,
    );
    await gateway.close();
  });

  it("a lens bound with an ANONYMOUS Schema is still nameable as a reading", async () => {
    const gateway = await keeperGarden(false);
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBody("Plant") },
      bedSchema("BedWithPlants"),
      [BED],
      { actor: KEEPER_SEED },
    );
    expect(await bedPlants(gateway)).toMatchObject({ height: 34 });
    await gateway.close();
  });

  it("evolving a lens moves the reading an expand resolves through", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
    await gateway.append(governedBootstrap(KEEPER_SEED));
    await gateway.append([...garden, planting]);
    const heightBy = (dir: "asc" | "desc") => ({
      ...PLANT_READING,
      props: new Map([
        ["height", { kind: "pick" as const, order: { kind: "byTimestamp" as const, dir } }],
      ]),
    });

    await gateway.publishRegistration(PLANT, heightBy("desc"), [FERN], { actor: KEEPER_SEED });
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBody("Plant") },
      bedSchema("BedWithPlants"),
      [BED],
      { actor: KEEPER_SEED },
    );
    expect(await bedPlants(gateway)).toMatchObject({ height: 34 });

    await gateway.publishRegistration(PLANT, heightBy("asc"), [FERN], { actor: KEEPER_SEED });

    expect(await bedPlants(gateway)).toMatchObject({ height: 30 });
    await gateway.close();
  });

  it("a publish shadowed by a process-local override is WRITTEN, and says it is not serving", async () => {
    const gateway = await keeperGarden();
    const out = await gateway.publishRegistration(PLANT, PLANT_READING, [FERN], {
      actor: KEEPER_SEED,
    });
    expect(out.persisted).toBe(true);
    expect(out.bound).toBe(false);
    expect(out.reason).toMatch(/collides with an earlier schema/);
    expect(out.reason).not.toMatch(/negate the old definition first/);
    const published = gateway
      .registrationVersions()
      .find((v) => v.hyperschema.name === "Plant" && lensOf(v) === "Plant");
    expect(published).toBeDefined();
    expect(published!.roots).toEqual([FERN]);
    expect([...published!.schema.props.keys()].sort()).toEqual(
      [...PLANT_READING.props.keys()].sort(),
    );
    await gateway.close();
  });

  it("a genuine RIVAL body is written too, and names why it does not serve", async () => {
    const gateway = await keeperGarden();
    const rival = {
      name: "Plant",
      alg: 1,
      body: parseTerm({
        op: "group",
        key: "byTargetContext",
        in: { op: "mask", policy: "drop", in: "input" },
      }),
    };
    const out = await gateway.publishRegistration(rival, PLANT_READING, [FERN], {
      actor: KEEPER_SEED,
    });
    expect(out.persisted).toBe(true);
    expect(out.bound).toBe(false);
    expect(out.reason).toMatch(/DIFFERENT bodies|rival/i);
    expect(out.reason).not.toMatch(/negate the old definition first/);
    await gateway.close();
  });
});
