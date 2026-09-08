// T288 CONTROL: the MCP connect door names no `from` to the gateway, so a channel the CLI opened
// re-connects over MCP with the same address once a standing channel must be re-opened with the
// options it stands with. This case PASSES on origin/main (the guard does not exist there); it is a
// control that pins the re-connect this PR must not narrow, and it goes red when the guard compares
// an omitted `from` against the record. The door records from="" for a channel it opens itself; a
// caller-chosen address is deliberately NOT recorded, because a resumed channel would send the
// operator's stored peer token to it after a restart.
import { afterEach, describe, expect, it } from "vitest";
import { channelName, sourceFor } from "../../src/federation/channel.js";
import { parseOffer } from "../../src/federation/offer.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { closeAll, connectionServer } from "../helpers/connection-fixture.js";
import { FERN } from "../spike/garden.js";

const PEER_SEED = "7a".repeat(32);
const PEER_TOKEN = "peer-door-token";
const peers: ServerHandle[] = [];
async function peerStore(): Promise<string> {
  const peer = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: PEER_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  const handle = await serve({
    mounts: { default: peer },
    tokens: { [PEER_TOKEN]: { operator: true } },
    port: 0,
  });
  peers.push(handle);
  return `${handle.url}/default`;
}
afterEach(async () => {
  while (peers.length > 0) await new Promise<void>((r) => peers.pop()!.server.close(() => r()));
  await closeAll();
});
async function callTool(
  base: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`${base}/default/mcp`, {
    method: "POST",
    headers: { authorization: "Bearer op-token", "content-type": "application/json" },
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
  return { text: body.result?.content?.[0]?.text ?? "", isError: body.result?.isError === true };
}
const connect = (base: string, from: string, into: string) =>
  callTool(base, "loam_federate_connect", {
    from,
    into,
    prefix: `${into}:peer`,
    token: PEER_TOKEN,
  });

describe("the MCP connect door carries no address into the record", () => {
  it("re-connects a CLI-opened channel and syncs it; a channel it opens itself records no address", async () => {
    const { base, gateway } = await connectionServer();
    const from = await peerStore();
    const readOffer = () => {
      throw new Error("url only");
    };
    await gateway.openChannel({
      into: "friends",
      prefix: "friends:peer",
      from,
      source: sourceFor(from, PEER_TOKEN, readOffer, parseOffer),
    });
    const again = await connect(base, from, "friends");
    expect(again.isError, again.text).toBe(false);
    expect(gateway.channelStatus(channelName("friends", "friends:peer"))[0]?.from).toBe(from);
    const fresh = await connect(base, from, "pals");
    expect(fresh.isError, fresh.text).toBe(false);
    expect(gateway.channelStatus(channelName("pals", "pals:peer"))[0]?.from).toBe("");
  });
});
