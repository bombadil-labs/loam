// T288: the MCP connect door names its peer as `pullsFrom`, compared against a standing record but
// never recorded. A channel the CLI opened re-connects over MCP from the same address and refuses
// another address, so a second peer's data cannot be received under an opening that names the
// first. A channel MCP opened records no address (a recorded caller-chosen address would receive
// the operator's stored peer token after a restart) and so re-connects from any address.
//
// RAILS-RED on origin/main, this file copied in: 1 red, 0 green (the other-address re-connect is
// accepted there). REVERT PROBES on this tree: the door names no `pullsFrom` → 1 red; `pullsFrom`
// yields to every record → 1 red; `pullsFrom` disagrees with an address-less record too → 1 red.
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

describe("the MCP connect door compares its peer against the record and never records it", () => {
  it("re-connects a CLI-opened channel from the same address, refuses another, and lets an address-less channel re-connect from any", async () => {
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
    const other = await peerStore();
    const changed = await connect(base, other, "friends");
    expect(changed.isError).toBe(true);
    expect(changed.text).toContain("drop it before opening it another way");
    expect(changed.text).not.toContain(from);
    expect(changed.text).not.toContain(other);
    expect(gateway.channelStatus(channelName("friends", "friends:peer"))[0]?.from).toBe(from);
    // A channel MCP opened records no address, so it has nothing to disagree with.
    const fresh = await connect(base, from, "pals");
    expect(fresh.isError, fresh.text).toBe(false);
    expect(gateway.channelStatus(channelName("pals", "pals:peer"))[0]?.from).toBe("");
    const moved = await connect(base, other, "pals");
    expect(moved.isError, moved.text).toBe(false);
    expect(gateway.channelStatus(channelName("pals", "pals:peer"))[0]?.from).toBe("");
  });
});
