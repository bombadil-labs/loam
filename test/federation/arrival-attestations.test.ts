// T207 — arrival attestations: custody as data, one signed stamp per sync.
//
// Provenance already answers three questions. The signature names the author. The pool names the
// last hop. The prefix names the receiver's petname for the peer. None of them answers WHEN a given
// delta stepped through the door: `lastSyncedAt` records when the door last opened, never what came
// through it. These rails pin the fourth answer — each sync that ACCEPTS deltas appends one
// receiver-signed attestation per 256 accepted refs, into the channel's own pool.
//
// THE RAILS READ THE GROUND, not a reader shipped beside the writer. An attestation is found by its
// `loam.arrival` context and its pointers are walked by hand, so a writer and a reader that agree
// on the wrong shape cannot pass together. That also makes the on-ground vocabulary — not a helper
// signature — the thing these rails freeze.
//
// WHAT THIS FILE DELIBERATELY DOES NOT PROVE: the target half of the erasure rail at the BYTES
// AFTER the cut. `drop()` closes the store it purged, so the same handle answers "this store is
// closed" rather than the question; the byte-level proof for a severed pool lives in
// test/federation/drop-cli.test.ts, which scans the pool's sqlite file. What this file proves is
// the premise at the bytes before the cut, the absence from the receiver's gather after it, and the
// BYSTANDER at the bytes — the half that sees over-purging, which is the failure that matters most.

import { beforeEach, describe, expect, it } from "vitest";
import { verifyDelta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway, type FederationReport } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const ME_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const BOB_SEED = "b0".repeat(32);

// The vocabulary, spelled out rather than imported: these rails pin the CONTEXT a later reader will
// look for, and an import would let a rename slip past them.
const CTX_ARRIVAL = "loam.arrival";
// The pointer fan cap. A larger batch is attested in ceil(N/256) stamps; an unbounded pointer list
// is an H8-shaped delta.
const FAN = 256;

const pools = new Map<string, MemoryBackend>();
// Cleared per test: `drop()` CLOSES the store it purged, so a backend reused across tests answers
// "this store is closed" rather than the question being asked.
beforeEach(() => pools.clear());
const backendFor = (pool: string): MemoryBackend => {
  const held = pools.get(pool) ?? new MemoryBackend();
  pools.set(pool, held);
  return held;
};

async function store(seed: string): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: seed, registrations: [] }),
    { channelBackend: backendFor },
  );
}
const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

interface Stamp {
  readonly deltaId: string;
  readonly author: string;
  readonly channel: string;
  readonly from: string;
  readonly at: number;
  readonly arrived: string[];
}

/**
 * Every arrival attestation standing in a pool, walked from the raw pointers.
 *
 * `asOf` is §26's one rule and nothing else: a delta is in force at T when its own timestamp is
 * `<= T`. Reading the surviving snapshot means a purged stamp can never reappear, however far back
 * T points.
 */
function stampsIn(pool: Gateway, asOf?: number): Stamp[] {
  const out: Stamp[] = [];
  for (const d of pool.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    if (asOf !== undefined && d.claims.timestamp > asOf) continue;
    // A struck stamp is not a standing one — suppression is a property of the operand set (H1), and
    // a reader that counted corpses would report a custody the store had withdrawn.
    if (pool.reactor.negationsOf(d.id).some((n) => pool.reactor.negationsOf(n).length === 0)) {
      continue;
    }
    const from = d.claims.pointers.find((p) => p.role === "from");
    const arrived: string[] = [];
    for (const p of d.claims.pointers) {
      if (p.target.kind === "delta") arrived.push(p.target.deltaRef.delta);
    }
    out.push({
      deltaId: d.id,
      author: d.claims.author,
      channel: marker.target.entity.id.startsWith("channel:")
        ? marker.target.entity.id.slice("channel:".length)
        : marker.target.entity.id,
      from: from?.target.kind === "primitive" ? String(from.target.value) : "",
      at: d.claims.timestamp,
      arrived,
    });
  }
  return out;
}

/** The union of every ref the given stamps carry. */
const refsOf = (stamps: readonly Stamp[]): string[] => stamps.flatMap((s) => s.arrived);

/**
 * Bend what the pool's union door REPORTS, leaving what it does with the deltas alone.
 *
 * The two refusals below cannot be reached by any offer a peer can compose: the door names every id
 * it counted, so the disagreement the sync path refuses on is a source fault rather than an input.
 * Injecting it here is what makes that refusal a behavior instead of an unprovable belief — the
 * alternative is code no rail can reach.
 */
function bendReport(pool: Gateway, bend: (r: FederationReport) => FederationReport): void {
  const real = pool.federate.bind(pool);
  pool.federate = async (deltas, opts) => bend(await real(deltas, opts));
}

/** The surviving registration bindings in a pool, by delta id — what "bound as law" means here. */
function bindingIdsIn(pool: Gateway): string[] {
  const out: string[] = [];
  for (const d of pool.reactor.snapshot()) {
    const registers = d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.id.startsWith("registration:"),
    );
    if (registers && pool.reactor.negationsOf(d.id).length === 0) out.push(d.id);
  }
  return out.sort();
}

describe("T207 — a sync that accepts deltas stamps its own custody", () => {
  it("(a) attests ceil(N/256) times, naming the channel, the peer address, and every accepted delta", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      // Past the cap on purpose: one attestation would otherwise carry an unbounded pointer list.
      const planted = Array.from({ length: 300 }, (_, i) =>
        observed(FERN, "height", i, 1000 + i, ALICE_SEED),
      );
      await alice.append(planted);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const report = await channel.sync();
      expect(report.accepted).toBeGreaterThan(FAN); // the premise: this sync exercises the cap

      const pool = channel.pool.gateway!;
      const stamps = stampsIn(pool);

      // ONE STAMP PER SYNC, fanned by the cap and not by anything else.
      expect(stamps.length).toBe(Math.ceil(report.accepted / FAN));
      for (const s of stamps) {
        expect(s.arrived.length).toBeGreaterThan(0);
        expect(s.arrived.length).toBeLessThanOrEqual(FAN);
        expect(s.channel).toBe(channel.name);
        expect(s.from).toBe("https://alice.example/loam");
        expect(s.at).toBeGreaterThan(0);
        // RECEIVER-SIGNED: the custody claim is the receiving operator's act, never the peer's.
        expect(s.author).toBe(me.operator);
        expect(s.author).not.toBe(alice.operator);
        expect(verifyDelta(pool.reactor.get(s.deltaId)!)).toBe("verified");
      }

      // The refs are the ACCEPTED SET exactly: as many as the door reported, no duplicates, and
      // every one of them a delta this pool actually holds. A count alone cannot say that.
      const refs = refsOf(stamps);
      expect(refs.length).toBe(report.accepted);
      expect(new Set(refs).size).toBe(report.accepted);
      for (const id of refs) expect(pool.reactor.get(id)).toBeDefined();
      // And the planted deltas — the ones a person would ask about — are named among them.
      const named = new Set(refs);
      for (const d of planted) expect(named.has(d.id)).toBe(true);

      // OBJECT LEVEL: the stamps are in the receiver's gather for that container, so custody rides
      // an ordinary read rather than living only in a pool nobody looks at.
      const gathered = new Set(me.containerScope({ containers: ["friends"] }).map((d) => d.id));
      for (const s of stamps) expect(gathered.has(s.deltaId)).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(b) a sync that accepts nothing attests nothing, while the sync before it did", async () => {
    // ANTI-SOUP, two-sided. Liveness is already the channel record's job; a per-poll heartbeat delta
    // would be delta soup by construction.
    //
    // The fixture isolates blessing side-effects deliberately: `bindArrived` blesses pool CONTENTS
    // rather than this sync's arrivals, so a channel with pending manifest rows can still append
    // rows on an empty sync. Syncing the SAME peer twice leaves nothing pending, and the assertion
    // is on attestation-context deltas rather than on a raw pool count, so an unrelated row landing
    // could never be mistaken for a stamp — nor hide one.
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThan(0);
      const pool = channel.pool.gateway!;
      const after1 = stampsIn(pool)
        .map((s) => s.deltaId)
        .sort();
      expect(after1.length).toBeGreaterThan(0); // the side that proves the rail can see a stamp

      // The quiet sync: the peer said nothing new, so union accepts nothing.
      const second = await channel.sync();
      expect(second.accepted).toBe(0);
      const after2 = stampsIn(pool)
        .map((s) => s.deltaId)
        .sort();
      expect(after2).toEqual(after1);

      // A third, for the same reason a standing sync polls forever: no stamp accrues per poll.
      await channel.sync();
      expect(
        stampsIn(pool)
          .map((s) => s.deltaId)
          .sort(),
      ).toEqual(after1);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(c) dropping a channel purges its attestations, and a bystander's survive at the bytes", async () => {
    // TWO-SIDED BY RULE. The trail was about the severed peer, so it goes with the pool — and a
    // rail that only proved removal could not see a purge reaching sideways into another peer.
    const alice = await store(ALICE_SEED);
    const bob = await store(BOB_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.append([observed(FERN, "height", 62, 1000, ALICE_SEED)]);
      await bob.append([observed(FERN, "height", 71, 2000, BOB_SEED)]);

      const one = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const two = await me.openChannel({
        into: "friends",
        prefix: "bob",
        from: "https://bob.example/loam",
        source: feed(bob),
      });
      await one.sync();
      await two.sync();

      const aliceStamps = stampsIn(one.pool.gateway!);
      const bobPool = two.pool.gateway!;
      const bobStamps = stampsIn(bobPool);
      expect(aliceStamps.length).toBeGreaterThan(0);
      expect(bobStamps.length).toBeGreaterThan(0);

      // THE PREMISE, AT THE BYTES, before the cut closes the handle.
      const aliceBytes = pools.get(one.name)!;
      const bobBytes = pools.get(two.name)!;
      for (const s of aliceStamps) expect(await aliceBytes.holds(s.deltaId)).toBe(true);
      for (const s of bobStamps) expect(await bobBytes.holds(s.deltaId)).toBe(true);

      await me.dropChannel(one.name);

      // TARGET: gone from what the receiver gathers. `drop()` byte-verifies and refuses by name on
      // any survivor, so a drop that returned at all is the byte-level evidence for this side.
      const gathered = new Set(me.containerScope({ containers: ["friends"] }).map((d) => d.id));
      for (const s of aliceStamps) expect(gathered.has(s.deltaId)).toBe(false);

      // BYSTANDER: bob's custody trail is untouched, at the bytes and through a read.
      for (const s of bobStamps) expect(await bobBytes.holds(s.deltaId)).toBe(true);
      const survivors = stampsIn(bobPool)
        .map((s) => s.deltaId)
        .sort();
      expect(survivors).toEqual(bobStamps.map((s) => s.deltaId).sort());
      for (const s of bobStamps) expect(gathered.has(s.deltaId)).toBe(true);
    } finally {
      await alice.close();
      await bob.close();
      await me.close();
    }
  });

  it("(d) an attestation never binds as law and never re-exports as a blessing", async () => {
    // The recursive-blessing class stays dead. An attestation is receiver-authored, and the channel
    // enumerates a peer's exports from PEER-authored bindings — so a stamp is outside law's reach by
    // the same filter that keeps a blessing from being re-blessed. Asserted, never assumed.
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.bound).toContain("alice:Plant");

      const pool = channel.pool.gateway!;
      const stamps = stampsIn(pool);
      expect(stamps.length).toBeGreaterThan(0);
      const bindings = bindingIdsIn(pool);

      // The poll after attesting binds NO new name, and the pool's binding set does not grow.
      const second = await channel.sync();
      expect(second.bound).toEqual([]);
      expect(bindingIdsIn(pool)).toEqual(bindings);
      const third = await channel.sync();
      expect(third.bound).toEqual([]);
      expect(bindingIdsIn(pool)).toEqual(bindings);

      // No layered name — "alice:alice:..." is what re-export looks like when it happens.
      for (const name of me.materializationNames()) {
        expect(name.startsWith("alice:alice:")).toBe(false);
      }
      // And no manifest row names a stamp: the receiver recognised nothing of its own authorship.
      const stampIds = new Set(stamps.map((s) => s.deltaId));
      for (const d of pool.reactor.snapshot()) {
        const alias = d.claims.pointers.find((p) => p.role === "alias");
        if (alias?.target.kind !== "primitive") continue;
        expect(stampIds.has(String(alias.target.value))).toBe(false);
      }
      // The mechanism the exclusion rests on, stated so a change to it goes red here too.
      for (const s of stamps) expect(s.author).toBe(me.operator);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("(e) an as-of read between two syncs sees only the first sync's attestations", async () => {
    // Custody rides §26: "what had arrived by Tuesday" is an ordinary as-of read of the pool, with
    // no separate history to keep in step.
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const early = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([early]);

      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const first = await channel.sync();
      expect(first.accepted).toBeGreaterThan(0);
      const pool = channel.pool.gateway!;
      const stampsAfterFirst = stampsIn(pool);
      expect(stampsAfterFirst.length).toBeGreaterThan(0);
      const between = Math.max(...stampsAfterFirst.map((s) => s.at));

      // A second arrival, later.
      const late = observed(FERN, "height", 71, 2000, ALICE_SEED);
      await alice.append([late]);
      const second = await channel.sync();
      expect(second.accepted).toBeGreaterThan(0);

      const now = stampsIn(pool);
      expect(now.length).toBeGreaterThan(stampsAfterFirst.length);
      expect(
        Math.min(
          ...now
            .filter((s) => !stampsAfterFirst.some((f) => f.deltaId === s.deltaId))
            .map((s) => s.at),
        ),
      ).toBeGreaterThan(between);

      // THE AS-OF READ: only the first sync's stamps, and the late delta is not named by any of them.
      const past = stampsIn(pool, between);
      expect(past.map((s) => s.deltaId).sort()).toEqual(
        stampsAfterFirst.map((s) => s.deltaId).sort(),
      );
      const pastRefs = new Set(refsOf(past));
      expect(pastRefs.has(early.id)).toBe(true);
      expect(pastRefs.has(late.id)).toBe(false);
      // The present read does name it — the past is narrower because time is, not because the read
      // is broken.
      expect(new Set(refsOf(now)).has(late.id)).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses to stamp a custody it cannot point at when the door names fewer ids than it counted", async () => {
    // A stamp naming a SUBSET of the arrivals is the silent failure this guards: the trail would
    // read complete and be short, and nothing anywhere would say so. Judge a custody claim by
    // whether it can be false, never by whether it was written.
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([planted]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = channel.pool.gateway!;
      bendReport(pool, (r) =>
        r.acceptedIds !== undefined && r.acceptedIds.length > 0
          ? { ...r, acceptedIds: r.acceptedIds.slice(1) }
          : r,
      );

      await expect(channel.sync()).rejects.toThrow(/could not record the arrival/);
      // TWO-SIDED, and it is the refusal's own sentence being checked: the deltas landed, and no
      // stamp did. A refusal that mis-stated either half would be the same overclaim in a new place.
      expect(pool.reactor.get(planted.id)).toBeDefined();
      expect(stampsIn(pool)).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("refuses, and says none were named, when the door names no ids at all", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(ME_SEED);
    try {
      const planted = observed(FERN, "height", 62, 1000, ALICE_SEED);
      await alice.append([planted]);
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: feed(alice),
      });
      const pool = channel.pool.gateway!;
      // The counts alone — the key is DROPPED, not set to undefined, which is what a door that
      // never learned to name its arrivals would return.
      bendReport(pool, (r) => ({
        offered: r.offered,
        accepted: r.accepted,
        rejected: r.rejected,
        held: r.held,
      }));

      // The COUNT is in the sentence, so a reader learns how far apart the two answers were.
      await expect(channel.sync()).rejects.toThrow(/named 0 of them/);
      expect(pool.reactor.get(planted.id)).toBeDefined();
      expect(stampsIn(pool)).toEqual([]);
    } finally {
      await alice.close();
      await me.close();
    }
  });
});
