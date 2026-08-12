// T104 — THE FRONT DOOR: GET / greets a human; everything else answers exactly as before.
//
// The bare root is the one path with no world behind it, so it is the one path that can afford a
// warm answer — and the answer must be a CONSTANT. These rails hold both halves at the object
// level (what the door serves):
//
//   * the greeting is byte-identical across a three-mount store with a public declaration, a
//     store with no mounts at all, a tokened and a tokenless caller, and a mount table that moves
//     under it — anything it varied on would be an oracle;
//   * the greeting lives at EXACTLY `/` (plus GET /favicon.ico → 204): a mount's bare root, an
//     absent mount, and a POST to `/` all refuse precisely as they did before it existed.
//
// What these rails deliberately do NOT assert: the uniform-refusal discipline on mount paths —
// that is test/server/dynamic-mounts.test.ts, frozen; this file only proves the greeting did not
// disturb it at the edges the greeting touches.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

vi.setConfig({ testTimeout: 20_000 }); // real listening servers

import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "7c".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = async (height: number): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", height, 1000, OP_SEED)]);
  return gw;
};

interface Answer {
  readonly status: number;
  readonly contentType: string;
  readonly text: string;
}

const get = async (base: string, path: string, token?: string): Promise<Answer> => {
  const res = await fetch(`${base}${path}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
  };
};

let garden: Gateway;
let meadow: Gateway;
let orchard: Gateway;
let annex: Gateway; // mounted and unmounted mid-test, to move the table under the greeting
let handle: ServerHandle;
let base: string;

beforeEach(async () => {
  garden = await boot(41);
  meadow = await boot(17);
  orchard = await boot(30);
  annex = await boot(5);
  // The garden's operator opened the §12 anonymous door — the greeting must not care.
  await garden.append([signClaims(publicClaims(["Plant"], OP, 10_000), OP_SEED)]);
  handle = await serve({
    mounts: { garden, meadow, orchard },
    tokens: { "alice-token": { actor: "a1".repeat(32) }, "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterEach(async () => {
  await handle.close();
  for (const gw of [garden, meadow, orchard, annex]) await gw.close();
});

describe("T104 — GET / answers a human", () => {
  it("greets a tokenless browser: 200, HTML, and the three true things", async () => {
    const answer = await get(base, "/");
    expect(answer.status).toBe(200);
    expect(answer.contentType).toContain("text/html");
    // The three facts the ticket asks the page to carry: a Loam store serves here, the doors
    // are the mounts, and public answers without a token while everything else wants one.
    expect(answer.text).toMatch(/loam store/i);
    expect(answer.text).toMatch(/mount/i);
    expect(answer.text).toMatch(/public/i);
    expect(answer.text).toMatch(/token/i);
  });

  it("is one constant body: three mounts or none, tokened or not, moving table or still", async () => {
    const greeting = await get(base, "/");

    // A store with NO mounts and NO public declaration answers the same bytes.
    const bare = await serve({ mounts: {}, tokens: { t: { operator: true } }, port: 0 });
    const bareGreeting = await get(bare.url, "/");
    await bare.close();
    expect(bareGreeting.status).toBe(greeting.status);
    expect(bareGreeting.text).toBe(greeting.text);

    // A token changes nothing — the greeting is for whoever knocks.
    expect((await get(base, "/", "op-token")).text).toBe(greeting.text);
    expect((await get(base, "/", "alice-token")).text).toBe(greeting.text);
    // Neither does a wrong token: the front page is not a credential probe.
    expect((await get(base, "/", "junk-token")).text).toBe(greeting.text);

    // The mount table moving underneath moves nothing on the front page.
    handle.addMount("annex", annex);
    expect((await get(base, "/")).text).toBe(greeting.text);
    await handle.removeMount("annex");
    expect((await get(base, "/")).text).toBe(greeting.text);

    // And a query string is not a lever.
    expect((await get(base, "/?read=Plant:plant:fern")).text).toBe(greeting.text);
  });

  it("enumerates nothing: no mount name of this store appears in the body", async () => {
    const { text } = await get(base, "/");
    for (const name of ["garden", "meadow", "orchard", "annex"]) {
      expect(text).not.toContain(name);
    }
  });

  it("answers the icon every browser asks for: 204, empty", async () => {
    const res = await fetch(`${base}/favicon.ico`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("lives at exactly /: bare mount roots and POST / refuse precisely as before", async () => {
    // A mount that exists and one that never did, at their bare roots, tokenless: the SAME
    // refusal, byte for byte — the greeting opened no crack in the §12 discipline.
    const present = await get(base, "/garden");
    const absent = await get(base, "/nowhere");
    expect(present.status).toBe(401);
    expect(present.text).toBe(absent.text);
    expect(present.contentType).toBe(absent.contentType);

    // POST / is not greeted; it refuses like any tokenless knock on a closed door.
    const posted = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ __typename }" }),
    });
    expect(posted.status).toBe(401);
    expect(await posted.text()).toBe(absent.text);

    // And the icon path is GET-only: a POST there is a knock like any other.
    const iconPost = await fetch(`${base}/favicon.ico`, { method: "POST" });
    expect(iconPost.status).toBe(401);
    expect(await iconPost.text()).toBe(absent.text);
  });
});
