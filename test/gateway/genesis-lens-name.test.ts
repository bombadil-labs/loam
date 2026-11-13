import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf } from "../../src/gateway/registration.js";
import { handleRest } from "../../src/surface/rest.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

const named = (name: string, dir: "asc" | "desc"): Schema =>
  parseSchema({
    name,
    alg: 1,
    props: { height: { pick: { order: { byTimestamp: dir } } } },
    default: { pick: { order: { byTimestamp: dir } } },
  });

const twoReadings = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      {
        hyperschema: PLANT,
        schema: named("PlantNew", "desc"),
        roots: [FERN],
        writable: ["height"],
      },
      { hyperschema: PLANT, schema: named("PlantOld", "asc"), roots: [FERN], writable: ["height"] },
    ],
  });

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(new MemoryBackend(), twoReadings());
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
  return gw;
};

describe("§21.7 — a genesis mints each reading under its own lens name", () => {
  it("DELTA LEVEL: two genesis readings over one hyperschema both survive, under distinct lenses", async () => {
    const gw = await boot();
    const lenses = gw.registered.map(lensOf).sort();
    expect(lenses).toContain("PlantNew");
    expect(lenses).toContain("PlantOld");
    await gw.close();
  });

  it("OBJECT LEVEL: each lens serves under its OWN policy, chosen by the operator not by array order", async () => {
    const gw = await boot();
    const view = (r: { body: unknown }) => (r.body as { view: { height: number } }).view;
    const newest = await handleRest(
      gw,
      "full",
      "GET",
      ["v1", "PlantNew", FERN],
      undefined,
      OP_SEED,
    );
    const oldest = await handleRest(
      gw,
      "full",
      "GET",
      ["v1", "PlantOld", FERN],
      undefined,
      OP_SEED,
    );
    expect(newest.status).toBe(200);
    expect(oldest.status).toBe(200);
    expect(view(newest).height).toBe(99);
    expect(view(oldest).height).toBe(10);
    await gw.close();
  });

  it("REFUSAL: a genesis whose two registrations resolve to the SAME lens name is refused, not reduced", () => {
    expect(() =>
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: named("Plant", "desc"),
            roots: [FERN],
            writable: ["height"],
          },
          {
            hyperschema: PLANT,
            schema: named("Plant", "asc"),
            roots: [FERN],
            writable: ["height"],
          },
        ],
      }),
    ).toThrow(/lens/i);
  });
});
