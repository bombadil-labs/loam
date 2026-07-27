// §34's face: (c) the `board` route renders every section from live store state, and a
// boardEvent mutation changes the page on the very next GET; (d) the public declaration is
// load-bearing — with it the route serves tokenless, without it nothing leaks, and the GraphQL
// door refuses a tokenless write either way.
//
// The renderers-demo pattern driven headless: real Gateway, real HTTP server, the page fetched
// like any browser would. Section membership is asserted on the RENDERED HTML (the object level
// of criterion f's exit: a shipped item leaves waiting/in-flight on the page); the delta level
// of the same writes lives in board-app.test.ts.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { publicClaims } from "../../src/gateway/public.js";
import { BOARD_ENTITY, BOARD_ROUTE } from "../../demos/board/vocabulary.mjs";
import {
  MOUNT,
  OPERATOR,
  OP_SEED,
  addItem,
  boardEvent,
  bootWorld,
  gql,
  registerVocabulary,
  type BoardWorld,
} from "./fixtures.js";

vi.setConfig({ testTimeout: 15000 });

const BUNDLE = readFileSync(new URL("../../demos/board/renderer.mjs", import.meta.url), "utf8");

const page = (base: string) =>
  fetch(`${base}/${MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}`, { method: "GET" });

// The section a title renders under: the HTML between `data-section="key"` and the next section.
function section(html: string, key: string): string {
  const marker = `data-section="${key}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const rest = html.slice(start + marker.length);
  const end = rest.indexOf("<section");
  return end < 0 ? rest : rest.slice(0, end);
}

// The open world: vocabulary, renderer, PUBLIC declaration, three seeded items.
let open: BoardWorld;

beforeAll(async () => {
  open = await bootWorld();
  await registerVocabulary(open.base);
  await open.gw.publishRenderer({
    route: BOARD_ROUTE,
    schema: "Board",
    consumes: ["banner", "items"],
    bundle: BUNDLE,
  });
  await open.gw.append([signClaims(publicClaims(["Board"], OPERATOR, 2), OP_SEED)]);
  await gql(
    open.base,
    `mutation { board(entity: ${JSON.stringify(BOARD_ENTITY)}, banner: "Loam — the board") { banner } }`,
    "op",
  );
  await addItem(open.base, "fable", "board:t42", {
    kind: "ticket",
    title: "sign the erasure spec",
    seam: "one read, one yes",
    est: 20,
    status: "waiting-myk",
  });
  await addItem(open.base, "fable", "board:pr-300", {
    kind: "lane",
    title: "T79 · piece 7 of 8",
    status: "building",
  });
  await addItem(open.base, "fable", "board:pr-266", {
    kind: "ticket",
    title: "T64 COMPLETE — two-phase erasure",
    url: "https://github.com/bombadil-labs/loam/pull/266",
    status: "shipped",
  });
});
afterAll(async () => {
  await open.handle.close();
  await open.gw.close();
});

describe("(c) the route renders every section from live store state", () => {
  it("each seeded item appears in its own section, with the waiting item's seam and estimate", async () => {
    const res = await page(open.base);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();

    expect(html).toContain("Loam — the board"); // the banner, from the store
    expect(section(html, "waiting")).toContain("sign the erasure spec");
    expect(section(html, "waiting")).toContain("one read, one yes");
    expect(section(html, "waiting")).toContain("≈20 min");
    expect(section(html, "flight")).toContain("T79 · piece 7 of 8");
    expect(section(html, "shipped")).toContain("T64 COMPLETE — two-phase erasure");
    expect(section(html, "shipped")).toContain("https://github.com/bombadil-labs/loam/pull/266");
  });

  it("a boardEvent mutation changes the page on the next GET — the shipped item leaves in-flight", async () => {
    const before = await (await page(open.base)).text();
    expect(section(before, "flight")).toContain("T79 · piece 7 of 8");

    const res = await boardEvent(open.base, "fable", "board:pr-300", "shipped");
    expect(res.json.errors, JSON.stringify(res.json.errors)).toBeUndefined();

    const after = await (await page(open.base)).text();
    expect(after).not.toBe(before);
    expect(section(after, "flight")).not.toContain("T79 · piece 7 of 8");
    expect(section(after, "shipped")).toContain("T79 · piece 7 of 8");
  });
});

describe("(d) the public declaration serves the page; the door still refuses tokenless writes", () => {
  it("a tokenless GET reads the board; a tokenless boardEvent lands nothing", async () => {
    const res = await page(open.base);
    expect(res.status).toBe(200);

    const ground = [...open.gw.reactor.snapshot()].length;
    const write = await boardEvent(open.base, undefined, "board:t42", "shipped");
    expect(write.json.errors).toBeDefined();
    expect(write.json.errors!.length).toBeGreaterThan(0);
    // Object level: the waiting item still waits. Delta level: nothing landed.
    const read = await gql(open.base, `{ boardItem(entity: "board:t42") { status } }`, "op");
    expect((read.json.data as { boardItem: { status: string } }).boardItem.status).toBe(
      "waiting-myk",
    );
    expect([...open.gw.reactor.snapshot()]).toHaveLength(ground);
  });

  it("WITHOUT the declaration the route serves nothing tokenless — the declaration is load-bearing", async () => {
    const closed = await bootWorld();
    try {
      await registerVocabulary(closed.base);
      await closed.gw.publishRenderer({
        route: BOARD_ROUTE,
        schema: "Board",
        consumes: ["banner", "items"],
        bundle: BUNDLE,
      });
      await addItem(closed.base, "fable", "board:t42", {
        kind: "ticket",
        title: "sign the erasure spec",
        status: "waiting-myk",
      });
      const res = await page(closed.base);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain("sign the erasure spec"); // no title leaks
    } finally {
      await closed.handle.close();
      await closed.gw.close();
    }
  });
});
