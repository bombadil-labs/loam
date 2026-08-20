// T196 — a channel's SOURCE survives the process that opened it.
//
// Before this, `channelRecordClaims` persisted into/prefix/toggles/lastSyncedAt and NOT where the
// peer is. So `resumeChannels` could re-attach a pool's bytes but never rebuild a Channel, and
// `keepSyncing` iterates `federationChannels`, which is empty on a booted store. The standing
// instruction — §46's user story S7, "he sees it, having run nothing" — held only for the life of
// one process, while `federate list` went on reporting `receiving`.
//
// THE SPLIT IS THE DESIGN (Myk, 2026-08-19): the ADDRESS is ordinary data and lives on the channel
// record; the TOKEN is a secret and lives in the home's config beside the pen seeds. This repo never
// puts a secret in the ground, and federation is the last subsystem that should break that rule.

import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readChannelToken, writeChannelToken } from "../../src/cli/config.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-src-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const store = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: "cc".repeat(32), registrations: [] }),
  );

describe("T196 — the source is persisted", () => {
  it("the channel record carries the peer's address", async () => {
    const gw = await store();
    try {
      const ch = await gw.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://peer.example/default",
        source: { pull: () => Promise.resolve([]) },
      });
      // Read it back from the GROUND, not from the handle — the point is that it outlives the handle.
      expect(gw.channelStatus(ch.name)[0]!.from).toBe("https://peer.example/default");
    } finally {
      await gw.close();
    }
  });

  it("the token goes to the home at 0600 and never into the ground", async () => {
    const gw = await store();
    try {
      writeChannelToken(home, "channel:friends:alice", "s3cret-peer-token");
      const held = readChannelToken(home, "channel:friends:alice");
      expect(held.kind).toBe("present");
      expect(held.kind === "present" && held.seed).toBe("s3cret-peer-token");

      // 0600, like every other secret this home holds — asserted off win32 only, where chmod is
      // advisory and stat reports 0o666 for any writable file (the same reasoning pen.test.ts
      // records for the seed files). The never-in-the-ground assertion below is the load-bearing
      // one and holds on every platform.
      if (process.platform !== "win32") {
        const file = readdirSync(home).find((f) => f.includes("channel"))!;
        expect(statSync(join(home, file)).mode & 0o777).toBe(0o600);
      }

      // THE HOUSE RAIL: the secret appears in no delta. Same assertion the operator and pen seeds
      // carry, because federation is exactly where a leaked credential would matter most.
      await gw.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://peer.example/default",
        source: { pull: () => Promise.resolve([]) },
      });
      const leaked = [...gw.reactor.snapshot()].some((d) =>
        JSON.stringify(d.claims).includes("s3cret-peer-token"),
      );
      expect(leaked, "a channel token appeared in a delta").toBe(false);
    } finally {
      await gw.close();
    }
  });

  it("a missing token and an unreadable one do not collapse", () => {
    // H9, and the same three-way read a pen seed has: only "absent" means unprovisioned.
    expect(readChannelToken(home, "channel:friends:nobody").kind).toBe("absent");
    writeChannelToken(home, "channel:friends:alice", "tok");
    expect(readChannelToken(home, "channel:friends:alice").kind).toBe("present");
  });

  it("a booted store REBUILDS its channels, so the standing sync resumes", async () => {
    // The whole point. A fresh Gateway has nothing in `federationChannels` until resume puts it
    // there, and `keepSyncing` iterates that map — so without this the poller finds nothing to do
    // while `federate list` still says `receiving`.
    // A real file, because the point is surviving a close: a MemoryBackend cannot be reopened, and
    // reusing a closed one would test the fixture rather than the feature.
    const { SqliteBackend } = await import("../../src/store/sqlite.js");
    const path = join(home, "store.sqlite");
    const genesis = assembleGenesis({ operatorSeed: "cc".repeat(32), registrations: [] });
    const first = await Gateway.boot(new SqliteBackend(path), genesis);
    await first.openChannel({
      into: "friends",
      prefix: "alice",
      from: "https://peer.example/default",
      source: { pull: () => Promise.resolve([]) },
    });
    await first.close();

    const rebooted = await Gateway.boot(new SqliteBackend(path), genesis, {
      channelToken: () => "tok",
    });
    try {
      expect(rebooted.federationChannels.size).toBe(1);
      expect([...rebooted.federationChannels.keys()]).toContain("channel:friends:alice");
    } finally {
      await rebooted.close();
    }
  });
});

describe("T196 — a channel whose pool cannot attach is not reported live", () => {
  it("a failed pool attach leaves the channel UNRESUMED, not silently registered", async () => {
    // The failure class the stderr report exists for: the record is whole, the token is present,
    // and the pool's own store cannot open (a locked or corrupt sqlite). Registering the channel
    // anyway would make it evade that report, and every sync tick would then throw BEFORE the
    // stamp-failure path runs — consecutiveFailures stays 0, lastSyncedAt rots, and `federate
    // list` says `receiving` about something that can never pull. That is the exact H9 shape this
    // ticket exists to close, reintroduced one layer down.
    const { SqliteBackend } = await import("../../src/store/sqlite.js");
    const path = join(home, "store.sqlite");
    const genesis = assembleGenesis({ operatorSeed: "cc".repeat(32), registrations: [] });
    const first = await Gateway.boot(new SqliteBackend(path), genesis);
    await first.openChannel({
      into: "friends",
      prefix: "alice",
      from: "https://peer.example/default",
      source: { pull: () => Promise.resolve([]) },
    });
    await first.close();

    const rebooted = await Gateway.boot(new SqliteBackend(path), genesis, {
      channelToken: () => "tok",
      // The pool's store refuses to open — the unreadable-sqlite case, made deterministic.
      channelBackend: () => {
        throw new Error("simulated: the pool's sqlite is locked");
      },
    });
    try {
      // NOT live: nothing can pull it, so nothing may claim it.
      expect(rebooted.federationChannels.has("channel:friends:alice")).toBe(false);
      // Two-sided: still LISTED — the record stands, which is what lets the CLI name it on stderr
      // instead of the channel simply vanishing.
      expect(rebooted.channelStatus("channel:friends:alice")).toHaveLength(1);
    } finally {
      await rebooted.close();
    }
  });
});
