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

const strike = (targetId: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author: GARDENER,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    GARDENER_SEED,
  );

describe("T39 — promotion respects a retraction made inside the pool", () => {
  it("a pool output retracted in the pool is not adopted into the primary", async () => {
    const gw = await boot();
    const pool = await gw.openQuarantine();

    const output = observed(FERN, "height", 42, 2000, GARDENER_SEED);
    await pool.gateway.federate([output]);
    await pool.gateway.federate([strike(output.id, 2100)]);

    expect(pool.gateway.reactor.negationsOf(output.id).length).toBeGreaterThan(0);

    let adopted: string | undefined;
    let refusal: string | undefined;
    try {
      adopted = (await gw.promote(pool.gateway, output.id)).promoted;
    } catch (e) {
      refusal = (e as Error).message;
    }

    expect(refusal, `a struck pool output was ADOPTED as ${adopted}`).toBeDefined();

    await pool.drop();
    await gw.close();
  });
});
