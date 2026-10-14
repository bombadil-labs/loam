// M5 slice 1: the portable batch read through the published package endpoint. A Plant read built
// from Loam's own signed source and original definition acts must answer the same HView and View
// digests the native read answers for the same entity, ground and time.

import { describe, expect, it } from "vitest";
import {
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
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_READING, PLANT_WRITABLE, garden, governedBootstrap } from "../gateway/fixtures.js";

const KEEPER_SEED = "d7".repeat(32);

const textOf = (d: Delta, role: string): string | undefined => {
  const t = d.claims.pointers.find((x) => x.role === role)?.target;
  return t?.kind === "primitive" && typeof t.value === "string" ? t.value : undefined;
};

async function publishedGarden(): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
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
