// T208 — SPEC §26's time pin reaches the RENDERED route. The data doors have read a moment since
// §26 landed; `GET /:mount/app/<route>/<entity>` resolved only the present, so the one surface a
// person actually looks at could not look backwards.
//
// Four laws under test, one per acceptance criterion:
//   (a) `?asOf=T` renders the value in force at T, and no `?asOf` still renders the latest —
//       through BOTH doors, because the app door is two call sites and a one-door build leaves
//       the other silently resolving the present.
//   (b) a malformed moment REFUSES, names the parameter, and renders nothing.
//   (c) an as-of window that spans an erasure carries §26's annotation as SERVER-SIDE CHROME
//       around the bundle's output. A payload field an unmodified bundle ignores would not
//       satisfy this — the page must not silently pretend completeness. Two-sided: the erased
//       fact is gone at the BYTES and a named live bystander still renders.
//   (d) the board demo's page carries the time control, and an `?asOf` shows a prior board state.
//
// (d) LIVES HERE RATHER THAN IN `test/board/board-render.test.ts` because that file is a FROZEN
// rail — T108 declared it and CLAUDE.md forbids editing a frozen rail. The board world is booted
// from the same shared fixture the board suite uses.
//
// BOTH LEVELS, as P3 requires. The object level is what the DOOR SERVES — the rendered bytes a
// browser receives, which is the only level a person ever meets. The delta level is asserted where
// it can disagree: (c) reads the sqlite file itself for the purged plaintext, and reads the
// surviving tombstone's timestamp to pin the annotation's window.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { asOfBanner } from "../../src/gateway/asof.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
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

// A bundle that DRAWS the two fields under test, so a page resolved against the wrong moment
// differs in its own bytes rather than agreeing by accident. It returns a FRAGMENT (no <body>),
// which is the branch of the chrome wrapper the board's full document does not exercise.
const BUNDLE = `export default function (node) {
  var h = node.view.height === undefined || node.view.height === null ? "none" : node.view.height;
  var t = node.view.tag === undefined || node.view.tag === null ? [] : node.view.tag;
  return "<main><p>height=" + h + "</p><p>tag=" + JSON.stringify(t) + "</p></main>";
}`;

const BOARD_BUNDLE = readFileSync(
  new URL("../../demos/board/renderer.mjs", import.meta.url),
  "utf8",
);

// The chrome markers §26's frame writes, and the marker the board's own control carries. Contract,
// not decoration: a rail that matched prose would pass on a banner that said the opposite. The two
// are deliberately distinct — the CHROME is the door's statement about what it served, the CONTROL
// is the renderer's offer to serve something else.
const PIN = 'data-loam-asof-says="pin"';
const FORGOTTEN = 'data-loam-asof-says="forgotten"';
const CONTROL = 'data-loam-asof-control="1"';

interface World {
  readonly gw: Gateway;
  readonly handle: ServerHandle;
  readonly base: string;
}

// A governed Plant store serving one rendered route, declared public so BOTH doors answer it.
// `seed` plants whatever facts the caller needs before the server opens.
async function bootWorldWith(
  backend: MemoryBackend | SqliteBackend,
  seed: readonly Delta[],
): Promise<World> {
  const gw = await Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
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
    bundle: BUNDLE,
  });
  // Without this the anonymous door serves a uniform 404 and the public half of (a) would be
  // asserting a refusal rather than a moment.
  await gw.append([signClaims(publicClaims(["Plant"], OP, 9_100), OP_SEED)]);
  const handle = await serve({
    mounts: { [MOUNT]: gw },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  return { gw, handle, base: handle.url };
}

// One GET of the route. `door` chooses the call site: the full door presents a token, the public
// door presents none — the two sites T208 must thread the pin through.
const app = (world: World, door: "full" | "public", query = ""): Promise<Response> =>
  fetch(`${world.base}/${MOUNT}/app/${ROUTE}/${encodeURIComponent(FERN)}${query}`, {
    headers: door === "full" ? { authorization: "Bearer op-token" } : {},
  });

const bodyOf = async (res: Response): Promise<string> => res.text();

// ── (a) the moment reaches the render, through both doors ────────────────────────────────────

describe("(a) a rendered route resolves against the ground as of T — on BOTH doors", () => {
  let world: World;
  beforeAll(async () => {
    // Two heights and two tags, dated. T=1500 sits between the heights; T=1600 after both tags.
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
      expect(past).toContain("height=10"); // the value written before T1…
      expect(past).not.toContain("height=20"); // …not the later overwrite

      const present = await app(world, door);
      expect(present.status).toBe(200);
      const now = await bodyOf(present);
      expect(now).toContain("height=20"); // the other side: the present is untouched
      expect(now).not.toContain("height=10");
    });

    it(`${door} door: a moment before anything was said renders the empty view`, async () => {
      const res = await app(world, door, "?asOf=500");
      expect(res.status).toBe(200); // absence, DRAWN — not a refusal
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
      // Number("") is 0, so a door that only tested Number.isFinite would pin the moment to the
      // epoch and serve an empty page while looking healthy.
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

// ── (b) a malformed moment refuses, and renders nothing ──────────────────────────────────────

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
      expect(body).toContain("asOf"); // the parameter is NAMED, as the doors' refusals are
      expect(body).not.toContain("height="); // and nothing rendered
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
    // Not a refusal: `asOf` is a READ parameter, and the REST door already ignores it on a write.
    // The route has no writable form, so the POST refuses for its OWN reason (never a 400 about
    // the moment) — which is what proves the parse did not run.
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
    expect(await res.text()).not.toContain("asOf must be");
  });
});

// ── (c) the erasure annotation, as chrome the bundle cannot suppress ──────────────────────────

describe("(c) an as-of window spanning an erasure confesses it, in the served bytes", () => {
  let world: World;
  let tmp: string;
  let dbPath: string;
  let tombstoneAt: number;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), "loam-t208-asof-"));
    dbPath = join(tmp, "store.sqlite");
    // The condemned fact and its live bystander are BOTH tags on the rendered entity, so the
    // two-sided assertion lands on one page: one tag must vanish, the other must still draw.
    const condemned = observed(FERN, "tag", "condemned-leaf", 1200, GARDENER_SEED);
    world = await bootWorldWith(new SqliteBackend(dbPath), [
      condemned,
      observed(FERN, "tag", "bystander-leaf", 1300, GARDENER_SEED),
      observed(FERN, "height", 20, 1400, GARDENER_SEED),
    ]);
    // Before the erasure the fact genuinely stands at T=1600 — so its later absence is the
    // erasure at work, not the timestamp filter hiding a not-yet-born fact.
    expect(await bodyOf(await app(world, "full", "?asOf=1600"))).toContain("condemned-leaf");

    await world.gw.erase(condemned.id);
    const tomb = [...world.gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "delta" && p.target.deltaRef.delta === condemned.id,
      ),
    );
    expect(tomb).toBeDefined();
    tombstoneAt = tomb!.claims.timestamp;
    expect(tombstoneAt).toBeGreaterThan(1600); // the window T=1600 → now genuinely spans it
  });
  afterAll(async () => {
    await world.handle.close();
    await world.gw.close();
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("the purge reached the BYTES — the condemned text is not in the store file, the bystander is", () => {
    // The delta level, read where T40 proved an API can lie downward: the file itself.
    const bytes = readFileSync(dbPath, "latin1");
    expect(bytes).not.toContain("condemned-leaf");
    expect(bytes).toContain("bystander-leaf");
  });

  for (const door of ["full", "public"] as const) {
    it(`${door} door: the page confesses the forgetting, and still draws the bystander`, async () => {
      const body = await bodyOf(await app(world, door, "?asOf=1600"));
      // The confession is SERVER-SIDE CHROME. The bundle above draws only height and tag; it
      // could not have produced these markers, so a payload field it ignored cannot pass this.
      expect(body).toContain(PIN);
      expect(body).toContain(FORGOTTEN);
      expect(body).toContain(String(tombstoneAt)); // the moment the ground forgot
      // Two-sided, on the same page: the erased fact is gone even at a moment it once stood…
      expect(body).not.toContain("condemned-leaf");
      // …and the live bystander is untouched, as is the rest of the view.
      expect(body).toContain("bystander-leaf");
      expect(body).toContain("height=20");
    });
  }

  it("the annotation does not cry wolf — a moment AFTER the erasure carries the pin and no confession", async () => {
    const body = await bodyOf(await app(world, "full", `?asOf=${tombstoneAt + 1}`));
    expect(body).toContain(PIN); // still an as-of read, still says so
    expect(body).not.toContain(FORGOTTEN); // nothing was forgotten since that moment
    expect(body).toContain("bystander-leaf");
  });

  it("a present-tense render carries neither pin nor confession", async () => {
    const body = await bodyOf(await app(world, "full"));
    expect(body).not.toContain("data-loam-asof");
    expect(body).toContain("bystander-leaf");
  });

  it("the confession names WHEN, never WHAT — a tombstone keeps no content to leak", async () => {
    const body = await bodyOf(await app(world, "public", "?asOf=1600"));
    expect(body).not.toContain("condemned-leaf");
    expect(body).not.toContain(GARDENER); // nor whose fact it was
  });
});

// ── (d) the board demo: the time control, and a prior board state ─────────────────────────────

describe("(d) the board's page carries the time control, and an asOf shows a prior board state", () => {
  let board: BoardWorld;
  let beforeShip: number;

  const page = (query = ""): Promise<Response> =>
    fetch(`${board.base}/${BOARD_MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}${query}`);

  // The section a card renders under, read through the demo's own `data-section` contract.
  const section = (html: string, key: string): string => {
    const marker = `data-section="${key}"`;
    const start = html.indexOf(marker);
    if (start < 0) return "";
    const rest = html.slice(start + marker.length);
    const end = rest.indexOf("<section");
    return end < 0 ? rest : rest.slice(0, end);
  };

  // The store's own latest authored moment. Read from the ground rather than from `Date.now()`:
  // `nextTimestamp` is `max(now, last + 1)`, so a fast run leaves the deltas AHEAD of the wall
  // clock and a wall-clock pin would silently sit before writes that already happened.
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
    expect(html).toContain(CONTROL); // the control's own marker, value included
    // A real input, naming the parameter the door parses — not merely the word somewhere on the page.
    expect(html).toMatch(/<input[^>]*name="asOf"/i);
    expect(html).toMatch(/<form[^>]*method="get"/i); // an inert GET — no script, any CSP
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
    // The demo returns `<!doctype html>…<body>`, the branch the fragment bundle above cannot reach.
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
    // The full door echoes every non-`read` parameter into `node.state`, so the field carries the
    // moment you are on. The anonymous door carries no state at all (a `?read=` there would be the
    // lens-existence oracle §17 closed), so the same URL leaves the field blank — the page is still
    // pinned, and the CHROME above is what says so on both doors.
    const viaFull = await bodyOf(
      await fetch(
        `${board.base}/${BOARD_MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}?asOf=${beforeShip}`,
        { headers: { authorization: "Bearer op" } },
      ),
    );
    expect(viaFull).toContain(`value="${beforeShip}"`);

    const viaPublic = await bodyOf(await page(`?asOf=${beforeShip}`));
    expect(viaPublic).toContain('value=""');
    expect(viaPublic).toContain(PIN); // pinned either way, and it says so either way
  });
});

// ── the banner's own arithmetic, where a door cannot reach it ─────────────────────────────────
//
// A rail driving real erasures can afford one or two of them, so the CAP and the plural forms
// stay unreached through the door — and both are copy a person reads off the page. Asserted
// directly on `asOfBanner`, which is the same function the door calls.

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
    expect(banner).toContain("10 records,"); // the count is never truncated
    expect(banner).toContain("101, 102, 103, 104, 105, 106, 107, 108");
    expect(banner).toContain("and 2 more"); // and the page says it truncated
    expect(banner).not.toContain("109"); // the ninth and tenth are not painted
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
});
