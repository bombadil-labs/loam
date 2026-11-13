import { describe, expect, it } from "vitest";
import { authorForSeed, parseSchema, signClaims, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf, type LensName } from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const L = (n: string): LensName => n as LensName;
const CARD = "export default (n) => `<p>height: ${n.view.height}</p>`;";

const BROAD: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const NARROW: Schema = parseSchema({
  name: "PlantPublic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const staged = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["height"] }],
    }),
  );
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
  await gw.publishRegistration(PLANT, NARROW, [FERN], undefined, undefined, undefined, ["height"]);
  await gw.publishRegistration(PLANT, BROAD, [FERN], undefined, undefined, undefined, ["height"]);
  return gw;
};

const plantVersions = (gw: Gateway) =>
  gw.registrationVersions().filter((v) => lensOf(v) === "Plant");

describe("§23.8 — a public pin freezes the Nth version of the LENS, not the program", () => {
  it("PRECONDITION: the coexistence world interleaves the two readings' versions", async () => {
    const gw = await staged();
    const plants = plantVersions(gw);
    expect(plants.length).toBe(2);
    const publics = gw.registrationVersions().filter((v) => lensOf(v) === "PlantPublic");
    expect(publics.length).toBe(1);
    const byProgram = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    expect(lensOf(byProgram[1]!)).toBe("PlantPublic");
    await gw.close();
  });

  it("DELTA LEVEL: declaring Plant@v2 freezes the 2nd PLANT version, not the interleaved sibling", async () => {
    const gw = await staged();
    const plantV2 = plantVersions(gw)[1]!;
    await gw.declarePublic(["Plant@v2"]);
    expect(gw.isPublicPin("Plant", plantV2.deltaId)).toBe(true);
    await gw.close();
  });

  it("OBJECT LEVEL: the anonymous route door serves the DECLARED reading, refusing the sibling", async () => {
    const gw = await staged();
    await gw.publishRenderer({
      route: "card",
      schema: "Plant",
      version: 2,
      consumes: ["height"],
      bundle: CARD,
    });
    await gw.declarePublic(["Plant@v2"]);
    const out = await gw.serveRoute("card", FERN, "public");
    expect(out.status).toBe(200);
    expect(out.body).toContain("height: 99");
    expect(out.body).not.toContain("height: 10");
    await gw.close();
  });

  it("OBJECT LEVEL: the route door resolves the PAIR — a binding whose lens and version disagree 404s", async () => {
    const gw = await staged();
    const publicId = gw.registrationVersions().find((v) => lensOf(v) === "PlantPublic")!.deltaId;
    const { rendererBindingClaims } = await import("../../src/gateway/renderers.js");
    await gw.append([
      signClaims(
        rendererBindingClaims(
          { route: "crafted", schemaName: L("Plant"), consumes: ["height"], bundle: CARD },
          publicId,
          OP,
          9_000_000,
        ),
        OP_SEED,
      ),
    ]);
    await gw.declarePublic([`Plant@${publicId}`]);
    const out = await gw.serveRoute("crafted", FERN, "public");
    expect(out.status).toBe(404);
    expect(out.body).not.toContain("height: 10");
    await gw.close();
  });
});
