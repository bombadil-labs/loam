import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseSchema,
  signClaims,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf } from "../../src/gateway/registration.js";
import { handleRest } from "../../src/surface/rest.js";
import { PLANT } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

const named = (name: string, dir: "asc" | "desc"): Schema =>
  parseSchema({
    name,
    alg: 1,
    props: { height: { pick: { order: { byTimestamp: dir } } } },
    default: { pick: { order: { byTimestamp: dir } } },
  });

const staged = async (): Promise<{ gw: Gateway; classicId: string }> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: named("Plant", "desc"), roots: [FERN], writable: ["height"] },
      ],
    }),
  );
  await gw.publishRegistration(
    PLANT,
    named("PlantLive", "desc"),
    [FERN],
    undefined,
    undefined,
    undefined,
    ["height"],
  );
  await gw.publishRegistration(
    PLANT,
    named("PlantClassic", "asc"),
    [FERN],
    undefined,
    undefined,
    undefined,
    ["height"],
  );
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  const classicId = gw.registrationVersions().find((v) => lensOf(v) === "PlantClassic")!.deltaId;
  await gw.append([signClaims(makeNegationClaims(OP, 9_000_000, classicId, "retired"), OP_SEED)]);
  return { gw, classicId };
};

const get = (gw: Gateway, vTag: string, lens: string) =>
  handleRest(gw, "full", "GET", [vTag, lens, FERN], undefined, OP_SEED);

describe("§17 — the 410 door names the withdrawn LENS, not the program", () => {
  it("DELTA LEVEL: the withdrawn record carries the struck registration's LENS name", async () => {
    const { gw, classicId } = await staged();
    const w = gw.withdrawnRegistrations().find((x) => x.deltaId === classicId);
    expect(w).toBeDefined();
    expect(w!.lensName).toBe("PlantClassic");
    await gw.close();
  });

  it("OBJECT — UNDER-ANSWER: the struck hash under ITS OWN lens answers 410, not a bare 404", async () => {
    const { gw, classicId } = await staged();
    const out = await get(gw, `@${classicId}`, "PlantClassic");
    expect(out.status).toBe(410);
    await gw.close();
  });

  it("OBJECT — OVER-ANSWER: the struck hash under the PROGRAM name is a plain 404, no cross-lens 410", async () => {
    const { gw, classicId } = await staged();
    const out = await get(gw, `@${classicId}`, "Plant");
    expect(out.status).toBe(404);
    await gw.close();
  });
});
