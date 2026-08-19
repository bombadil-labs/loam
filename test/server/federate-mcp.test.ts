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
