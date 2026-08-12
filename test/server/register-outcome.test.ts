// T157, riding along — the registration doors answer what actually happened.
//
// A publish can PERSIST without BINDING: the claim is valid law and is written to append-only
// ground, and this store's fixpoint still does not serve it (a process-local binding holding the
// name, a rival body under it). `publishRegistration` has reported that pair since T28 —
// `{persisted, bound, reason}` — and both HTTP doors threw the outcome away and answered 200 with
// the name and the entity. The operator read "registered" and had no way to learn that nothing
// serves it. The same H7 shape, at two of the four doors that carry it.
//
// Two-sided at both levels, per door: an unbindable registration answers `bound: false` WITH the
// proximate cause, AND the surface really is unchanged — while an ordinary registration answers
// `bound: true`, carries no reason, and its type answers immediately. `bound` is a fact about a
// LENS, so the answer names the lens too, and one fixture makes lens and program differ (H6).
//
// GAP, named: the other two doors are NOT covered here and still discard the outcome.
// `loam register` (`src/cli/cli.ts`) prints "the next serve grows the surface from it"
// unconditionally; `POST /admin/register` (`src/server/admin.ts`) redirects on any publish that
// did not throw. The CLI half is claimed by an open PR (T85); the admin half needs a rendered
// page to say it in, which is a page change rather than a field.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSchema, parseTerm } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const PICK = { pick: { order: { byTimestamp: "desc" } } };

// A VALID gather body that is not Plant's. Registering it under the name a manual binding already
// holds is a rival, not an evolution: the deltas land, the fixpoint refuses to serve them.
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

// The quarry mount's law, held in this PROCESS under a reading of its own — so `lens` and
// `registered` genuinely differ, and a rail can tell which one the door reported on. Publishing
// the same pair through the door is then shadowed by this override: written, and not serving here.
const STONE = {
  hyperschema: { name: "Stone", alg: 1, body: freshRock.hyperschema.body },
  schema: { name: "StoneRough", props: { color: PICK }, default: PICK },
  roots: ["stone:1"],
  writable: ["color"],
};

interface Answer {
  registered: string; // the PROGRAM name the operator typed
  lens: string; // the READING `bound` is a fact about (H6)
  entity: string;
  bound: boolean;
  reason?: string;
}

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  // The manual registration is the shadow: this process holds "Plant" in memory, so a published
  // rival under that name persists and cannot bind HERE. (A peer pulling those deltas, holding no
  // such manual binding, binds them fine — which is why the write is not refused.)
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

// The fern's resolved hex under whatever currently serves `plant` — an expectation taken from the
// surface BEFORE a publish, so it can disagree with the surface after one.
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
    // The object-level expectation is taken BEFORE the publish, from the surface as it stands.
    // "The field still resolves" would be worthless — `plant` exists because beforeAll registered
    // it in-process, so it answers whether the rival binds, does not bind, or was never sent. The
    // rival body is a different gather, so its `_hex` differs: pinning the hex is the assertion
    // that can actually go red if the rival ever shapes the surface.
    const before = await hexOfFern();
    expect(before).toMatch(/^[0-9a-f]+$/);

    const res = await register(rivalPlant);
    expect(res.status).toBe(200); // the deltas landed — this is not a refusal
    const body = (await res.json()) as Answer;
    expect(body.registered).toBe("Plant");
    expect(body.bound).toBe(false);
    expect(body.reason).toMatch(/DIFFERENT bodies|collides/i);

    // Object level: what the door SAID matches what the surface DOES — byte-identical, so the
    // manual Plant still serves its own shape and the published rival shapes nothing.
    expect(await hexOfFern()).toBe(before);
  });

  it("POST /:mount/register: `bound` is a fact about the LENS, and the answer names which one", async () => {
    // H6: `bound` is decided at (entity, LENS) — a program may carry sibling readings of which
    // some bind and some do not, so a report naming only the program can report on the wrong
    // thing. Every fixture above has an anonymous schema, where lens and program COINCIDE and no
    // assertion could tell them apart. The quarry mount does not: its law is held in-process
    // under the reading `StoneRough` over the program `Stone`.
    // The published reading carries an EXTRA field the in-process one does not. That is the
    // object-level witness: if this publish ever bound, `grit` would appear on `stoneRough`. A
    // fixture publishing the identical schema could not tell a bound publish from a shadowed one.
    const res = await register(
      {
        ...STONE,
        schema: { ...STONE.schema, props: { color: PICK, grit: PICK } },
        writable: ["color", "grit"],
      },
      "quarry",
    );
    expect(res.status).toBe(200); // written — the process-local override is not a refusal
    const body = (await res.json()) as Answer;
    expect(body.registered).toBe("Stone"); // the PROGRAM the operator typed
    expect(body.lens).toBe("StoneRough"); // the READING `bound` is about
    expect(body.lens).not.toBe(body.registered); // the two really are different here
    expect(body.bound).toBe(false);
    expect(body.reason).toMatch(/collides with an earlier schema/);

    // Object level: the door named the reading, and the reading is what the surface answers to.
    // `stone` is not a field; `stoneRough` is — and it still has no `grit`, so the publish that
    // said it did not bind really did not.
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
    expect(body.reason).toBeUndefined(); // a bound registration has nothing to explain

    // ...and the claim is true: the new type answers on the surface immediately.
    const answer = await gql(`{ rock(entity: "rock:1") { _hex } }`);
    expect(((await answer.json()) as { errors?: string[] }).errors).toBeUndefined();
  });

  it("loam_register over MCP carries the same two answers", async () => {
    // The MCP tool shares performRegistration with the HTTP door, so this rail exists to keep
    // that sharing honest: a future split that reported on one door and not the other goes red.
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
