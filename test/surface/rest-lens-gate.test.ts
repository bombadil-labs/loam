// §17/§21.7 — the REST door's warm-path test must name the LENS, not the program (ticket T42's
// second site, `servesLive` in surface/rest.ts).
//
// The byte-door's sibling. `servesLive` decides whether a versioned read answers through the door's
// LIVE surface or through pinned resolution, and it asked `r.hyperschema.name === schemaName` while
// every path around it names the lens. In a §21.7 coexistence world the two names differ, so the
// live-surface test failed for BOTH readings and every versioned read fell through to pinned
// resolution.
//
// WHAT THIS RAIL CAN AND CANNOT SEE, stated plainly rather than implied. The two branches resolve
// the SAME registration for the latest version — pinned resolution applies that version's own schema
// and its own resolvers — so a correct implementation and the reverted one agree on the RESPONSE
// BODY. This rail therefore asserts the contract that is observable here: that both readings over
// one gather are independently addressable at the REST door and each answers under its OWN policy
// (the archival lens picking the oldest value, the broad lens the newest). It fails if the two
// readings are ever conflated into one — the failure the program-name comparison would produce if
// the surrounding code stopped compensating.
//
// THE GAP: this rail does NOT discriminate the `servesLive` line by itself, because warm and pinned
// resolution are semantically equal for the latest version by design. Closing it needs a rail that
// can observe WHICH path ran — a materialization counter or a resolver invocation probe — which the
// gateway does not expose today. Named here rather than papered over: an honest-looking header over
// a weaker test is how this class survives review, and this file's predecessor did exactly that.

import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { PLANT } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

const BROAD: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["height"] }],
    }),
  );
  await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
  return gw;
};

const viewOf = (r: { body: unknown }): Record<string, number> =>
  (r.body as { view: Record<string, number> }).view;

const get = (gw: Gateway, door: "full" | "public", lens: string) =>
  handleRest(gw, door, "GET", ["v1", lens, FERN], undefined, OP_SEED);

describe("§21.7 — the REST door addresses each coexisting reading under its own policy", () => {
  it("each lens answers under ITS OWN order — the readings are not conflated", async () => {
    const gw = await boot();
    const broad = await get(gw, "full", "Plant");
    const archival = await get(gw, "full", "PlantClassic");
    expect(broad.status).toBe(200);
    expect(archival.status).toBe(200);
    // The whole point of coexistence: one gather, two answers. `desc` takes the newest observation,
    // `asc` the oldest. If the door ever resolved both through one reading these would agree, which
    // is the observable shape of the two names being conflated.
    expect(viewOf(broad).height).toBe(99);
    expect(viewOf(archival).height).toBe(10);
    await gw.close();
  });

  it("the public door serves ONLY the declared reading, and the undeclared sibling is not addressable", async () => {
    const gw = await boot();
    await gw.declarePublic(["PlantClassic"]);
    const declared = await get(gw, "public", "PlantClassic");
    expect(declared.status).toBe(200);
    expect(viewOf(declared).height).toBe(10);
    // The undeclared sibling shares the program name, so a door that gated on the program would
    // serve it here. It must not be reachable at all.
    const undeclared = await get(gw, "public", "Plant");
    expect(undeclared.status).toBe(404);
    await gw.close();
  });
});
