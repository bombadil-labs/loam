import { describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { parseResolvers, type ResolverSpecs } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

const COUNT = "export default (bucket) => bucket.length;";
const SUM = "export default (bucket) => bucket.reduce((s, e) => s + Number(e.value), 0);";

const countHeight: ResolverSpecs = { height: { rung: "a", type: "number", code: COUNT } };

const bootWithResolver = (resolvers?: ResolverSpecs): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN],
          writable: [...PLANT_WRITABLE],
          ...(resolvers === undefined ? {} : { resolvers }),
        },
      ],
    }),
  );

const heightOf = (r: { data?: unknown }): unknown =>
  (r.data as { plant: { height: unknown } }).plant.height;

describe("§22 rung (a): a bucket-pure resolver overrides the Policy value", () => {
  it("resolves height as the COUNT of its facts, not the picked latest", async () => {
    const gw = await bootWithResolver(countHeight);
    await gw.append([
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 34, 2000, OP_SEED),
    ]);
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(heightOf(res)).toBe(2);
    await gw.close();
  });

  it("with no resolver, the Policy value stands (nothing existing moves)", async () => {
    const gw = await bootWithResolver();
    await gw.append([
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 34, 2000, OP_SEED),
    ]);
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(heightOf(res)).toBe(34);
    await gw.close();
  });
});

describe("§22 rung admission: v1 builds (a) only", () => {
  it("parseResolvers accepts rung (a)", () => {
    expect(() =>
      parseResolvers({ height: { rung: "a", type: "number", code: COUNT } }),
    ).not.toThrow();
  });

  it("refuses the higher rungs and synthetics (b, c, d, e) with a reason", () => {
    for (const rung of ["b", "c", "d", "e"]) {
      expect(() => parseResolvers({ height: { rung, type: "number", code: COUNT } })).toThrow(
        /not admitted|rung \(a\) only/,
      );
    }
  });

  it("refuses an unknown output type and empty code", () => {
    expect(() => parseResolvers({ height: { rung: "a", type: "int", code: COUNT } })).toThrow(
      /type/,
    );
    expect(() => parseResolvers({ height: { rung: "a", type: "number", code: "  " } })).toThrow(
      /code/,
    );
  });

  it("refuses a resolver over a field the schema does not have (rung (e) is design-only)", async () => {
    const gw = await bootWithResolver();
    await expect(
      gw.publishRegistration(
        PLANT,
        PLANT_POLICY,
        [FERN],
        undefined,
        undefined,
        undefined,
        [...PLANT_WRITABLE],
        { nonesuch: { rung: "a", type: "number", code: COUNT } },
      ),
    ).rejects.toThrow(/no such field/);
    await gw.close();
  });
});

describe("§22.6: the doors advertise the declared output type", () => {
  it("GraphQL types a number-resolved field as Float, not the pass-through ViewValue", async () => {
    const gw = await bootWithResolver(countHeight);
    const res = await gw.query(`{ __type(name: "PlantView") { fields { name type { name } } } }`);
    const fields = (
      res.data as { __type: { fields: Array<{ name: string; type: { name: string | null } }> } }
    ).__type.fields;
    const height = fields.find((f) => f.name === "height");
    expect(height?.type.name).toBe("Float");
    await gw.close();
  });
});

describe("§22.5 + §11: the memo invalidates when the ground forgets", () => {
  it("a memoized resolver value disappears when a delta it was computed over is erased", async () => {
    const gw = await bootWithResolver(countHeight);
    const a = observed(FERN, "height", 30, 1000, OP_SEED);
    const b = observed(FERN, "height", 34, 2000, OP_SEED);
    await gw.append([a, b]);

    expect(heightOf(await gw.query(`{ plant(entity: "${FERN}") { height } }`))).toBe(2);

    await gw.erase(a.id);

    expect(heightOf(await gw.query(`{ plant(entity: "${FERN}") { height } }`))).toBe(1);
    await gw.close();
  });
});

describe("§22: writability stays orthogonal — a write still hits the bucket", () => {
  it("a surface write lands even though the read is f(bucket), not the written value", async () => {
    const gw = await bootWithResolver(countHeight);
    await gw.append([observed(FERN, "height", 30, 1000, OP_SEED)]);
    expect(heightOf(await gw.query(`{ plant(entity: "${FERN}") { height } }`))).toBe(1);

    const w = await gw.query(`mutation { plant(entity: "${FERN}", height: 99) { height } }`);
    expect(w.errors).toBeUndefined();
    expect(heightOf(await gw.query(`{ plant(entity: "${FERN}") { height } }`))).toBe(2);
    await gw.close();
  });
});

describe("§22.4: a resolver freezes with its version", () => {
  it("changing a resolver mints a new version; the pinned old version keeps its old resolver", async () => {
    const gw = await bootWithResolver(countHeight);
    await gw.append([
      observed(FERN, "height", 30, 1000, OP_SEED),
      observed(FERN, "height", 34, 2000, OP_SEED),
    ]);
    await gw.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
      { height: { rung: "a", type: "number", code: SUM } },
    );

    const versions = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect(versions[0]!.resolvers?.height?.code).toBe(COUNT);
    expect(versions[1]!.resolvers?.height?.code).toBe(SUM);

    const v1 = gw.resolvePinned(versions[0]!, FERN);
    const v2 = gw.resolvePinned(versions[1]!, FERN);
    expect((v1.view as { height: unknown }).height).toBe(2);
    expect((v2.view as { height: unknown }).height).toBe(64);
    await gw.close();
  });
});
