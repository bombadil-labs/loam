// §21.7 — genesis mints each reading under its own LENS name, not the program (ticket T56, H6 at the
// MINT site). `assembleGenesis` passed `reg.hyperschema.name` (the program) where the two live mint
// paths pass the lens, and silently discarded `Registration.lensName`. Under coexistence a genesis
// declaring two readings over one hyperschema minted BOTH at living entity `schema:<program>`; on
// replay `readRegistrations` keys latest-per-lens, both collided, and the LAST in the array won —
// array order, not the operator, decided which policy served, including behind the anonymous door.

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

// A genesis declaring TWO readings over ONE hyperschema — the case that used to collapse.
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
    // Both readings bind. Before the fix they collided at `schema:Plant` and only one survived.
    expect(lenses).toContain("PlantNew");
    expect(lenses).toContain("PlantOld");
    await gw.close();
  });

  it("OBJECT LEVEL: each lens serves under its OWN policy, chosen by the operator not by array order", async () => {
    const gw = await boot();
    // PlantNew picks newest (99), PlantOld picks oldest (10). If they collapsed, one lens name would
    // be unservable and the other would answer under whichever policy won the array.
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
    // Two readings that collide on lens name (both "Plant") over one hyperschema can never both
    // bind — silently dropping one is how array order used to pick the served policy. Refuse loudly.
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
