import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  parseTerm,
  signClaims,
  type Delta,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  isSuppressed,
} from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
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
      author: OP,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: targetId } } }],
    },
    OP_SEED,
  );

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

describe("T38 — the seeding edge carries the negation closure", () => {
  it("a claim retracted in the primary does not read as live in a Term-seeded pool", async () => {
    const gw = await boot();
    const earlier = observed(FERN, "height", 28, 900, OP_SEED);
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([earlier, claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);

    const members = gw.select(HEIGHTS).map((d) => d.id);
    expect(members).toContain(claim.id);
    expect(members).not.toContain(retraction.id);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    assertPreservesSuppression({
      what: "the quarantine seeding edge",
      source: gw,
      destination: pool.gateway,
      struckClaim: claim.id,
    });
    expect(isPresent(pool.gateway, claim.id)).toBe(true);
    expect(isPresent(pool.gateway, retraction.id)).toBe(true);

    pool.gateway.register(PLANT, SCHEMA, [FERN], undefined, ["height"]);
    const seen = await pool.gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(seen.errors).toBeUndefined();
    expect((seen.data as { plant: { height: number | null } }).plant.height).toBe(28);
    await pool.drop();
    await gw.close();
  });

  it("the closure is TRANSITIVE — a struck strike revives, and the revival survives the edge", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);
    const counter = strike(retraction.id, 1200);
    await gw.append([counter]);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    expect(isPresent(pool.gateway, retraction.id)).toBe(true);
    expect(isPresent(pool.gateway, counter.id)).toBe(true);
    expect(isSuppressed(pool.gateway, retraction.id)).toBe(true);
    await pool.drop();
    await gw.close();
  });

  it("the closure does NOT leak — a negation whose target never crossed drags nothing in", async () => {
    const gw = await boot();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const outsider = observed(FERN, "message", "not a member", 1050, OP_SEED);
    await gw.append([member, outsider]);
    const strikesOutsider = strike(outsider.id, 1100);
    await gw.append([strikesOutsider]);

    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    expect(isPresent(pool.gateway, member.id)).toBe(true);
    assertClosureDoesNotLeak({
      what: "the quarantine seeding edge",
      destination: pool.gateway,
      excludedTarget: outsider.id,
      itsRetraction: strikesOutsider.id,
    });
    await pool.drop();
    await gw.close();
  });

  it("a retraction landing AFTER seeding reaches the pool on the next pulse", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const pool = await gw.openQuarantine({ membership: HEIGHTS });
    expect(isSuppressed(pool.gateway, claim.id)).toBe(false);
    expect(isPresent(pool.gateway, claim.id)).toBe(true);

    const late = strike(claim.id, 1100);
    await gw.append([late]);
    await pool.reseed();
    assertPreservesSuppression({
      what: "the quarantine seeding edge, on reseed",
      source: gw,
      destination: pool.gateway,
      struckClaim: claim.id,
    });
    expect(isPresent(pool.gateway, claim.id)).toBe(true);
    expect(isPresent(pool.gateway, late.id)).toBe(true);
    await pool.drop();
    await gw.close();
  });

  it("select() itself is UNCHANGED — the closure belongs to the edge, not the reading surface", async () => {
    const gw = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    await gw.append([strike(claim.id, 1100)]);
    const ids = gw.select(HEIGHTS).map((d) => d.id);
    expect(ids).toEqual([claim.id]);
    await gw.close();
  });
});

describe("T38 — the offered lens carries it too (the same bug, pointed outward)", () => {
  it("a peer pulling through an offered lens receives retractions with their targets", async () => {
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height"] },
        ],
      }),
      { offeredLens: parseTerm(HEIGHTS) },
    );
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const retraction = strike(claim.id, 1100);
    await gw.append([retraction]);

    const offered = gw.offeredDeltas();
    expect(offered.map((d) => d.id)).toContain(claim.id);

    const peer = await boot();
    await peer.federate(offered);
    assertPreservesSuppression({
      what: "the offered lens",
      source: gw,
      destination: peer,
      struckClaim: claim.id,
    });
    expect(isPresent(peer, claim.id)).toBe(true);
    expect(isPresent(peer, retraction.id)).toBe(true);
    await peer.close();
    await gw.close();
  });
});
