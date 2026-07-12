// SPEC §2, "The reactor": named, rooted materializations kept current on each ingest, and
// subscribe as push change-notification. Dynamic view = subscription; ingest is idempotent,
// forgery is rejected, and order of arrival cannot change the materialized truth. This file
// also confirms the exact seam step 3 stands on: resolveView over a materializedView equals
// the batch-eval path, and negation flows through the live read.

import { describe, expect, it } from "vitest";
import {
  DeltaSet,
  evalTerm,
  makeDelta,
  makeNegationClaims,
  resolveView,
  resultCanonicalHex,
  viewCanonicalHex,
  type Delta,
  type MaterializationChange,
  type Schema,
} from "@bombadil/rhizomatic";
import {
  FERN,
  GARDENER,
  GARDENER_SEED,
  PLANT_BODY,
  SURVEYOR_SEED,
  observed,
  plantReactor,
} from "./garden.js";

const height30 = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const height34 = observed(FERN, "height", 34, 2000, SURVEYOR_SEED); // same bucket as height30
const tag = observed(FERN, "tag", "shade", 1500, SURVEYOR_SEED);
const elsewhere = observed("plant:moss", "height", 2, 1200, SURVEYOR_SEED);

const latest: Schema = {
  props: new Map(),
  default: { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } },
};

// Ground truth: batch-evaluate the same term over a bare DeltaSet.
function batchHex(deltas: readonly Delta[]): string {
  return resultCanonicalHex(evalTerm(PLANT_BODY, DeltaSet.from(deltas), FERN));
}

function watched(): { reactor: ReturnType<typeof plantReactor>; changes: MaterializationChange[] } {
  const reactor = plantReactor();
  const changes: MaterializationChange[] = [];
  reactor.subscribe("plant", (c) => changes.push(c));
  return { reactor, changes };
}

describe("spike: reactor materializations + subscribe", () => {
  it("a materialization stays current on ingest, agreeing with batch evaluation", () => {
    const { reactor } = watched();
    expect(reactor.ingest(height30)).toEqual({ status: "accepted" });
    expect(reactor.materializedView("plant", FERN)?.props.get("height")).toHaveLength(1);
    expect(reactor.materializedHex("plant", FERN)).toBe(batchHex([height30]));
    reactor.ingest(tag);
    expect(reactor.materializedHex("plant", FERN)).toBe(batchHex([height30, tag]));
  });

  it("subscribe pushes a MaterializationChange naming what moved, why, and the true new hex", () => {
    const { reactor, changes } = watched();
    reactor.ingest(height30);
    expect(changes).toEqual([
      {
        materialization: "plant",
        root: FERN,
        changedProps: ["height"],
        responsibleDeltaIds: [height30.id],
        newHex: batchHex([height30]), // ground truth, not the reactor's own readback
      },
    ]);
  });

  it("every subscriber hears the change, and the raw stream carries each accepted delta once", () => {
    const reactor = plantReactor();
    const first: MaterializationChange[] = [];
    const second: MaterializationChange[] = [];
    const raw: Delta[] = [];
    reactor.subscribe("plant", (c) => first.push(c));
    reactor.subscribe("plant", (c) => second.push(c));
    reactor.subscribeRaw((d) => raw.push(d));

    reactor.ingest(height30);
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(raw.map((d) => d.id)).toEqual([height30.id]);

    reactor.ingest(height30); // duplicate: silent everywhere
    const forged: Delta = { ...height34, id: `1e20${"00".repeat(32)}` };
    expect(reactor.ingest(forged).status).toBe("rejected"); // forgery: silent everywhere
    expect(first).toHaveLength(1);
    expect(raw).toHaveLength(1);
  });

  it("irrelevant deltas move nothing: no event, no re-evaluation, same hex", () => {
    const { reactor, changes } = watched();
    reactor.ingest(height30);
    const hex = reactor.materializedHex("plant", FERN);
    const evals = reactor.evalCountOf("plant");
    changes.length = 0;
    expect(reactor.ingest(elsewhere).status).toBe("accepted");
    expect(changes).toEqual([]);
    expect(reactor.evalCountOf("plant")).toBe(evals); // root-anchored term: not even re-evaluated
    expect(reactor.materializedHex("plant", FERN)).toBe(hex);
  });

  it("registration after ingest backfills from the already-settled ground", () => {
    const reactor = plantReactor(); // "plant" watches; "late" does not exist yet
    reactor.ingest(height30);
    reactor.ingest(tag);
    reactor.register("late", PLANT_BODY, [FERN]);
    expect(reactor.materializedHex("late", FERN)).toBe(batchHex([height30, tag]));
  });

  it("negation flows through the live read: the value disappears, subscribers hear it", () => {
    const { reactor, changes } = watched();
    reactor.ingest(height30);
    reactor.ingest(height34);
    const before = resolveView(latest, reactor.materializedView("plant", FERN)!);
    expect((before as Record<string, unknown>)["height"]).toBe(34);

    changes.length = 0;
    reactor.ingest(makeDelta(makeNegationClaims(GARDENER, 3000, height34.id)));
    expect(changes).toHaveLength(1);
    expect(changes[0]!.changedProps).toContain("height");
    const after = resolveView(latest, reactor.materializedView("plant", FERN)!);
    expect((after as Record<string, unknown>)["height"]).toBe(30); // the negated claim is gone
  });

  it("the gateway seam: resolveView over a materializedView equals the batch-eval path", () => {
    const { reactor } = watched();
    for (const d of [height30, height34, tag]) reactor.ingest(d);
    const liveResult = resolveView(latest, reactor.materializedView("plant", FERN)!);

    const batch = evalTerm(PLANT_BODY, DeltaSet.from([height30, height34, tag]), FERN);
    if (batch.sort !== "hview") throw new Error(`expected an hview, got ${batch.sort}`);
    const batchResult = resolveView(latest, batch.hview);

    expect(viewCanonicalHex(liveResult)).toBe(viewCanonicalHex(batchResult));
    expect((liveResult as Record<string, unknown>)["height"]).toBe(34);
  });

  it("arrival order cannot change the materialized truth, even within one bucket", () => {
    const ab = plantReactor();
    const ba = plantReactor();
    for (const d of [height30, height34, tag]) ab.ingest(d);
    for (const d of [tag, height34, height30]) ba.ingest(d);
    expect(ab.materializedHex("plant", FERN)).toBe(ba.materializedHex("plant", FERN));
    expect(ab.materializedHex("plant", FERN)).toBe(batchHex([height30, height34, tag]));
  });
});
