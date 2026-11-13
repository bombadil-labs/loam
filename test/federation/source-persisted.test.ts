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

      if (process.platform !== "win32") {
        const file = readdirSync(home).find((f) => f.includes("channel"))!;
        expect(statSync(join(home, file)).mode & 0o777).toBe(0o600);
      }

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
    expect(readChannelToken(home, "channel:friends:nobody").kind).toBe("absent");
    writeChannelToken(home, "channel:friends:alice", "tok");
    expect(readChannelToken(home, "channel:friends:alice").kind).toBe("present");
  });

  it("a booted store REBUILDS its channels, so the standing sync resumes", async () => {
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
      channelBackend: () => {
        throw new Error("simulated: the pool's sqlite is locked");
      },
    });
    try {
      expect(rebooted.federationChannels.has("channel:friends:alice")).toBe(false);
      expect(rebooted.channelStatus("channel:friends:alice")).toHaveLength(1);
    } finally {
      await rebooted.close();
    }
  });
});
