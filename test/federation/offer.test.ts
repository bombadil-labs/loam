// The frozen offer (SPEC §15, continuity): an export is a federation offer with the clock
// stopped — `{ deltas: WireDelta[] }`, BYTE-IDENTICAL to what `GET /federate` serves, ids and
// signatures intact — so migration never launders provenance. exportOffer is the writing half;
// parseOffer is the reading half; and the served door is the reference implementation both are
// held against.

import { describe, expect, it, vi } from "vitest";
import { exportOffer, parseOffer } from "../../src/federation/offer.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve } from "../../src/server/http.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 15000 }); // one real HTTP server rides this suite

const OPERATOR_SEED = "0e".repeat(32);

describe("exportOffer: the store walks out as bytes", () => {
  it("is byte-identical to the served /federate body — the door is the reference", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append(assembleGenesis({ operatorSeed: OPERATOR_SEED }).deltas);
    await gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]);

    const server = await serve({
      mounts: { tab: gateway },
      tokens: { "op-token": { operator: true } },
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const res = await fetch(`${server.url}/tab/federate`, {
        headers: { authorization: "Bearer op-token" },
      });
      expect(res.status).toBe(200);
      expect(exportOffer(gateway)).toBe(await res.text());
    } finally {
      await server.close();
      await gateway.close();
    }
  });

  it("round-trips: parseOffer(exportOffer(g)) is the store's own deltas, verified", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]);
    const back = parseOffer(exportOffer(gateway));
    expect(back.map((d) => d.id).sort()).toEqual(
      gateway
        .offeredDeltas()
        .map((d) => d.id)
        .sort(),
    );
    await gateway.close();
  });

  it("an offered lens shapes the export exactly as it shapes the door", async () => {
    // The export is offeredDeltas() frozen — so a store that keeps its grumbles home keeps
    // them out of the file too, with no second mechanism to drift.
    const { parseTerm } = await import("@bombadil/rhizomatic");
    const lens = parseTerm({
      op: "select",
      pred: { not: { hasPointer: { context: { exact: "grumbles" } } } },
      in: { op: "mask", policy: "drop", in: "input" },
    });
    const gateway = await Gateway.open(new MemoryBackend(), {
      seed: OPERATOR_SEED,
      offeredLens: lens,
    });
    await gateway.append([
      observed(FERN, "height", 30, 1000, OPERATOR_SEED),
      observed(FERN, "grumbles", "the aphids again", 2000, OPERATOR_SEED),
    ]);
    const offered = parseOffer(exportOffer(gateway));
    expect(offered).toHaveLength(1);
    expect(JSON.stringify(offered)).not.toContain("aphids");
    await gateway.close();
  });

  it("parseOffer refuses what is not an offer, and what does not recompute", async () => {
    expect(() => parseOffer("not json")).toThrow(/offer/);
    expect(() => parseOffer(`{"nope":[]}`)).toThrow(/deltas/);
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([observed(FERN, "height", 30, 1000, OPERATOR_SEED)]);
    const tampered = exportOffer(gateway).replace('"height"', '"weight"');
    expect(() => parseOffer(tampered)).toThrow(/does not recompute/); // a forgery cannot survive the crossing
    await gateway.close();
  });
});
