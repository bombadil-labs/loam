// SPEC §30 criterion 16 — the pack door does not exist to a non-operator, in the RIGHT uniform shape for
// each caller. The reason is specific: the emitted page carries the renderer's BUNDLE SOURCE verbatim,
// which no existing door discloses (`serveRoute` discloses only the bundle's output). Deciding to publish
// your code is the operator's, and so is the emission that carries it.
//
// "DOES NOT EXIST" HAS TWO UNIFORM SHAPES, NOT ONE, and the door must match the right one per caller. An
// earlier reading of this criterion asked for a single response byte-identical across an actor token, no
// token, and a bad token — which `src/server/http.ts` cannot give and should not, because a bad or absent
// token never reaches the verb switch at all. It is refused before mount resolution matters, precisely so
// an anonymous prober learns nothing about which mounts exist:
//
//   token-bearing non-operator → 404 uniform ACROSS VERBS   (this door looks like every unknown one)
//   no token, or a bad token   → 401 uniform ACROSS MOUNTS  (no 404-vs-401 oracle)
//
// Two families, both deliberate. This suite asserts BOTH, byte for byte against the responses the server
// already gives, so neither reveals that `artifact` is a verb the server knows.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const ALICE_SEED = "a1".repeat(32);

const BUNDLE = 'export default (n) => "<p>h=" + n.view.height + "</p>";';

let handle: ServerHandle;
let base: string;
let gateway: Gateway;

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
  ]);
  await gateway.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: BUNDLE,
  });
  await gateway.declareArtifact(["plant"]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true }, "alice-token": { actor: ALICE_SEED } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const get = (path: string, token?: string): Promise<Response> =>
  fetch(`${base}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

// A response reduced to the three things a prober can see: status, every header we set, and the body.
const shape = async (res: Response): Promise<string> =>
  JSON.stringify({
    status: res.status,
    headers: [...res.headers.entries()]
      .filter(([k]) => k !== "date" && k !== "connection" && k !== "keep-alive")
      .sort(),
    body: await res.text(),
  });

const PACK = "/garden/artifact/plant/" + encodeURIComponent(FERN) + "?connector=My%20Loam";
const UNKNOWN_VERB = "/garden/no-such-verb/plant/" + encodeURIComponent(FERN);

describe("§30 criterion 16: the pack door is the operator's, and to anyone else it does not exist", () => {
  it("serves the operator a page", async () => {
    const res = await get(PACK, "op-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const page = await res.text();
    expect(page).toContain("<!doctype html>");
    // The capability statement rides the RESPONSE too, for the operator's own review.
    expect(decodeURIComponent(res.headers.get("x-loam-capability") ?? "")).toContain(
      "This app reads the lens",
    );
    expect(res.headers.get("x-loam-manifest")).toBe("loam_query,loam_mutate");
  });

  it("to a TOKEN-BEARING non-operator: byte-identical to the unknown-verb 404", async () => {
    const door = await get(PACK, "alice-token");
    const unknown = await get(UNKNOWN_VERB, "alice-token");
    expect(await shape(door)).toBe(await shape(unknown));
    expect(door.status).toBe(404);
  });

  it("to a TOKEN-LESS caller: byte-identical to the server's uniform 401", async () => {
    const door = await get(PACK);
    const unknown = await get(UNKNOWN_VERB);
    expect(await shape(door)).toBe(await shape(unknown));
    expect(door.status).toBe(401);
  });

  it("to a BAD-token caller: the same uniform 401, and no 404-vs-401 oracle across mounts", async () => {
    const door = await get(PACK, "not-a-token");
    const unknown = await get(UNKNOWN_VERB, "not-a-token");
    expect(await shape(door)).toBe(await shape(unknown));
    // The other half of that family: a mount that does not exist answers identically, so an
    // anonymous prober cannot learn which mounts the server has.
    const nowhere = await get("/no-such-mount/artifact/plant/x", "not-a-token");
    expect(await shape(nowhere)).toBe(await shape(await get(PACK, "not-a-token")));
  });

  it("a non-GET is the same nonexistence, even to the operator", async () => {
    const res = await fetch(`${base}${PACK}`, {
      method: "POST",
      headers: { authorization: "Bearer op-token" },
    });
    expect(await shape(res)).toBe(await shape(await get(UNKNOWN_VERB, "op-token")));
  });

  it("a REFUSAL reaches the operator in the door's own words — one shape for every door", async () => {
    // The refusal is the operator's own: they already proved they may see this door, so a uniform
    // 404 here would hide a reason they need. Every other identity never gets this far.
    const res = await get(
      "/garden/artifact/plant/" + encodeURIComponent(FERN) + "?connector=",
      "op-token",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors[0]).toMatch(/--connector/);
  });

  it("an undeclared route refuses with its reason, live on the next request", async () => {
    await gateway.publishRenderer({
      route: "undeclared",
      schema: "Plant",
      consumes: ["height"],
      bundle: BUNDLE,
    });
    const res = await get(
      "/garden/artifact/undeclared/" + encodeURIComponent(FERN) + "?connector=My%20Loam",
      "op-token",
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors[0]).toMatch(/not declared publishable/);
  });
});
