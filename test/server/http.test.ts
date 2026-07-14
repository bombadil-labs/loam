// Step 6's contract: the gateway, served. One node:http server; bearer tokens map onto step 5's
// actor-per-request seam (transport adds authentication, never new authority); mounts isolate
// stores; GraphQL over POST, subscriptions over SSE, and a minimal MCP surface over JSON-RPC.
// Everything here talks to a real listening server with a real fetch — no shortcuts through
// in-process calls.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

// Real listening server + SSE; a generous hang-guard so machine load can't blow the default
// per-test timeout. Only ever matters when something is genuinely stuck.
vi.setConfig({ testTimeout: 15000 });
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { toWire } from "../../src/federation/wire.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = "a1".repeat(32); // the gardener
const MALLORY_SEED = "e4".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

const SURVEYOR = authorForSeed("b2".repeat(32));

let handle: ServerHandle;
let base: string;

async function governedGarden(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9002), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9003), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

async function emptyMeadow(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateway.register(PLANT, PLANT_POLICY, ["plant:moss"], undefined, PLANT_WRITABLE);
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
    // and the refusal actually refused: the value is not mallory's 99
    const after = await gql("garden", "alice-token", `{ plant(entity: "${FERN}") { height } }`);
    expect(
      ((await after.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).not.toBe(99);
  });

  it("an unknown mount is 404 — but only to the authenticated; prototype keys are not mounts", async () => {
    expect((await gql("orchard", "alice-token", `{ __typename }`)).status).toBe(404);
    // a prototype-member name resolves no phantom gateway
    expect((await gql("__proto__", "alice-token", `{ __typename }`)).status).toBe(404);
    expect((await gql("constructor", "alice-token", `{ __typename }`)).status).toBe(404);
    // and an unauthenticated caller cannot tell a real mount from a missing one: both 401
    const realNoToken = await gql("garden", undefined, `{ __typename }`);
    const fakeNoToken = await gql("orchard", undefined, `{ __typename }`);
    expect(realNoToken.status).toBe(401);
    expect(fakeNoToken.status).toBe(401);
  });

  it("mounts are separate worlds", async () => {
    // the meadow has no fern claims: its plant view is silent about the garden's data
    const meadow = await gql("meadow", "op-token", `{ plant(entity: "${FERN}") { height } }`);
    const body = (await meadow.json()) as { data: { plant: { height: number | null } } };
    expect(body.data.plant.height).toBeNull();
  });

  it("an oversized body is refused, not swallowed", async () => {
    const huge = "x".repeat(6 * 1024 * 1024);
    const res = await fetch(`${base}/garden/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer alice-token" },
      body: JSON.stringify({ query: `{ plant(entity: "${huge}") { height } }` }),
    });
    expect(res.status).toBe(413);
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
        arguments: { mutation: `mutation { plant(entity: "${FERN}", height: 7) { height } }` },
      },
    });
    const deniedBody = (await denied.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(deniedBody.result.isError).toBe(true);
    expect(deniedBody.result.content[0]!.text).toMatch(/not permitted/);
    // the denial refused: mallory's 7 did not land
    const check = await rpc("alice-token", {
      method: "tools/call",
      params: {
        name: "loam_query",
        arguments: { query: `{ plant(entity: "${FERN}") { height } }` },
      },
    });
    const checkBody = (await check.json()) as { result: { content: Array<{ text: string }> } };
    const height = (
      JSON.parse(checkBody.result.content[0]!.text) as { data: { plant: { height: number } } }
    ).data.plant.height;
    expect(height).not.toBe(7);
  });

  it("a notification (no id) is answered with silence", async () => {
    const res = await fetch(`${base}/garden/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer alice-token" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    });
    expect(res.status).toBe(202);
  });

  it("a junk token cannot even say hello", async () => {
    const res = await rpc("junk", { method: "initialize", params: {} });
    expect(res.status).toBe(401);
  });
});

// The non-custodial door: a client signs its own deltas and presents them; the token merely
// authenticates transport — each delta is authorized by its own verified author's standing.
describe("POST /:mount/append", () => {
  const post = (deltas: unknown[]) =>
    fetch(`${base}/garden/append`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer mallory-token" },
      body: JSON.stringify({ deltas }),
    });

  it("a pre-signed delta lands under its own author, whatever token carried it", async () => {
    // signed by ALICE (who holds standing) — carried over MALLORY's token
    const delta = observed(FERN, "note", "self-signed, hand-carried", Date.now(), ALICE_SEED);
    const res = await post([toWire(delta)]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accepted: number; duplicates: number };
    expect(body.accepted).toBe(1);
    const read = await gql("garden", "alice-token", `{ plant(entity: "${FERN}") { _view } }`);
    expect(JSON.stringify((await read.json()) as unknown)).toContain("hand-carried");
  });

  it("an author without standing is 403 — the token cannot lend authority", async () => {
    const delta = observed(FERN, "note", "forgery", Date.now(), MALLORY_SEED);
    const res = await post([toWire(delta)]);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/not permitted/);
  });

  it("a batch is all-or-nothing: one standing-less delta refuses the honest rest", async () => {
    const honest = observed(FERN, "note", "should-not-land-alone", Date.now(), ALICE_SEED);
    const stranger = observed(FERN, "note", "no standing", Date.now() + 1, MALLORY_SEED);
    const res = await post([toWire(honest), toWire(stranger)]);
    expect(res.status).toBe(403);
    const read = await gql("garden", "alice-token", `{ plant(entity: "${FERN}") { _view } }`);
    expect(JSON.stringify((await read.json()) as unknown)).not.toContain("should-not-land-alone");
  });

  it("a tampered delta is 400; a malformed body is 400", async () => {
    const honest = observed(FERN, "note", "tamper-target", Date.now(), ALICE_SEED);
    const res = await post([{ ...toWire(honest), id: `1e20${"00".repeat(32)}` }]);
    expect(res.status).toBe(400);
    const junk = await fetch(`${base}/garden/append`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify({ nope: true }),
    });
    expect(junk.status).toBe(400);
  });
});

// The turnkey path: a served store gains its first (or next) schema with nothing but curl.
// Registration is constitutional, so the gate is the operator token — authentication is not
// authorization here any more than anywhere else.
describe("POST /:mount/register: the schema-schema mutation mechanism, served", () => {
  const PICK = { pick: { order: { byTimestamp: "desc" } } };
  const rockBody = {
    hyperschema: {
      name: "Rock",
      alg: 1,
      body: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    },
    schema: { props: { color: PICK }, default: PICK },
    roots: ["rock:1"],
    writable: ["color"],
  };
  const register = (mount: string, token: string, body: unknown) =>
    fetch(`${base}/${mount}/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

  it("an operator registers a schema over HTTP; the new type answers immediately", async () => {
    const res = await register("meadow", "op-token", rockBody);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { registered: string; entity: string };
    expect(body.registered).toBe("Rock");
    expect(body.entity).toBe("hyperschema:Rock");

    // write and read through the brand-new surface — no restart, no library
    const write = await gql(
      "meadow",
      "op-token",
      `mutation { rock(entity: "rock:1", color: "basalt") { color } }`,
    );
    const written = (await write.json()) as { data: { rock: { color: string } } };
    expect(written.data.rock.color).toBe("basalt");
    // and the pre-existing manual registration (Plant) still serves beside it
    const both = await gql("meadow", "op-token", `{ plant(entity: "plant:moss") { _hex } }`);
    expect(((await both.json()) as { errors?: string[] }).errors).toBeUndefined();
  });

  it("a non-operator token is 403: registration is constitutional", async () => {
    const res = await register("garden", "alice-token", rockBody);
    expect(res.status).toBe(403);
  });

  it("a malformed registration is 400 with a reason, and nothing binds", async () => {
    const res = await register("meadow", "op-token", {
      hyperschema: { name: "Broken", alg: 1, body: { op: "no-such-op" } },
      schema: { default: PICK },
      roots: [],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors.length).toBeGreaterThan(0);
    const gone = await gql("meadow", "op-token", `{ broken(entity: "x") { _hex } }`);
    expect(((await gone.json()) as { errors?: string[] }).errors).toBeDefined();
  });

  it("loam_register rides MCP under the same operator gate", async () => {
    const pondBody = {
      ...rockBody,
      hyperschema: { ...rockBody.hyperschema, name: "Pond" },
      roots: ["pond:1"],
    };
    const denied = await rpcOn("garden", "alice-token", {
      method: "tools/call",
      params: { name: "loam_register", arguments: pondBody },
    });
    const deniedBody = (await denied.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(deniedBody.result.isError).toBe(true);
    expect(deniedBody.result.content[0]!.text).toMatch(/operator/);

    const ok = await rpcOn("garden", "op-token", {
      method: "tools/call",
      params: { name: "loam_register", arguments: pondBody },
    });
    const okBody = (await ok.json()) as {
      result: { content: Array<{ text: string }>; isError?: boolean };
    };
    expect(okBody.result.isError).not.toBe(true);
    const listed = await rpcOn("garden", "alice-token", { method: "tools/list", params: {} });
    const tools = ((await listed.json()) as { result: { tools: Array<{ name: string }> } }).result
      .tools;
    expect(tools.map((t) => t.name)).toContain("loam_register");
    const answer = await gql("garden", "alice-token", `{ pond(entity: "pond:1") { _hex } }`);
    expect(((await answer.json()) as { errors?: string[] }).errors).toBeUndefined();
  });

  const rpcOn = (mount: string, token: string, body: Record<string, unknown>) =>
    fetch(`${base}/${mount}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
    });
});
