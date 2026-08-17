// T178 — `server/discover`, the first word a real MCP client says.
//
// MEASURED: two Anthropic clients open the conversation with `server/discover` BEFORE `initialize`.
// The door answered -32601. One client fell back and lived; the other read the refusal as a dead
// connection, reported `Connection closed`, and cached that. The current MCP draft says a server
// MUST implement the method, so the store owed it a real answer.
//
// WHAT THIS FILE ASSERTS, and why the second rail is the load-bearing one. The method is easy; the
// HONESTY is the whole ticket. `server/discover` speaks BEFORE any negotiation, so whatever it
// claims is what a client plans its whole session around. A discover answer that advertised a
// protocol version, a capability, or an identity that `initialize` does not honour would be a report
// that can be false (H7) on the store's own front step — and nothing downstream could catch it,
// because the client would already have chosen.
//
// So the two answers are compared to EACH OTHER, in one test, rather than each to a literal:
//   - `supportedVersions` is compared to the exported `MCP_PROTOCOLS` constant, never to a copied
//     list. A rail holding its own copy of the versions goes green while the two drift apart.
//   - `capabilities` and `serverInfo` are read out of a LIVE `initialize` reply in the same test and
//     compared object-against-object. If either side is edited alone, this fails.
//
// The auth rail says the opposite of what "discovery" suggests: this method is INSIDE the door. It
// answers the same 401, with the same www-authenticate challenge, as every other MCP method —
// compared response-against-response so the rail cannot drift green while both answers change.
// Discovery of the AUTH surface belongs to the well-known documents (T133/T177), not here.
//
// Deliberately NOT asserted: the optional `ttlMs` / `cacheScope` fields, which the store does not
// send — it has no cache policy to state, and inventing one would be the same overclaim in a
// smaller shape. Tool CONTENT is `mcp-tool-honesty.test.ts`'s (T86); this file asserts only what the
// front step announces about itself.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MCP_PROTOCOLS, serve, type ServerHandle } from "../../src/server/http.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./../gateway/fixtures.js";

vi.setConfig({ testTimeout: 20_000 }); // a real listening server

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = "a1".repeat(32);

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "alice-token": { actor: ALICE_SEED } },
    port: 0,
    host: "127.0.0.1",
    // publicUrl is what gives the MCP door its www-authenticate challenge (SPEC §37 phase 12).
    // The auth rail below is only meaningful on a door that has one.
    publicUrl: "https://store.example",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

/** One JSON-RPC request at the MCP door. `token` undefined presents no credential at all. */
const rpc = (body: Record<string, unknown>, token?: string): Promise<Response> =>
  fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
  });

type Discover = {
  result: {
    resultType: string;
    supportedVersions: string[];
    capabilities: Record<string, unknown>;
    instructions?: string;
    _meta: Record<string, unknown>;
  };
};

const discover = async (): Promise<Discover["result"]> => {
  const res = await rpc({ id: 1, method: "server/discover", params: {} }, "alice-token");
  expect(res.status).toBe(200);
  return ((await res.json()) as Discover).result;
};

describe("server/discover: the method a client speaks first", () => {
  it("answers a complete result rather than -32601", async () => {
    const result = await discover();
    expect(result).toBeDefined();
    expect(result.resultType).toBe("complete");
  });

  it("names exactly the protocol versions the door speaks — the constant, not a copy", async () => {
    const result = await discover();
    // Compared to the EXPORTED constant. A literal here would let the two drift apart in silence,
    // which is the exact failure this rail exists to make impossible.
    expect(result.supportedVersions).toEqual([...MCP_PROTOCOLS]);
    // And the door honours what it advertises: initialize accepts each announced version by name.
    for (const version of MCP_PROTOCOLS) {
      const res = await rpc(
        { id: 2, method: "initialize", params: { protocolVersion: version } },
        "alice-token",
      );
      const body = (await res.json()) as { result: { protocolVersion: string } };
      expect(body.result.protocolVersion).toBe(version);
    }
  });

  it("its capabilities and serverInfo are exactly what initialize answers", async () => {
    const announced = await discover();
    const res = await rpc({ id: 3, method: "initialize", params: {} }, "alice-token");
    const honoured = (
      (await res.json()) as {
        result: { capabilities: Record<string, unknown>; serverInfo: Record<string, unknown> };
      }
    ).result;

    expect(announced.capabilities).toEqual(honoured.capabilities);
    expect(announced._meta["io.modelcontextprotocol/serverInfo"]).toEqual(honoured.serverInfo);
    // The identity is a real one, not an empty shell that would compare equal to another empty shell.
    const info = honoured.serverInfo as { name?: unknown; version?: unknown };
    expect(info.name).toMatch(/loam/i);
    expect(typeof info.version).toBe("string");
  });

  it("sits behind the same bearer requirement as the rest of the door", async () => {
    const denied = await rpc({ id: 4, method: "server/discover", params: {} });
    const baseline = await rpc({ id: 4, method: "initialize", params: {} });

    expect(denied.status).toBe(401);
    // Response against response: the challenge and the body are the door's, not this method's.
    expect(denied.status).toBe(baseline.status);
    expect(denied.headers.get("www-authenticate")).toBe(baseline.headers.get("www-authenticate"));
    expect(denied.headers.get("www-authenticate")).toBeTruthy();
    expect(await denied.text()).toBe(await baseline.text());
  });

  it("adds a method rather than making the door permissive", async () => {
    const res = await rpc({ id: 5, method: "server/undiscover", params: {} }, "alice-token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toMatch(/no such method/);
  });

  it("a notification-shaped server/discover gets silence, like every other notification", async () => {
    const res = await rpc({ method: "server/discover", params: {} }, "alice-token");
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });
});
