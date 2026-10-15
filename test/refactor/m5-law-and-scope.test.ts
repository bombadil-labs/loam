// M5 slice 4 rails: the portable door judges law as native law does, a slate that lands while a
// read is in flight refuses that read, and an as-of read cuts its scoped operands at the cut.
// Each case compares the portable answer with the native answer on the same ground and time.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { classifyPortableRead } from "../../src/gateway/portable-door.js";
import { runPortableRead } from "../../src/gateway/portable-read.js";
import { MemoryBackend } from "../../src/store/memory.js";
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

async function bedStore(routes: Route[]): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), {
    seed: KEEPER_SEED,
    portableReads: true,
    onReadRoute: (r: Route) => void routes.push(r),
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
  );
  await gw.publishRegistration(BED_WITH_PLANTS, BED_READING, [BED], { actor: KEEPER_SEED });
  return gw;
}

/** The published act that carries the Plant reading's definition. */
function plantReadingAct(gw: Gateway): Delta {
  const act = gw.reactor
    .byTarget("schema:Plant")
    .map((id) => gw.reactor.get(id)!)
    .find((d) => d.claims.pointers.some((p) => p.role === "rhizomatic.schema.term"));
  if (act === undefined) throw Error("no published Plant reading act");
  return act;
}

const strike = (
  seed: string,
  timestamp: number,
  target: string,
  window: { validFrom?: number; validUntil?: number } = {},
): Delta =>
  signClaims({ ...makeNegationClaims(authorForSeed(seed), timestamp, target), ...window }, seed);

async function bothRoutesAgree(gw: Gateway, routes: Route[]): Promise<void> {
  const now = gw.now();
  for (const [lens, entity] of [
    ["Plant", FERN],
    ["BedWithPlants", BED],
  ] as const) {
    const portable = await gw.readNode(lens, entity, undefined, now);
    const native = gw.resolvedNode(lens, entity, undefined, now);
    expect(routes.at(-1)).toEqual({ lens, entity, route: "portable" });
    expect(portable.hex).toBe(native.hex);
    expect(portable.view).toEqual(native.view);
  }
}

describe("M5 law selection matches native law", () => {
  it("a stranger's strike on a definition act retires nothing", async () => {
    const routes: Route[] = [];
    const gw = await bedStore(routes);
    await gw.append([strike(GARDENER_SEED, gw.now(), plantReadingAct(gw).id)]);
    await bothRoutesAgree(gw, routes);
    await gw.close();
  });

  it("an operator strike that is itself struck revives the act", async () => {
    const routes: Route[] = [];
    const gw = await bedStore(routes);
    const withdrawal = strike(KEEPER_SEED, gw.now(), plantReadingAct(gw).id);
    await gw.append([withdrawal]);
    await gw.append([strike(KEEPER_SEED, gw.now(), withdrawal.id)]);
    await bothRoutesAgree(gw, routes);
    await gw.close();
  });

  // Native law evaluates every strike in the chain at `now`, so a strike outside its own window
  // binds nothing yet, or nothing any longer.
  it("an operator strike that holds only in the future retires nothing now", async () => {
    const routes: Route[] = [];
    const gw = await bedStore(routes);
    const now = gw.now();
    await gw.append([
      strike(KEEPER_SEED, now, plantReadingAct(gw).id, { validFrom: now + 60_000 }),
    ]);
    await bothRoutesAgree(gw, routes);
    await gw.close();
  });

  it("an operator strike whose window has closed retires nothing now", async () => {
    const routes: Route[] = [];
    const gw = await bedStore(routes);
    const now = gw.now();
    await gw.append([
      strike(KEEPER_SEED, now - 2_000, plantReadingAct(gw).id, {
        validFrom: now - 2_000,
        validUntil: now - 1_000,
      }),
    ]);
    await bothRoutesAgree(gw, routes);
    await gw.close();
  });

  it("a strike of the withdrawal that holds only in the future does not revive the act yet", async () => {
    const routes: Route[] = [];
    const gw = await bedStore(routes);
    const now = gw.now();
    const withdrawal = strike(KEEPER_SEED, now, plantReadingAct(gw).id);
    await gw.append([withdrawal]);
    await gw.append([strike(KEEPER_SEED, now, withdrawal.id, { validFrom: now + 60_000 })]);
    // The withdrawal stands, so the Plant law is retired on both routes and neither read is portable.
    expect(classifyPortableRead(gw, "Plant", FERN, gw.now())).toEqual({
      route: "native",
      reason: "unpublished-law",
    });
    await gw.close();
  });
});

async function slateStore(portableReads: boolean): Promise<Gateway> {
  const genesis = assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });
  return Gateway.boot(new MemoryBackend(), genesis, { portableReads });
}

describe("M5 read closure lands in flight", () => {
  it("a slate closing a member after preparation refuses the read; the next read withholds it", async () => {
    const gw = await slateStore(true);
    const member = observed(FERN, "height", 30, 1000, OP_SEED),
      bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const now = gw.now();
    const route = classifyPortableRead(gw, "Plant", FERN, now);
    expect(route.route).toBe("portable");
    if (route.route !== "portable") return;
    // The slate points outside the read's scope. Only the read closure moves S(scope).
    await standSlate(gw, { members: [member], closes: ["read"] });
    const answer = await runPortableRead(route.signer, route.prepared);
    expect(answer).toMatchObject({ status: "refused", stage: "gather", code: "source-changed" });
    const next = await gw.readNode("Plant", FERN, undefined, gw.now());
    expect(next.view["height"]).toBeUndefined();
    expect(next.view["tag"]).toEqual(["shade"]);
    await gw.close();
  });
});

describe("M5 as-of reads cut their scoped operands", () => {
  it("a fact said after the cut is absent even when it holds before the cut", async () => {
    const native = await slateStore(false),
      portable = await slateStore(true);
    // Said at 1800, holding since 0: an as-of read at 1500 has not heard it yet.
    const late = observed(FERN, "height", 77, { timestamp: 1800, validFrom: 0 }, OP_SEED);
    const early = observed(FERN, "height", 30, 1000, OP_SEED);
    for (const gw of [native, portable]) await gw.append([early, late]);
    const now = portable.now();
    const route = classifyPortableRead(portable, "Plant", FERN, now, 1500);
    expect(route.route).toBe("portable");
    if (route.route === "portable")
      expect(route.prepared.invocation.source.map((d) => d.id)).not.toContain(late.id);
    const a = await portable.readNode("Plant", FERN, 1500, now),
      b = native.resolvedNode("Plant", FERN, 1500, now);
    expect(a.view["height"]).toEqual(b.view["height"]);
    expect(a.hex).toBe(b.hex);
    expect(JSON.stringify(a.view)).not.toContain("77");
    await native.close();
    await portable.close();
  });
});
