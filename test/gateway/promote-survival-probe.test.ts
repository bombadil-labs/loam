// THE REPRODUCTION (T39) — does promotion check that its source SURVIVES, or only that it is
// PRESENT? One output, retracted by its own author inside the pool, offered to `promote`.
//
// `reactor.get` is PRESENCE: it says nothing about whether the delta still survives in the pool.
// Meanwhile `promotionRefusal` refuses to promote a NEGATION ("a retraction is the operator's own §14
// act, never an adopted output"). Each rule is right alone and they combine badly — the retraction
// cannot cross, but its target can, so promoting a retracted output RESURRECTS it in the OPERATOR'S
// OWN VOICE, with full force, asserting something withdrawn where it was made.
//
// This is §28.4's rule pointed at a different edge (a filter that narrows a delta-set must carry what
// struck it; promotion narrows to exactly one delta) — with a door's remedy rather than a filter's:
// promotion REFUSES. The decision and its scoping are railed in `promote-survival.test.ts`; this file
// holds only the single crossing that failed, in the smallest shape that shows it.

import { describe, expect, it } from "vitest";
import { signClaims, type Delta, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([["height", pick]]),
  default: pick,
};

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height"] }],
    }),
  );

// A strike in the pool author's own voice — a guest retracting their own interpretation, which is
// the ordinary way a sandboxed app withdraws an output.
const strike = (targetId: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      author: GARDENER,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    GARDENER_SEED,
  );

describe("T39 — promotion respects a retraction made inside the pool", () => {
  it("a pool output retracted in the pool is not adopted into the primary", async () => {
    const gw = await boot();
    const pool = await gw.openQuarantine();

    // The sandboxed app produces an interpretation, then withdraws it — both inside the pool.
    const output = observed(FERN, "height", 42, 2000, GARDENER_SEED);
    await pool.gateway.federate([output]);
    await pool.gateway.federate([strike(output.id, 2100)]);

    // It is struck where it was made.
    expect(pool.gateway.reactor.negationsOf(output.id).length).toBeGreaterThan(0);

    // THE QUESTION: may the operator still adopt it? Promotion re-signs into the operator's voice,
    // so adopting a withdrawn interpretation would put the operator's name on a claim its own
    // author had already taken back.
    let adopted: string | undefined;
    let refusal: string | undefined;
    try {
      adopted = (await gw.promote(pool.gateway, output.id)).promoted;
    } catch (e) {
      refusal = (e as Error).message;
    }

    // Promotion refuses. A failure here reads `adopted` back so the message names the resurrected
    // delta rather than only the absent refusal.
    expect(refusal, `a struck pool output was ADOPTED as ${adopted}`).toBeDefined();

    await pool.drop();
    await gw.close();
  });
});
