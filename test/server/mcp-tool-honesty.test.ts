import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 20_000 });
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const SURVEYOR = authorForSeed("b2".repeat(32));

let handle: ServerHandle;
let base: string;
let backend: MemoryBackend;
let gateway: Gateway;

beforeAll(async () => {
  backend = new MemoryBackend();
  gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9002), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9003), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "alice-token": { actor: ALICE_SEED } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

type ToolReply = {
  result: { content: Array<{ type: string; text: string }>; isError?: boolean };
};

const rpc = async (body: Record<string, unknown>): Promise<Response> =>
  fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer alice-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  });

const call = async (name: string, args: Record<string, unknown>): Promise<ToolReply["result"]> => {
  const res = await rpc({ method: "tools/call", params: { name, arguments: args } });
  expect(res.status).toBe(200);
  return ((await res.json()) as ToolReply).result;
};

const deltas = async (): Promise<number> => {
  await gateway.flush();
  return (await backend.deltasSince(new Set())).length;
};

const heightViaDoor = async (): Promise<number> => {
  const result = await call("loam_query", { query: `{ plant(entity: "${FERN}") { height } }` });
  expect(result.isError).not.toBe(true);
  return (JSON.parse(result.content[0]!.text) as { data: { plant: { height: number } } }).data.plant
    .height;
};

describe("MCP tool honesty: loam_query is a read, and says so on the wire", () => {
  it("refuses a mutation document, names loam_mutate, and leaves the ground untouched", async () => {
    const before = await heightViaDoor();
    const count = await deltas();

    const refused = await call("loam_query", {
      query: `mutation { plant(entity: "${FERN}", height: 91) { height } }`,
    });
    expect(await deltas()).toBe(count);
    expect(await heightViaDoor()).toBe(before);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/loam_mutate/);
    expect(refused.content[0]!.text).not.toMatch(/91/);
  });

  it("refuses a mutation smuggled as the second operation of a multi-operation document", async () => {
    const before = await heightViaDoor();
    const count = await deltas();

    const refused = await call("loam_query", {
      query:
        `query Peek { plant(entity: "${FERN}") { height } } ` +
        `mutation Sneak { plant(entity: "${FERN}", height: 92) { height } }`,
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/loam_mutate/);

    expect(await deltas()).toBe(count);
    expect(await heightViaDoor()).toBe(before);
  });

  it("refuses a named mutation with no query beside it", async () => {
    const before = await heightViaDoor();
    const count = await deltas();

    const refused = await call("loam_query", {
      query: `mutation Sneak { plant(entity: "${FERN}", height: 93) { height } }`,
    });
    expect(await deltas()).toBe(count);
    expect(await heightViaDoor()).toBe(before);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/loam_mutate/);
  });

  it("refuses a subscription document — the same class, a different door", async () => {
    const before = await heightViaDoor();
    const count = await deltas();
    const refused = await call("loam_query", {
      query: `subscription { plant(entity: "${FERN}") { height } }`,
    });
    expect(await deltas()).toBe(count);
    expect(await heightViaDoor()).toBe(before);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/subscribe/);
  });

  it("leaves an unparseable document to the gateway, in the gateway's own words", async () => {
    const broken = await call("loam_query", { query: `{ plant(entity: ` });
    expect(broken.isError).toBe(true);
    expect(broken.content[0]!.text).toMatch(/Syntax Error/);
    expect(broken.content[0]!.text).not.toMatch(/loam_mutate|subscribe/);
  });

  it("still answers an ordinary query — shorthand and named alike", async () => {
    const shorthand = await call("loam_query", {
      query: `{ plant(entity: "${FERN}") { height } }`,
    });
    expect(shorthand.isError).not.toBe(true);
    const shorthandHeight = (
      JSON.parse(shorthand.content[0]!.text) as { data: { plant: { height: number } } }
    ).data.plant.height;
    expect(shorthandHeight).toBeGreaterThan(0);

    const named = await call("loam_query", {
      query: `query Peek { plant(entity: "${FERN}") { height } }`,
    });
    expect(named.isError).not.toBe(true);
    expect(
      (JSON.parse(named.content[0]!.text) as { data: { plant: { height: number } } }).data.plant
        .height,
    ).toBe(shorthandHeight);
  });

  it("loam_mutate still writes: the ground grows and the reading moves", async () => {
    const count = await deltas();
    const write = await call("loam_mutate", {
      mutation: `mutation { plant(entity: "${FERN}", height: 77) { height } }`,
    });
    expect(write.isError).not.toBe(true);

    expect(await deltas()).toBeGreaterThan(count);
    expect(await heightViaDoor()).toBe(77);
  });

  it("tools/list declares the read-only scope on the wire", async () => {
    const res = await rpc({ method: "tools/list", params: {} });
    const tools = (
      (await res.json()) as {
        result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
      }
    ).result.tools;
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("loam_query")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("loam_mutate")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("loam_register")?.annotations?.readOnlyHint).toBe(false);
  });
});

describe("MCP protocol negotiation: the revision must be able to carry the annotation", () => {
  const ANNOTATIONS_SINCE = "2025-03-26";
  const NEWEST_SPOKEN = "2025-06-18";

  const initialize = async (params: Record<string, unknown>): Promise<string> => {
    const res = await rpc({ method: "initialize", params });
    expect(res.status).toBe(200);
    return ((await res.json()) as { result: { protocolVersion: string } }).result.protocolVersion;
  };

  it("echoes a supported revision the client asks for", async () => {
    expect(await initialize({ protocolVersion: "2025-06-18" })).toBe("2025-06-18");
    expect(await initialize({ protocolVersion: "2025-03-26" })).toBe("2025-03-26");
  });

  it("answers an absent, unknown, or annotation-less request with a revision it can speak", async () => {
    for (const params of [
      {},
      { protocolVersion: "2024-11-05" },
      { protocolVersion: "1999-01-01" },
      { protocolVersion: 20250618 },
    ]) {
      const spoken = await initialize(params);
      expect(spoken >= ANNOTATIONS_SINCE).toBe(true);
      expect(spoken).toBe(NEWEST_SPOKEN);
    }
  });

  it("binds the two halves: the same session's annotations are legible under what it negotiated", async () => {
    const spoken = await initialize({ protocolVersion: "2025-06-18" });
    expect(spoken >= ANNOTATIONS_SINCE).toBe(true);

    const res = await rpc({ method: "tools/list", params: {} });
    const tools = (
      (await res.json()) as {
        result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
      }
    ).result.tools;
    expect(tools.find((t) => t.name === "loam_query")?.annotations?.readOnlyHint).toBe(true);
  });
});
