// M5 slice 1: the portable batch read through the published package endpoint. A Plant read built
// from Loam's own signed source and original definition acts must answer the same HView and View
// digests the native read answers for the same entity, ground and time.

import { describe, expect, it } from "vitest";
import {
  parseTerm,
  signClaims,
  schemaCanonicalHex,
  schemaHash,
  termCanonicalHex,
  termHash,
  type Delta,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { readGround } from "../../src/gateway/slate.js";
import { seedSigner } from "../../src/gateway/signer.js";
import { portableBoot, portableRead } from "../../src/gateway/portable-read.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED } from "../spike/garden.js";
import { classifyPortableRead } from "../../src/gateway/portable-door.js";
import {
  PLANT,
  PLANT_READING,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
} from "../gateway/fixtures.js";

const KEEPER_SEED = "d7".repeat(32);

const textOf = (d: Delta, role: string): string | undefined => {
  const t = d.claims.pointers.find((x) => x.role === role)?.target;
  return t?.kind === "primitive" && typeof t.value === "string" ? t.value : undefined;
};

type Route = { lens: string; route: string; reason?: string };
async function publishedGarden(portableReads = false, routes?: Route[]): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), {
    seed: KEEPER_SEED,
    portableReads,
    ...(routes === undefined ? {} : { onReadRoute: (r: Route) => void routes.push(r) }),
  });
  await gw.append(governedBootstrap(KEEPER_SEED));
  await gw.append(garden);
  await gw.publishRegistration(
    PLANT,
    PLANT_READING,
    [FERN],
    { actor: KEEPER_SEED },
    undefined,
    undefined,
    PLANT_WRITABLE,
  );
  return gw;
}

describe("M5 slice 1: the portable batch read", () => {
  it("answers the native Plant read's HView and View digests from Loam's own signed acts", async () => {
    const gw = await publishedGarden();
    const now = gw.now();
    const native = gw.resolvedNode("Plant", FERN, undefined, now);
    const ground = [...readGround(gw, now)];
    const hyper = ground.find(
      (d) => textOf(d, "rhizomatic.hyperschema.term") === termCanonicalHex(PLANT.body),
    );
    const reading = ground.find(
      (d) => textOf(d, "rhizomatic.schema.term") === schemaCanonicalHex(PLANT_READING),
    );
    expect(hyper, "the published HyperSchema act").toBeDefined();
    expect(reading, "the published reading act").toBeDefined();
    const signer = seedSigner(KEEPER_SEED);
    const answer = await portableRead(signer, portableBoot(signer), {
      root: FERN,
      at: now,
      receivedAt: now,
      program: {
        hyperschema: hyper!,
        hyperschemaPin: termHash(PLANT.body),
        schema: reading!,
        schemaPin: schemaHash(PLANT_READING),
        definitions: [],
        definitionAt: now,
      },
      source: ground,
      currentSource: () => [...readGround(gw, now)],
    });
    expect(answer).toMatchObject({ status: "completed" });
    if (answer.status !== "completed") return;
    expect(native.view).toMatchObject({ height: 34, readings: 2 });
    expect(answer.view).toMatchObject({ height: 34, readings: 2 });
    expect(answer.hviewDigest).toBe(native.hviewHex);
    expect(answer.viewDigest).toBe(native.hex);
    await gw.close();
  });

  it("reads the source it was given: one fact fewer answers a different View", async () => {
    const gw = await publishedGarden();
    const now = gw.now();
    const native = gw.resolvedNode("Plant", FERN, undefined, now);
    const latest = garden.find((d) => d.claims.timestamp === 2000)!;
    const ground = [...readGround(gw, now)].filter((d) => d.id !== latest.id);
    const hyper = ground.find(
      (d) => textOf(d, "rhizomatic.hyperschema.term") === termCanonicalHex(PLANT.body),
    )!;
    const reading = ground.find(
      (d) => textOf(d, "rhizomatic.schema.term") === schemaCanonicalHex(PLANT_READING),
    )!;
    const signer = seedSigner(KEEPER_SEED);
    const answer = await portableRead(signer, portableBoot(signer), {
      root: FERN,
      at: now,
      receivedAt: now,
      program: {
        hyperschema: hyper,
        hyperschemaPin: termHash(PLANT.body),
        schema: reading,
        schemaPin: schemaHash(PLANT_READING),
        definitions: [],
        definitionAt: now,
      },
      source: ground,
      currentSource: () => ground,
    });
    expect(answer).toMatchObject({ status: "completed", view: { height: 30 } });
    if (answer.status === "completed") expect(answer.viewDigest).not.toBe(native.hex);
    await gw.close();
  });
});

const BED = "bed:shade";
const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
const BED_WITH_PLANTS = {
  name: "BedWithPlants",
  alg: 1,
  body: parseTerm({
    op: "expand",
    role: { exact: "plant" },
    schema: "Plant",
    reading: "Plant",
    in: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  }),
};
const BED_READING = {
  name: "BedWithPlants",
  alg: 1,
  props: new Map([["plants", PICK]]),
  default: PICK,
};
const planting = signClaims(
  {
    timestamp: 1100,
    validFrom: 1100,
    author: GARDENER,
    pointers: [
      { role: "bed", target: { kind: "entity", entity: { id: BED, context: "plants" } } },
      { role: "plant", target: { kind: "entity", entity: { id: FERN, context: "planted" } } },
    ],
  },
  GARDENER_SEED,
);

async function bedGarden(portableReads: boolean, routes?: Route[]): Promise<Gateway> {
  const gw = await publishedGarden(portableReads, routes);
  await gw.append([planting]);
  await gw.publishRegistration(BED_WITH_PLANTS, BED_READING, [BED], { actor: KEEPER_SEED });
  return gw;
}

const query = async (gw: Gateway, source: string) => {
  const res = await gw.query(source);
  expect(res.errors, source).toBeUndefined();
  return res.data;
};

describe("M5 slice 1: the routed door", () => {
  it("classifies each read before dispatch, with its reason named", async () => {
    const gw = await bedGarden(true);
    const now = gw.now();
    expect(classifyPortableRead(gw, "Plant", FERN, now).route).toBe("portable");
    expect(classifyPortableRead(gw, "BedWithPlants", BED, now).route).toBe("portable");
    expect(
      classifyPortableRead(gw, "Plant", FERN, now, undefined, { container: "x" } as never),
    ).toEqual({ route: "native", reason: "bound-connection" });
    await gw.close();
  });

  it("keeps a native-only registration native: it never published law", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED, portableReads: true });
    await gw.append(governedBootstrap(KEEPER_SEED));
    await gw.append(garden);
    gw.register(PLANT, PLANT_READING, [FERN]);
    expect(classifyPortableRead(gw, "Plant", FERN, gw.now())).toEqual({
      route: "native",
      reason: "unpublished-law",
    });
    await gw.close();
  });

  it("answers the same GraphQL data and digests on both routes, present and as of", async () => {
    const routes: Route[] = [];
    const native = await bedGarden(false),
      portable = await bedGarden(true, routes);
    for (const source of [
      `{ plant(entity: "${FERN}") { height tag readings _hex _hviewHex } }`,
      `{ plant(entity: "${FERN}", asOf: 1600) { height tag _hex _hviewHex _asOf } }`,
      `{ bedWithPlants(entity: "${BED}") { plants _hex _hviewHex } }`,
    ])
      expect(await query(portable, source)).toEqual(await query(native, source));
    // Every one of those reads really took the portable route.
    expect(routes.map((r) => [r.lens, r.route])).toEqual([
      ["Plant", "portable"],
      ["Plant", "portable"],
      ["BedWithPlants", "portable"],
    ]);
    await native.close();
    await portable.close();
  });
});
