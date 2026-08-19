// T188 — federation over MCP. Authority is the CONTAINER-SCOPED federate grant, never the operator
// role: `GET /:mount/federate` demands the operator token today, and that token also registers root
// law, mints grants and reads everything, so federating cost a peer the whole store.
//
// FIVE tools rather than one `federate` passthrough, because tools are the unit of CONSENT — a
// client applies policy per tool, so `status` can be auto-approved while `drop` always asks. This
// file covers the two that are safe by construction; the staged drop has its own.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve } from "../../src/server/http.js";

const OP = "cc".repeat(32);
const FRIEND = "d1".repeat(32);
const STRANGER = "e2".repeat(32);

async function storeWithChannels(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP, registrations: [] }),
  );
  const nothing = { pull: () => Promise.resolve([]) };
  await gw.openChannel({ into: "friends", prefix: "alice", source: nothing });
  await gw.openChannel({ into: "work", prefix: "carol", source: nothing });
  await gw.append([
    signClaims(
      grantClaims(
        STORE_ENTITY,
        authorForSeed(FRIEND),
        "federate",
        gw.operatorAuthor!,
        gw.nextTimestamp(),
        "friends",
      ),
      OP,
    ),
  ]);
  return gw;
}

async function callTool(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${url}/default/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = (await res.json()) as {
    result?: { content?: { text?: string }[]; isError?: boolean };
  };
  return {
    text: body.result?.content?.[0]?.text ?? "",
    isError: body.result?.isError === true,
  };
}

describe("T188 — federation tools over MCP", () => {
  it("a scoped holder sees ONLY the channels its grant names", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-friend": { actor: FRIEND }, "tok-op": { operator: true } },
      port: 0,
    });
    try {
      const scoped = await callTool(door.url, "tok-friend", "loam_federate_status");
      expect(scoped.isError).toBe(false);
      expect(scoped.text).toContain("channel:friends:alice");
      // The fence, from the side that matters: `work` is not theirs to see.
      expect(scoped.text).not.toContain("channel:work:carol");

      // Two-sided: the operator is unrestricted, so the tool is not simply hiding everything.
      const op = await callTool(door.url, "tok-op", "loam_federate_status");
      expect(op.text).toContain("channel:friends:alice");
      expect(op.text).toContain("channel:work:carol");
    } finally {
      await door.close();
      await gw.close();
    }
  });

  it("a caller with no federate grant is refused, and learns nothing about what exists", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-stranger": { actor: STRANGER } },
      port: 0,
    });
    try {
      const asked = await callTool(door.url, "tok-stranger", "loam_federate_status", {
        channel: "channel:friends:alice",
      });
      expect(asked.isError).toBe(true);
      // No oracle: naming a real channel and a fictional one must read identically (§12/T78).
      const fiction = await callTool(door.url, "tok-stranger", "loam_federate_status", {
        channel: "channel:nope:nobody",
      });
      expect(fiction.text).toBe(asked.text);
      expect(asked.text).not.toContain("channel:friends:alice");
    } finally {
      await door.close();
      await gw.close();
    }
  });

  it("set adjusts a channel inside the fence and refuses one outside it", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-friend": { actor: FRIEND } },
      port: 0,
    });
    try {
      const frozen = await callTool(door.url, "tok-friend", "loam_federate_set", {
        channel: "channel:friends:alice",
        receiving: false,
      });
      expect(frozen.isError, frozen.text).toBe(false);
      expect(gw.channelStatus("channel:friends:alice")[0]!.receiving).toBe(false);

      const outside = await callTool(door.url, "tok-friend", "loam_federate_set", {
        channel: "channel:work:carol",
        blessing: false,
      });
      expect(outside.isError).toBe(true);
      // And it did NOT take effect — a refusal that still acted would be the worst of both.
      expect(gw.channelStatus("channel:work:carol")[0]!.blessing).toBe(true);
    } finally {
      await door.close();
      await gw.close();
    }
  });
});

describe("T188 — an agent can stage a sever and can never complete one", () => {
  it("the drop tool purges NOTHING, and says so", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-friend": { actor: FRIEND } },
      port: 0,
    });
    try {
      const before = gw.channelStatus().map((c) => c.name);
      const staged = await callTool(door.url, "tok-friend", "loam_federate_drop", {
        channel: "channel:friends:alice",
      });
      expect(staged.isError, staged.text).toBe(false);

      const body = JSON.parse(staged.text) as {
        staged: string;
        purgedNothing: boolean;
        wouldPurge: string[];
        wouldSurvive: string[];
      };
      expect(body.purgedNothing).toBe(true);
      expect(body.staged).toMatch(/^[0-9a-f]{32}$/);

      // THE CHANNEL IS STILL THERE. Asserted against the store rather than the report, because the
      // report is the thing under test.
      expect(gw.channelStatus().map((c) => c.name)).toEqual(before);
      expect(gw.channelStatus("channel:friends:alice")).toHaveLength(1);
    } finally {
      await door.close();
      await gw.close();
    }
  });

  it("the preview is TWO-SIDED — what would go, and what would remain", async () => {
    // A preview naming only the target cannot show over-purging, which is the failure with no
    // recovery. The operator must be able to read what SURVIVES before agreeing to anything.
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-op": { operator: true } },
      port: 0,
    });
    try {
      const staged = await callTool(door.url, "tok-op", "loam_federate_drop", {
        channel: "channel:friends:alice",
      });
      const body = JSON.parse(staged.text) as { wouldPurge: string[]; wouldSurvive: string[] };
      expect(body.wouldPurge.join(" ")).toContain("channel:friends:alice");
      expect(body.wouldSurvive).toContain("channel:work:carol");
      expect(body.wouldSurvive).not.toContain("channel:friends:alice");
    } finally {
      await door.close();
      await gw.close();
    }
  });

  it("staging outside the fence is refused, and stages nothing", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-friend": { actor: FRIEND } },
      port: 0,
    });
    try {
      const outside = await callTool(door.url, "tok-friend", "loam_federate_drop", {
        channel: "channel:work:carol",
      });
      expect(outside.isError).toBe(true);
      expect(outside.text).not.toContain("staged");
      // Two-sided: the channel it could not stage is untouched and still listed for its owner.
      expect(gw.channelStatus("channel:work:carol")).toHaveLength(1);
    } finally {
      await door.close();
      await gw.close();
    }
  });
});

describe("T188 — opening a channel over MCP", () => {
  it("a scoped holder opens into its own container and is refused for another", async () => {
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-friend": { actor: FRIEND } },
      port: 0,
    });
    try {
      // Outside the fence: refused, and nothing is created.
      const outside = await callTool(door.url, "tok-friend", "loam_federate_connect", {
        from: "http://127.0.0.1:1/default",
        into: "work",
        prefix: "mallory",
      });
      expect(outside.isError).toBe(true);
      expect(gw.channelStatus().some((c) => c.prefix === "mallory")).toBe(false);

      // Inside the fence the FENCE passes — the peer is unreachable here, so the failure that
      // follows is the peer's, not the fence's. Asserting the refusal TEXT differs is what
      // distinguishes "you may not" from "it did not work".
      const inside = await callTool(door.url, "tok-friend", "loam_federate_connect", {
        from: "http://127.0.0.1:1/default",
        into: "friends",
        prefix: "dave",
      });
      expect(inside.text).not.toContain("not yours to open");
    } finally {
      await door.close();
      await gw.close();
    }
  });

  it("the refusal reads identically for a real container and a fictional one", async () => {
    // No oracle: a caller must not be able to map this store's containers by comparing refusals.
    const gw = await storeWithChannels();
    const door = await serve({
      mounts: { default: gw },
      tokens: { "tok-stranger": { actor: STRANGER } },
      port: 0,
    });
    try {
      const real = await callTool(door.url, "tok-stranger", "loam_federate_connect", {
        from: "http://127.0.0.1:1/default",
        into: "friends",
        prefix: "x",
      });
      const fiction = await callTool(door.url, "tok-stranger", "loam_federate_connect", {
        from: "http://127.0.0.1:1/default",
        into: "no-such-container",
        prefix: "x",
      });
      expect(real.isError).toBe(true);
      expect(real.text).toBe(fiction.text);
    } finally {
      await door.close();
      await gw.close();
    }
  });
});
