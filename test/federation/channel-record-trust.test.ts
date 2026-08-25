// T217 — a channel record is the OPERATOR's record, and a record that does not read back as its
// own shapes is UNREADABLE rather than healthy.
//
// `readChannels` is the single reader behind every channel surface: `loam federate list`, the
// /admin channels panel, and `loam_federate_status`. It scanned the root ground for any delta
// carrying a `loam.channel` entity pointer, took latest-wins by timestamp with NO author check, and
// coerced every field toward health — `receiving !== false`, `Number(x ?? 0)`. Two false reports
// followed, and this file covers both:
//
//   1. a writer the door admits could append a newer channel-shaped record and move a real
//      channel's toggles on every reader; and
//   2. a partially legible record read as a healthy channel that had never synced, which is the
//      same answer a real quiet channel gives.
//
// What it asserts, at both levels:
//   - DELTA LEVEL: each forged delta really is in the ground and really is not struck, so every
//     assertion below is about what the READER does with it rather than about a door that turned
//     it away. Where the operator's own act is the two-sided half, the same is asserted of it.
//   - OBJECT LEVEL: what `channelStatus` and `channelsEver` answer, what a GraphQL read of a
//     channel-scoped lens resolves, and what a person reads from `loam federate list`.
//
// Every test here names a live bystander channel that must keep reading exactly as it did: a reader
// that answered "nothing" would satisfy the forgery half of every assertion otherwise.
//
// What it deliberately does NOT assert, and why:
//   - the /admin panel row — `test/server/admin-channel-unreadable.test.ts` owns it;
//   - `loam_federate_status` — `test/server/federate-mcp.test.ts` owns it;
//   - THE `unattested` ILLEGIBILITY RULE. `readChannels` condemns a custody-debt pointer that is
//     not a primitive, and no product writer can produce one: `channelRecordClaims` writes every
//     debt id as a primitive, and a foreign delta is already refused by the author filter. Reaching
//     it needs a hand-rolled delta, which this file refuses to build on principle — a guard proved
//     against a shape nothing writes proves nothing. It is defence in depth for the day the author
//     filter changes, and it is unrailed on purpose rather than by oversight.
//   - curse records (`cursesOf`), which are read with no author filter and no lawful-negation
//     filter of their own — so a write-granted stranger can still lift an operator's curse and let
//     the next poll re-bless a retired lens. Confirmed by review on this diff; it is a separate
//     reading with a separate blast radius and it needs its own ticket.
//   - `syncChannel` on a SEVERED channel. A caller still holding the handle can re-stamp a channel
//     back into existence after a drop, because sync treats "no record" as "a new channel". Also
//     pre-existing, also its own ticket.
//
// Erasure standing rule: every store here is this file's own MemoryBackend or mkdtemp fixture.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Claims,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { CTX_CHANNEL, channelRecordClaims } from "../../src/federation/channel.js";
import { exportOffer } from "../../src/federation/offer.js";
import { channelLens } from "../../src/gateway/reads.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

vi.setConfig({ testTimeout: 60_000 }); // the CLI half opens real sqlite homes and three channels

const OPERATOR_SEED = "17".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const STRANGER_SEED = "b0".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);
const PEER_SEED = "c4".repeat(32);

const ALICE = "channel:friends:alice";
const BRAM = "channel:friends:bram";

const nothing = { pull: (): Promise<never[]> => Promise.resolve([]) };

const grounds: Gateway[] = [];
afterEach(async () => {
  while (grounds.length > 0) await grounds.pop()!.close();
});

/**
 * A store with two channels the operator really opened: `alice`, synced once so it carries a real
 * time, and `bram`, opened and never synced.
 *
 * The stranger holds an ordinary WRITE grant. That is the threat this rail is about — a writer the
 * door admits on purpose, not one it turns away — and it is what makes the delta-level assertions
 * below meaningful: the forged deltas land, and the reader is the only thing between them and every
 * channel surface.
 */
async function storeWithChannels(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] }),
  );
  grounds.push(gw);
  await gw.append([
    signClaims(
      grantClaims(STORE_ENTITY, STRANGER, "write", OPERATOR, gw.nextTimestamp()),
      OPERATOR_SEED,
    ),
  ]);
  const alice = await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
  await alice.sync();
  await gw.openChannel({ into: "friends", prefix: "bram", source: nothing });
  return gw;
}

/** Every channel record in the ground for one pool, newest last — the delta-level view. */
const recordsFor = (gw: Gateway, pool: string): Delta[] =>
  [...gw.reactor.snapshot()]
    .filter((d) =>
      d.claims.pointers.some(
        (p) =>
          p.target.kind === "entity" &&
          p.target.entity.context === CTX_CHANNEL &&
          p.target.entity.id === `channel:${pool}`,
      ),
    )
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp);

/** The newest timestamp any record for this pool carries — what a forgery must beat to win. */
const newestAt = (gw: Gateway, pool: string): number =>
  Math.max(...recordsFor(gw, pool).map((d) => d.claims.timestamp));

/**
 * Append a record for `pool` built by the PRODUCT's own `channelRecordClaims`, with the caller's
 * edit applied. A hand-rolled delta would prove the reader against a shape nothing writes.
 */
async function append(
  gw: Gateway,
  pool: string,
  edit: Record<string, unknown>,
  author: { key: string; seed: string },
  at: number,
): Promise<Delta> {
  const status = gw.channelStatus(pool)[0] ?? gw.channelsEver(pool)[0]!;
  const delta = signClaims(
    channelRecordClaims({ ...status, ...edit }, author.key, at),
    author.seed,
  );
  await gw.append([delta]);
  return delta;
}

const OP = { key: OPERATOR, seed: OPERATOR_SEED };
const THEM = { key: STRANGER, seed: STRANGER_SEED };

/**
 * Drop ONE pointer from a channel's live record and append the result — the partially legible
 * record, in the product's own shape minus a role.
 *
 * The timestamp comes from the store's own clock rather than a future offset. A record stamped
 * AHEAD of the clock wins latest-wins against every later write, so a rail about what a later write
 * does would silently be reading the fixture back instead of the write it meant to test.
 */
async function truncate(gw: Gateway, pool: string, role: string): Promise<void> {
  const built = channelRecordClaims(gw.channelStatus(pool)[0]!, OPERATOR, gw.nextTimestamp());
  await gw.append([
    signClaims(
      { ...built, pointers: built.pointers.filter((p) => p.role !== role) },
      OPERATOR_SEED,
    ),
  ]);
}

describe("T217 (a) — a channel record is the operator's record or it is not one", () => {
  it("a stranger's NEWER record moves nothing, and the real record still reads", async () => {
    const gw = await storeWithChannels();
    const real = gw.channelStatus(ALICE)[0]!;
    // A hand-written wall-clock floor (2025-08-12), not a value read from the thing under test: a
    // stamp of 1 would satisfy `> 0` while proving the clock was never consulted.
    expect(real.lastSyncedAt).toBeGreaterThan(1755000000000);
    expect(real.receiving).toBe(true);
    expect(real.blessing).toBe(true);

    const beat = newestAt(gw, ALICE);
    const forged = await append(
      gw,
      ALICE,
      { receiving: false, blessing: false, lastSyncedAt: 0, consecutiveFailures: 99 },
      THEM,
      beat + 1_000_000,
    );

    // Delta level: the door TOOK it, it stands un-negated, and it BEATS the operator's newest
    // record on the clock. Latest-wins is the rule it rides, so without the author filter this
    // delta is the one every surface would read.
    expect(gw.reactor.get(forged.id)).toBeDefined();
    expect(gw.reactor.negationsOf(forged.id)).toHaveLength(0);
    expect(forged.claims.author).toBe(STRANGER);
    expect(forged.claims.timestamp).toBeGreaterThan(beat);

    // Object level: the answer is still the operator's record, field for field.
    const after = gw.channelStatus(ALICE);
    expect(after).toHaveLength(1);
    expect(after[0]!.receiving).toBe(true);
    expect(after[0]!.blessing).toBe(true);
    expect(after[0]!.consecutiveFailures).toBe(0);
    expect(after[0]!.lastSyncedAt).toBe(real.lastSyncedAt);

    // Two-sided on the filter itself: the OPERATOR's own newer record still governs, so this is an
    // authorship rule and not a store that has stopped reading its newest record.
    await gw.setChannel(ALICE, { receiving: false });
    expect(gw.channelStatus(ALICE)[0]!.receiving).toBe(false);
    expect(gw.channelStatus(ALICE)[0]!.blessing).toBe(true);
  });

  it("a stranger cannot INVENT a channel this store never opened", async () => {
    const gw = await storeWithChannels();
    const before = gw.channelStatus().map((c) => c.name);
    expect(before).toEqual([ALICE, BRAM]);

    const forged = await append(
      gw,
      ALICE,
      { name: "channel:friends:mallory", prefix: "mallory", from: "https://mallory.example" },
      THEM,
      newestAt(gw, ALICE) + 1_000_000,
    );
    expect(gw.reactor.get(forged.id)).toBeDefined();

    // Neither reading invents it. `channelsEver` is asked too: a severed channel survives there by
    // design, so a filter that covered only the live reading would leave the invented name standing
    // in the reading that decides whether a lens resolves over a pool.
    expect(gw.channelStatus().map((c) => c.name)).toEqual(before);
    expect(gw.channelsEver().map((c) => c.name)).toEqual(before);
    expect(gw.channelStatus("channel:friends:mallory")).toHaveLength(0);
  });

  it("a stranger's negation does not sever a channel, and the operator's does", async () => {
    const gw = await storeWithChannels();
    // Opened and never synced, so exactly one record carries it — one strike is the whole channel.
    const records = recordsFor(gw, BRAM);
    expect(records).toHaveLength(1);
    const target = records[0]!.id;

    const forged = signClaims(
      makeNegationClaims(STRANGER, gw.nextTimestamp(), target),
      STRANGER_SEED,
    );
    await gw.append([forged]);

    // Delta level: the strike is really filed against the record, and nothing has struck it back.
    expect(gw.reactor.negationsOf(target)).toContain(forged.id);
    expect(gw.reactor.negationsOf(forged.id)).toHaveLength(0);

    // Object level: the channel still stands, and still reads as receiving.
    expect(gw.channelStatus(BRAM)).toHaveLength(1);
    expect(gw.channelStatus(BRAM)[0]!.receiving).toBe(true);

    // Two-sided: the OPERATOR's strike does sever it — so this reads negations, it just does not
    // read a stranger's. `channelsEver` keeps the severed channel, which is what §46 promises.
    await gw.append([
      signClaims(makeNegationClaims(OPERATOR, gw.nextTimestamp(), target), OPERATOR_SEED),
    ]);
    expect(gw.channelStatus(BRAM)).toHaveLength(0);
    expect(gw.channelsEver(BRAM)).toHaveLength(1);
    // ...and the bystander channel is untouched by either strike.
    expect(gw.channelStatus(ALICE)).toHaveLength(1);
  });

  it("a stranger's negation cannot make a sever leave the channel standing", async () => {
    const gw = await storeWithChannels();
    const target = recordsFor(gw, BRAM)[0]!.id;
    // The sever asks "is this record already struck?" before it strikes. If it asked a WIDER
    // question than the reader answers, a stranger's negation would satisfy it — the sever would
    // skip the record, and `federate list` would keep printing a channel whose pool is purged.
    // That is the "one command said severed and the next said standing" defect, re-armed from
    // outside; the two questions must be the same question.
    await gw.append([
      signClaims(makeNegationClaims(STRANGER, gw.nextTimestamp(), target), STRANGER_SEED),
    ]);

    // A forged RECORD for the same channel sits here too, so the sever meets both shapes a
    // stranger can leave behind: a negation it must not count, and a record it must not act on.
    const forgedRecord = await append(gw, BRAM, {}, THEM, newestAt(gw, BRAM) + 1_000);

    await gw.dropChannel(BRAM);

    expect(gw.channelStatus(BRAM)).toHaveLength(0);
    expect(gw.channelsEver(BRAM)).toHaveLength(1);
    // THE SEVER WRITES ABOUT ITS OWN RECORDS AND NOTHING ELSE. A strike against a stranger's delta
    // would be the store signing a statement about a claim it already refuses to read.
    expect(gw.reactor.negationsOf(forgedRecord.id)).toHaveLength(0);
    // Two-sided, as every sever rail here is: the named bystander channel still stands.
    expect(gw.channelStatus(ALICE)).toHaveLength(1);
    expect(gw.channelStatus(ALICE)[0]!.receiving).toBe(true);
  });

  it("a store that cannot name its operator still reports its channels", async () => {
    // The author filter needs an author. An early `return []` for a seedless gateway looks like
    // the careful answer and is the dangerous one: `channelGroundFor` reads "no channel with that
    // prefix" as licence to resolve a peer's lens over the RECEIVER's own ground, which is T199's
    // measured disclosure. A reader that cannot tell must not answer "there is nothing".
    const backend = new MemoryBackend();
    const governed = await Gateway.boot(
      backend,
      assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] }),
    );
    grounds.push(governed);
    await governed.openChannel({ into: "friends", prefix: "alice", source: nothing });
    expect(governed.channelStatus()).toHaveLength(1);

    // The SAME bytes, read by a gateway holding no seed.
    const seedless = await Gateway.open(backend, {});
    grounds.push(seedless);
    expect(seedless.operatorAuthor).toBeUndefined();
    expect(seedless.channelStatus().map((c) => c.name)).toEqual([ALICE]);
    expect(seedless.channelStatus()[0]!.unreadable).toEqual([]);
  });
});

describe("T217 — the verdict survives the next write, and the next poll", () => {
  it("`setChannel` carries an unreadable role forward as unreadable", async () => {
    const gw = await storeWithChannels();
    await truncate(gw, BRAM, "lastSyncedAt");
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["lastSyncedAt"]);

    // The act `loam federate list` points a person at. It writes a NEW record built from the
    // condemned one's coerced fields — and `Number(undefined ?? 0)` is a perfectly legible 0, so
    // the verdict would be replaced by the very "never synced" it was drawn to refuse. Nothing
    // else in the store would ever say otherwise again.
    const returned = await gw.setChannel(BRAM, { receiving: false });

    // The toggle this call SET is legible: it is a fact of this act, not a coercion of the last.
    expect(returned.receiving).toBe(false);
    expect(gw.channelStatus(BRAM)[0]!.receiving).toBe(false);
    // ...and the role it could not read is still unreadable, in the record and in the answer.
    expect(returned.unreadable).toEqual(["lastSyncedAt"]);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["lastSyncedAt"]);

    // Two-sided: a set over a LEGIBLE record writes a fully legible record, so the rule above is
    // about the condemned roles and not a store that has stopped writing fields.
    await gw.setChannel(ALICE, { blessing: false });
    const good = gw.channelStatus(ALICE)[0]!;
    expect(good.unreadable).toEqual([]);
    expect(good.blessing).toBe(false);
    expect(good.lastSyncedAt).toBeGreaterThan(1755000000000);
  });

  it("a failing sync does not count up from a number it could not read", async () => {
    const gw = await storeWithChannels();
    // Its OWN channel, opened with a peer that never answers — `openChannel` is idempotent by
    // name, so re-opening an existing prefix would hand back the fixture's healthy source and this
    // rail would test nothing.
    const CAROL = "channel:friends:carol";
    const dead = {
      pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
    };
    const channel = await gw.openChannel({ into: "friends", prefix: "carol", source: dead });
    await truncate(gw, CAROL, "consecutiveFailures");
    expect(gw.channelStatus(CAROL)[0]!.unreadable).toEqual(["consecutiveFailures"]);

    // The no-human path: a standing sync polls, the peer does not answer, and the failure stamp
    // writes `(before.consecutiveFailures ?? 0) + 1`. Counting up from a condemned base invents a
    // count AND clears the verdict, with nobody watching. It is also the arithmetic that made a
    // failing sync throw a WRITE error out of its own catch block when the base was NaN, losing
    // the peer's real error on the way.
    await expect(channel.sync()).rejects.toThrow(/did not answer/);

    expect(gw.channelStatus(CAROL)[0]!.unreadable).toEqual(["consecutiveFailures"]);

    // TWO-SIDED, and it must be the same act: a failing sync over a LEGIBLE record still counts.
    // Without this, a store that had simply stopped counting failures would pass the assertion
    // above. `dave`'s peer is the same dead source; only its record differs.
    const DAVE = "channel:friends:dave";
    const dave = await gw.openChannel({ into: "friends", prefix: "dave", source: dead });
    expect(gw.channelStatus(DAVE)[0]!.consecutiveFailures).toBe(0);
    await expect(dave.sync()).rejects.toThrow(/did not answer/);
    expect(gw.channelStatus(DAVE)[0]!.consecutiveFailures).toBe(1);
    expect(gw.channelStatus(DAVE)[0]!.unreadable).toEqual([]);

    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });
});

describe("T217 (b) — a record that fails its own shapes is UNREADABLE at the reader", () => {
  it("a non-numeric lastSyncedAt is named, and the row and its NaN are kept in place", async () => {
    const gw = await storeWithChannels();
    await append(gw, BRAM, { lastSyncedAt: "soon" }, OP, newestAt(gw, BRAM) + 1_000);

    const bad = gw.channelStatus(BRAM)[0]!;
    expect(bad.unreadable).toContain("lastSyncedAt");
    // ADDITIVE, never a replacement and never a dropped row: the row still reads, the corrupt
    // field still carries its NaN, and the sibling field is still a good number. Every reader that
    // already knew this shape keeps working; the new marker is what the honest ones read.
    expect(Number.isNaN(bad.lastSyncedAt)).toBe(true);
    expect(Number.isFinite(bad.consecutiveFailures)).toBe(true);
    expect(bad.name).toBe(BRAM);

    // Two-sided: a legible channel carries no marker at all.
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a MISSING health field is unreadable, not the never-synced channel it used to read as", async () => {
    const gw = await storeWithChannels();
    const status = gw.channelStatus(BRAM)[0]!;
    const built = channelRecordClaims(status, OPERATOR, newestAt(gw, BRAM) + 1_000);
    // The product's own claims MINUS one pointer — the partially legible record, which is the
    // shape that used to be indistinguishable from a real quiet peer: `Number(undefined ?? 0)` is
    // 0, and 0 is exactly what a channel that has never synced carries.
    const truncated: Claims = {
      ...built,
      pointers: built.pointers.filter((p) => p.role !== "lastSyncedAt"),
    };
    await gw.append([signClaims(truncated, OPERATOR_SEED)]);

    const bad = gw.channelStatus(BRAM)[0]!;
    expect(bad.unreadable).toContain("lastSyncedAt");
    // The coercion is still what it always was — the row is honest ABOUT that 0, not repaired.
    expect(bad.lastSyncedAt).toBe(0);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a toggle that is not a boolean is unreadable, never the healthy default", async () => {
    const gw = await storeWithChannels();
    // `receiving !== false` answered TRUE for every value that is not the boolean false, so a
    // record carrying the word "yes" reported a channel as receiving. Both toggles are proved,
    // separately, so a guard that checked only one would leave the other defaulting to health.
    await append(gw, BRAM, { receiving: "yes" }, OP, newestAt(gw, BRAM) + 1_000);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["receiving"]);

    await append(gw, BRAM, { blessing: 1 }, OP, newestAt(gw, BRAM) + 1_000);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["blessing"]);

    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a negative count is unreadable — a finite number is not yet a health reading", async () => {
    const gw = await storeWithChannels();
    await append(gw, BRAM, { consecutiveFailures: -3 }, OP, newestAt(gw, BRAM) + 1_000);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["consecutiveFailures"]);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("every failed field is named, not the first one found", async () => {
    const gw = await storeWithChannels();
    await append(
      gw,
      BRAM,
      { lastSyncedAt: "soon", consecutiveFailures: "a few" },
      OP,
      newestAt(gw, BRAM) + 1_000,
    );
    // A marker that stopped at the first failure would let a person repair one field and believe
    // the record was legible again.
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["lastSyncedAt", "consecutiveFailures"]);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a peer address that is not text is unreadable, and the address is not invented", async () => {
    const gw = await storeWithChannels();
    // `from` is the one role that is legitimately ABSENT — `channelRecordClaims` omits it when
    // empty, so a record written before addresses existed reads back unchanged. Absence is
    // therefore legible and only a wrong SHAPE is not; both halves are asserted here, because a
    // check that condemned absence would mark every pre-address record in every store.
    await append(gw, BRAM, { from: 42 }, OP, newestAt(gw, BRAM) + 1_000);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["from"]);

    // The bystander's record carries no `from` at all, and reads clean.
    const bystander = gw.channelStatus(ALICE)[0]!;
    expect(bystander.unreadable).toEqual([]);
    expect(bystander.from).toBe("");
  });

  it("the WRITER still writes every role the reader demands", async () => {
    // RECORD_SHAPES rests on a claim about history: every record `channelRecordClaims` has ever
    // written carries all six roles, so an absent one is a record this store cannot read rather
    // than an older one it should tolerate. Nothing pins history — but the half that can still
    // change is the WRITER, and this pins that. Add a seventh role to the reader without the
    // writer and every record in every store reads unreadable; drop a role from the writer and
    // the same. Either way this names the premise being broken, on the day it breaks.
    const gw = await storeWithChannels();
    const full = gw.channelStatus(ALICE)[0]!;
    expect(full.unreadable).toEqual([]);

    const written = channelRecordClaims(full, OPERATOR, newestAt(gw, ALICE) + 1_000);
    const roles = new Set(written.pointers.map((p) => p.role));
    for (const role of [
      "into",
      "prefix",
      "receiving",
      "blessing",
      "lastSyncedAt",
      "consecutiveFailures",
    ]) {
      expect(roles.has(role), `the writer no longer writes "${role}"`).toBe(true);
      // ...and the reader demands exactly this set: drop the role the writer just wrote and the
      // verdict names it. That is what keeps the two lists from drifting apart silently.
      await gw.append([
        signClaims(
          {
            ...written,
            timestamp: newestAt(gw, ALICE) + 1_000,
            pointers: written.pointers.filter((p) => p.role !== role),
          },
          OPERATOR_SEED,
        ),
      ]);
      expect(
        gw.channelStatus(ALICE)[0]!.unreadable,
        `the reader tolerates a missing "${role}"`,
      ).toContain(role);
    }

    // Two-sided: the untouched record is legible, so the loop above is not simply condemning
    // everything it is handed.
    await gw.append([
      signClaims({ ...written, timestamp: newestAt(gw, ALICE) + 1_000 }, OPERATOR_SEED),
    ]);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });
});

describe("T217 — an illegible prefix refuses the read rather than answering from the wrong ground", () => {
  it("the query door refuses, and never answers from the receiver's own ground", async () => {
    // A receiver holding a channel lens AND a private claim of its own at the same entity. 11 is
    // the peer's height and the right answer; 999 is the receiver's own and must never escape.
    const alice = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: PEER_SEED, registrations: [] }),
    );
    grounds.push(alice);
    const me = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] }),
    );
    grounds.push(me);
    await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await alice.append([observed(FERN, "height", 11, 1000, PEER_SEED)]);

    // A SECOND illegible channel, opened FIRST so it sorts ahead of alice's in the reader's
    // first-append order. It is what forces the lookup to match on BOTH halves: a search that
    // accepted "illegible" OR "this name's prefix" would find this one and refuse in its name,
    // telling a person to go and look at a channel that has nothing to do with their lens.
    const other = await me.openChannel({ into: "friends", prefix: "bram", source: nothing });
    await truncate(me, other.name, "prefix");
    expect(me.channelStatus(other.name)[0]!.unreadable).toEqual(["prefix"]);

    const ch = await me.openChannel({
      into: "friends",
      prefix: "alice",
      source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
    });
    await ch.sync();
    await me.append([observed(FERN, "height", 999, 5000, OPERATOR_SEED)]);

    // TWO-SIDED, and asserted FIRST so the fixture is proven to serve before it is broken.
    const before = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(before.errors, JSON.stringify(before)).toBeUndefined();
    expect((before.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(11);

    // `channelGroundFor` matches a lens to its channel BY PREFIX. A record whose prefix does not
    // read as text coerces to "" and matches nothing, so the lookup misses and the fall-through
    // resolves the peer's lens over the RECEIVER's ground — T199's measured disclosure, reached
    // through illegibility instead of through a sever. The channel's NAME still carries the prefix
    // structurally, and that is the identity that makes the refusal possible at all.
    await truncate(me, ch.name, "prefix");
    expect(me.channelStatus(ch.name)[0]!.unreadable).toEqual(["prefix"]);
    expect(me.channelStatus(ch.name)[0]!.prefix).toBe("");

    const after = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    // The half that matters: the receiver's own 999 did not answer in the peer's name.
    expect(JSON.stringify(after.data ?? {})).not.toContain("999");
    const said = JSON.stringify(after.errors ?? []);
    expect(said).toMatch(/does not carry its prefix/);
    // ...and it names THIS lens's channel, not the other illegible one.
    expect(said).toContain(ch.name);
    expect(said).not.toContain(other.name);

    // THE SUBSCRIPTION DOOR TOO. It cannot scope a channel lens at all, so it refuses one by
    // asking `channelLens` — and a reader that answered "not a channel lens" for an illegible
    // prefix would stop that refusal and stream the receiver's own ground instead.
    await expect(
      me.subscribe(`subscription { alice_Plant(entity: "${FERN}") { height } }`),
    ).rejects.toThrow(/federation channel/);

    // ...and it must answer for THIS lens's channel rather than for whichever illegible channel
    // happens to exist. Asked directly, because the difference is only visible for a namespaced
    // lens that belongs to NO channel — and such a lens is by construction not registered here, so
    // no door can be driven to show it. A reader that matched any illegible channel would refuse
    // ordinary namespaced reads right across the store.
    expect(channelLens(me, "alice:Plant")).toBe(true);
    expect(channelLens(me, "zed:Plant")).toBe(false);

    // Two-sided on that door: an ordinary lens, in a store with no channel at all, still
    // subscribes. Without this a `channelLens` that answered TRUE for everything would satisfy the
    // refusal above and break every subscription in the store. It needs its own store because
    // `alice:Plant` already serves this law here, and identical law does not bind twice.
    const solo = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: "d5".repeat(32), registrations: [] }),
    );
    grounds.push(solo);
    await solo.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    const stream = await solo.subscribe(`subscription { plant(entity: "${FERN}") { height } }`);
    expect(stream).toBeDefined();
    await stream.return?.(undefined);
  });
});

describe("T217 (b) — `loam federate list` renders the unreadable record as unreadable", () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];
  const io = (): { out: (s: string) => void; err: (s: string) => void } => ({
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  const said = (): string => [...out, ...err].join("\n");
  /** One channel's own block: `federate list` prints each channel with a single `out` call. */
  const blockFor = (pool: string): string => out.find((s) => s.startsWith(`${pool}\n`)) ?? "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "loam-t217-cli-"));
    out.length = 0;
    err.length = 0;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("names the fields it cannot read, and leaves a legible channel reading as it did", async () => {
    const home = join(root, "me");
    expect(await run(["init", "--home", home, "--seed", OPERATOR_SEED], io())).toBe(0);

    // A frozen offer is a channel source exactly as a live peer is (§46 criteria 1 and 2), so the
    // channels below are opened THROUGH the shipped command rather than assembled beside it.
    const peer = await Gateway.open(new MemoryBackend(), { seed: PEER_SEED });
    const offer = join(root, "peer.json");
    writeFileSync(offer, exportOffer(peer));
    await peer.close();

    for (const prefix of ["alice", "bram", "carol"]) {
      out.length = 0;
      err.length = 0;
      const code = await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          prefix,
          "--home",
          home,
        ],
        io(),
      );
      expect(code, said()).toBe(0);
    }

    // Two records this command has no honest reading of, written by the OPERATOR so the author
    // filter is not what this half is about: one field absent, one field the wrong type.
    const ground = await Gateway.open(new SqliteBackend(storePath(home)), { seed: OPERATOR_SEED });
    const at = ground.nextTimestamp() + 1_000_000;
    const built = channelRecordClaims(ground.channelStatus(BRAM)[0]!, OPERATOR, at);
    await ground.append([
      signClaims(
        { ...built, pointers: built.pointers.filter((p) => p.role !== "lastSyncedAt") },
        OPERATOR_SEED,
      ),
      signClaims(
        channelRecordClaims(
          { ...ground.channelStatus("channel:friends:carol")[0]!, lastSyncedAt: "soon" as never },
          OPERATOR,
          at,
        ),
        OPERATOR_SEED,
      ),
    ]);
    await ground.close();

    out.length = 0;
    err.length = 0;
    expect(await run(["federate", "list", "--home", home], io()), said()).toBe(0);

    // The legible channel reads exactly as it always did — the two-sided half, and the one that
    // fails if the command simply gave up on every row.
    const good = blockFor(ALICE);
    expect(good).toContain("receiving");
    expect(good).toMatch(/last synced \d{4}-\d{2}-\d{2}T/);
    expect(good).not.toContain("UNREADABLE");

    for (const [pool, field] of [
      [BRAM, "lastSyncedAt"],
      ["channel:friends:carol", "lastSyncedAt"],
    ] as const) {
      const bad = blockFor(pool);
      expect(bad, `no block printed for ${pool}`).not.toBe("");
      expect(bad).toContain("UNREADABLE");
      // It NAMES the field, so a person can look at the record rather than at a guess.
      expect(bad).toContain(field);
      // And it invents nothing: no time, no word for a health it cannot read.
      expect(bad).not.toContain("never synced");
      expect(bad).not.toContain("last synced");
      expect(bad).not.toContain("NaN");
      expect(bad).not.toContain("Invalid Date");
    }
  });
});
