// The byte-door over real HTTP (SPEC §23.7): GET /:mount/bytes/<ref>?from=<lens>/<entity> returns the
// raw bytes with the BytesView's own mime — on the full door under the token's read discipline, and on
// the anonymous door only for a publicly-declared lens. GET-only; a malformed probe refuses uniformly.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authorForSeed,
  contentAddress,
  signClaims,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, PLANT_BODY } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const REF = contentAddress(PNG);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const PROFILE: Schema = { props: new Map<string, Policy>([["avatar", pick]]), default: pick };

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  gw.register({ name: "Plant", alg: 1, body: PLANT_BODY }, PROFILE, [FERN], undefined, []);
  await gw.append([
    signClaims(
      {
        timestamp: 1000,
        author: OP,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "avatar" } } },
          { role: "value", target: { kind: "bytes", mime: "image/png", value: PNG } },
        ],
      },
      OP_SEED,
    ),
    signClaims(publicClaims(["Plant"], OP, 2000), OP_SEED),
  ]);
  handle = await serve({
    mounts: { almanac: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const from = `Plant/${encodeURIComponent(FERN)}`;

describe("the byte-door over HTTP", () => {
  it("the full door serves the raw bytes with the BytesView's mime", async () => {
    const res = await fetch(`${base}/almanac/bytes/${REF}?from=${from}`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
  });

  it("the anonymous door serves it too, because Plant is publicly declared", async () => {
    const res = await fetch(`${base}/almanac/bytes/${REF}?from=${from}`);
    expect(res.status).toBe(200);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
  });

  it("a wrong `from` entity is a uniform 404 to the anonymous caller", async () => {
    const res = await fetch(`${base}/almanac/bytes/${REF}?from=Plant/entity:absent`);
    expect(res.status).toBe(404);
  });

  it("POST is refused (the door is GET-only); a missing `from` refuses too", async () => {
    const post = await fetch(`${base}/almanac/bytes/${REF}?from=${from}`, {
      method: "POST",
      headers: { authorization: "Bearer op-token" },
    });
    expect(post.status).toBeGreaterThanOrEqual(400);
    const noFrom = await fetch(`${base}/almanac/bytes/${REF}`, {
      headers: { authorization: "Bearer op-token" },
    });
    expect(noFrom.status).toBeGreaterThanOrEqual(400);
  });
});
