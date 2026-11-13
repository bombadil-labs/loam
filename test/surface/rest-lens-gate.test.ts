import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { lensOf } from "../../src/gateway/registration.js";
import { PLANT } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

const BASE: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const LIVE: Schema = parseSchema({
  name: "PlantLive",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});
const ARCHIVAL_V2: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BASE, roots: [FERN], writable: ["height"] }],
    }),
  );
  await gw.publishRegistration(PLANT, LIVE, [FERN], undefined, undefined, undefined, ["height"]);
  await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
  return gw;
};

const viewOf = (r: { body: unknown }): Record<string, number> =>
  (r.body as { view: Record<string, number> }).view;

const get = (gw: Gateway, door: "full" | "public", vTag: string, lens: string) =>
  handleRest(gw, door, "GET", [vTag, lens, FERN], undefined, OP_SEED);

describe("§21.7 — the REST door addresses each coexisting reading under its own policy", () => {
  it("PRECONDITION: neither lens name coincides with the program name", async () => {
    const gw = await boot();
    const lenses = gw.registered.map((r) => ({ program: r.hyperschema.name, lens: lensOf(r) }));
    const plants = lenses.filter((l) => l.program === "Plant");
    expect(plants.length).toBeGreaterThanOrEqual(3);
    const underTest = plants
      .filter((l) => l.lens !== "Plant")
      .map((l) => l.lens)
      .sort();
    expect(underTest).toEqual(["PlantClassic", "PlantLive"]);
    await gw.close();
  });

  it("each lens answers under ITS OWN order — the readings are not conflated", async () => {
    const gw = await boot();
    const live = await get(gw, "full", "v1", "PlantLive");
    const archival = await get(gw, "full", "v1", "PlantClassic");
    expect(live.status).toBe(200);
    expect(archival.status).toBe(200);
    expect(viewOf(live).height).toBe(99);
    expect(viewOf(archival).height).toBe(10);
    await gw.close();
  });

  it("a non-latest version is real: v1 and v2 of one lens answer under their own schemas", async () => {
    const gw = await boot();
    await gw.publishRegistration(PLANT, ARCHIVAL_V2, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    const v1 = await get(gw, "full", "v1", "PlantClassic");
    const v2 = await get(gw, "full", "v2", "PlantClassic");
    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(viewOf(v1).height).toBe(10);
    expect(viewOf(v2).height).toBe(99);
    await gw.close();
  });

  it("the @<hash> branch honours the lens: a sibling's registration hash is not addressable under this name", async () => {
    const gw = await boot();
    const versions = gw.registrationVersions();
    const classic = versions.find((v) => lensOf(v) === "PlantClassic");
    const live = versions.find((v) => lensOf(v) === "PlantLive");
    expect(classic).toBeDefined();
    expect(live).toBeDefined();

    const own = await get(gw, "full", `@${classic!.deltaId}`, "PlantClassic");
    expect(own.status).toBe(200);
    expect(viewOf(own).height).toBe(10);

    const crossed = await get(gw, "full", `@${live!.deltaId}`, "PlantClassic");
    expect(crossed.status).toBe(404);
    await gw.close();
  });

  it("the public door serves ONLY the declared reading", async () => {
    const gw = await boot();
    await gw.declarePublic(["PlantClassic"]);
    const declared = await get(gw, "public", "v1", "PlantClassic");
    expect(declared.status).toBe(200);
    expect(viewOf(declared).height).toBe(10);
    const undeclared = await get(gw, "public", "v1", "PlantLive");
    expect(undeclared.status).toBe(404);
    await gw.close();
  });
});
