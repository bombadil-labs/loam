// The MCP door's tool names must be its actual authorities. `loam_query` is named, described, and
// (now) ANNOTATED as the read surface, and a shell that believes `readOnlyHint: true` is licensed to
// cache a call and REPLAY it — so a document that writes must never travel under that name.
//
// Asserted at both levels, on every refusal: the GROUND (the backend's whole delta set, counted
// before and after) and the READING (what `loam_query` answers for the same entity afterwards). The
// count alone cannot see a write that replaced a claim without growing the store; the reading alone
// cannot see a delta that landed unresolved. The positive legs are load-bearing too — a door that
// refused everything would satisfy the refusals and serve nobody.
//
// The MUTATION legs are the ones that pin a real write path — they were watched red, and the ground
// moved. The subscription leg asserts both levels for symmetry rather than because a write could slip
// through it: graphql's `execute` never invokes a subscription field's `subscribe` resolver, so that
// document cannot write even with the guard gone. What it pins there is honesty — the read tool is
// not a stream door — and that assertion holds whatever the substrate does later.
//
// Deliberately NOT asserted: `operationName` selecting one operation out of several. The MCP tool
// takes `{ query, variables }` and no operation name, so there is nothing to select with; the rail
// instead pins that a mutation ANYWHERE in the document refuses the whole document, which is what
// keeps that gap closed if an operation name is ever plumbed through.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 15000 });
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = "a1".repeat(32); // the gardener: a real write standing, so a leaked write WOULD land
const OPERATOR = authorForSeed(OPERATOR_SEED);
const SURVEYOR = authorForSeed("b2".repeat(32)); // the garden fixture's other author

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

// The GROUND: every delta the backend holds. `flush()` first — a surface write is queued behind
// the resolver's answer, so counting without it would read the store one write early.
const deltas = async (): Promise<number> => {
  await gateway.flush();
  return (await backend.deltasSince(new Set())).length;
};

// The READING: what the read door itself answers, resolved through the lens.
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
    // The ground first: it is the assertion that matters, and the one a cosmetic refusal would pass.
    expect(await deltas()).toBe(count); // delta level: nothing landed
    expect(await heightViaDoor()).toBe(before); // object level: no reader sees 91
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/loam_mutate/);
    // The refusal is a refusal, not a report of a write it performed.
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
    // The refusal must be the READ DOOR's, naming the write door — not graphql-js's incidental
    // "must provide operation name", which is a parser accident and would evaporate the day an
    // operation name reaches the resolver.
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
    // The door this refusal points at is itself a read: graphql's `subscribe` throws
    // `Expected subscription operation.` for a query or mutation document, so ?query=mutation{…}
    // on /subscribe is not a way around this one.
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
    // The read-door check cannot classify what it cannot parse, and must not invent a refusal for
    // it: a syntax error belongs to the layer that knows the schema.
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

    // The `query` KEYWORD must survive the check — refusing every named operation would pass the
    // refusal rails above and break the door.
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

    expect(await deltas()).toBeGreaterThan(count); // delta level: a claim landed
    expect(await heightViaDoor()).toBe(77); // object level: the reader sees it
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
    // Explicitly FALSE, not absent: a wire-explicit write declaration is what makes a shell's own
    // cache/replay machinery refuse the call, which is a second guard we do not hold ourselves.
    expect(byName.get("loam_mutate")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("loam_register")?.annotations?.readOnlyHint).toBe(false);
  });
});

// An annotation is only an authority if the NEGOTIATED revision can carry it. `readOnlyHint` arrived
// in MCP 2025-03-26; a client told "2024-11-05" that validates against, or gates policy on, the
// revision it negotiated never sees the field at all — so the declaration above would be legible to
// us and invisible to the shell whose cache we are trying to restrain. These rails assert the
// negotiated string, which nothing pinned before: the annotation half is asserted on OUR side of the
// wire and stays true whatever the client was told it may read.
describe("MCP protocol negotiation: the revision must be able to carry the annotation", () => {
  const ANNOTATIONS_SINCE = "2025-03-26"; // ISO dates order lexicographically
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
      { protocolVersion: "2024-11-05" }, // predates ToolAnnotations entirely
      { protocolVersion: "1999-01-01" },
      { protocolVersion: 20250618 }, // not even a string
    ]) {
      const spoken = await initialize(params);
      expect(spoken >= ANNOTATIONS_SINCE).toBe(true); // it can carry what we declare
      // …and it is the NEWEST we speak, not merely a new-enough one: a fallback that negotiates down
      // gives up every later revision's vocabulary for nothing. Bump this deliberately when the door
      // learns a newer one.
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
