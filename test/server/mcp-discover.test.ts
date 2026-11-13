import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MCP_PROTOCOLS, serve, type ServerHandle } from "../../src/server/http.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./../gateway/fixtures.js";

vi.setConfig({ testTimeout: 20_000 });

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
    publicUrl: "https://store.example",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

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
    expect(result.supportedVersions).toEqual([...MCP_PROTOCOLS]);
    expect(result.supportedVersions.length).toBeGreaterThanOrEqual(2);
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
    const info = honoured.serverInfo as { name?: unknown; version?: unknown };
    expect(info.name).toMatch(/loam/i);
    expect(typeof info.version).toBe("string");
  });

  it("announces only capabilities the door actually serves", async () => {
    const announced = await discover();
    const keys = Object.keys(announced.capabilities);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const honours = SERVED[key];
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
    const named = announced.instructions!.match(/loam_[a-z_]+/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const name of named) expect(real).toContain(name);
  });

  it("sits behind the same bearer requirement as the rest of the door", async () => {
    const denied = await rpc({ id: 4, method: "server/discover", params: {} });
    const baseline = await rpc({ id: 4, method: "initialize", params: {} });

    expect(denied.status).toBe(401);
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
