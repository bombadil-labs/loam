import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { trustClaims } from "../../src/gateway/trust.js";
import { pullFrom } from "../../src/federation/pull.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  retraction,
} from "./narrowing.js";

vi.setConfig({ testTimeout: 20_000 });

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OP_B_SEED = "0b".repeat(32);
const OP_B = authorForSeed(OP_B_SEED);
const ALICE_SEED = "a1".repeat(32);
const ALICE = authorForSeed(ALICE_SEED);
const MODERATOR_SEED = "cc".repeat(32);
const MODERATOR = authorForSeed(MODERATOR_SEED);

const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  for (const g of gateways.splice(0)) await g.close().catch(() => {});
});

const boot = async (seed: string): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: seed,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  gateways.push(gw);
  return gw;
};

const heightSeenBy = async (gw: Gateway): Promise<number | null> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  expect(res.errors).toBeUndefined();
  return (res.data as { plant: { height: number | null } }).plant.height;
};

describe("T43(a) — the seeding edge's PREDICATE knob carries the closure too", () => {
  const heightsOnly = (d: Delta): boolean =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "height",
    );

  it("a claim retracted in the primary does not read as LIVE in a predicate-seeded wall", async () => {
    const gw = await boot(OP_SEED);
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const outsider = observed(FERN, "tag", "not a height", 1050, OP_SEED);
    await gw.append([claim, outsider]);
    const strike = retraction(claim.id, OP, OP_SEED, 1100);
    const strikesOutsider = retraction(outsider.id, OP, OP_SEED, 1150);
    await gw.append([strike, strikesOutsider]);

    expect(heightsOnly(claim)).toBe(true);
    expect(heightsOnly(strike)).toBe(false);

    const pool = await gw.openQuarantine({ admit: heightsOnly });
    const wall = pool.gateway;
    wall.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    assertPreservesSuppression({
      what: "openQuarantine({ admit }) seeding edge",
      source: gw,
      destination: wall,
      struckClaim: claim.id,
    });
    expect(await heightSeenBy(gw)).toBeNull();
    expect(await heightSeenBy(wall)).toBeNull();

    assertClosureDoesNotLeak({
      what: "openQuarantine({ admit }) seeding edge",
      destination: wall,
      excludedTarget: outsider.id,
      itsRetraction: strikesOutsider.id,
    });
    await pool.drop();
  });

  it("the predicate closure is TRANSITIVE — a struck strike revives across the edge", async () => {
    const gw = await boot(OP_SEED);
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([claim]);
    const strike = retraction(claim.id, OP, OP_SEED, 1100);
    await gw.append([strike]);
    const counter = retraction(strike.id, OP, OP_SEED, 1200);
    await gw.append([counter]);

    const pool = await gw.openQuarantine({ admit: heightsOnly });
    const wall = pool.gateway;
    wall.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    expect(isPresent(wall, strike.id)).toBe(true);
    expect(isPresent(wall, counter.id)).toBe(true);
    expect(await heightSeenBy(gw)).toBe(30);
    expect(await heightSeenBy(wall)).toBe(30);
    await pool.drop();
  });
});

describe("T43(b) — a rostered inbound door carries the strikes of what it admits", () => {
  const peerWithAWithdrawnPost = async (): Promise<{
    peer: Gateway;
    post: Delta;
    withdrawal: Delta;
  }> => {
    const peer = await boot(OP_SEED);
    await peer.append([
      signClaims(grantClaims(STORE_ENTITY, ALICE, "write", OP, 1), OP_SEED),
      signClaims(grantClaims(STORE_ENTITY, MODERATOR, "write", OP, 2), OP_SEED),
    ]);
    const post = observed(FERN, "height", 30, 1000, ALICE_SEED);
    await peer.append([post]);
    const withdrawal = retraction(post.id, MODERATOR, MODERATOR_SEED, 1100);
    await peer.append([withdrawal]);
    return { peer, post, withdrawal };
  };

  const rosteredPuller = async (roster: readonly string[]): Promise<Gateway> => {
    const gw = await boot(OP_B_SEED);
    await gw.append([signClaims(trustClaims("roster", [...roster], OP_B, 9_000), OP_B_SEED)]);
    return gw;
  };

  it("a rostered pull does not serve a post the peer's moderator withdrew", async () => {
    const { peer, post } = await peerWithAWithdrawnPost();
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas());

    assertPreservesSuppression({
      what: "federate under the store's roster policy",
      source: peer,
      destination: puller,
      struckClaim: post.id,
    });
    expect(await heightSeenBy(peer)).toBeNull();
    expect(await heightSeenBy(puller)).toBeNull();
  });

  it("the batch closure is TRANSITIVE — a withdrawal the peer itself reversed does not suppress", async () => {
    const { peer, withdrawal } = await peerWithAWithdrawnPost();
    const reversal = retraction(withdrawal.id, MODERATOR, MODERATOR_SEED, 1200);
    await peer.append([reversal]);
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas());

    expect(isPresent(puller, withdrawal.id)).toBe(true);
    expect(isPresent(puller, reversal.id)).toBe(true);
    expect(await heightSeenBy(peer)).toBe(30);
    expect(await heightSeenBy(puller)).toBe(30);
  });

  it("the batch closure runs FORWARD only — an off-roster post is not dragged in by its strike", async () => {
    const { peer } = await peerWithAWithdrawnPost();
    const strangerPost = observed(FERN, "height", 99, 1300, MODERATOR_SEED);
    await peer.append([strangerPost]);
    const strangerWithdrawal = retraction(strangerPost.id, MODERATOR, MODERATOR_SEED, 1400);
    await peer.append([strangerWithdrawal]);
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas());

    assertClosureDoesNotLeak({
      what: "federate under the store's roster policy",
      destination: puller,
      excludedTarget: strangerPost.id,
      itsRetraction: strangerWithdrawal.id,
    });
  });

  it("only a `negates` pointer AT A DELTA is a strike — no other pointer shape rides in", async () => {
    const { peer, post } = await peerWithAWithdrawnPost();
    const supersedes = signClaims(
      {
        timestamp: 1500,
        validFrom: 1500,
        author: MODERATOR,
        pointers: [
          { role: "supersededBy", target: { kind: "delta", deltaRef: { delta: post.id } } },
        ],
      },
      MODERATOR_SEED,
    );
    const negatesAnEntity = signClaims(
      {
        timestamp: 1600,
        validFrom: 1600,
        author: MODERATOR,
        pointers: [
          { role: "negates", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
        ],
      },
      MODERATOR_SEED,
    );
    await peer.append([supersedes, negatesAnEntity]);
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas());

    expect(isPresent(puller, supersedes.id)).toBe(false);
    expect(isPresent(puller, negatesAnEntity.id)).toBe(false);
    assertPreservesSuppression({
      what: "federate under the store's roster policy",
      source: peer,
      destination: puller,
      struckClaim: post.id,
    });
  });

  it("the report counts refusals it made — a duplicate in the offer is not one", async () => {
    const { peer, post } = await peerWithAWithdrawnPost();
    const offer = peer.offeredDeltas();
    const once = await (await rosteredPuller([ALICE])).federate(offer);
    const twice = await (await rosteredPuller([ALICE])).federate([...offer, post]);

    expect(twice.offered).toBe(once.offered + 1);
    expect(twice.rejected).toBe(once.rejected);
    expect(once.rejected).toBeGreaterThan(0);
  });

  it("END TO END: pullFrom over the wire carries the withdrawal the roster would refuse", async () => {
    const { peer, post } = await peerWithAWithdrawnPost();
    const handle = await serve({
      mounts: { default: peer },
      tokens: { "tok-peer": { operator: true } },
      port: 0,
    });
    handles.push(handle);
    const puller = await rosteredPuller([ALICE]);

    const report = await pullFrom(puller, `${handle.url}/default`, "tok-peer");
    expect(report.accepted).toBeGreaterThan(0);

    assertPreservesSuppression({
      what: "pullFrom under the store's roster policy",
      source: peer,
      destination: puller,
      struckClaim: post.id,
    });
    expect(await heightSeenBy(puller)).toBeNull();
  });
});
