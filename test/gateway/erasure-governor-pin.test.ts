import { describe, expect, it } from "vitest";
import { Reactor, authorForSeed, signClaims } from "@bombadil/rhizomatic";
import {
  eraseClaims,
  erasedFromReading,
  pinErasureGovernors,
} from "../../src/gateway/erase-law.js";
import { GARDENER_SEED, observed } from "../spike/garden.js";

const HOST_SEED = "e1".repeat(32),
  POOL_SEED = "e2".repeat(32);
const HOST = authorForSeed(HOST_SEED),
  POOL = authorForSeed(POOL_SEED);

describe("erasure governor pins", () => {
  it("a pin after the first read takes effect on the next read", () => {
    const reactor = new Reactor();
    const target = observed("plant:fern", "height", 30, 1000, GARDENER_SEED);
    const bystander = observed("plant:fern", "tag", "shade", 1001, GARDENER_SEED);
    const order = signClaims(
      eraseClaims(target.id, target.claims.author, HOST, 2000, undefined, undefined, POOL),
      HOST_SEED,
    );
    for (const d of [target, bystander, order]) expect(reactor.ingest(d).status).toBe("accepted");

    expect(erasedFromReading(reactor, POOL).has(target.id)).toBe(false);

    pinErasureGovernors(reactor, [HOST]);
    const erased = erasedFromReading(reactor, POOL);
    expect(erased.has(target.id)).toBe(true);
    expect(erased.has(bystander.id)).toBe(false);
  });
});
