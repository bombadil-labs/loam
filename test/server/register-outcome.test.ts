import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSchema, parseTerm } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const PICK = { pick: { order: { byTimestamp: "desc" } } };

const RIVAL_BODY = {
  op: "group",
  key: "byTargetContext",
  in: { op: "mask", policy: "drop", in: "input" },
};

const rivalPlant = {
  hyperschema: { name: "Plant", alg: 1, body: RIVAL_BODY },
  schema: { props: { height: PICK }, default: PICK },
  roots: [FERN],
  writable: ["height"],
};

const freshRock = {
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

const STONE = {
  hyperschema: { name: "Stone", alg: 1, body: freshRock.hyperschema.body },
  schema: { name: "StoneRough", props: { color: PICK }, default: PICK },
  roots: ["stone:1"],
  writable: ["color"],
};

interface Answer {
  registered: string;
  lens: string;
  entity: string;
  bound: boolean;
  reason?: string;
}

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const quarry = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  quarry.register(
    { name: STONE.hyperschema.name, alg: 1, body: parseTerm(STONE.hyperschema.body) },
    parseSchema({ ...STONE.schema, alg: 1 }),
    STONE.roots,
    undefined,
    STONE.writable,
  );
  handle = await serve({
    mounts: { garden: gateway, quarry },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});

afterAll(async () => {
  await handle.close();
});

const register = (body: unknown, mount = "garden") =>
  fetch(`${base}/${mount}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer op-token" },
    body: JSON.stringify(body),
  });

const viaMcp = async (body: unknown): Promise<Answer> => {
  const res = await fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer op-token" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "loam_register", arguments: body },
    }),
  });
  const rpc = (await res.json()) as { result: { content: Array<{ text: string }> } };
  return JSON.parse(rpc.result.content[0]!.text) as Answer;
};

const hexOfFern = async (): Promise<string> => {
  const res = await gql(`{ plant(entity: "${FERN}") { _hex } }`);
  const body = (await res.json()) as { data?: { plant?: { _hex?: string } }; errors?: string[] };
  expect(body.errors).toBeUndefined();
  return body.data!.plant!._hex!;
};

const gql = (query: string, mount = "garden") =>
  fetch(`${base}/${mount}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer op-token" },
    body: JSON.stringify({ query }),
  });

describe("the registration doors report whether anything now serves the name", () => {
  it("POST /:mount/register: a rival body is 200, persisted, and says bound: false with the cause", async () => {
    const before = await hexOfFern();
    expect(before).toMatch(/^[0-9a-f]+$/);

    const res = await register(rivalPlant);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Answer;
    expect(body.registered).toBe("Plant");
    expect(body.bound).toBe(false);
    expect(body.reason).toMatch(/DIFFERENT bodies|collides/i);

    expect(await hexOfFern()).toBe(before);
  });

  it("POST /:mount/register: `bound` is a fact about the LENS, and the answer names which one", async () => {
    const res = await register(
      {
        ...STONE,
        schema: { ...STONE.schema, props: { color: PICK, grit: PICK } },
        writable: ["color", "grit"],
      },
      "quarry",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Answer;
    expect(body.registered).toBe("Stone");
    expect(body.lens).toBe("StoneRough");
    expect(body.lens).not.toBe(body.registered);
    expect(body.bound).toBe(false);
    expect(body.reason).toMatch(/collides with an earlier schema/);

    const byLens = await gql(`{ stoneRough(entity: "stone:1") { _hex } }`, "quarry");
    expect(((await byLens.json()) as { errors?: string[] }).errors).toBeUndefined();
    const byProgram = await gql(`{ stone(entity: "stone:1") { _hex } }`, "quarry");
    expect(((await byProgram.json()) as { errors?: string[] }).errors).toBeDefined();
    const withGrit = await gql(`{ stoneRough(entity: "stone:1") { grit } }`, "quarry");
    const gritErrors = ((await withGrit.json()) as { errors?: string[] }).errors;
    expect(gritErrors?.join(" ")).toMatch(/grit/);
  });

  it("POST /:mount/register: an ordinary registration says bound: true, with no reason to give", async () => {
    const res = await register(freshRock);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Answer;
    expect(body.registered).toBe("Rock");
    expect(body.bound).toBe(true);
    expect(body.reason).toBeUndefined();

    const answer = await gql(`{ rock(entity: "rock:1") { _hex } }`);
    expect(((await answer.json()) as { errors?: string[] }).errors).toBeUndefined();
  });

  it("loam_register over MCP carries the same two answers", async () => {
    const unbound = await viaMcp(rivalPlant);
    expect(unbound.bound).toBe(false);
    expect(unbound.reason).toMatch(/DIFFERENT bodies|collides/i);

    const bound = await viaMcp({
      ...freshRock,
      hyperschema: { ...freshRock.hyperschema, name: "Pond" },
      roots: ["pond:1"],
    });
    expect(bound.bound).toBe(true);
    expect(bound.reason).toBeUndefined();
    const answer = await gql(`{ pond(entity: "pond:1") { _hex } }`);
    expect(((await answer.json()) as { errors?: string[] }).errors).toBeUndefined();
  });
});
