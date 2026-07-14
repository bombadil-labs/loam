// The open door, served (SPEC §12). Anonymous requests reach ONLY the restricted read surface
// of mounts whose operator declared schemas public — and to an anonymous caller, a mount with
// nothing public answers exactly like a mount that does not exist (no mount-name oracle). A
// presented-but-wrong token is 401 always: bad credentials never downgrade to anonymous. CORS
// rides every response, because bearer tokens are explicit headers, never ambient — a
// wildcard origin lends no authority.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 15000 });
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, SURVEYOR } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32); // the gardener's seed

let handle: ServerHandle;
let base: string;
let commonsGateway: Gateway;
let commonsDeclaration: Delta;

// The garden: Plant registered and declared public. The meadow: governed, nothing public.
// The commons: public until the revocation test strikes its declaration.
async function governed(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9001), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9002), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

const openDoor = async (gateway: Gateway, ts: number): Promise<Delta> => {
  const declaration = signClaims(publicClaims(["Plant"], OPERATOR, ts), OPERATOR_SEED);
  await gateway.append([declaration]);
  return declaration;
};

beforeAll(async () => {
  const gardenGateway = await governed();
  await openDoor(gardenGateway, 10_000);
  commonsGateway = await governed();
  commonsDeclaration = await openDoor(commonsGateway, 10_000);
  handle = await serve({
    mounts: {
      garden: gardenGateway,
      meadow: await governed(),
      commons: commonsGateway,
    },
    tokens: { "alice-token": { actor: ALICE_SEED }, "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const anon = (mount: string, query: string) =>
  fetch(`${base}/${mount}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });

describe("the anonymous read path", () => {
  it("a tokenless query flows where the operator opened the door", async () => {
    const res = await anon("garden", `{ plant(entity: "${FERN}") { height } }`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { plant: { height: number } } };
    expect(body.data.plant.height).toBe(34);
  });

  it("no oracle: nothing-public and no-such-mount answer the anonymous identically", async () => {
    const closed = await anon("meadow", `{ __typename }`);
    const absent = await anon("orchard", `{ __typename }`);
    expect(closed.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await closed.text()).toBe(await absent.text());
  });

  it("a wrong token is 401 even where anonymous would pass — no downgrade", async () => {
    const res = await fetch(`${base}/garden/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer junk" },
      body: JSON.stringify({ query: `{ plant(entity: "${FERN}") { height } }` }),
    });
    expect(res.status).toBe(401);
  });

  it("the public surface has no mutations, and a private schema stays invisible", async () => {
    const write = await anon(
      "garden",
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
    );
    expect(write.status).toBe(200);
    expect(((await write.json()) as { errors: string[] }).errors.length).toBeGreaterThan(0);
    const after = await anon("garden", `{ plant(entity: "${FERN}") { height } }`);
    expect(
      ((await after.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(34);
  });

  it("every write-shaped surface stays behind the token", async () => {
    for (const verb of ["append", "register", "federate", "mcp"]) {
      const res = await fetch(`${base}/garden/${verb}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status, `anonymous ${verb}`).toBe(401);
    }
  });

  it("anonymous SSE: the snapshot arrives through the open door", async () => {
    const query = encodeURIComponent(
      `subscription { plant(entity: "${FERN}") { height _fromHex } }`,
    );
    const res = await fetch(`${base}/garden/subscribe?query=${query}`, {
      headers: { accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const data = buffer
          .slice(0, boundary)
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("");
        if (data.length > 0) {
          const event = JSON.parse(data) as { plant: { height: number; _fromHex: null | string } };
          expect(event.plant.height).toBe(34);
          expect(event.plant._fromHex).toBeNull();
          break;
        }
        buffer = buffer.slice(boundary + 2);
        continue;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("stream ended before the snapshot");
      buffer += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
  });

  it("anonymous SSE on a closed or absent mount is the same 401", async () => {
    const closed = await fetch(`${base}/meadow/subscribe?query=x`);
    const absent = await fetch(`${base}/orchard/subscribe?query=x`);
    expect(closed.status).toBe(401);
    expect(absent.status).toBe(401);
    expect(await closed.text()).toBe(await absent.text());
  });

  it("a malformed percent-escape in the mount is the same uniform 401, never a 500", async () => {
    const mangled = await fetch(`${base}/%zz/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    const absent = await anon("orchard", `{ __typename }`);
    expect(mangled.status).toBe(401);
    expect(await mangled.text()).toBe(await absent.text());
  });

  it("the public door's stream budget is its own — the token door stays open", async () => {
    const gateway = await governed();
    await openDoor(gateway, 10_000);
    const small = await serve({
      mounts: { grove: gateway },
      tokens: { "alice-token": { actor: ALICE_SEED } },
      port: 0,
      host: "127.0.0.1",
      maxPublicStreams: 1,
    });
    const query = encodeURIComponent(`subscription { plant(entity: "${FERN}") { _hex } }`);
    try {
      const first = await fetch(`${small.url}/grove/subscribe?query=${query}`);
      expect(first.status).toBe(200);
      const second = await fetch(`${small.url}/grove/subscribe?query=${query}`);
      expect(second.status).toBe(503);
      const tokend = await fetch(`${small.url}/grove/subscribe?query=${query}`, {
        headers: { authorization: "Bearer alice-token" },
      });
      expect(tokend.status).toBe(200);
      await first.body!.cancel();
      await tokend.body!.cancel();
    } finally {
      await small.close();
    }
  });

  it("revocation is live at the transport: one negation, the next request refuses", async () => {
    const before = await anon("commons", `{ plant(entity: "${FERN}") { height } }`);
    expect(before.status).toBe(200);
    await commonsGateway.append([
      signClaims(makeNegationClaims(OPERATOR, 10_001, commonsDeclaration.id), OPERATOR_SEED),
    ]);
    const after = await anon("commons", `{ plant(entity: "${FERN}") { height } }`);
    expect(after.status).toBe(401);
  });
});

describe("CORS: the door a browser can see", () => {
  it("a knowledge-free preflight answers for any path, without a token", async () => {
    const res = await fetch(`${base}/garden/graphql`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/POST/);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/authorization/i);
  });

  it("responses carry the wildcard origin — success, refusal, and stream alike", async () => {
    const ok = await anon("garden", `{ plant(entity: "${FERN}") { _hex } }`);
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    const refused = await anon("meadow", `{ __typename }`);
    expect(refused.headers.get("access-control-allow-origin")).toBe("*");
    const query = encodeURIComponent(`subscription { plant(entity: "${FERN}") { height } }`);
    const stream = await fetch(`${base}/garden/subscribe?query=${query}`);
    expect(stream.headers.get("access-control-allow-origin")).toBe("*");
    await stream.body!.cancel();
  });
});
