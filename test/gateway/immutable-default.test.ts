import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { schemaEntityFor } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "d4".repeat(32);

async function operatorGateway(writable?: readonly string[]): Promise<Gateway> {
  const g = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  g.register(PLANT, PLANT_POLICY, [FERN], undefined, writable);
  return g;
}

describe("the hyperschema-entity rename", () => {
  it("defaults a hyperschema definition to hyperschema:<Name>", () => {
    expect(schemaEntityFor(PLANT)).toBe("hyperschema:Plant");
  });

  it("an explicit entity still overrides the default", () => {
    expect(schemaEntityFor(PLANT, "hyperschema:Custom")).toBe("hyperschema:Custom");
  });

  it("a fresh genesis registration's definition entity is hyperschema:<Name>", async () => {
    const genesis = assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    });
    const g = await Gateway.boot(new MemoryBackend(), genesis);
    expect(g.registrationVersions()[0]!.entity).toBe("hyperschema:Plant");
    await g.close();
  });
});

describe("immutable-by-default writability", () => {
  it("a registration with no writable list accepts NO surface write", async () => {
    const g = await operatorGateway();
    const res = await g.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["height"]) { height } }`,
    );
    expect(res.errors?.join(" ")).toContain("read-only");
    await g.close();
  });

  it("a field absent from writable is refused; a listed field is allowed", async () => {
    const g = await operatorGateway(["height"]);
    const listed = await g.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["height"]) { height } }`,
    );
    expect(listed.errors, "a listed field writes").toBeUndefined();

    const absent = await g.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["tag"]) { tag } }`,
    );
    expect(absent.errors?.join(" "), "an unlisted field is refused").toContain("read-only");
    await g.close();
  });

  it("naming every field restores the fully-writable surface (the pre-flip behavior)", async () => {
    const g = await operatorGateway([...PLANT_WRITABLE]);
    const res = await g.query(`mutation { plant(entity: "${FERN}", height: 42) { height } }`);
    expect(res.errors).toBeUndefined();
    expect((res.data as { plant: { height: number } }).plant.height).toBe(42);
    await g.close();
  });

  it("with no writable, GraphQL offers a bare mutate field (no per-prop args)", async () => {
    const g = await operatorGateway();
    const res = await g.query(`mutation { plant(entity: "${FERN}", height: 5) { height } }`);
    expect(res.errors?.join(" ")).toMatch(/height/i);
    await g.close();
  });
});
