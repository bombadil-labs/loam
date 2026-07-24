// T70 (health) — the door. GET /:mount/health answers the operator's question "have my store's
// promises settled to bytes?" over HTTP. Operator-token only: the outstanding list names ids the
// operator ordered forgotten, and advertising WHAT a store is still trying to forget — or even
// that it is trying — belongs to whoever governs it, nobody else. To any other identity or
// method the door DOES NOT EXIST: byte-for-byte the 404 an unknown verb gets, so a valid token
// cannot even learn the route is real (no exists-oracle). Anonymous callers are refused upstream
// like every verb.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

vi.setConfig({ testTimeout: 15000 });

const OP_SEED = "0e".repeat(32);
const target = observed(FERN, "height", 30, 1000, OP_SEED);

let handle: ServerHandle;
let base: string;
let backend: MemoryBackend;

beforeAll(async () => {
  backend = new MemoryBackend();
  const gateway = await Gateway.open(backend, { seed: OP_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.append([target]);
  await gateway.erase(target.id);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true }, "reader-token": { actor: GARDENER_SEED } },
    port: 0,
  });
  base = handle.url;
});
afterAll(async () => handle.close());

const get = (path: string, token?: string): Promise<Response> =>
  fetch(`${base}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

describe("T70: GET /:mount/health — the operator's settling report", () => {
  it("the operator reads a settled store, then watches a resurfaced byte reopen the debt", async () => {
    const clean = await get("/garden/health", "op-token");
    expect(clean.status).toBe(200);
    const settled = (await clean.json()) as { status: string; erasure: { pending: number } };
    expect(settled.status).toBe("ok");
    expect(settled.erasure.pending).toBe(0);

    await backend.append([target]); // a lagging tier delivers the byte back, behind the gateway
    const dirty = await get("/garden/health", "op-token");
    const settling = (await dirty.json()) as {
      status: string;
      erasure: { pending: number; outstanding: string[] };
    };
    expect(settling.status).toBe("settling");
    expect(settling.erasure.outstanding).toContain(target.id);

    await backend.purge([target.id]); // restore for any later assertion
  });

  it("to a non-operator token the door does not exist — byte-for-byte an unknown verb's 404", async () => {
    const res = await get("/garden/health", "reader-token");
    const uniform = await get("/garden/nonesuch-verb", "reader-token");
    expect(res.status).toBe(404);
    expect(uniform.status).toBe(404);
    // Same body too: a distinctive refusal would be the exists-oracle in a party mask.
    expect(await res.text()).toBe(await uniform.text());
  });

  it("anonymous is refused upstream; a write-shaped method does not exist even for the operator", async () => {
    expect((await get("/garden/health")).status).toBe(401); // every verb refuses anonymous alike
    const post = await fetch(`${base}/garden/health`, {
      method: "POST",
      headers: { authorization: "Bearer op-token" },
    });
    expect(post.status).toBe(404); // not refused-as-closed: nonexistent, like any unknown surface
  });
});
