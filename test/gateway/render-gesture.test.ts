import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { readKey, parseReadGesture } from "../../src/gateway/renderers.js";
import { FERN, GARDENER, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const MOSS = "moss";

const FLOOR = `export default function (node) {
  var keys = Object.keys(node.reads).sort();
  var lines = keys.map(function (k) {
    var r = node.reads[k];
    return r.error ? k + "!" + r.error.code : k + "=" + r.view.height;
  });
  var st = Object.keys(node.state).sort().map(function (k) { return k + ":" + node.state[k]; });
  return "<p>root=" + node.view.height + "|reads=" + lines.join(",") + "|state=" + st.join(",") + "</p>";
}`;

let handle: ServerHandle;
let base: string;
let gateway: Gateway;

beforeAll(async () => {
  gateway = await Gateway.open(new MemoryBackend(), { seed: OP_SEED, renderTimeoutMs: 10_000 });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 9002), OP_SEED),
  ]);
  await gateway.append([
    observed(FERN, "height", 42, 1000, OP_SEED),
    observed(MOSS, "height", 7, 1000, OP_SEED),
  ]);
  gateway.register(PLANT, PLANT_POLICY, [FERN, MOSS], undefined, PLANT_WRITABLE);
  await gateway.publishRenderer({
    route: "plant",
    schema: "Plant",
    consumes: ["height"],
    bundle: FLOOR,
  });
  await gateway.append([signClaims(publicClaims(["Plant"], OP, 9_100), OP_SEED)]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const app = (query: string, token?: string): Promise<Response> =>
  fetch(`${base}/garden/app/plant/${encodeURIComponent(FERN)}${query}`, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  });

describe("§30 criterion 35a: the host route honors the same gesture, and fills the same members", () => {
  it("a ?read= gesture lands in reads[<lens>@<entity>] with the resolved view", async () => {
    const res = await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(`reads=${readKey("Plant", MOSS)}=7`);
    expect(body).toContain("root=42");
  });

  it("a second gesture at a DIFFERENT entity leaves the first intact", async () => {
    const res = await app(
      `?read=Plant:${encodeURIComponent(MOSS)}&read=Plant:${encodeURIComponent(FERN)}`,
      "op-token",
    );
    const body = await res.text();
    expect(body).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(body).toContain(`${readKey("Plant", FERN)}=42`);
  });

  it("state rides the query string, echoed verbatim — UI state has nowhere else to live", async () => {
    const res = await app(`?page=3&sort=asc`, "op-token");
    const body = await res.text();
    expect(body).toContain("state=page:3,sort:asc");
  });

  it("BOTH members are present and EMPTY on a bare first paint — never absent", async () => {
    const body = await (await app("", "op-token")).text();
    expect(body).toContain("|reads=|state=");
  });

  it("a read at an entity the store has nothing for is a SUCCESS carrying an empty view", async () => {
    const body = await (await app("?read=Plant:no-such-plant", "op-token")).text();
    expect(body).toContain(`${readKey("Plant", "no-such-plant")}=undefined`);
    expect(body).not.toContain("!not_served");
    expect(body).not.toContain("!refused");
  });
});

describe("§30 criterion 35b: the refusal is the FLOOR's enum, identical across hosts", () => {
  it("a lens this store does not serve yields not_served — the host-neutral code", async () => {
    const body = await (await app("?read=NoSuchLens:x", "op-token")).text();
    expect(body).toContain(`${readKey("NoSuchLens", "x")}!not_served`);
  });

  it("a malformed gesture is DROPPED, not resolved as a guess", async () => {
    expect(parseReadGesture("Plant")).toBeUndefined();
    expect(parseReadGesture(":x")).toBeUndefined();
    expect(parseReadGesture("Plant:")).toBeUndefined();
    expect(parseReadGesture("Plant:urn:x:1")).toEqual({ lens: "Plant", entity: "urn:x:1" });
    const body = await (await app("?read=Plant", "op-token")).text();
    expect(body).toContain("|reads=|");
  });
});

describe("§30 criterion 35c: on the PUBLIC door a ?read= is ignored", () => {
  it("over HTTP the route renders exactly as it does today, with no per-lens refusal", async () => {
    const bare = await (await app("")).text();
    const gestured = await (await app("?read=NoSuchLens:x&page=9")).text();
    expect(gestured).toBe(bare);
    expect(gestured).toContain("|reads=|state=");
  });

  it("and serveRoute REFUSES a gesture handed to it directly on the public door", async () => {
    const out = await gateway.serveRoute("plant", FERN, "public", {
      reads: [{ lens: "Plant", entity: MOSS }],
      state: { page: "9" },
    });
    expect(out.status).toBe(200);
    expect(out.body).toContain("|reads=|state=");
    expect(out.body).not.toContain("Plant@");
    expect(out.body).not.toContain("page:9");
    const full = await gateway.serveRoute("plant", FERN, "full", {
      reads: [{ lens: "Plant", entity: MOSS }],
      state: { page: "9" },
    });
    expect(full.body).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(full.body).toContain("page:9");
  });
});

describe("§30 criterion 35: the resolution count per request is BOUNDED", () => {
  it("honors at most the cap, so a repeatable parameter cannot multiply resolutions freely", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `read=Plant:p${i}`).join("&");
    const body = await (await app(`?${many}`, "op-token")).text();
    expect(body.match(/Plant@p\d+/g)).toHaveLength(8);
  });
});

describe("§30 criterion 28: the SCHEMA is the request surface, and the boundary is the store's", () => {
  it("a gesture at a REGISTERED lens is served; the identical gesture at an unregistered one is refused", async () => {
    const served = await (await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")).text();
    expect(served).toContain(`${readKey("Plant", MOSS)}=7`);
    const refused = await (await app("?read=Ledger:whatever", "op-token")).text();
    expect(refused).toContain("!not_served");
    expect(refused).not.toMatch(/Ledger@whatever=/);
  });

  it("two mounts whose registered lens sets DIFFER serve different sets for the same gesture", async () => {
    const other = await Gateway.open(new MemoryBackend(), {
      seed: OP_SEED,
      renderTimeoutMs: 10_000,
    });
    await other.append([observed(MOSS, "height", 999, 1000, OP_SEED)]);
    other.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
    await other.publishRenderer({
      route: "plant",
      schema: "Plant",
      consumes: ["height"],
      bundle: FLOOR,
    });
    handle.addMount("other", other);
    const here = await (await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")).text();
    const there = await (
      await fetch(`${base}/other/app/plant/${encodeURIComponent(MOSS)}?read=Plant:${MOSS}`, {
        headers: { authorization: "Bearer op-token" },
      })
    ).text();
    expect(here).toContain(`${readKey("Plant", MOSS)}=7`);
    expect(there).toContain(`${readKey("Plant", MOSS)}=999`);
    await handle.removeMount("other");
    await other.close();
  });

  it("a token individuates WRITE standing, not reads — so the same mount answers identically", async () => {
    handle.addMount("shared", gateway);
    const asOperator = await (
      await app(`?read=Plant:${encodeURIComponent(MOSS)}`, "op-token")
    ).text();
    const viaOtherMountName = await (
      await fetch(`${base}/shared/app/plant/${encodeURIComponent(FERN)}?read=Plant:${MOSS}`, {
        headers: { authorization: "Bearer op-token" },
      })
    ).text();
    expect(viaOtherMountName).toBe(asOperator);
    await handle.removeMount("shared");
  });
});
