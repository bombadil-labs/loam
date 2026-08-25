// T222 — the custody crash window: `federate` and `attest` are two non-atomic writes.
//
// T207 heals every REPORTED attest failure — a refusal stamps a debt, the next sync pays it. What
// it cannot see is a crash BETWEEN `ground.federate` landing the peer's deltas and `attestArrival`
// stamping them: no catch runs, so nothing writes the debt down. On restart the deltas are held,
// the door accepts none of them again, and the trail reads complete while those arrivals carry no
// stamp — silent, and undetectable without a scan (arrival-attestations.test.ts names this as its
// gap #3, and it is FROZEN — these rails live in their own file).
//
// The close under test (candidate 1): journal the INTENT before federating. The ids about to be
// ingested are appended as an OPTIMISTIC debt, so the crash window becomes an over-declared debt a
// later sync settles rather than a silent omission. Two interactions these rails pin directly:
//   1. the optimistic debt UNIONS with a debt already on the record — a naive overwrite would strand
//      a reported failure's unpaid custody, which the frozen T207 heal rail names exactly;
//   2. the declared refs are DEDUPED against what the pool already holds — so a crash-heal never
//      re-stamps a ref an earlier sync already stamped.
//
// THE RAILS READ THE GROUND, not a reader shipped beside the writer: arrival stamps are walked from
// their `loam.arrival` pointers and channel records from their `loam.channel` pointers, both by
// hand, so a writer and reader agreeing on a wrong shape cannot pass together.
//
// THE PEER'S DELTAS ARE OFFERED EXPLICITLY, not pulled from a whole store: a peer's real offer is
// its whole arrival log, genesis and all, which is noise for a rail that counts what a single
// arrival is stamped. `observed` signs with the seed alone, so the peer needs no gateway — the
// receiver federates the bare, self-contained claims it is handed.
//
// THE CRASH IS MODELLED, not real: `federate` lands the peer's batch for real and then throws,
// which reproduces exactly the on-disk state a dead process leaves — the deltas held, no stamp, and
// no failure catch having run. The next `sync()` then reads that persisted state precisely as a
// rebooted process would (the frozen heal rail models its restart the same way).

import { beforeEach, describe, expect, it } from "vitest";
import type { Delta } from "@bombadil/rhizomatic";
import { authorForSeed, verifyDelta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const ME_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const BRAM_SEED = "b0".repeat(32);
const ALICE = authorForSeed(ALICE_SEED);

// Vocabulary spelled out, never imported: these rails freeze the CONTEXT a later reader looks for,
// and an import would let a rename slip past them.
const CTX_ARRIVAL = "loam.arrival";
const CTX_CHANNEL = "loam.channel";

const pools = new Map<string, MemoryBackend>();
// Cleared per test: the pool NAME repeats across tests, and `backendFor` keys on it, so a backend
// reused across tests would carry one test's arrivals into the next.
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

/** A peer whose offer is a mutable list — push arrivals, then sync to deliver them. */
function peer(): { offering: Delta[]; source: { pull: () => Promise<Delta[]> } } {
  const offering: Delta[] = [];
  return { offering, source: { pull: () => Promise.resolve([...offering]) } };
}

interface Stamp {
  readonly deltaId: string;
  readonly channel: string;
  readonly from: string;
  readonly author: string;
  readonly at: number;
  readonly arrived: string[];
}

/** Every surviving arrival attestation in a pool, walked from the raw pointers. */
function stampsIn(pool: Gateway): Stamp[] {
  const out: Stamp[] = [];
  for (const d of pool.reactor.snapshot()) {
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
    );
    if (marker === undefined || marker.target.kind !== "entity") continue;
    // A struck stamp is not a standing one — suppression is a property of the operand set (H1).
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
      channel: marker.target.entity.id.startsWith("channel:")
        ? marker.target.entity.id.slice("channel:".length)
        : marker.target.entity.id,
      from: from?.target.kind === "primitive" ? String(from.target.value) : "",
      author: d.claims.author,
      at: d.claims.timestamp,
      arrived,
    });
  }
  return out;
}

/** The union of every ref the given stamps carry. */
const refsOf = (stamps: readonly Stamp[]): string[] => stamps.flatMap((s) => s.arrived);
const countOf = (refs: readonly string[], id: string): number =>
  refs.filter((r) => r === id).length;

interface Record {
  readonly deltaId: string;
  readonly at: number;
  readonly unattested: string[];
}

/**
 * Every channel record this store's operator has WRITTEN, superseded ones included — the count is
 * the whole point, so this walks the raw snapshot rather than the latest-wins reader.
 */
function channelRecords(gw: Gateway): Record[] {
  const out: Record[] = [];
  for (const d of gw.reactor.snapshot()) {
    if (d.claims.author !== gw.operator) continue;
    const marker = d.claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    );
    if (marker === undefined) continue;
    const unattested: string[] = [];
    for (const p of d.claims.pointers) {
      if (p.role === "unattested" && p.target.kind === "primitive") {
        unattested.push(String(p.target.value));
      }
    }
    out.push({ deltaId: d.id, at: d.claims.timestamp, unattested });
  }
  return out;
}

/** The records in `after` that were not already in `before`, by delta id. */
function added(before: readonly Record[], after: readonly Record[]): Record[] {
  const seen = new Set(before.map((r) => r.deltaId));
  return after.filter((r) => !seen.has(r.deltaId));
}

/**
 * Every operator-authored, NOT-struck channel record for one pool — the delta-level live view a
 * resurrection would climb back into. `dropChannel` strikes every live record for the pool, so this
 * reads empty after a sever and any new live record here is a re-stamp.
 */
const liveRecords = (gw: Gateway, name: string): string[] =>
  [...gw.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.author === gw.operator &&
        d.claims.pointers.some(
          (p) =>
            p.target.kind === "entity" &&
            p.target.entity.context === CTX_CHANNEL &&
            p.target.entity.id === `channel:${name}`,
        ) &&
        gw.reactor.negationsOf(d.id).length === 0,
    )
    .map((d) => d.id);

const isStamp = (d: Delta): boolean =>
  d.claims.pointers.some(
    (p) => p.target.kind === "entity" && p.target.entity.context === CTX_ARRIVAL,
  );

/**
 * Simulate a crash AFTER `federate` lands the peer's batch and BEFORE anything stamps it.
 *
 * The peer's data batch is the one call carrying a delta signed by someone other than the receiver.
 * It is landed for real — the deltas ARE in the pool — and then a throw stands in for the process
 * dying: no failure catch runs, exactly as a real crash leaves it. Fires once; `restore` lets the
 * next sync heal.
 */
function crashAfterArrivalsLand(
  pool: Gateway,
  receiver: string,
): { seen: { hits: number }; restore: () => void } {
  const real = pool.federate.bind(pool);
  const seen = { hits: 0 };
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    const isPeerBatch = all.some((d) => d.claims.author !== receiver && !isStamp(d));
    const landed = await real(all, opts);
    if (isPeerBatch && seen.hits === 0) {
      seen.hits += 1;
      throw new Error("simulated crash: the process died after federate landed the arrivals");
    }
    return landed;
  };
  return { seen, restore: () => (pool.federate = real) };
}

/**
 * Simulate a crash AFTER the optimistic journal lands and BEFORE `federate` ingests anything — the
 * new window the fix opens. The peer's batch throws before `real` runs, so the deltas never pool,
 * exactly as a process that died between the two writes leaves it. Fires once; `restore` lets the
 * next sync self-correct.
 */
function crashBeforeIngest(
  pool: Gateway,
  receiver: string,
): { seen: { hits: number }; restore: () => void } {
  const real = pool.federate.bind(pool);
  const seen = { hits: 0 };
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    const isPeerBatch = all.some((d) => d.claims.author !== receiver && !isStamp(d));
    if (isPeerBatch && seen.hits === 0) {
      seen.hits += 1;
      throw new Error("simulated crash: the process died after journaling, before federate");
    }
    return real(all, opts);
  };
  return { seen, restore: () => (pool.federate = real) };
}

/** Make the pool's door throw on the first attestation batch — a REPORTED failure, T207's path. */
function failStampsOnce(pool: Gateway): { restore: () => void } {
  const real = pool.federate.bind(pool);
  let fired = false;
  pool.federate = async (deltas, opts) => {
    const all = [...deltas];
    if (!fired && all.length > 0 && all.every(isStamp)) {
      fired = true;
      throw new Error("simulated stamp-door failure");
    }
    return real(all, opts);
  };
  return { restore: () => (pool.federate = real) };
}

describe("T222 — a crash between federate and attest heals or names its own gap", () => {
  it("(a) a crash after arrivals land is healed on the next sync, and a clean bystander is not re-stamped", async () => {
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = channel.pool.gateway!;

      // A clean first sync stamps X once — X is the BYSTANDER the crash-heal must not touch.
      const x = observed(FERN, "height", 10, 1000, ALICE_SEED);
      offering.push(x);
      const clean = await channel.sync();
      expect(clean.accepted).toBe(1);
      const afterClean = stampsIn(pool);
      expect(refsOf(afterClean)).toEqual([x.id]);
      const cleanSyncedAt = me.channelStatus(channel.name)[0]!.lastSyncedAt;
      expect(cleanSyncedAt).toBeGreaterThan(0);

      // Y arrives, and the process crashes after it lands but before it is stamped.
      const y = observed(FERN, "height", 20, 2000, ALICE_SEED);
      offering.push(y);
      const crash = crashAfterArrivalsLand(pool, me.operator!);
      await expect(channel.sync()).rejects.toThrow(/simulated crash/);
      expect(crash.seen.hits).toBe(1); // the premise: the crash fired exactly once
      crash.restore();

      // THE CRASH STATE, both levels. DELTA: Y is in the pool, and no stamp names it yet.
      expect(pool.reactor.get(y.id)).toBeDefined();
      expect(refsOf(stampsIn(pool))).toEqual([x.id]);
      // OBJECT: the record no longer reads complete — it names Y as owed, and NOT the bystander X
      // (deduped, since X was already held). The counters are carried forward, not a failure: the
      // crash bypassed the catch, so nothing counted a failure and the clock did not move.
      const crashed = me.channelStatus(channel.name)[0]!;
      expect(crashed.unattested).toContain(y.id);
      expect(crashed.unattested).not.toContain(x.id);
      expect(crashed.consecutiveFailures).toBe(0);
      expect(crashed.lastSyncedAt).toBe(cleanSyncedAt);

      // THE HEAL. The peer says nothing new, so the door accepts none — the debt alone is stamped.
      const heal = await channel.sync();
      expect(heal.accepted).toBe(0);

      // DELTA: Y is now named exactly once, and X is still named exactly once — no ref twice.
      const healed = stampsIn(pool);
      const refs = refsOf(healed);
      expect(countOf(refs, y.id)).toBe(1);
      expect(countOf(refs, x.id)).toBe(1);
      expect(new Set(refs).size).toBe(refs.length);
      const yStamp = healed.find((s) => s.arrived.includes(y.id))!;
      expect(yStamp.channel).toBe(channel.name);
      expect(yStamp.from).toBe("https://alice.example/loam");
      expect(yStamp.author).toBe(me.operator);
      expect(yStamp.author).not.toBe(ALICE);
      expect(verifyDelta(pool.reactor.get(yStamp.deltaId)!)).toBe("verified");

      // OBJECT: the record is clean again, and the clock has moved past the crash.
      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(cleanSyncedAt);
    } finally {
      await me.close();
    }
  });

  it("(a2) the optimistic debt UNIONS with a reported failure's debt, and both heal together", async () => {
    // INTERACTION 1. A reported failure leaves a debt on the record; a crash then arrives with a new
    // delta. A naive overwrite would drop the standing debt — so the record must name BOTH, and the
    // heal must stamp BOTH.
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = channel.pool.gateway!;

      // A REPORTED failure: the deltas land, the stamp door refuses, the debt is written down.
      const a = observed(FERN, "height", 30, 1000, ALICE_SEED);
      const b = observed(FERN, "height", 31, 1001, ALICE_SEED);
      offering.push(a, b);
      const fail = failStampsOnce(pool);
      await expect(channel.sync()).rejects.toThrow();
      fail.restore();
      const reported = me.channelStatus(channel.name)[0]!;
      expect(reported.consecutiveFailures).toBe(1);
      expect([...reported.unattested].sort()).toEqual([a.id, b.id].sort());
      expect(stampsIn(pool)).toEqual([]);
      expect(pool.reactor.get(a.id)).toBeDefined();
      expect(pool.reactor.get(b.id)).toBeDefined();

      // A NEW delta arrives, and the process crashes after it lands.
      const z = observed(FERN, "height", 32, 2000, ALICE_SEED);
      offering.push(z);
      const crash = crashAfterArrivalsLand(pool, me.operator!);
      await expect(channel.sync()).rejects.toThrow(/simulated crash/);
      expect(crash.seen.hits).toBe(1);
      crash.restore();

      // THE UNION: the record names the standing debt AND the new arrival — nothing stranded.
      const crashed = me.channelStatus(channel.name)[0]!;
      expect([...crashed.unattested].sort()).toEqual([a.id, b.id, z.id].sort());

      // THE HEAL: all three named, each exactly once, and the record clean again.
      const heal = await channel.sync();
      expect(heal.accepted).toBe(0);
      const refs = refsOf(stampsIn(pool));
      expect(new Set(refs)).toEqual(new Set([a.id, b.id, z.id]));
      expect(new Set(refs).size).toBe(refs.length);
      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await me.close();
    }
  });

  it("(b) anti-soup: a quiet sync writes one record, an accepting sync writes exactly one more", async () => {
    // The optimistic journal must cost one record per ACCEPTING sync, never one per poll. Counted on
    // the ground, both ways: an accepting sync writes the journal AND the success stamp; a quiet one
    // writes only the success stamp and no journal at all.
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const x = observed(FERN, "height", 40, 1000, ALICE_SEED);
      offering.push(x);

      // ACCEPTING: exactly two records — the optimistic journal (naming X) and the success stamp.
      const beforeAccept = channelRecords(me);
      const accept = await channel.sync();
      expect(accept.accepted).toBe(1);
      const addedAccept = added(beforeAccept, channelRecords(me));
      expect(addedAccept.length).toBe(2);
      const journals = addedAccept.filter((r) => r.unattested.length > 0);
      const cleared = addedAccept.filter((r) => r.unattested.length === 0);
      expect(journals.length).toBe(1); // one optimistic journal, and only one
      expect(cleared.length).toBe(1); // one success stamp that clears it
      expect(journals[0]!.unattested).toEqual([x.id]);
      expect(me.channelStatus(channel.name)[0]!.unattested).toEqual([]);

      // QUIET: exactly one record — the success stamp — and NO optimistic journal.
      const beforeQuiet = channelRecords(me);
      const quiet = await channel.sync();
      expect(quiet.accepted).toBe(0);
      const addedQuiet = added(beforeQuiet, channelRecords(me));
      expect(addedQuiet.length).toBe(1);
      expect(addedQuiet.every((r) => r.unattested.length === 0)).toBe(true);

      // A third poll, for the standing-sync reason: still one record, still no journal.
      const beforeThird = channelRecords(me);
      await channel.sync();
      const addedThird = added(beforeThird, channelRecords(me));
      expect(addedThird.length).toBe(1);
      expect(addedThird.every((r) => r.unattested.length === 0)).toBe(true);
    } finally {
      await me.close();
    }
  });

  it("(a3) the journal refuses to resurrect a severed channel [T233 intersection]", async () => {
    // The journal is a NEW stamp site, and it fires BEFORE `federate` — so on a severed channel a
    // real-delta poll reaches it first, ahead of the closed pool. Its `opening: false` must let the
    // T233 severed-lineage guard refuse; a flip to `opening: true` would let the journal mint a fresh
    // operator-signed record and resurrect the channel, silently undoing T233.
    const me = await store(ME_SEED);
    try {
      // BYSTANDER: a live channel, never dropped — it proves the guard refuses the SEVERED case only,
      // not journalling in general.
      const live = peer();
      const bram = await me.openChannel({
        into: "friends",
        prefix: "bram",
        from: "https://bram.example/loam",
        source: live.source,
      });
      live.offering.push(observed(FERN, "height", 1, 500, BRAM_SEED));
      await bram.sync();
      expect(me.channelStatus("channel:friends:bram")).toHaveLength(1);

      // TARGET: opened, synced (a real record), then severed.
      const target = peer();
      const alice = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source: target.source,
      });
      target.offering.push(observed(FERN, "height", 10, 1000, ALICE_SEED));
      await alice.sync();
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(1);

      await me.dropChannel("channel:friends:alice");
      // DELTA + OBJECT after the sever: the drop's strike stands, both readers agree severed.
      expect(liveRecords(me, "channel:friends:alice")).toEqual([]);
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(0);
      expect(me.channelsEver("channel:friends:alice")).toHaveLength(1);

      // THE STALE HANDLE offers a NEW delta, so `declared.length > owed.length` and the journal WOULD
      // fire. `opening: false` makes the severed guard refuse instead. Reverted to `true`, the journal
      // stamps and `channelStatus` climbs back to 1 — the resurrection this rail forbids.
      target.offering.push(observed(FERN, "height", 20, 2000, ALICE_SEED));
      await expect(alice.sync()).rejects.toThrow(/severed/);

      // DELTA + OBJECT: the refused journal minted nothing; still severed in both readings.
      expect(liveRecords(me, "channel:friends:alice")).toEqual([]);
      expect(me.channelStatus("channel:friends:alice")).toHaveLength(0);
      expect(me.channelsEver("channel:friends:alice")).toHaveLength(1);

      // TWO-SIDED: the bystander is live, so a new arrival journals and stamps as normal. Without
      // this, a guard that refused every journal would pass every assertion above.
      live.offering.push(observed(FERN, "height", 2, 600, BRAM_SEED));
      const bramBefore = channelRecords(me).length;
      const bramSync = await bram.sync();
      expect(bramSync.accepted).toBe(1);
      expect(me.channelStatus("channel:friends:bram")).toHaveLength(1);
      // The journal AND the success stamp both landed — the live path is untouched.
      expect(channelRecords(me).length).toBe(bramBefore + 2);
    } finally {
      await me.close();
    }
  });

  it("(b2) a crash BETWEEN the journal and federate self-corrects, and a gone delta never stamps", async () => {
    // THE NEW WINDOW the fix opens: the journal lands, then the process dies before `federate`
    // ingests. The arrivals never pool, so the debt the journal wrote over-declares them — honest,
    // because the owed-filter drops any that never come back, and nothing is ever stamped that did
    // not land.
    const me = await store(ME_SEED);
    try {
      const { offering, source } = peer();
      const channel = await me.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://alice.example/loam",
        source,
      });
      const pool = channel.pool.gateway!;

      // Two arrivals are journalled, then the crash lands before `federate` takes either. W will be
      // re-offered and must heal; V vanishes (a rejected or withdrawn delta) and must NEVER stamp.
      const w = observed(FERN, "height", 50, 1000, ALICE_SEED);
      const v = observed(FERN, "height", 51, 1001, ALICE_SEED);
      offering.push(w, v);
      const crash = crashBeforeIngest(pool, me.operator!);
      await expect(channel.sync()).rejects.toThrow(/before federate/);
      expect(crash.seen.hits).toBe(1);
      crash.restore();

      // CRASH STATE. DELTA: neither delta pooled, and no stamp names either.
      expect(pool.reactor.get(w.id)).toBeUndefined();
      expect(pool.reactor.get(v.id)).toBeUndefined();
      expect(stampsIn(pool)).toEqual([]);
      // OBJECT: the journal over-declared both as owed — the honest, self-correcting shape.
      const crashed = me.channelStatus(channel.name)[0]!;
      expect([...crashed.unattested].sort()).toEqual([w.id, v.id].sort());

      // THE HEAL. The peer re-offers only W; V is gone for good.
      offering.length = 0;
      offering.push(w);
      const heal = await channel.sync();
      expect(heal.accepted).toBe(1); // W lands this time; V does not

      // DELTA, both sides: W pooled and stamped EXACTLY once; V never pooled, never stamped — the
      // owed-filter dropped the phantom, so no stamp names a delta the pool does not hold.
      expect(pool.reactor.get(w.id)).toBeDefined();
      expect(pool.reactor.get(v.id)).toBeUndefined();
      const refs = refsOf(stampsIn(pool));
      expect(countOf(refs, w.id)).toBe(1);
      expect(refs).not.toContain(v.id);
      expect(new Set(refs).size).toBe(refs.length);
      // OBJECT: the debt clears — W settled, V dropped, nothing stranded.
      const healthy = me.channelStatus(channel.name)[0]!;
      expect(healthy.unattested).toEqual([]);
      expect(healthy.consecutiveFailures).toBe(0);
      expect(healthy.lastSyncedAt).toBeGreaterThan(0);
    } finally {
      await me.close();
    }
  });
});
