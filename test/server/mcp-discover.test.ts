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
// AGREEMENT IS NOT TRUTH, so agreement is not the only rail here. Both methods read the same three
// constants, so the comparison above cannot fail while a constant is edited — announce
// `{ tools: {}, resources: {} }` and every agreement rail stays green while a client's
// `resources/list` draws -32601. Each announcement therefore also earns an HONOURS rail beside its
// AGREES rail:
//   - every key in the announced capabilities must be one this file can PROVE the door serves, and
//     the set must be non-empty (an emptied constant is an under-claim, but it is also a door that
//     announces nothing, and it should be a decision rather than an accident);
//   - the announced versions have a floor, so an emptied list reddens. Their LITERAL values are
//     pinned by `mcp-tool-honesty.test.ts` (T86, frozen), not here. What no rail can prove is that
//     ADDING a version to `MCP_PROTOCOLS` came with implementing it — an appended revision is
//     echoed back by `initialize` and passes both files. That is a claim only a reader can check:
//     a new entry in that constant is a promise, and it owes an implementation.
//
// The auth rail says the opposite of what "discovery" suggests: this method is INSIDE the door. It
// answers the same 401, with the same www-authenticate challenge, as every other MCP method —
// compared response-against-response so the rail cannot drift green while both answers change.
// Discovery of the AUTH surface belongs to the well-known documents (T133/T177), not here.
//
// Deliberately NOT asserted:
//   - the optional `ttlMs` / `cacheScope` fields, which the store does not send — it has no cache
//     policy to state, and inventing one would be the same overclaim in a smaller shape;
//   - that `instructions` names EVERY tool. Naming fewer tools than exist is an under-claim and
//     cannot mislead a client into calling something that is not there. The rail below runs the
//     dangerous direction only: every tool the string names must be a tool `tools/list` returns;
//   - the era gap. This door answers discover while implementing none of the modern era's
//     per-request machinery (`_meta` versioning, MCP-Protocol-Version, -32022). It is named in the
//     code beside the case, and closing it is T181's. No rail here can see it, because the door has
//     nothing yet to assert against.
// Tool CONTENT is `mcp-tool-honesty.test.ts`'s (T86); this file asserts only what the front step
// announces about itself.

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

const tools = async (): Promise<Array<{ name: string }>> => {
  const res = await rpc({ id: 9, method: "tools/list", params: {} }, "alice-token");
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { tools: Array<{ name: string }> } }).result.tools;
};

// One probe per capability the door may announce: what must actually ANSWER for that announcement
// to be true. A key with no entry here is an announcement no rail can back, and the capability rail
// fails on it by name rather than skipping it.
const SERVED: Record<string, () => Promise<void>> = {
  resources: async () => {
    const r = await rpc({ id: 8, method: "resources/list", params: {} }, "alice-token");
    const body = (await r.json()) as { result: { resources: unknown[] } };
    expect(body.result.resources.length).toBeGreaterThan(0);
  },
  tools: async () => {
    expect((await tools()).length).toBeGreaterThan(0);
  },
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
    // A floor, because the line above compares the answer to the constant that produced it: an
    // emptied list would satisfy the equality and leave a client with nothing to choose.
    expect(result.supportedVersions.length).toBeGreaterThanOrEqual(2);
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

  it("announces only capabilities the door actually serves", async () => {
    const announced = await discover();
    const keys = Object.keys(announced.capabilities);
    // Non-empty: an announcement of nothing agrees with initialize perfectly and tells a client
    // there is no reason to stay.
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const honours = SERVED[key];
      // A capability with no probe is an announcement this file cannot back. Adding a key to
      // MCP_CAPABILITIES therefore reddens here until a probe proves the door answers for it —
      // which is the whole difference between agreeing with initialize and being true.
      expect(
        honours,
        `the door announces capability "${key}" and no rail proves it is served: ` +
          `add the probe, or stop announcing it`,
      ).toBeDefined();
      await honours!();
    }
  });

  it("its instructions name no tool the door does not have", async () => {
    const announced = await discover();
    expect(typeof announced.instructions).toBe("string");
    expect(announced.instructions!.length).toBeGreaterThan(0);
    const real = new Set((await tools()).map((t) => t.name));
    // Every `loam_*` name the guidance mentions must exist. The other direction is deliberately
    // free (see the header): naming fewer tools than exist cannot mislead anyone.
    const named = announced.instructions!.match(/loam_[a-z_]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(real).toContain(name);
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
