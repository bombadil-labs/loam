// §17 — the withdrawn-registration 410 door must name a struck registration by its LENS, not its
// program (ticket T59, hazard H6). `readWithdrawnRegistrations` recorded `schemaName` from the
// hyperschema's own name (the program), while the door at rest.ts:328 compares it to the lens name
// taken from the URL — and every sibling comparison in that function resolves through `lensOf`.
//
// Two wrong outcomes under §21.7 coexistence, where a lens name differs from its program:
//   UNDER-ANSWER — striking a sibling reading's registration, then asking for its hash under ITS OWN
//     lens, drew a bare 404 instead of the 410 §17 promises. 404 vs 410 is what tells an integrator
//     "withdrawn, stop retrying" rather than "you have the wrong hash".
//   OVER-ANSWER — asking for that hash under the PROGRAM name (which no lens need serve) drew a 410
//     confirming the hash was a lawful registration of this store, on the strength of a withdrawal
//     belonging to a DIFFERENT reading.
//
// Genesis cannot mint a distinct lens name today (T56), so the coexistence readings arrive via
// `publishRegistration` — the fixture shape from test/surface/rest-lens-gate.test.ts.

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

// A coexistence world: genesis lens "Plant" (shares the program name), plus two readings named
// distinctly from the program so the lens-vs-program gap is real.
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
  // The operator strikes PlantClassic's registration — lawful, remembered, no longer served.
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
    // The record must name "PlantClassic" — the lens the operator struck — not the program "Plant".
    expect(w!.lensName).toBe("PlantClassic");
    await gw.close();
  });

  it("OBJECT — UNDER-ANSWER: the struck hash under ITS OWN lens answers 410, not a bare 404", async () => {
    const { gw, classicId } = await staged();
    const out = await get(gw, `@${classicId}`, "PlantClassic");
    // §17: it was lawful, the operator struck it, the ground remembers. A program-named record
    // makes the comparison miss and downgrades this to a 404.
    expect(out.status).toBe(410);
    await gw.close();
  });

  it("OBJECT — OVER-ANSWER: the struck hash under the PROGRAM name is a plain 404, no cross-lens 410", async () => {
    const { gw, classicId } = await staged();
    const out = await get(gw, `@${classicId}`, "Plant");
    // "Plant" is the program, and no lens named "Plant" was struck here. A record that named the
    // program would confirm the hash was lawful under a reading the caller did not name.
    expect(out.status).toBe(404);
    await gw.close();
  });
});
