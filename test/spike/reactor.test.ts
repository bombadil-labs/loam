// SPEC §2, "The reactor": named, rooted materializations kept current on each ingest, and
// subscribe as push change-notification. Dynamic view = subscription; ingest is idempotent,
// forgery is rejected, and order of arrival cannot change the materialized truth.

import { describe, expect, it } from "vitest";
import { Reactor, type Delta, type MaterializationChange } from "@bombadil/rhizomatic";
import { FERN, GARDENER_SEED, PLANT_BODY, SURVEYOR_SEED, observed } from "./garden.js";

const height = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const tag = observed(FERN, "tag", "shade", 1500, SURVEYOR_SEED);
const elsewhere = observed("plant:moss", "height", 2, 1200, SURVEYOR_SEED);

function watchedReactor(): { reactor: Reactor; changes: MaterializationChange[] } {
  const reactor = new Reactor();
  reactor.register("plant", PLANT_BODY, [FERN]);
  const changes: MaterializationChange[] = [];
  reactor.subscribe("plant", (c) => changes.push(c));
  return { reactor, changes };
}

describe("spike: reactor materializations + subscribe", () => {
  it("a materialization stays current on ingest", () => {
    const { reactor } = watchedReactor();
    expect(reactor.ingest(height)).toEqual({ status: "accepted" });
    const view = reactor.materializedView("plant", FERN);
    expect(view?.props.get("height")).toHaveLength(1);
    const before = reactor.materializedHex("plant", FERN);
    reactor.ingest(tag);
    expect(reactor.materializedHex("plant", FERN)).not.toBe(before);
  });

  it("subscribe pushes a MaterializationChange naming what moved and why", () => {
    const { reactor, changes } = watchedReactor();
    reactor.ingest(height);
    expect(changes).toEqual([
      {
        materialization: "plant",
        root: FERN,
        changedProps: ["height"],
        responsibleDeltaIds: [height.id],
        newHex: reactor.materializedHex("plant", FERN),
      },
    ]);
  });

  it("irrelevant deltas move nothing: no event, same hex", () => {
    const { reactor, changes } = watchedReactor();
    reactor.ingest(height);
    const hex = reactor.materializedHex("plant", FERN);
    changes.length = 0;
    expect(reactor.ingest(elsewhere).status).toBe("accepted");
    expect(changes).toEqual([]);
    expect(reactor.materializedHex("plant", FERN)).toBe(hex);
  });

  it("duplicate ingest is acknowledged and silent", () => {
    const { reactor, changes } = watchedReactor();
    reactor.ingest(height);
    changes.length = 0;
    expect(reactor.ingest(height)).toEqual({ status: "duplicate" });
    expect(changes).toEqual([]);
  });

  it("a forged content address is rejected, leaving no trace", () => {
    const { reactor } = watchedReactor();
    const forged: Delta = { ...height, id: `1e20${"00".repeat(32)}` };
    expect(reactor.ingest(forged).status).toBe("rejected");
    expect(reactor.size).toBe(0);
  });

  it("arrival order cannot change the materialized truth", () => {
    const { reactor: ab } = watchedReactor();
    const { reactor: ba } = watchedReactor();
    ab.ingest(height);
    ab.ingest(tag);
    ba.ingest(tag);
    ba.ingest(height);
    expect(ab.materializedHex("plant", FERN)).toBe(ba.materializedHex("plant", FERN));
  });
});
