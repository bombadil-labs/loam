// T43 — the INBOUND doors carry the negation closure (hazard H1, src/gateway/SUBSTRATE-HAZARDS.md).
//
// Two inbound doors narrow a delta set by AUTHORSHIP or by a hand-picked predicate, and neither
// could see a strike:
//
//   (a) the seeding edge's PREDICATE knob (`openQuarantine({ admit })`) — the degenerate form of
//       the membership knob, whose Term form has carried the closure since T38. The predicate form
//       did not, so a wall seeded by a predicate admitted a claim without its retraction and
//       resolved it LIVE inside.
//   (b) the federation door under the store's OWN trust policy (roster mode) — roster admission is
//       authorship-scoped, and a negation's author is incidental to the claim it strikes. A
//       rostered pull admitted a post and refused the off-roster retraction that withdrew it; the
//       puller then served a withdrawn post as live, and the peer could not tell.
//
// The remedy differs by door, and the difference is the design point: (a) closes over the LOCAL
// ground (the primary IS the source), (b) closes over the OFFERED BATCH (the peer's negations are
// not local yet). Both run FORWARD ONLY — from an admitted delta to the negations OF it — so every
// case here is paired with `assertClosureDoesNotLeak`, and both levels are asserted: the delta
// level through `test/gateway/narrowing.ts`, the object level through a Schema on the destination's
// own reading surface.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. An EXPLICIT `admit` predicate at the federation door
// stays the caller's own boundary — `test/federation/federate.test.ts` pins one such deliberate
// boundary (refusing a stranger's strike, the interim answer to the heckler's veto) — so the batch
// closure applies only where admission was POLICY-driven. That asymmetry is a documented caller
// obligation on `PullOptions.admit`, not an oversight; the rail that would close it is a
// read-time, authority-scoped suppression predicate, which is substrate work (rhizomatic#2).

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

vi.setConfig({ testTimeout: 15000 });

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

// A governed store that can READ its own ground through the Plant schema — the object level.
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

// What a READER resolves through the Plant schema — `null` when every height claim is struck.
const heightSeenBy = async (gw: Gateway): Promise<number | null> => {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  expect(res.errors).toBeUndefined();
  return (res.data as { plant: { height: number | null } }).plant.height;
};

describe("T43(a) — the seeding edge's PREDICATE knob carries the closure too", () => {
  // The realistic predicate shape, and the reason the hole is not contrived: a hand-picked subset
  // selects DOMAIN facts ("height claims about the fern"), and a negation carries only a `negates`
  // pointer — no entity, no context. It can never match such a predicate, so the wall received the
  // claim and nothing that struck it.
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

    // The predicate admits the claim and NOT the retraction. That asymmetry is the whole bug.
    expect(heightsOnly(claim)).toBe(true);
    expect(heightsOnly(strike)).toBe(false);

    const pool = await gw.openQuarantine({ admit: heightsOnly });
    const wall = pool.gateway;
    wall.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    // Delta level: struck at the source, never live at the destination.
    assertPreservesSuppression({
      what: "openQuarantine({ admit }) seeding edge",
      source: gw,
      destination: wall,
      struckClaim: claim.id,
    });
    // Object level: what a reader RESOLVES through the Plant schema, on both sides. The primary
    // says the height is withdrawn; a wall that disagrees is republishing it.
    expect(await heightSeenBy(gw)).toBeNull();
    expect(await heightSeenBy(wall)).toBeNull();

    // Forward only: a delta the predicate excluded is not dragged in by what negates it.
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
    const counter = retraction(strike.id, OP, OP_SEED, 1200); // negating the negation revives
    await gw.append([counter]);

    const pool = await gw.openQuarantine({ admit: heightsOnly });
    const wall = pool.gateway;
    wall.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    // One link is not enough: carrying the strike but not the counter leaves the claim wrongly
    // suppressed inside — the same bug mirrored. The primary reads 30 again; so must the wall.
    expect(isPresent(wall, strike.id)).toBe(true);
    expect(isPresent(wall, counter.id)).toBe(true);
    expect(await heightSeenBy(gw)).toBe(30);
    expect(await heightSeenBy(wall)).toBe(30);
    await pool.drop();
  });
});

describe("T43(b) — a rostered inbound door carries the strikes of what it admits", () => {
  // The peer: alice posts, the peer's own moderator withdraws one post. Both hold write standing
  // there; neither the moderator nor the peer's operator is on the puller's roster.
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

  // The puller: rostered to alice alone, and able to read its own ground through Plant.
  const rosteredPuller = async (roster: readonly string[]): Promise<Gateway> => {
    const gw = await boot(OP_B_SEED);
    await gw.append([signClaims(trustClaims("roster", [...roster], OP_B, 9_000), OP_B_SEED)]);
    return gw;
  };

  it("a rostered pull does not serve a post the peer's moderator withdrew", async () => {
    const { peer, post } = await peerWithAWithdrawnPost();
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas()); // no explicit admit: the store's own policy rules

    assertPreservesSuppression({
      what: "federate under the store's roster policy",
      source: peer,
      destination: puller,
      struckClaim: post.id,
    });
    // The object level is the claim the ticket makes: "your GraphQL surface serves a retracted post
    // as live". Ask the surface.
    expect(await heightSeenBy(peer)).toBeNull();
    expect(await heightSeenBy(puller)).toBeNull();
  });

  it("the batch closure is TRANSITIVE — a withdrawal the peer itself reversed does not suppress", async () => {
    const { peer, withdrawal } = await peerWithAWithdrawnPost();
    const reversal = retraction(withdrawal.id, MODERATOR, MODERATOR_SEED, 1200);
    await peer.append([reversal]); // the moderator takes the withdrawal back
    const puller = await rosteredPuller([ALICE]);

    await puller.federate(peer.offeredDeltas());

    // Carrying the withdrawal and stopping would leave the puller suppressing a live post.
    expect(isPresent(puller, withdrawal.id)).toBe(true);
    expect(isPresent(puller, reversal.id)).toBe(true);
    expect(await heightSeenBy(peer)).toBe(30);
    expect(await heightSeenBy(puller)).toBe(30);
  });

  it("the batch closure runs FORWARD only — an off-roster post is not dragged in by its strike", async () => {
    const { peer } = await peerWithAWithdrawnPost();
    // A post by an author the roster excludes, and its withdrawal. Neither may cross: the closure
    // must never walk from a negation back to its target, or a roster becomes a leak.
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
    // Two off-roster deltas the closure must ignore whole. One points at the admitted post with a
    // DIFFERENT role: supersession is not suppression, and reading it as a strike would let a
    // stranger's delta cross on the post's coattails. The other's `negates` names an ENTITY rather
    // than a delta — a shape any peer is free to send, and one this door must not read a `deltaRef`
    // out of. (`hollow-test` found both: swapping the guard's `||` for `&&` passed every other rail.)
    const supersedes = signClaims(
      {
        timestamp: 1500,
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
    // And the genuine strike still crossed, so this is not passing by admitting nothing.
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
    // The same door, the same offer, one delta sent twice. Union dedups and the closure keys by id,
    // so a count inferred from set sizes would report a refusal that never happened (H7: a report
    // that can be false). Two fresh pullers, because a store's second pull sees different ground.
    const once = await (await rosteredPuller([ALICE])).federate(offer);
    const twice = await (await rosteredPuller([ALICE])).federate([...offer, post]);

    expect(twice.offered).toBe(once.offered + 1);
    expect(twice.rejected).toBe(once.rejected);
    expect(once.rejected).toBeGreaterThan(0); // the peer's own law is off-roster and truly refused
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

    // pullFrom decodes the offer and forwards it to the same door with NO admit of its own — so
    // this pins the whole path the ticket describes, not just the door's body.
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
