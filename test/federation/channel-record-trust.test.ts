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
import { withStamp } from "../../src/gateway/stamp.js";
import { exportOffer } from "../../src/federation/offer.js";
import { channelLens } from "../../src/gateway/reads.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

vi.setConfig({ testTimeout: 60_000 });

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

async function storeWithChannels(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] }),
  );
  grounds.push(gw);
  await gw.append([
    signClaims(
      withStamp(gw.stamp(OPERATOR), (t) =>
        grantClaims(STORE_ENTITY, STRANGER, "write", OPERATOR, t),
      ),
      OPERATOR_SEED,
    ),
  ]);
  const alice = await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
  await alice.sync();
  await gw.openChannel({ into: "friends", prefix: "bram", source: nothing });
  return gw;
}

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

const newestAt = (gw: Gateway, pool: string): number =>
  Math.max(...recordsFor(gw, pool).map((d) => d.claims.timestamp));

const recordClaims = (
  gw: Gateway,
  status: Parameters<typeof channelRecordClaims>[0],
  author: string,
  at: number,
): Claims =>
  withStamp({ timestamp: at, validFrom: gw.now() }, (t) => channelRecordClaims(status, author, t));

async function append(
  gw: Gateway,
  pool: string,
  edit: Record<string, unknown>,
  author: { key: string; seed: string },
  at: number,
): Promise<Delta> {
  const status = gw.channelStatus(pool)[0] ?? gw.channelsEver(pool)[0]!;
  const delta = signClaims(recordClaims(gw, { ...status, ...edit }, author.key, at), author.seed);
  await gw.append([delta]);
  return delta;
}

const OP = { key: OPERATOR, seed: OPERATOR_SEED };
const THEM = { key: STRANGER, seed: STRANGER_SEED };

async function truncate(gw: Gateway, pool: string, role: string): Promise<void> {
  const built = recordClaims(gw, gw.channelStatus(pool)[0]!, OPERATOR, gw.nextTimestamp());
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

    expect(gw.reactor.get(forged.id)).toBeDefined();
    expect(gw.reactor.negationsOf(forged.id)).toHaveLength(0);
    expect(forged.claims.author).toBe(STRANGER);
    expect(forged.claims.timestamp).toBeGreaterThan(beat);

    const after = gw.channelStatus(ALICE);
    expect(after).toHaveLength(1);
    expect(after[0]!.receiving).toBe(true);
    expect(after[0]!.blessing).toBe(true);
    expect(after[0]!.consecutiveFailures).toBe(0);
    expect(after[0]!.lastSyncedAt).toBe(real.lastSyncedAt);

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

    expect(gw.channelStatus().map((c) => c.name)).toEqual(before);
    expect(gw.channelsEver().map((c) => c.name)).toEqual(before);
    expect(gw.channelStatus("channel:friends:mallory")).toHaveLength(0);
  });

  it("a stranger's negation does not sever a channel, and the operator's does", async () => {
    const gw = await storeWithChannels();
    const records = recordsFor(gw, BRAM);
    expect(records).toHaveLength(1);
    const target = records[0]!.id;

    const forged = signClaims(
      withStamp(gw.stamp(STRANGER), (t) => makeNegationClaims(STRANGER, t, target)),
      STRANGER_SEED,
    );
    await gw.append([forged]);

    expect(gw.reactor.negationsOf(target)).toContain(forged.id);
    expect(gw.reactor.negationsOf(forged.id)).toHaveLength(0);

    expect(gw.channelStatus(BRAM)).toHaveLength(1);
    expect(gw.channelStatus(BRAM)[0]!.receiving).toBe(true);

    await gw.append([
      signClaims(
        withStamp(gw.stamp(OPERATOR), (t) => makeNegationClaims(OPERATOR, t, target)),
        OPERATOR_SEED,
      ),
    ]);
    expect(gw.channelStatus(BRAM)).toHaveLength(0);
    expect(gw.channelsEver(BRAM)).toHaveLength(1);
    expect(gw.channelStatus(ALICE)).toHaveLength(1);
  });

  it("a stranger's negation cannot make a sever leave the channel standing", async () => {
    const gw = await storeWithChannels();
    const target = recordsFor(gw, BRAM)[0]!.id;
    await gw.append([
      signClaims(
        withStamp(gw.stamp(STRANGER), (t) => makeNegationClaims(STRANGER, t, target)),
        STRANGER_SEED,
      ),
    ]);

    const forgedRecord = await append(gw, BRAM, {}, THEM, newestAt(gw, BRAM) + 1_000);

    await gw.dropChannel(BRAM);

    expect(gw.channelStatus(BRAM)).toHaveLength(0);
    expect(gw.channelsEver(BRAM)).toHaveLength(1);
    expect(gw.reactor.negationsOf(forgedRecord.id)).toHaveLength(0);
    expect(gw.channelStatus(ALICE)).toHaveLength(1);
    expect(gw.channelStatus(ALICE)[0]!.receiving).toBe(true);
  });

  it("a store that cannot name its operator still reports its channels", async () => {
    const backend = new MemoryBackend();
    const governed = await Gateway.boot(
      backend,
      assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] }),
    );
    grounds.push(governed);
    await governed.openChannel({ into: "friends", prefix: "alice", source: nothing });
    expect(governed.channelStatus()).toHaveLength(1);

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

    const returned = await gw.setChannel(BRAM, { receiving: false });

    expect(returned.receiving).toBe(false);
    expect(gw.channelStatus(BRAM)[0]!.receiving).toBe(false);
    expect(returned.unreadable).toEqual(["lastSyncedAt"]);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["lastSyncedAt"]);

    await gw.setChannel(ALICE, { blessing: false });
    const good = gw.channelStatus(ALICE)[0]!;
    expect(good.unreadable).toEqual([]);
    expect(good.blessing).toBe(false);
    expect(good.lastSyncedAt).toBeGreaterThan(1755000000000);
  });

  it("a failing sync does not count up from a number it could not read", async () => {
    const gw = await storeWithChannels();
    const CAROL = "channel:friends:carol";
    const dead = {
      pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
    };
    const channel = await gw.openChannel({ into: "friends", prefix: "carol", source: dead });
    await truncate(gw, CAROL, "consecutiveFailures");
    expect(gw.channelStatus(CAROL)[0]!.unreadable).toEqual(["consecutiveFailures"]);

    await expect(channel.sync()).rejects.toThrow(/did not answer/);

    expect(gw.channelStatus(CAROL)[0]!.unreadable).toEqual(["consecutiveFailures"]);

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
    expect(Number.isNaN(bad.lastSyncedAt)).toBe(true);
    expect(Number.isFinite(bad.consecutiveFailures)).toBe(true);
    expect(bad.name).toBe(BRAM);

    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a MISSING health field is unreadable, not the never-synced channel it used to read as", async () => {
    const gw = await storeWithChannels();
    const status = gw.channelStatus(BRAM)[0]!;
    const built = recordClaims(gw, status, OPERATOR, newestAt(gw, BRAM) + 1_000);
    const truncated: Claims = {
      ...built,
      pointers: built.pointers.filter((p) => p.role !== "lastSyncedAt"),
    };
    await gw.append([signClaims(truncated, OPERATOR_SEED)]);

    const bad = gw.channelStatus(BRAM)[0]!;
    expect(bad.unreadable).toContain("lastSyncedAt");
    expect(bad.lastSyncedAt).toBe(0);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a toggle that is not a boolean is unreadable, never the healthy default", async () => {
    const gw = await storeWithChannels();
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
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["lastSyncedAt", "consecutiveFailures"]);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });

  it("a peer address that is not text is unreadable, and the address is not invented", async () => {
    const gw = await storeWithChannels();
    await append(gw, BRAM, { from: 42 }, OP, newestAt(gw, BRAM) + 1_000);
    expect(gw.channelStatus(BRAM)[0]!.unreadable).toEqual(["from"]);

    const bystander = gw.channelStatus(ALICE)[0]!;
    expect(bystander.unreadable).toEqual([]);
    expect(bystander.from).toBe("");
  });

  it("the WRITER still writes every role the reader demands", async () => {
    const gw = await storeWithChannels();
    const full = gw.channelStatus(ALICE)[0]!;
    expect(full.unreadable).toEqual([]);

    const written = recordClaims(gw, full, OPERATOR, newestAt(gw, ALICE) + 1_000);
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

    await gw.append([
      signClaims({ ...written, timestamp: newestAt(gw, ALICE) + 1_000 }, OPERATOR_SEED),
    ]);
    expect(gw.channelStatus(ALICE)[0]!.unreadable).toEqual([]);
  });
});

describe("T217 — an illegible prefix refuses the read rather than answering from the wrong ground", () => {
  it("the query door refuses, and never answers from the receiver's own ground", async () => {
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

    const before = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(before.errors, JSON.stringify(before)).toBeUndefined();
    expect((before.data as { alice_Plant: { height: unknown } }).alice_Plant.height).toBe(11);

    await truncate(me, ch.name, "prefix");
    expect(me.channelStatus(ch.name)[0]!.unreadable).toEqual(["prefix"]);
    expect(me.channelStatus(ch.name)[0]!.prefix).toBe("");

    const after = await me.query(`{ alice_Plant(entity: "${FERN}") { height } }`);
    expect(JSON.stringify(after.data ?? {})).not.toContain("999");
    const said = JSON.stringify(after.errors ?? []);
    expect(said).toMatch(/does not carry its prefix/);
    expect(said).toContain(ch.name);
    expect(said).not.toContain(other.name);

    await expect(
      me.subscribe(`subscription { alice_Plant(entity: "${FERN}") { height } }`),
    ).rejects.toThrow(/federation channel/);

    expect(channelLens(me, "alice:Plant")).toBe(true);
    expect(channelLens(me, "zed:Plant")).toBe(false);

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

    const ground = await Gateway.open(new SqliteBackend(storePath(home)), { seed: OPERATOR_SEED });
    const at = ground.nextTimestamp() + 1_000_000;
    const built = recordClaims(ground, ground.channelStatus(BRAM)[0]!, OPERATOR, at);
    await ground.append([
      signClaims(
        { ...built, pointers: built.pointers.filter((p) => p.role !== "lastSyncedAt") },
        OPERATOR_SEED,
      ),
      signClaims(
        recordClaims(
          ground,
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

    const good = blockFor(ALICE);
    expect(good).toContain("receiving");
    expect(good).toMatch(/last recorded sync \d{4}-\d{2}-\d{2}T/);
    expect(good).not.toContain("UNREADABLE");

    for (const [pool, field] of [
      [BRAM, "lastSyncedAt"],
      ["channel:friends:carol", "lastSyncedAt"],
    ] as const) {
      const bad = blockFor(pool);
      expect(bad, `no block printed for ${pool}`).not.toBe("");
      expect(bad).toContain("UNREADABLE");
      expect(bad).toContain(field);
      expect(bad).not.toContain("never synced");
      expect(bad).not.toContain("last recorded sync");
      expect(bad).not.toContain("NaN");
      expect(bad).not.toContain("Invalid Date");
    }
  });
});
