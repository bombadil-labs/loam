// §17/§23.8 — a `Name@vN` public pin must freeze the Nth version OF THAT LENS, and the door that
// serves it must resolve the exact pair it authorized (ticket T47, hazard H6).
//
// Two links compose into an anonymous over-disclosure with no malice. `freezePublicEntry` indexes
// `registrationVersions().filter(byLens)[N-1]`; under §21.7 coexistence, filtering by the PROGRAM
// name instead interleaves every reading over the hyperschema, so `Plant@v2` can freeze a sibling
// reading's version. The route door then gates on `isPublicPin(schemaName, versionId)` — the pair —
// but resolves the version by content address ALONE, so it serves whatever the mis-frozen pin points
// at, undeclared reading and all.
//
// The readings differ the way §21.7 coexistence actually differs — by HOW they resolve, never by
// field set (a Schema cannot omit a property; `resolveView` backfills from `default`). BROAD picks
// the newest height, NARROW the oldest, so a served body tells them apart.

import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf } from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
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

// A coexistence world where the version INDEX of lens "Plant" diverges from its position in the
// program-filtered list. Ground order: Plant#1, PlantPublic#1, Plant#2. So the 2nd "Plant" version
// is at program-index 3 — a program-name filter puts PlantPublic#1 at index 2 and mis-freezes it.
const staged = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["height"] }],
    }),
  );
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]); // oldest → NARROW picks this
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]); // newest → BROAD picks this
  // PlantPublic#1 lands BETWEEN the two Plant versions, so the program-filtered index diverges.
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
    expect(plants.length).toBe(2); // Plant#1 and Plant#2
    const publics = gw.registrationVersions().filter((v) => lensOf(v) === "PlantPublic");
    expect(publics.length).toBe(1);
    // The 2nd Plant version is NOT at program-index 2 — that slot is PlantPublic#1.
    const byProgram = gw.registrationVersions().filter((v) => v.hyperschema.name === "Plant");
    expect(lensOf(byProgram[1]!)).toBe("PlantPublic"); // the interleaving that breaks a program filter
    await gw.close();
  });

  it("DELTA LEVEL: declaring Plant@v2 freezes the 2nd PLANT version, not the interleaved sibling", async () => {
    const gw = await staged();
    const plantV2 = plantVersions(gw)[1]!; // the version the operator means by "Plant@v2"
    await gw.declarePublic(["Plant@v2"]);
    // The frozen pin must name Plant#2's deltaId under lens "Plant" — a program-index bug freezes
    // PlantPublic#1 instead, and this asserts the exact deltaId the door will resolve.
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
    // Plant@v2 is the BROAD reading → newest height (99). If the pin mis-froze the NARROW sibling,
    // the anonymous door would serve height 10 — an undeclared reading — or go dark.
    expect(out.status).toBe(200);
    expect(out.body).toContain("height: 99");
    expect(out.body).not.toContain("height: 10");
    await gw.close();
  });
});
