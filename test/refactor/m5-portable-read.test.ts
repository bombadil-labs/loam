// M5 slice 1: the portable batch read through the published package endpoint. A Plant read built
// from Loam's own signed source and original definition acts must answer the same HView and View
// digests the native read answers for the same entity, ground and time.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  claimsToJson,
  parseTerm,
  schemaCanonicalHex,
  schemaHash,
  termCanonicalHex,
  termHash,
  type Delta,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { readGround } from "../../src/gateway/slate.js";
import { readClosedIds } from "../../src/gateway/slate-law.js";
import { seedSigner } from "../../src/gateway/signer.js";
import { portableBoot, portableRead, runPortableRead } from "../../src/gateway/portable-read.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  BED,
  BED_READING,
  BED_WITH_PLANTS,
  BED_WITH_PLANTS_JSON,
  planting,
} from "./m5-fixtures.js";
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

/** The Plant read's scope and S(scope) under the read closure, from the reactor's anchored read. */
function scoped(gw: Gateway, now: number): { scope: string[]; source: Delta[] } {
  const closed = readClosedIds(gw, now);
  const read = gw.reactor.evalAnchored(
    PLANT.body,
    gw.validityNow(now),
    FERN,
    gw.registry,
    undefined,
    (d) => !closed.has(d.id),
  );
  return { scope: [...read.scope], source: read.members.map((id) => gw.reactor.get(id)!) };
}

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
      ...scoped(gw, now),
      currentSource: () => Promise.resolve(scoped(gw, now).source),
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
    const ground = [...readGround(gw, now)];
    const { scope, source: full } = scoped(gw, now);
    const source = full.filter((d) => d.id !== latest.id);
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
      scope,
      source,
      currentSource: () => Promise.resolve(source),
    });
    expect(answer).toMatchObject({ status: "completed", view: { height: 30 } });
    if (answer.status === "completed") expect(answer.viewDigest).not.toBe(native.hex);
    await gw.close();
  });
});

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

describe("M5 slice 1: a child reading pinned by hash", () => {
  // The Bed program with its child reading pinned by hash, not named. Native evaluation resolves
  // the pin through the registry, so the portable closure must carry the same signed Plant act.
  const pinned = {
    ...BED_WITH_PLANTS,
    name: "BedPinned",
    body: parseTerm({
      ...BED_WITH_PLANTS_JSON,
      reading: { pinned: schemaHash({ ...PLANT_READING, alg: 1 }) },
    }),
  };

  it("closes over the pinned reading's signed act and answers as native", async () => {
    const routes: Route[] = [];
    const gw = await publishedGarden(true, routes);
    await gw.append([planting]);
    await gw.publishRegistration(pinned, { ...BED_READING, name: "BedPinned" }, [BED], {
      actor: KEEPER_SEED,
    });
    const now = gw.now();
    const native = gw.resolvedNode("BedPinned", BED, undefined, now);
    expect(native.view).toMatchObject({ plants: { height: 34 } });
    const read = await gw.readNode("BedPinned", BED, undefined, now);
    expect(routes).toEqual([{ lens: "BedPinned", entity: BED, route: "portable" }]);
    expect(read.view).toEqual(native.view);
    expect(read.hex).toBe(native.hex);
    await gw.close();
  });
});

describe("M5 schedule 5: another SQLite handle changes the store", () => {
  // A journal-backed store, and a second connection that writes beside the gateway. Rows changed
  // through that connection never pass the gateway, so only the store's own revision can show it.
  const height34 = garden.find((d) => d.claims.timestamp === 2000)!;
  const replacement = observed(FERN, "height", 77, 2500, GARDENER_SEED);

  async function durable(path: string) {
    const backend = new SqliteBackend(path);
    const gw = await Gateway.boot(backend, assembleGenesis({ operatorSeed: KEEPER_SEED }), {
      peerStore: backend.journalStore(),
      portableReads: true,
    });
    return { backend, gw };
  }

  const schedules: [string, (db: Database.Database) => void][] = [
    ["deletes a row", (db) => db.prepare("DELETE FROM deltas WHERE id = ?").run(height34.id)],
    [
      "replaces a row, keeping the count",
      (db) =>
        db.transaction(() => {
          db.prepare("DELETE FROM deltas WHERE id = ?").run(height34.id);
          db.prepare("INSERT INTO deltas (id, claims, sig) VALUES (?, ?, ?)").run(
            replacement.id,
            JSON.stringify(claimsToJson(replacement.claims)),
            replacement.sig ?? null,
          );
        })(),
    ],
  ];

  for (const [name, change] of schedules) {
    it(`when it ${name}, reads refuse until reopen, then read the store's inventory`, async () => {
      const path = join(mkdtempSync(join(tmpdir(), "loam-m5-external-")), "s.sqlite");
      const first = await durable(path);
      await first.gw.append(governedBootstrap(KEEPER_SEED));
      await first.gw.append(garden);
      await first.gw.publishRegistration(PLANT, PLANT_READING, [FERN], { actor: KEEPER_SEED });
      const route = classifyPortableRead(first.gw, "Plant", FERN, first.gw.now());
      expect(route.route).toBe("portable");
      if (route.route !== "portable") return;

      const db = new Database(path);
      change(db);
      db.close();
      expect(await first.backend.holds(height34.id)).toBe(false);

      // The read prepared before the change refuses at its final source check.
      expect(await runPortableRead(route.signer, route.prepared)).toMatchObject({
        status: "refused",
        stage: "gather",
        code: "source-unavailable",
      });
      // A new read refuses too: memory still holds the row, and it cannot vouch for the store.
      await expect(first.gw.readNode("Plant", FERN)).rejects.toThrow(/source-unavailable/);
      await first.gw.close();
      await first.backend.close();

      // Reopened, the gateway reads the store as it is: the removed height is gone, the tag stays,
      // and a row the journal never admitted is held but never served.
      const second = await durable(path);
      const read = await second.gw.readNode("Plant", FERN);
      expect(read.view["height"]).toBe(30);
      expect(read.view["tag"]).toContain("shade");
      expect(read.hex).toBe(second.gw.resolvedNode("Plant", FERN).hex);
      await second.gw.close();
      await second.backend.close();
    });
  }
});
