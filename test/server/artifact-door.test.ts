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
  it("serves the operator the verdict", async () => {
    const res = await get(PACK, "op-token");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      manifest: string[];
      capability: string[];
      coordinates: { server: string; lens: string };
    };
    expect(body.manifest).toEqual(["loam_query", "loam_mutate"]);
    expect(body.capability.join(" ")).toContain("This app reads the lens");
    expect(body.coordinates.server).toBe("My Loam");
    expect(body.coordinates.lens).toBe("Plant");
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

  it("a MALFORMED path is the same nonexistence, not a guess at what was meant", async () => {
    const unknown = await shape(await get(UNKNOWN_VERB, "op-token"));
    for (const bad of [
      "/garden/artifact/plant",
      "/garden/artifact/plant/" + encodeURIComponent(FERN) + "/extra",
      "/garden/artifact//" + encodeURIComponent(FERN),
      "/garden/artifact",
    ]) {
      expect(await shape(await get(bad + "?connector=My%20Loam", "op-token")), bad).toBe(unknown);
    }
    expect((await get(PACK, "op-token")).status).toBe(200);
  });

  it("a REFUSAL reaches the operator in the door's own words — one shape for every door", async () => {
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
    expect(((await res.json()) as { errors: string[] }).errors[0]).toMatch(
      /not declared publishable/,
    );
  });
});
