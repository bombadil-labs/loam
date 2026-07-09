// Step 6's contract: the gateway, served. One node:http server; bearer tokens map onto step 5's
// actor-per-request seam (transport adds authentication, never new authority); mounts isolate
// stores; GraphQL over POST, subscriptions over SSE, and a minimal MCP surface over JSON-RPC.
// Everything here talks to a real listening server with a real fetch — no shortcuts through
// in-process calls.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims, membershipClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, garden } from "./../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = "a1".repeat(32); // the gardener
const MALLORY_SEED = "e4".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

const GARDEN = "tenant:garden";
const SURVEYOR = authorForSeed("b2".repeat(32));

let handle: ServerHandle;
let base: string;

async function governedGarden(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(membershipClaims(GARDEN, FERN, OPERATOR, 9001), OPERATOR_SEED),
    signClaims(grantClaims(GARDEN, GARDENER, "write", OPERATOR, 9002), OPERATOR_SEED),
    signClaims(grantClaims(GARDEN, SURVEYOR, "write", OPERATOR, 9003), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  return gateway;
}

async function emptyMeadow(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateway.register(PLANT, PLANT_POLICY, ["plant:moss"]);
  return gateway;
}

beforeAll(async () => {
  handle = await serve({
    mounts: { garden: await governedGarden(), meadow: await emptyMeadow() },
    tokens: {
      "alice-token": { actor: ALICE_SEED },
      "mallory-token": { actor: MALLORY_SEED },
      "op-token": { operator: true },
    },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const gql = (
  mount: string,
  token: string | undefined,
  query: string,
  variables?: Record<string, unknown>,
) =>
  fetch(`${base}/${mount}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query, variables }),
  });

describe("HTTP: the gateway behind a bearer token", () => {
  it("a valid token queries; junk and silence are 401", async () => {
    const ok = await gql("garden", "alice-token", `{ plant(entity: "${FERN}") { height } }`);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { plant: { height: number } } };
    expect(body.data.plant.height).toBe(34);

    expect((await gql("garden", "junk-token", `{ __typename }`)).status).toBe(401);
    expect((await gql("garden", undefined, `{ __typename }`)).status).toBe(401);
  });

  it("mutations carry the token's identity: alice may, mallory may not", async () => {
    const allowed = await gql(
      "garden",
      "alice-token",
      `mutation { plant(entity: "${FERN}", height: 40) { height } }`,
    );
    expect(
      ((await allowed.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(40);

    const denied = await gql(
      "garden",
      "mallory-token",
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
    );
    const deniedBody = (await denied.json()) as { errors: string[] };
    expect(deniedBody.errors.join(" ")).toMatch(/not permitted/);
  });

  it("an unknown mount is 404; mounts are separate worlds", async () => {
    expect((await gql("orchard", "alice-token", `{ __typename }`)).status).toBe(404);
    // the meadow has no fern claims: its plant view is silent about the garden's data
    const meadow = await gql("meadow", "op-token", `{ plant(entity: "${FERN}") { height } }`);
    const body = (await meadow.json()) as { data: { plant: { height: number | null } } };
    expect(body.data.plant.height).toBeNull();
  });

  it("subscribe over SSE: the snapshot arrives, then the patch", async () => {
    const query = encodeURIComponent(
      `subscription { plant(entity: "${FERN}") { height _fromHex } }`,
    );
    const res = await fetch(`${base}/garden/subscribe?query=${query}`, {
      headers: { authorization: "Bearer alice-token", accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const nextEvent = async (): Promise<{ plant: { height: number; _fromHex: string | null } }> => {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (data.length > 0) return JSON.parse(data) as never;
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("stream ended early");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };

    const initial = await nextEvent();
    expect(initial.plant._fromHex).toBeNull();

    await gql(
      "garden",
      "alice-token",
      `mutation { plant(entity: "${FERN}", height: 51) { height } }`,
    );
    const patch = await nextEvent();
    expect(patch.plant.height).toBe(51);
    expect(patch.plant._fromHex).not.toBeNull();

    await reader.cancel(); // the client hangs up; the server lets go
  });

  it("subscribe with a junk token is 401 before any stream opens", async () => {
    const res = await fetch(`${base}/garden/subscribe?query=x`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });
});

describe("MCP: the same gateway as JSON-RPC tools", () => {
  const rpc = (token: string, body: Record<string, unknown>) =>
    fetch(`${base}/garden/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });

  it("initialize → tools/list → tools/call runs a query end-to-end", async () => {
    const init = await rpc("alice-token", { method: "initialize", params: {} });
    expect(init.status).toBe(200);
    const initBody = (await init.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(initBody.result.serverInfo.name).toMatch(/loam/i);

    const list = await rpc("alice-token", { method: "tools/list", params: {} });
    const tools = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result
      .tools;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["loam_query", "loam_mutate"]));

    const call = await rpc("alice-token", {
      method: "tools/call",
      params: {
        name: "loam_query",
        arguments: { query: `{ plant(entity: "${FERN}") { height } }` },
      },
    });
    const result = (await call.json()) as {
      result: { content: Array<{ type: string; text: string }> };
    };
    const payload = JSON.parse(result.result.content[0]!.text) as {
      data: { plant: { height: number } };
    };
    expect(payload.data.plant.height).toBeGreaterThanOrEqual(34);
  });

  it("loam_mutate writes as the token's actor and is refused for the ungranted", async () => {
    const write = await rpc("alice-token", {
      method: "tools/call",
      params: {
        name: "loam_mutate",
        arguments: { mutation: `mutation { plant(entity: "${FERN}", height: 55) { height } }` },
      },
    });
    const ok = (await write.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(ok.result.isError).not.toBe(true);

    const denied = await rpc("mallory-token", {
      method: "tools/call",
      params: {
        name: "loam_mutate",
        arguments: { mutation: `mutation { plant(entity: "${FERN}", height: 1) { height } }` },
      },
    });
    const deniedBody = (await denied.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(deniedBody.result.isError).toBe(true);
    expect(deniedBody.result.content[0]!.text).toMatch(/not permitted/);
  });

  it("a junk token cannot even say hello", async () => {
    const res = await rpc("junk", { method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });
});
