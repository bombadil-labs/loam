// Three reads that have an entity anchor answer from the target index, never from a walk of the
// store (H8): the erasure probe behind `withoutErased`, `localChannelsInContainer`, and
// `orphanedDeclaration`. The COST cases count every reactor access the read makes: no whole-store
// door (`snapshot`, `arrivalLog`) opens, and the accesses are the same with 0 and with 1000
// unrelated facts in the store. The ANSWER cases hold the result fixed, each with a struck or
// erased member beside a live bystander.
//
// The ANSWER cases are CONTROLS: they pass with the whole-store walk too, because the index read
// must select exactly what the walk selected. Only the COST cases can tell the two apart.
//
// Not covered here: the erase door and the drop door that ask `orphanedDeclaration` are driven in
// local-channel-live-opening.test.ts (the unreadable-event cases, both directions). No door
// serves `localChannelsInContainer` yet. With an erasure in the ground the probe hands over to
// `refusedIds`, whose cost grows with the erasure index; no case here bounds that.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { containerClaims, survivingDeclarationIds } from "../../src/gateway/container-law.js";
import { ERASE_ENTITY, isErasure } from "../../src/gateway/erase-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { withoutErased } from "../../src/gateway/ingest.js";
import { withStamp } from "../../src/gateway/stamp.js";
import {
  localChannelEvidence,
  localChannelsInContainer,
  orphanedDeclaration,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const PEER_SEED = "a1".repeat(32);
const UNRELATED = 1000;

const homes: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const gw of homes.splice(0)) await gw.close();
});

async function home(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}
const bystanders = (gw: Gateway, count: number) =>
  count === 0
    ? Promise.resolve()
    : gw.append(
        Array.from({ length: count }, (_, n) =>
          observed(`plant:other-${n}`, "height", n, 1000 + n, SEED),
        ),
      );
async function open(gw: Gateway, into: string, prefix: string) {
  const offering: Delta[] = [];
  const ch = await gw.openChannel({
    into,
    prefix,
    from: `https://peer.example/${prefix}`,
    source: { pull: () => Promise.resolve([...offering]) },
  });
  offering.push(observed(FERN, "height", 1, 1001, PEER_SEED));
  await ch.sync();
  return ch;
}
function declarationOf(gw: Gateway, name: string): string {
  const evidence = localChannelEvidence(gw, name);
  if (evidence.state !== "open") throw new Error(`expected open: ${JSON.stringify(evidence)}`);
  return evidence.opening.poolDeclaration;
}
// A second declaration under a channel's name, made by hand: no opening names it.
async function declareByHand(gw: Gateway, name: string): Promise<string> {
  const before = new Set(survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, name));
  await gw.append([
    signClaims(
      withStamp(gw.stamp(OP), (t) =>
        containerClaims(
          { container: name, trust: "untrusted", posture: "separate", inboxOf: "friends" },
          OP,
          t,
        ),
      ),
      SEED,
    ),
  ]);
  const made = survivingDeclarationIds(gw.reactor, gw.validityNow(), OP, name).filter(
    (id) => !before.has(id),
  );
  if (made.length !== 1) throw new Error(`expected one new declaration, saw ${made.length}`);
  return made[0]!;
}

const ACCESSES = [
  "get",
  "targets",
  "negators",
  "byTarget",
  "negationsOf",
  "snapshot",
  "arrivalLog",
] as const;
type Accesses = Record<(typeof ACCESSES)[number], number>;
function accesses(gw: Gateway, read: () => void): Accesses {
  const spies = ACCESSES.map((m) => [m, vi.spyOn(gw.reactor, m)] as const);
  read();
  const counts = Object.fromEntries(spies.map(([m, s]) => [m, s.mock.calls.length]));
  vi.restoreAllMocks();
  return counts as Accesses;
}
// The read's cost on a store with no unrelated facts and on one with UNRELATED of them.
async function costOf(
  prepare: (gw: Gateway) => Promise<() => void>,
): Promise<{ small: Accesses; large: Accesses }> {
  const out: Accesses[] = [];
  for (const count of [0, UNRELATED]) {
    const gw = await home();
    const read = await prepare(gw);
    await bystanders(gw, count);
    out.push(accesses(gw, read));
  }
  return { small: out[0]!, large: out[1]! };
}
function expectFootprint({ small, large }: { small: Accesses; large: Accesses }): void {
  expect(small.snapshot).toBe(0);
  expect(small.arrivalLog).toBe(0);
  expect(small.byTarget).toBeGreaterThan(0);
  expect(large).toEqual(small);
}

describe("COST: an anchored read opens no whole-store door and does not grow with unrelated facts", () => {
  it("the erasure probe behind withoutErased, on a store that holds no erasure", async () => {
    const served = [observed(FERN, "height", 5, 1005, SEED)];
    const cost = await costOf(async (gw) => {
      await gw.append(served);
      return () => expect(withoutErased(gw, served)).toEqual(served);
    });
    expectFootprint(cost);
  }, 120_000);

  it("localChannelsInContainer", async () => {
    const cost = await costOf(async (gw) => {
      const ch = await open(gw, "friends", "friends:peer");
      return () => expect(localChannelsInContainer(gw, "friends")).toEqual([ch.name]);
    });
    expectFootprint(cost);
  }, 120_000);

  it("orphanedDeclaration, for a declaration an opening names", async () => {
    const cost = await costOf(async (gw) => {
      const ch = await open(gw, "friends", "friends:peer");
      const declaration = declarationOf(gw, ch.name);
      return () => expect(orphanedDeclaration(gw, declaration)).toBe(false);
    });
    expectFootprint(cost);
  }, 120_000);

  it("orphanedDeclaration, for a declaration made by hand", async () => {
    const cost = await costOf(async (gw) => {
      const ch = await open(gw, "friends", "friends:peer");
      const byHand = await declareByHand(gw, ch.name);
      return () => expect(orphanedDeclaration(gw, byHand)).toBe(true);
    });
    expectFootprint(cost);
  }, 120_000);
});

describe("ANSWER (controls: these pass over a whole-store walk too)", () => {
  // The erase purges the target from the reactor, so the caller's own copy stands in for a delta
  // a door is about to serve. The offer door can then only show the bystander side.
  async function erase(gw: Gateway, target: Delta): Promise<Delta> {
    await gw.erase(target.id);
    const erasure = gw.reactor
      .byTarget(ERASE_ENTITY)
      .map((id) => gw.reactor.get(id)!)
      .filter((d) => isErasure(d.claims));
    expect(erasure).toHaveLength(1);
    return erasure[0]!;
  }

  it("withoutErased withholds an erased delta a caller still holds and serves its bystander; the offer door serves the bystander", async () => {
    const gw = await home();
    const target = observed(FERN, "height", 5, 1005, SEED),
      bystander = observed(FERN, "height", 6, 1006, SEED);
    await gw.append([target, bystander]);
    expect(withoutErased(gw, [target, bystander])).toEqual([target, bystander]);
    expect(gw.offeredDeltas().map((d) => d.id)).toEqual(
      expect.arrayContaining([target.id, bystander.id]),
    );
    await erase(gw, target);
    expect(withoutErased(gw, [target, bystander])).toEqual([bystander]);
    const offered = gw.offeredDeltas().map((d) => d.id);
    expect(offered).not.toContain(target.id);
    expect(offered).toContain(bystander.id);
  });

  it("a struck erasure still refuses its id: the probe counts a negated erasure as an erasure", async () => {
    const gw = await home();
    const target = observed(FERN, "height", 5, 1005, SEED),
      bystander = observed(FERN, "height", 6, 1006, SEED);
    await gw.append([target, bystander]);
    const erasure = await erase(gw, target);
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) => makeNegationClaims(OP, t, erasure.id)),
        SEED,
      ),
    ]);
    expect(gw.reactor.negationsOf(erasure.id)).toHaveLength(1);
    expect(withoutErased(gw, [target, bystander])).toEqual([bystander]);
    const offered = gw.offeredDeltas().map((d) => d.id);
    expect(offered).not.toContain(target.id);
    expect(offered).toContain(bystander.id);
  });

  it("localChannelsInContainer lists a standing channel and not one whose declaration is struck, per container", async () => {
    const gw = await home();
    const kept = await open(gw, "friends", "friends:kept"),
      dropped = await open(gw, "friends", "friends:dropped");
    expect(localChannelsInContainer(gw, "friends")).toEqual([dropped.name, kept.name].sort());
    expect(localChannelsInContainer(gw, "nobody")).toEqual([]);
    const struck = declarationOf(gw, dropped.name);
    await gw.dropChannel(dropped.name);
    // Delta level: the dropped opening's declaration is held and struck, not gone.
    expect(gw.reactor.get(struck)).toBeDefined();
    expect(gw.reactor.negationsOf(struck).length).toBeGreaterThan(0);
    expect(localChannelsInContainer(gw, "friends")).toEqual([kept.name]);
  });

  it("orphanedDeclaration: an opening's declaration is not an orphan, struck or standing; a hand declaration is; another channel's opening does not answer for it", async () => {
    const gw = await home();
    const a = await open(gw, "friends", "friends:a"),
      b = await open(gw, "friends", "friends:b");
    const named = declarationOf(gw, a.name);
    const byHand = await declareByHand(gw, a.name);
    expect(orphanedDeclaration(gw, named)).toBe(false);
    expect(orphanedDeclaration(gw, byHand)).toBe(true);
    expect(orphanedDeclaration(gw, declarationOf(gw, b.name))).toBe(false);
    // A struck declaration keeps its opening: the question reads events, not the strike.
    const bDeclaration = declarationOf(gw, b.name);
    await gw.dropChannel(b.name);
    expect(gw.reactor.negationsOf(bDeclaration).length).toBeGreaterThan(0);
    expect(orphanedDeclaration(gw, bDeclaration)).toBe(false);
    expect(orphanedDeclaration(gw, byHand)).toBe(true);
  });
});
