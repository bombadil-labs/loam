// M5 schedules on the portable door: a source change in flight, validity crossed by explicit time,
// and capacity at the input boundary. Each case reads both routes and names which route ran.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { classifyPortableRead } from "../../src/gateway/portable-door.js";
import { primaryGroundImpl } from "../../src/gateway/reads.js";
import { runPortableRead } from "../../src/gateway/portable-read.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { BED, BED_READING, BED_WITH_PLANTS, planting } from "./m5-fixtures.js";
import { OP_SEED, standSlate } from "../gateway/slating.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_READING,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
} from "../gateway/fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
type Route = { lens: string; route: string; reason?: string };

async function store(portableReads: boolean, routes?: Route[], facts: Delta[] = garden) {
  const gw = await Gateway.open(new MemoryBackend(), {
    seed: KEEPER_SEED,
    portableReads,
    ...(routes === undefined ? {} : { onReadRoute: (r: Route) => void routes.push(r) }),
  });
  await gw.append(governedBootstrap(KEEPER_SEED));
  await gw.append(facts);
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

// A moss height that holds only inside [validFrom, validUntil). Timestamp and validity are
// independent: it was said in the past and holds in the future.
const MOSS = "plant:moss";
const mossHeight = (value: number, timestamp: number, from: number, until?: number): Delta =>
  signClaims(
    {
      author: authorForSeed(GARDENER_SEED),
      timestamp,
      validFrom: from,
      ...(until === undefined ? {} : { validUntil: until }),
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: MOSS, context: "height" } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    GARDENER_SEED,
  );

describe("M5 schedule 5: a source change in flight refuses, the next read sees it", () => {
  it("a prepared read whose source moved before dispatch refuses visibly, once", async () => {
    const gw = await store(true);
    const now = gw.now();
    const route = classifyPortableRead(gw, "Plant", FERN, now);
    expect(route.route).toBe("portable");
    if (route.route !== "portable") return;
    // The source moves after the read was frozen and before it runs.
    await gw.append([observed(FERN, "height", 99, now - 1, GARDENER_SEED)]);
    const answer = await runPortableRead(route.signer, route.prepared);
    expect(answer).toMatchObject({ status: "refused", stage: "gather", code: "source-changed" });
    // The next read takes a new basis and sees the new fact, on the portable route.
    const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(res.errors).toBeUndefined();
    expect(res.data).toEqual({ plant: { height: 99 } });
    await gw.close();
  });
});

describe("M5 schedule 6: explicit time crosses validity without ingest", () => {
  it("two reads at distinct times answer as native does at each time, on the portable route", async () => {
    const routes: Route[] = [];
    const native = await store(false),
      portable = await store(true, routes);
    // Moss is not a registered root, so the native read evaluates cold at each explicit time.
    const base = Math.max(native.now(), portable.now());
    const facts = [
      mossHeight(10, base - 2, base - 2),
      mossHeight(50, base - 1, base + 2000, base + 4000),
    ];
    await native.append(facts);
    await portable.append(facts);
    const answers: Record<number, unknown> = {};
    for (const t of [base + 3000, base + 5000]) {
      const a = await portable.readNode("Plant", MOSS, undefined, t),
        b = native.resolvedNode("Plant", MOSS, undefined, t);
      expect(a.view).toEqual(b.view);
      expect(a.hex).toBe(b.hex);
      answers[t] = a.view["height"];
    }
    expect(answers).toEqual({ [base + 3000]: 50, [base + 5000]: 10 });
    expect(routes.map((r) => r.route)).toEqual(["portable", "portable"]);
    await native.close();
    await portable.close();
  });
});

describe("M5 schedule 8: input capacity is decided before dispatch", () => {
  it("4096 source appearances run portable; 4097 stay native; both answer as native", async () => {
    // The limit counts the snapshot's appearances: every delta of the authorized source, law
    // included, since definition acts are members of the ground.
    const routes: Route[] = [];
    const gw = await store(true, routes);
    const now = gw.now();
    const size = () => [...primaryGroundImpl(gw, now)].length;
    const fill = (from: number, count: number) =>
      Array.from({ length: count }, (_, n) =>
        observed(`plant:filler-${from + n}`, "height", n, 1000 + from + n, GARDENER_SEED),
      );
    await gw.append(fill(0, 4096 - size()));
    expect(size()).toBe(4096);
    const exact = await gw.readNode("Plant", FERN, undefined, now);
    expect(routes.at(-1)).toEqual({ lens: "Plant", entity: FERN, route: "portable" });
    expect(exact.hex).toBe(gw.resolvedNode("Plant", FERN, undefined, now).hex);

    await gw.append(fill(4096, 1));
    expect(size()).toBe(4097);
    expect(classifyPortableRead(gw, "Plant", FERN, now)).toEqual({
      route: "native",
      reason: "input-capacity",
    });
    const over = await gw.readNode("Plant", FERN, undefined, now);
    expect(routes.at(-1)).toEqual({
      lens: "Plant",
      entity: FERN,
      route: "native",
      reason: "input-capacity",
    });
    expect(over.hex).toBe(gw.resolvedNode("Plant", FERN, undefined, now).hex);
    expect(over.view).toEqual(exact.view);
    await gw.close();
  }, 300_000);
});

describe("M5 schedule 9: concurrent preparations keep their own basis", () => {
  it("a stale preparation fails once; a preparation on the new basis succeeds", async () => {
    const gw = await store(true);
    await gw.append([mossHeight(10, gw.now() - 1, gw.now() - 1)]);
    const now = gw.now();
    const stale = classifyPortableRead(gw, "Plant", FERN, now);
    // The source moves; the moss read is prepared after it, on the new basis.
    await gw.append([observed(FERN, "height", 77, now - 1, GARDENER_SEED)]);
    const later = gw.now();
    const fresh = classifyPortableRead(gw, "Plant", MOSS, later);
    if (stale.route !== "portable" || fresh.route !== "portable") throw new Error("not portable");
    const [a, b] = await Promise.all([
      runPortableRead(stale.signer, stale.prepared),
      runPortableRead(fresh.signer, fresh.prepared),
    ]);
    expect(a).toMatchObject({ status: "refused", code: "source-changed" });
    expect(b).toMatchObject({ status: "completed", view: { height: 10 } });
    await gw.close();
  });
});

describe("M5 schedules 2 and 7: a durable store reopens and reads from its published acts", () => {
  it("after close and reopen, a fresh Bed read runs portable and matches native", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "loam-m5-reopen-")), "s.sqlite");
    const genesis = assembleGenesis({ operatorSeed: KEEPER_SEED });
    const open = async (routes?: Route[]) => {
      const backend = new SqliteBackend(path);
      const gw = await Gateway.boot(backend, genesis, {
        peerStore: backend.journalStore(),
        portableReads: true,
        ...(routes === undefined ? {} : { onReadRoute: (r: Route) => void routes.push(r) }),
      });
      return { backend, gw };
    };
    const first = await open();
    await first.gw.append(governedBootstrap(KEEPER_SEED));
    await first.gw.append([...garden, planting]);
    await first.gw.publishRegistration(PLANT, PLANT_READING, [FERN], { actor: KEEPER_SEED });
    await first.gw.publishRegistration(BED_WITH_PLANTS, BED_READING, [BED], { actor: KEEPER_SEED });
    const before = await first.gw.readNode("BedWithPlants", BED);
    await first.gw.close();
    await first.backend.close();

    // A fresh process: no native registration or cache survives; law is refolded from the journal.
    const routes: Route[] = [];
    const second = await open(routes);
    const now = second.gw.now();
    const after = await second.gw.readNode("BedWithPlants", BED, undefined, now);
    expect(routes).toEqual([{ lens: "BedWithPlants", entity: BED, route: "portable" }]);
    expect(after.view).toEqual(before.view);
    expect(after.hex).toBe(second.gw.resolvedNode("BedWithPlants", BED, undefined, now).hex);
    expect(after.view).toMatchObject({ plants: { height: 34, readings: 2 } });
    await second.gw.close();
    await second.backend.close();
  });
});

describe("M5 schedule 1: bytes and negation answer the same on both routes", () => {
  it("a struck fact and a bytes value give the native View and HView, through the package", async () => {
    const routes: Route[] = [];
    const native = await store(false),
      portable = await store(true, routes);
    const base = Math.max(native.now(), portable.now());
    const tall = mossHeight(90, base - 3, base - 3);
    const blob = signClaims(
      {
        author: authorForSeed(GARDENER_SEED),
        timestamp: base - 2,
        validFrom: base - 2,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: MOSS, context: "payload" } } },
          {
            role: "value",
            target: {
              kind: "bytes",
              mime: "application/octet-stream",
              value: new Uint8Array([0, 255, 1]),
            },
          },
        ],
      },
      GARDENER_SEED,
    );
    const strike = signClaims(
      makeNegationClaims(authorForSeed(GARDENER_SEED), base - 1, tall.id),
      GARDENER_SEED,
    );
    const facts = [mossHeight(10, base - 4, base - 4), tall, blob, strike];
    await native.append(facts);
    await portable.append(facts);
    const t = base + 1;
    const a = await portable.readNode("Plant", MOSS, undefined, t),
      b = native.resolvedNode("Plant", MOSS, undefined, t);
    expect(routes.map((r) => r.route)).toEqual(["portable"]);
    expect(a.view).toMatchObject({ height: 10 });
    expect(a.view).toEqual(b.view);
    expect(a.hex).toBe(b.hex);
    expect(a.hviewHex).toBe(b.hviewHex);
    await native.close();
    await portable.close();
  });
});

describe("M5 schedule 4: read closure narrows present and historical portable reads", () => {
  it("a read-closed fact is gone from both reads; an unrelated fact survives", async () => {
    const genesis = assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    });
    const routes: Route[] = [];
    const native = await Gateway.boot(new MemoryBackend(), genesis),
      portable = await Gateway.boot(new MemoryBackend(), genesis, {
        portableReads: true,
        onReadRoute: (r: Route) => void routes.push(r),
      });
    const member = observed(FERN, "height", 30, 1000, OP_SEED),
      bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    for (const gw of [native, portable]) {
      await gw.append([member, bystander]);
      await standSlate(gw, { members: [member], closes: ["read"] });
    }
    for (const asOf of [undefined, 1500]) {
      const now = portable.now();
      const a = await portable.readNode("Plant", FERN, asOf, now),
        b = native.resolvedNode("Plant", FERN, asOf, now);
      expect(a.view["height"]).toBeUndefined();
      expect(a.view["tag"]).toEqual(["shade"]);
      expect(a.view).toEqual(b.view);
      expect(a.hex).toBe(b.hex);
    }
    expect(routes.map((r) => [r.route, r.reason])).toEqual([
      ["portable", undefined],
      ["portable", undefined],
    ]);
    await native.close();
    await portable.close();
  });
});

describe("M5 schedule 3: a bucket resolver sees the full evidence on the portable route", () => {
  it("a readings resolver counts values 7 and 9 as 2, on Plant and on the Bed's child", async () => {
    const COUNT = {
      readings: {
        code: "export default (b) => b.length",
        rung: "a" as const,
        type: "number" as const,
      },
    };
    const open = async (portableReads: boolean, routes?: Route[]) => {
      const gw = await Gateway.open(new MemoryBackend(), {
        seed: KEEPER_SEED,
        portableReads,
        ...(routes === undefined ? {} : { onReadRoute: (r: Route) => void routes.push(r) }),
      });
      await gw.append(governedBootstrap(KEEPER_SEED));
      await gw.append([...garden, planting]);
      await gw.publishRegistration(
        PLANT,
        PLANT_READING,
        [FERN],
        { actor: KEEPER_SEED },
        undefined,
        undefined,
        PLANT_WRITABLE,
        COUNT,
      );
      await gw.publishRegistration(BED_WITH_PLANTS, BED_READING, [BED], { actor: KEEPER_SEED });
      return gw;
    };
    const routes: Route[] = [];
    const native = await open(false),
      portable = await open(true, routes);
    const now = portable.now();
    for (const [lens, entity] of [
      ["Plant", FERN],
      ["BedWithPlants", BED],
    ] as const) {
      const a = await portable.readNode(lens, entity, undefined, now),
        b = native.resolvedNode(lens, entity, undefined, now);
      expect(a.view).toEqual(b.view);
      expect(a.hex).toBe(b.hex);
    }
    expect((await portable.readNode("Plant", FERN, undefined, now)).view).toMatchObject({
      readings: 2,
    });
    expect((await portable.readNode("BedWithPlants", BED, undefined, now)).view).toMatchObject({
      plants: { readings: 2 },
    });
    expect(routes.every((r) => r.route === "portable")).toBe(true);
    await native.close();
    await portable.close();
  });
});

describe("M5 schedule 7: an unavailable source refuses", () => {
  it("a read whose present source cannot be read refuses source-unavailable, with no fallback", async () => {
    const gw = await store(true);
    const route = classifyPortableRead(gw, "Plant", FERN, gw.now());
    expect(route.route).toBe("portable");
    if (route.route !== "portable") return;
    const unavailable = {
      ...route.prepared,
      invocation: {
        ...route.prepared.invocation,
        currentSource: (): readonly Delta[] => {
          throw new Error("the journal is gone");
        },
      },
    };
    const answer = await runPortableRead(route.signer, unavailable);
    expect(answer).toMatchObject({
      status: "refused",
      stage: "gather",
      code: "source-unavailable",
    });
    // The same prepared read with its source readable completes: the refusal is the source's.
    expect(await runPortableRead(route.signer, route.prepared)).toMatchObject({
      status: "completed",
    });
    await gw.close();
  });
});
