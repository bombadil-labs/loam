// The browser client (SPEC §12), exercised against a real listening server. Non-custodial by
// construction: the seed is minted client-side, every delta is signed client-side, and the
// bearer token authenticates TRANSPORT only — the delta's own verified author is the
// authority the door asks about. Public reads ride with no token at all.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  authorForSeed as serverAuthorForSeed,
  signClaims,
  verifyDelta,
} from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 15000 });
import { loamClient, mintSeed } from "../../src/client/index.js";
import { fromWire } from "../../src/federation/wire.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = serverAuthorForSeed(OPERATOR_SEED);
const TRANSPORT_SEED = "a1".repeat(32); // the token's actor — NOT the client's identity

let gateway: Gateway;
let handle: ServerHandle;
let mount: string;

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  await gateway.append([signClaims(publicClaims(["Plant"], OPERATOR, 9000), OPERATOR_SEED)]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "transport-token": { actor: TRANSPORT_SEED } },
    port: 0,
    host: "127.0.0.1",
  });
  mount = `${handle.url}/garden`;
});
afterAll(async () => {
  await handle.close();
});

describe("keygen in the page", () => {
  it("mintSeed mints distinct 32-byte hex seeds that derive authors", async () => {
    const { authorForSeed } = await import("../../src/client/index.js");
    const a = mintSeed();
    const b = mintSeed();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    // The client derives the same author the server would — one identity, both sides.
    expect(authorForSeed(a)).toBe(serverAuthorForSeed(a));
  });
});

describe("local signing and the non-custodial door", () => {
  it("signs locally: the delta verifies, and timestamps are monotonic", () => {
    const seed = mintSeed();
    const client = loamClient({ url: mount, seed });
    const first = client.sign([
      { role: "subject", at: FERN, context: "height" },
      { role: "value", value: 41 },
    ]);
    const second = client.sign([
      { role: "subject", at: FERN, context: "height" },
      { role: "value", value: 42 },
    ]);
    const delta = fromWire(first);
    expect(verifyDelta(delta)).toBe("verified");
    expect(delta.claims.author).toBe(client.author);
    const secondTs = fromWire(second).claims.timestamp;
    expect(secondTs).toBeGreaterThan(delta.claims.timestamp);
  });

  it("a granted author writes through /append under its OWN name, not the token's", async () => {
    const seed = mintSeed();
    const author = serverAuthorForSeed(seed);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, author, "write", OPERATOR, 9100), OPERATOR_SEED),
    ]);
    const client = loamClient({ url: mount, token: "transport-token", seed });
    const receipt = await client.claim([
      { role: "subject", at: FERN, context: "height" },
      { role: "value", value: 77 },
    ]);
    expect(receipt.accepted).toBe(1);
    const landed = gateway.reactor.get(receipt.delta);
    expect(landed?.claims.author).toBe(author);
    expect(landed?.claims.author).not.toBe(serverAuthorForSeed(TRANSPORT_SEED));
  });

  it("without standing, the door refuses — the token lends no authority", async () => {
    const client = loamClient({ url: mount, token: "transport-token", seed: mintSeed() });
    await expect(
      client.claim([
        { role: "subject", at: FERN, context: "height" },
        { role: "value", value: 99 },
      ]),
    ).rejects.toThrow(/not permitted/);
  });

  it("a tokenless client cannot append at all — the transport door needs its bearer", async () => {
    const seed = mintSeed();
    const author = serverAuthorForSeed(seed);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, author, "write", OPERATOR, 9200), OPERATOR_SEED),
    ]);
    const client = loamClient({ url: mount, seed });
    await expect(
      client.claim([
        { role: "subject", at: FERN, context: "height" },
        { role: "value", value: 1 },
      ]),
    ).rejects.toThrow(/bearer|token/i);
  });

  it("a client with no seed refuses to sign, plainly", () => {
    const client = loamClient({ url: mount });
    expect(client.author).toBeUndefined();
    expect(() => client.sign([{ role: "note", value: "x" }])).toThrow(/seed/);
  });
});

describe("the public read path", () => {
  it("queries without a token through the open door", async () => {
    const client = loamClient({ url: mount });
    const result = await client.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((result.data as { plant: { height: number } }).plant.height).toBe(77);
  });

  it("carries variables", async () => {
    const client = loamClient({ url: mount });
    const result = await client.query(`query($e: ID!) { plant(entity: $e) { _entity } }`, {
      e: FERN,
    });
    expect((result.data as { plant: { _entity: string } }).plant._entity).toBe(FERN);
  });

  it("subscribes over SSE: snapshot, then the patch when the ground moves", async () => {
    const client = loamClient({ url: mount });
    const stream = client.subscribe(
      `subscription { plant(entity: "${FERN}") { height _fromHex } }`,
    );
    const first = (await stream.next()).value as {
      plant: { height: number; _fromHex: string | null };
    };
    expect(first.plant._fromHex).toBeNull();
    expect(first.plant.height).toBe(77);

    await gateway.query(`mutation { plant(entity: "${FERN}", height: 78) { height } }`);
    const second = (await stream.next()).value as {
      plant: { height: number; _fromHex: string | null };
    };
    expect(second.plant.height).toBe(78);
    expect(second.plant._fromHex).not.toBeNull();
    await stream.return(undefined);
  });

  it("a refused subscription surfaces the server's reason, not a hang", async () => {
    const client = loamClient({ url: mount });
    const stream = client.subscribe(`subscription { ledger(entity: "x") { _hex } }`);
    await expect(stream.next()).rejects.toThrow(/not defined|Cannot query field|refus/i);
  });
});

describe("the SSE parser, against a hand-fed wire", () => {
  const sse =
    (chunks: string[]): typeof fetch =>
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              for (const c of chunks) controller.enqueue(encoder.encode(c));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );

  it("survives a frame split across chunks, and CRLF framing", async () => {
    const client = loamClient({
      url: "http://nowhere.invalid/m",
      fetch: sse([`data: {"a":`, `1}\r\n\r\ndata: {"b":2}\n\n`]),
    });
    const stream = client.subscribe(`subscription { x }`);
    expect((await stream.next()).value).toEqual({ a: 1 });
    expect((await stream.next()).value).toEqual({ b: 2 });
    expect((await stream.next()).done).toBe(true);
  });

  it("a mid-stream error frame throws with the server's reason", async () => {
    const client = loamClient({
      url: "http://nowhere.invalid/m",
      fetch: sse([
        `data: {"ok":true}\n\n`,
        `event: error\ndata: {"message":"the stream failed loudly"}\n\n`,
      ]),
    });
    const stream = client.subscribe(`subscription { x }`);
    expect((await stream.next()).value).toEqual({ ok: true });
    await expect(stream.next()).rejects.toThrow(/failed loudly/);
  });
});
