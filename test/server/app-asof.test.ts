import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { asOfBanner, frameAsOf } from "../../src/gateway/asof.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { readKey } from "../../src/gateway/renderers.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import type { ResolvedNode } from "../../src/surface/surface.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { BOARD_ENTITY, BOARD_ROUTE } from "../../demos/board/vocabulary.mjs";
import {
  MOUNT as BOARD_MOUNT,
  OPERATOR as BOARD_OPERATOR,
  OP_SEED as BOARD_OP_SEED,
  addItem,
  boardEvent,
  bootWorld,
  registerVocabulary,
  type BoardWorld,
} from "../board/fixtures.js";

vi.setConfig({ testTimeout: 30_000 });

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const MOUNT = "garden";
const ROUTE = "plant";
const MOSS = "plant:moss";

const BUNDLE = `export default function (node) {
  var h = node.view.height === undefined || node.view.height === null ? "none" : node.view.height;
  var t = node.view.tag === undefined || node.view.tag === null ? [] : node.view.tag;
  return "<main><p>height=" + h + "</p><p>tag=" + JSON.stringify(t) + "</p></main>";
}`;

const GESTURE_BUNDLE = `export default function (node) {
  var lines = Object.keys(node.reads).sort().map(function (k) {
    var r = node.reads[k];
    return r.error ? k + "!" + r.error.code : k + "=" + r.view.height;
  });
  return "<main><p>root=" + node.view.height + "</p><p>reads=" + lines.join(",") + "</p></main>";
}`;

const BOARD_BUNDLE = readFileSync(
  new URL("../../demos/board/renderer.mjs", import.meta.url),
  "utf8",
);

const PIN = 'data-loam-asof-says="pin"';
const FORGOTTEN = 'data-loam-asof-says="forgotten"';
const CONTROL = 'data-loam-asof-control="1"';

interface World {
  readonly gw: Gateway;
  readonly handle: ServerHandle;
  readonly base: string;
}

async function bootWorldWith(
  backend: MemoryBackend | SqliteBackend,
  seed: readonly Delta[],
  opts: { roots?: readonly string[]; bundle?: string } = {},
): Promise<World> {
  const gw = await Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [...(opts.roots ?? [FERN])],
          writable: [...PLANT_WRITABLE],
        },
      ],
      grants: [grantClaims(STORE_ENTITY, GARDENER, "write", OP, 2)],
    }),
    { renderTimeoutMs: 15_000 },
  );
  if (seed.length > 0) await gw.append([...seed]);
  await gw.publishRenderer({
    route: ROUTE,
    schema: "Plant",
    consumes: ["height", "tag"],
    bundle: opts.bundle ?? BUNDLE,
  });
  await gw.append([signClaims(publicClaims(["Plant"], OP, 9_100), OP_SEED)]);
  const handle = await serve({
    mounts: { [MOUNT]: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  return { gw, handle, base: handle.url };
}

const app = (world: World, door: "full" | "public", query = ""): Promise<Response> =>
  fetch(`${world.base}/${MOUNT}/app/${ROUTE}/${encodeURIComponent(FERN)}${query}`, {
    headers: door === "full" ? { authorization: "Bearer op-token" } : {},
  });

const bodyOf = async (res: Response): Promise<string> => res.text();

describe("(a) a rendered route resolves against the ground as of T — on BOTH doors", () => {
  let world: World;
  beforeAll(async () => {
    world = await bootWorldWith(new MemoryBackend(), [
      observed(FERN, "height", 10, 1000, GARDENER_SEED),
      observed(FERN, "height", 20, 2000, GARDENER_SEED),
      observed(FERN, "tag", "shade", 1200, GARDENER_SEED),
    ]);
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
  });

  for (const door of ["full", "public"] as const) {
    it(`${door} door: ?asOf=1500 renders the earlier height; no ?asOf renders the latest`, async () => {
      const pinned = await app(world, door, "?asOf=1500");
      expect(pinned.status).toBe(200);
      expect(pinned.headers.get("content-type")).toMatch(/text\/html/);
      const past = await bodyOf(pinned);
      expect(past).toContain("height=10");
      expect(past).not.toContain("height=20");

      const present = await app(world, door);
      expect(present.status).toBe(200);
      const now = await bodyOf(present);
      expect(now).toContain("height=20");
      expect(now).not.toContain("height=10");
    });

    it(`${door} door: a moment before anything was said renders the empty view`, async () => {
      const res = await app(world, door, "?asOf=500");
      expect(res.status).toBe(200);
      const body = await bodyOf(res);
      expect(body).toContain("height=none");
      expect(body).not.toContain("height=10");
      expect(body).not.toContain("height=20");
    });

    it(`${door} door: a present-tense render carries NO time chrome at all`, async () => {
      const body = await bodyOf(await app(world, door));
      expect(body).not.toContain(PIN);
      expect(body).not.toContain("data-loam-asof");
    });

    it(`${door} door: an EMPTY ?asOf= is present-tense, exactly as the REST door reads it`, async () => {
      const body = await bodyOf(await app(world, door, "?asOf="));
      expect(body).toContain("height=20");
      expect(body).not.toContain("data-loam-asof");
    });
  }

  it("both doors answer the same moment identically — one pin, one ground, two call sites", async () => {
    const viaFull = await bodyOf(await app(world, "full", "?asOf=1500"));
    const viaPublic = await bodyOf(await app(world, "public", "?asOf=1500"));
    expect(viaFull).toContain("height=10");
    expect(viaPublic).toContain("height=10");
    expect(viaPublic).toBe(viaFull);
  });

  it("the pin narrows the WHOLE view, not only the picked field — a tag not yet claimed is absent", async () => {
    const early = await bodyOf(await app(world, "full", "?asOf=1100"));
    expect(early).toContain(`tag=[]`);
    const later = await bodyOf(await app(world, "full", "?asOf=1300"));
    expect(later).toContain(`tag=["shade"]`);
  });
});

describe("(a) a ?read= gesture resolves at the pinned moment, not at the present", () => {
  let world: World;
  const key = readKey("Plant", MOSS);

  beforeAll(async () => {
    world = await bootWorldWith(
      new MemoryBackend(),
      [
        observed(FERN, "height", 10, 1000, GARDENER_SEED),
        observed(FERN, "height", 20, 2000, GARDENER_SEED),
        observed(MOSS, "height", 7, 1000, GARDENER_SEED),
        observed(MOSS, "height", 99, 2000, GARDENER_SEED),
      ],
      { roots: [FERN, MOSS], bundle: GESTURE_BUNDLE },
    );
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
  });

  it("without a pin the gesture answers the present — the other side of the assertion", async () => {
    const body = await bodyOf(await app(world, "full", `?read=Plant:${encodeURIComponent(MOSS)}`));
    expect(body).toContain("root=20");
    expect(body).toContain(`${key}=99`);
    expect(body).not.toContain("data-loam-asof");
  });

  it("with a pin the gesture answers the MOMENT, and the page agrees with its own banner", async () => {
    const body = await bodyOf(
      await app(world, "full", `?asOf=1500&read=Plant:${encodeURIComponent(MOSS)}`),
    );
    expect(body).toContain("root=10");
    expect(body).toContain(`${key}=7`);
    expect(body).not.toContain(`${key}=99`);
    expect(body).toContain(PIN);
  });

  it("a moment before the gesture's entity was spoken of resolves it empty, not to the present", async () => {
    const body = await bodyOf(
      await app(world, "full", `?asOf=500&read=Plant:${encodeURIComponent(MOSS)}`),
    );
    expect(body).toContain(`${key}=undefined`);
    expect(body).not.toContain(`${key}=7`);
    expect(body).not.toContain(`${key}=99`);
  });
});

describe("(a) a VERSION-PINNED route honours the moment — both pins, on both doors", () => {
  let world: World;
  const PINNED_ROUTE = "plant-frozen";

  const pinnedPage = (door: "full" | "public", query = ""): Promise<Response> =>
    fetch(`${world.base}/${MOUNT}/app/${PINNED_ROUTE}/${encodeURIComponent(FERN)}${query}`, {
      headers: door === "full" ? { authorization: "Bearer op-token" } : {},
    });

  beforeAll(async () => {
    world = await bootWorldWith(new MemoryBackend(), [
      observed(FERN, "height", 10, 1000, GARDENER_SEED),
      observed(FERN, "height", 20, 2000, GARDENER_SEED),
    ]);
    await world.gw.publishRenderer({
      route: PINNED_ROUTE,
      schema: "Plant",
      version: 1,
      consumes: ["height", "tag"],
      bundle: BUNDLE,
    });
    await world.gw.declarePublic(["Plant@v1"]);
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
  });

  it("the pinned route is genuinely the pinned branch — it serves, and v1 is a declared pin", () => {
    const v1 = world.gw.registrationVersions().find((v) => v.hyperschema.name === "Plant");
    expect(v1).toBeDefined();
    expect(world.gw.isPublicPin("Plant", v1!.deltaId)).toBe(true);
  });

  for (const door of ["full", "public"] as const) {
    it(`${door} door: the frozen lens reads the past, and still reads the present without a pin`, async () => {
      const past = await pinnedPage(door, "?asOf=1500");
      expect(past.status).toBe(200);
      const pastBody = await bodyOf(past);
      expect(pastBody).toContain("height=10");
      expect(pastBody).not.toContain("height=20");
      expect(pastBody).toContain(PIN);

      const now = await pinnedPage(door);
      expect(now.status).toBe(200);
      const nowBody = await bodyOf(now);
      expect(nowBody).toContain("height=20");
      expect(nowBody).not.toContain("data-loam-asof");
    });
  }
});

describe("(b) an invalid asOf refuses with the parameter named, and renders nothing", () => {
  let world: World;
  beforeAll(async () => {
    world = await bootWorldWith(new MemoryBackend(), [
      observed(FERN, "height", 20, 2000, GARDENER_SEED),
    ]);
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
  });

  for (const door of ["full", "public"] as const) {
    it(`${door} door: ?asOf=nonsense is a 400 naming asOf, with no page in the body`, async () => {
      const res = await app(world, door, "?asOf=nonsense");
      expect(res.status).toBe(400);
      const body = await bodyOf(res);
      expect(body).toContain("asOf");
      expect(body).not.toContain("height=");
      expect(body).not.toContain("<main>");
    });
  }

  it("the refusal is a plain-text door answer, never a rendered page", async () => {
    const res = await app(world, "full", "?asOf=nonsense");
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
  });

  it("the refusal leaks no route-existence oracle — an unknown route refuses identically", async () => {
    const real = await app(world, "public", "?asOf=nonsense");
    const fake = await fetch(
      `${world.base}/${MOUNT}/app/no-such-route/${encodeURIComponent(FERN)}?asOf=nonsense`,
    );
    expect(fake.status).toBe(real.status);
    expect(await fake.text()).toBe(await real.text());
  });

  it("a POST ignores asOf entirely, exactly as the REST door does — a write is present-tense", async () => {
    const res = await fetch(
      `${world.base}/${MOUNT}/app/${ROUTE}/${encodeURIComponent(FERN)}?asOf=nonsense`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer op-token",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "height=99",
      },
    );
    expect(res.status).toBe(405);
    const body = await res.text();
    expect(body).toContain("this route is read-only");
    expect(body).not.toContain("asOf must be");
  });
});

describe("(c) an as-of window spanning an erasure confesses it, in the served bytes", () => {
  let world: World;
  let tmp: string;
  let dbPath: string;
  let tombstoneAt: number;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "loam-t208-asof-"));
    dbPath = join(tmp, "store.sqlite");
    const condemned = observed(FERN, "tag", "condemned-leaf", 1200, GARDENER_SEED);
    world = await bootWorldWith(new SqliteBackend(dbPath), [
      condemned,
      observed(FERN, "tag", "bystander-leaf", 1300, GARDENER_SEED),
      observed(FERN, "height", 20, 1400, GARDENER_SEED),
    ]);
    expect(await bodyOf(await app(world, "full", "?asOf=1600"))).toContain("condemned-leaf");

    await world.gw.erase(condemned.id);
    const tomb = [...world.gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === condemned.id,
      ),
    );
    expect(tomb).toBeDefined();
    tombstoneAt = tomb!.claims.timestamp;
    expect(tombstoneAt).toBeGreaterThan(1600);
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("the purge reached the BYTES — the condemned text is not in the store file, the bystander is", () => {
    const files = [dbPath, `${dbPath}-wal`].filter((f) => existsSync(f));
    expect(files).toContain(dbPath);
    for (const f of files) expect(readFileSync(f, "latin1")).not.toContain("condemned-leaf");
    expect(files.map((f) => readFileSync(f, "latin1")).join("")).toContain("bystander-leaf");
  });

  for (const door of ["full", "public"] as const) {
    it(`${door} door: the page confesses the forgetting, and still draws the bystander`, async () => {
      const body = await bodyOf(await app(world, door, "?asOf=1600"));
      expect(body).toContain(PIN);
      expect(body).toContain(FORGOTTEN);
      expect(body).toContain(String(tombstoneAt));
      expect(body).not.toContain("condemned-leaf");
      expect(body).toContain("bystander-leaf");
      expect(body).toContain("height=20");
    });
  }

  it("the annotation does not cry wolf — a moment AFTER the erasure carries the pin and no confession", async () => {
    const body = await bodyOf(await app(world, "full", `?asOf=${tombstoneAt + 1}`));
    expect(body).toContain(PIN);
    expect(body).not.toContain(FORGOTTEN);
    expect(body).toContain("bystander-leaf");
  });

  it("a present-tense render carries neither pin nor confession", async () => {
    const body = await bodyOf(await app(world, "full"));
    expect(body).not.toContain("data-loam-asof");
    expect(body).toContain("bystander-leaf");
  });

  it("the confession names WHEN, never WHAT — an erasure keeps no content to leak", async () => {
    const body = await bodyOf(await app(world, "public", "?asOf=1600"));
    expect(body).not.toContain("condemned-leaf");
    expect(body).not.toContain(GARDENER);
  });
});

describe("(d) the board's page carries the time control, and an asOf shows a prior board state", () => {
  let board: BoardWorld;
  let beforeShip: number;

  const page = (query = ""): Promise<Response> =>
    fetch(`${board.base}/${BOARD_MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}${query}`);

  const section = (html: string, key: string): string => {
    const marker = `data-section="${key}"`;
    const start = html.indexOf(marker);
    if (start < 0) return "";
    const rest = html.slice(start + marker.length);
    const end = rest.indexOf("<section");
    return end < 0 ? rest : rest.slice(0, end);
  };

  const latestTs = (world: BoardWorld): number =>
    Math.max(...[...world.gw.reactor.snapshot()].map((d) => d.claims.timestamp));

  beforeAll(async () => {
    board = await bootWorld();
    await registerVocabulary(board.base);
    await board.gw.publishRenderer({
      route: BOARD_ROUTE,
      schema: "Board",
      consumes: ["banner", "items"],
      bundle: BOARD_BUNDLE,
    });
    await board.gw.append([signClaims(publicClaims(["Board"], BOARD_OPERATOR, 2), BOARD_OP_SEED)]);
    await addItem(board.base, "fable", "board:t208", {
      kind: "ticket",
      title: "as-of reaches the rendered route",
      status: "waiting-myk",
    });
    beforeShip = latestTs(board);
    const shipped = await boardEvent(board.base, "fable", "board:t208", "shipped");
    expect(shipped.json.errors, JSON.stringify(shipped.json.errors)).toBeUndefined();
    expect(latestTs(board)).toBeGreaterThan(beforeShip);
  });
  afterAll(async () => {
    await board.handle.close();
    await board.gw.close();
  });

  it("the rendered page carries the time control, and the control re-requests with asOf", async () => {
    const html = await bodyOf(await page());
    expect(html).toContain(CONTROL);
    expect(html).toMatch(/<input[^>]*name="asOf"/i);
    expect(html).toMatch(/<form[^>]*method="get"/i);
    expect(html).toMatch(/<input[^>]*name="asOf"[^>]*step="any"/i);
  });

  it("an asOf shows the PRIOR board state — the card is back in waiting, not shipped", async () => {
    const now = await bodyOf(await page());
    expect(section(now, "shipped")).toContain("as-of reaches the rendered route");

    const past = await bodyOf(await page(`?asOf=${beforeShip}`));
    expect(section(past, "waiting")).toContain("as-of reaches the rendered route");
    expect(section(past, "shipped")).not.toContain("as-of reaches the rendered route");
    expect(past).not.toBe(now);
  });

  it("the pin chrome rides a WHOLE document too — the banner lands inside <body>", async () => {
    const past = await bodyOf(await page(`?asOf=${beforeShip}`));
    expect(past).toContain(PIN);
    expect(past).toMatch(/<body[^>]*>\s*<aside[^>]*data-loam-asof/);
  });

  it("the board's present-tense page is unchanged — no chrome, latest state", async () => {
    const now = await bodyOf(await page());
    expect(now).not.toContain("data-loam-asof-says");
    expect(section(now, "shipped")).toContain("as-of reaches the rendered route");
  });

  it("the control re-shows the pin where the door offers it, and starts empty where it does not", async () => {
    const viaFull = await bodyOf(
      await fetch(
        `${board.base}/${BOARD_MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}?asOf=${beforeShip}`,
        { headers: { authorization: "Bearer op" } },
      ),
    );
    expect(viaFull).toContain(`value="${beforeShip}"`);

    const viaPublic = await bodyOf(await page(`?asOf=${beforeShip}`));
    expect(viaPublic).toContain('value=""');
    expect(viaPublic).toContain(PIN);
  });
});

describe("the confession counts honestly — plurals, and a capped enumeration", () => {
  const nodeAt = (asOf: number, forgotten: number[], suppressed?: number): ResolvedNode => ({
    entity: FERN,
    view: {},
    hex: "",
    hviewHex: "",
    asOf,
    forgotten,
    ...(suppressed === undefined ? {} : { suppressed }),
  });

  it("one forgetting is a record; two are records — the count matches the enumeration", () => {
    const one = asOfBanner(nodeAt(50, [101]));
    expect(one).toContain("1 record,");
    expect(one).toContain("101");
    const two = asOfBanner(nodeAt(50, [101, 102]));
    expect(two).toContain("2 records,");
    expect(two).toContain("101, 102");
  });

  it("a long history states the exact COUNT and lists only the first eight", () => {
    const many = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const banner = asOfBanner(nodeAt(50, many));
    expect(banner).toContain("10 records,");
    expect(banner).toContain("101, 102, 103, 104, 105, 106, 107, 108");
    expect(banner).toContain("and 2 more");
    expect(banner).not.toContain("109");
    expect(banner).not.toContain("110");
  });

  it("exactly eight is the boundary — all listed, nothing claimed to be more", () => {
    const banner = asOfBanner(nodeAt(50, [101, 102, 103, 104, 105, 106, 107, 108]));
    expect(banner).toContain("108");
    expect(banner).not.toContain("more");
  });

  it("a standing slate is confessed in the same register, and stays silent at zero", () => {
    expect(asOfBanner(nodeAt(50, [], 1))).toContain("1 delta");
    expect(asOfBanner(nodeAt(50, [], 3))).toContain("3 deltas");
    expect(asOfBanner(nodeAt(50, [], 0))).not.toContain('data-loam-asof-says="suppressed"');
    expect(asOfBanner(nodeAt(50, []))).not.toContain('data-loam-asof-says="suppressed"');
  });

  it("nothing forgotten is no confession at all — the pin still states the moment", () => {
    const banner = asOfBanner(nodeAt(50, []));
    expect(banner).toContain(PIN);
    expect(banner).toContain("as of 50 ");
    expect(banner).not.toContain(FORGOTTEN);
  });

  it("a PRESENT node passes through byte-identical — the frame is a no-op without a moment", () => {
    const html = `<!doctype html><html><body><main>untouched</main></body></html>`;
    const present: ResolvedNode = { entity: FERN, view: {}, hex: "", hviewHex: "" };
    expect(frameAsOf(html, present)).toBe(html);
    expect(frameAsOf("<p>bare</p>", present)).toBe("<p>bare</p>");
    expect(frameAsOf(html, { ...present, asOf: 50, forgotten: [] })).not.toBe(html);
  });
});
