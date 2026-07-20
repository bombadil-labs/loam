// The registry's reading half, at the door (rhizomatic 0.8 / issue #23). A hyperschema whose gather
// `expand`s must name a `reading`, and that reading must be one the store can resolve. Two failures
// are possible and BOTH must be refused before anything persists, because append-only ground cannot
// take a bad body back:
//
//   • a WRONG name — refused by SchemaRegistry.build, which resolves every reading ref at build time;
//   • NO name at all — refused by nothing in the substrate (parseTerm accepts the legacy shape,
//     collectReadingRefs has no ref to resolve, and the materializability trial evaluates over an
//     EMPTY delta set so no expansion is ever produced). Such a body used to publish cleanly, bind,
//     advertise its type, and then throw on the first read of an entity that actually had a child
//     pointer. `assertReadingsNamed` closes that.
//
// And the reading a body may name is any bound LENS — including one whose resolution Schema is
// anonymous, since a lens's name is `schema.name ?? hyperschema.name` everywhere else in the system.

import { describe, expect, it } from "vitest";
import { parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_READING, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
const BED = "bed:shade";

const bedBody = (reading?: string) =>
  parseTerm({
    op: "expand",
    role: { exact: "plant" },
    schema: "Plant",
    ...(reading === undefined ? {} : { reading }),
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

const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
const bedSchema = (name: string) => ({
  name,
  alg: 1,
  props: new Map([["plants", PICK]]),
  default: PICK,
});

// The fern, planted in the bed — so a bed read has a real child to expand into.
const planting = signClaims(
  {
    timestamp: 1100,
    author: GARDENER,
    pointers: [
      { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
      { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
    ],
  },
  GARDENER_SEED,
);

// `named` chooses whether the Plant lens is bound with a NAMED Schema or an anonymous one — both are
// legitimate ways to bind lens `Plant`, and a body must be able to name either as its child's reading.
async function keeperGarden(named = true): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gateway.append(governedBootstrap(KEEPER_SEED));
  await gateway.append([...garden, planting]);
  gateway.register(PLANT, named ? PLANT_READING : PLANT_POLICY, [FERN]);
  return gateway;
}

const bedPlants = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ bedWithPlants(entity: "${BED}") { plants } }`);
  expect(res.errors).toBeUndefined();
  return (res.data as { bedWithPlants: { plants: unknown } }).bedWithPlants.plants;
};

describe("expand reading refs bind at the door (issue #23)", () => {
  it("a bed naming a KNOWN reading publishes AND resolves its child through it", async () => {
    const gateway = await keeperGarden();
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBody("Plant") },
      bedSchema("BedWithPlants"),
      [BED],
      { actor: KEEPER_SEED },
    );
    // The point is not that publish was quiet — it is that the child actually resolves THROUGH the
    // named reading, all the way to the fern's own field.
    expect(await bedPlants(gateway)).toMatchObject({ height: 34 });
    await gateway.close();
  });

  it("a bed naming an UNKNOWN reading is refused loudly at publish, not silently persisted", async () => {
    const gateway = await keeperGarden();
    await expect(
      gateway.publishRegistration(
        { name: "BedWithGhosts", alg: 1, body: bedBody("Ghost") },
        bedSchema("BedWithGhosts"),
        [BED],
        { actor: KEEPER_SEED },
      ),
    ).rejects.toThrow(/reading|Ghost/i);
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedWithGhosts")).toBe(
      false,
    );
    await gateway.close();
  });

  it("a bed whose expand names NO reading is refused too — the shape nothing else catches", async () => {
    const gateway = await keeperGarden();
    await expect(
      gateway.publishRegistration(
        { name: "BedLegacy", alg: 1, body: bedBody() }, // the pre-0.8 shape
        bedSchema("BedLegacy"),
        [BED],
        { actor: KEEPER_SEED },
      ),
    ).rejects.toThrow(/names no `reading`/i);
    // Nothing persisted: it never becomes a lens that binds, advertises a type, and throws on read.
    expect(gateway.registrationVersions().some((v) => v.hyperschema.name === "BedLegacy")).toBe(
      false,
    );
    await gateway.close();
  });

  it("a lens bound with an ANONYMOUS Schema is still nameable as a reading", async () => {
    // A lens's name is `schema.name ?? hyperschema.name` everywhere else — the GraphQL type, the
    // field, the resolver lookup. Keying the reading registry on `schema.name` alone made an
    // anonymously-bound lens serveable but un-embeddable: you could query it and never expand into it.
    const gateway = await keeperGarden(false); // Plant bound with the ANONYMOUS PLANT_POLICY
    await gateway.publishRegistration(
      { name: "BedWithPlants", alg: 1, body: bedBody("Plant") },
      bedSchema("BedWithPlants"),
      [BED],
      { actor: KEEPER_SEED },
    );
    expect(await bedPlants(gateway)).toMatchObject({ height: 34 });
    await gateway.close();
  });
});
