// SPEC §49 criterion (a) — the pulse law, audited at the one periodic surface the tree has
// (T212; .adlc/specs/49-legibility.md, settled 2026-08-28): *a pulse is not a fact.* A
// periodic writer either supersedes one standing record in place or writes NOTHING on a no-op
// cycle. The channel sync is that writer, and this file audits both halves at the deltas:
// quiet polls leave the ground's delta count unchanged, and the record that does move is the
// ONE standing row per pool, superseded, never accumulated.
//
// The doctrine sentence lands in CLAUDE.md's standing rules with this ticket's landing PR;
// every FUTURE cron-shaped writer owes its own audit case beside its own suite, in this
// file's image.
//
// Erasure standing rule: every store here is this file's own memory fixture.

import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { CTX_CHANNEL } from "../../src/federation/channel.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const PEER_SEED = "2a".repeat(32);
const PEER = authorForSeed(PEER_SEED);

const nothing = { pull: (): Promise<never[]> => Promise.resolve([]) };

const channelRows = (gw: Gateway): number =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_CHANNEL,
    ),
  ).length;

describe("§49(a) — a pulse is not a fact: the channel sync under audit", () => {
  it("a month of quiet polls writes NOTHING: primary and pool delta counts hold still", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const channel = await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
    await channel.sync(); // the first sync may stamp the record into being — that is opening
    const primary = gw.reactor.size;
    const pool = gw.attachedContainers.get(channel.name)?.reactor.size;
    const records = channelRows(gw);

    for (let i = 0; i < 30; i++) await channel.sync();

    // Thirty empty polls later: not one delta anywhere — no heartbeat, no empty stamp, no
    // fresh record row. The lastSyncedAt a reader wants lives on the standing record and only
    // moves when a sync has something to say.
    expect(gw.reactor.size).toBe(primary);
    expect(gw.attachedContainers.get(channel.name)?.reactor.size).toBe(pool);
    expect(channelRows(gw)).toBe(records);
  });

  it("a sync that DOES accept supersedes the one standing row; the next quiet poll adds nothing", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, PEER, "write", OPERATOR, 5000), OPERATOR_SEED),
    ]);
    const arrival = signClaims(
      {
        timestamp: 6000,
        author: PEER,
        pointers: [
          { role: "note", target: { kind: "entity", entity: { id: "note:hi", context: "mail" } } },
          { role: "text", target: { kind: "primitive", value: "hello" } },
        ],
      } as never,
      PEER_SEED,
    );
    let handed = false;
    const once = {
      pull: (): Promise<readonly Delta[]> =>
        Promise.resolve(handed ? [] : ((handed = true), [arrival])),
    };
    const channel = await gw.openChannel({ into: "friends", prefix: "alice", source: once });
    const records0 = channelRows(gw);

    await channel.sync(); // accepts one delta: record moves, custody stamps land — real facts
    const recordsAfterAccept = channelRows(gw);
    const primaryAfterAccept = gw.reactor.size;
    // The POSITIVE half, asserted here rather than delegated: an accepting sync DID write, and
    // the reading still resolves ONE standing row over however many the ground accumulated.
    expect(recordsAfterAccept).toBeGreaterThan(records0);
    expect(gw.channelStatus(channel.name)).toHaveLength(1);
    expect(gw.channelStatus(channel.name)[0]!.lastSyncedAt).toBeGreaterThan(0);

    await channel.sync(); // quiet again: nothing to say, nothing written
    expect(gw.reactor.size).toBe(primaryAfterAccept);
    expect(channelRows(gw)).toBe(recordsAfterAccept);
  });
});
