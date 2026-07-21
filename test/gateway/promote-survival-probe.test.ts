// PROBE (2026-07-21, T38 fallout sweep) — does promotion check that its source SURVIVES, or only
// that it is PRESENT?
//
// RESULT: CONFIRMED. Run 2026-07-21 — promotion SUCCEEDED. A pool output that was retracted inside
// the pool was adopted into the primary, re-signed into the operator's own voice. Ticket **T39**
// fixes it; this file is its rail, committed SKIPPED so the suite keeps telling the truth about what
// is green. Un-skipping it is step one. Do not "fix" this file; fix the promotion gate.
//
// THE SUSPICION. `promoteImpl` does:
//
//     const src = source.reactor.get(deltaId);
//     if (src === undefined) throw new Error(`nothing to promote: ...`);
//
// `reactor.get` is PRESENCE. It says nothing about whether the delta still survives in the pool —
// whether something in there struck it. Meanwhile `promotionRefusal` correctly refuses to promote a
// NEGATION ("a retraction is the operator's own §14 act, never an adopted output").
//
// Those two rules are individually right and may combine badly: the retraction cannot cross, but its
// target can. If so, promoting a retracted pool output RESURRECTS it — and worse than the seeding-edge
// bug of T38, because promotion RE-SIGNS: the claim enters the primary in the OPERATOR'S OWN VOICE,
// with full force, asserting something that had been withdrawn where it was made.
//
// This is the §28.4 rule pointed at a different edge: a filter that narrows a delta-set must carry
// what struck it. Promotion narrows to exactly one delta.

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

describe.skip("T39 — promotion respects a retraction made inside the pool (FAILS — see T39)", () => {
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

    // eslint-disable-next-line no-console
    console.log(
      `PROBE — promotion of a struck pool output: ${
        refusal === undefined ? `ADOPTED as ${adopted}` : `refused (${refusal})`
      }`,
    );

    // The expected-correct behavior: promotion refuses, naming the retraction. If this fails, the
    // resurrection is real and wants a ticket.
    expect(refusal).toBeDefined();

    await pool.drop();
    await gw.close();
  });
});
