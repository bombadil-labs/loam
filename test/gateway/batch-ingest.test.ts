// An admitted batch enters the reactor as one update, so a warm view refreshes once per batch and
// not once per delta. The rail asserts both levels: the reactor saw one batch (delta level), and
// the View equals the one a delta-at-a-time store answers (object level).

import { describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_READING, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);

async function published(): Promise<Gateway> {
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

const facts = Array.from({ length: 40 }, (_, n) =>
  observed(FERN, "height", n, 5000 + n, GARDENER_SEED),
);

describe("batch ingest", () => {
  it("takes an admitted batch as one reactor update and answers the same View", async () => {
    const together = await published();
    const changes = { together: 0, apart: 0 };
    together.reactor.subscribe(together.matName("Plant"), () => void (changes.together += 1));
    const batch = vi.spyOn(together.reactor, "ingestBatch");
    const single = vi.spyOn(together.reactor, "ingest");
    const receipt = await together.append([...facts, facts[0]!]);
    expect(receipt).toEqual({ accepted: 40, duplicates: 1 });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0]![0]).toHaveLength(40);
    expect(single).not.toHaveBeenCalled();

    const apart = await published();
    apart.reactor.subscribe(apart.matName("Plant"), () => void (changes.apart += 1));
    for (const d of facts) await apart.append([d]);
    // The warm view refreshed once for the batch, and once per delta when they came apart.
    expect(changes).toEqual({ together: 1, apart: 40 });
    expect(together.reactor.materializedView(together.matName("Plant"), FERN)).toBeDefined();
    const now = Math.max(together.now(), apart.now());
    const a = together.resolvedNode("Plant", FERN, undefined, now);
    const b = apart.resolvedNode("Plant", FERN, undefined, now);
    expect(a.view).toEqual(b.view);
    expect(a.hex).toBe(b.hex);
    expect(a.view).toMatchObject({ height: 39 });
    await together.close();
    await apart.close();
  });

  it("control: a batch of only held deltas is all duplicates and reaches no reactor update", async () => {
    const gw = await published();
    await gw.append(facts.slice(0, 3));
    const batch = vi.spyOn(gw.reactor, "ingestBatch");
    expect(await gw.append(facts.slice(0, 3))).toEqual({ accepted: 0, duplicates: 3 });
    expect(batch).not.toHaveBeenCalled();
    await gw.close();
  });

  it("a refused batch takes each member's own verdict, and attests only what landed", async () => {
    const gw = await published();
    const [a, b] = [facts[0]!, facts[1]!];
    vi.spyOn(gw.reactor, "ingestBatch").mockReturnValue({ status: "rejected", reason: "fixture" });
    const ingest = gw.reactor.ingest.bind(gw.reactor);
    vi.spyOn(gw.reactor, "ingest").mockImplementation((d) =>
      d.id === a.id ? { status: "rejected", reason: "fixture" } : ingest(d),
    );
    const report = await gw.federate([a, b], { ids: true, admittedIds: true, admit: () => true });
    expect(report.acceptedIds).toEqual([b.id]);
    expect(report.admittedIds).toEqual([b.id]);
    expect(gw.reactor.get(a.id)).toBeUndefined();
    vi.restoreAllMocks();
    await gw.close();
  });

  it("a claim and its strike in one batch never show the claim", async () => {
    const gw = await published();
    const views: unknown[] = [];
    gw.reactor.subscribe(gw.matName("Plant"), () =>
      views.push(gw.reactor.materializedView(gw.matName("Plant"), FERN)),
    );
    const claim = observed(FERN, "height", 555, 9000, GARDENER_SEED);
    const strike = signClaims(
      makeNegationClaims(authorForSeed(GARDENER_SEED), 9001, claim.id),
      GARDENER_SEED,
    );
    await gw.append([claim, strike]);
    // Together they leave the view as it was, so it emits no frame at all. One at a time, the
    // claim's frame would show 555 before the strike's frame withdrew it.
    expect(views).toEqual([]);
    expect(gw.resolvedNode("Plant", FERN, undefined, gw.now()).view["height"]).not.toBe(555);
    await gw.close();
  });
});
