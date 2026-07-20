// The registry's reading half, at the door (rhizomatic 0.8 / issue #23): a hyperschema whose gather
// `expand`s must name a `reading` the store can resolve. Loam threads every bound resolution Schema
// into SchemaRegistry.build as a reading, so a registration whose child names an UNKNOWN reading is
// refused LOUDLY at publish (where the mistake is fixable) — never persisted as a surface that would
// only fail, silently, at read. The same build runs on replay inside a try/catch, so a store that
// somehow holds such a registration simply leaves it unbound rather than crashing the boot.

import { describe, expect, it } from "vitest";
import { parseTerm } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_READING, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
const BED = "bed:shade";

const bedBodyNaming = (reading: string) =>
  parseTerm({
    op: "expand",
    role: { exact: "plant" },
    schema: "Plant",
    reading,
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

const BED_SCHEMA_PROPS = {
  props: new Map([
    [
      "plants",
      { kind: "pick" as const, order: { kind: "byTimestamp" as const, dir: "desc" as const } },
    ],
  ]),
  default: { kind: "pick" as const, order: { kind: "byTimestamp" as const, dir: "desc" as const } },
};

async function keeperGarden(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_READING, [FERN]); // the "Plant" reading is now bound
  return gateway;
}

describe("expand reading refs bind at the door (issue #23)", () => {
  it("a bed naming a KNOWN reading publishes and resolves its child", async () => {
    const gateway = await keeperGarden();
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBodyNaming("Plant") },
      { name: "BedWithPlants", alg: 1, ...BED_SCHEMA_PROPS },
      [BED],
      { actor: KEEPER_SEED },
    );
    // No assertion beyond "it did not throw": the child's reading resolved at build time.
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedWithPlants")).toBe(
      true,
    );
    await gateway.close();
  });

  it("a bed naming an UNKNOWN reading is refused loudly at publish, not silently persisted", async () => {
    const gateway = await keeperGarden();
    await expect(
      gateway.publishRegistration(
        { name: "BedWithGhosts", alg: 1, body: bedBodyNaming("Ghost") },
        { name: "BedWithGhosts", alg: 1, ...BED_SCHEMA_PROPS },
        [BED],
        { actor: KEEPER_SEED },
      ),
    ).rejects.toThrow(/reading|Ghost/i);
    // Nothing bound — the loud refusal happened before any delta could shape a surface.
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedWithGhosts")).toBe(
      false,
    );
    await gateway.close();
  });
});
