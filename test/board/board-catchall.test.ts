// T112 — no item vanishes from the page. The renderer buckets items into fixed sections by
// status; before this rail, an item whose status matched no section emitted no card at all, so
// the page silently under-reported what the door answers (the repo's H7 class, at the face).
// Two-sided: (1) every KNOWN status renders in its own section — all seven, including review /
// parked / blocked, the three no earlier test seeded (the 2026-07-26 hollow-test survivors);
// (2) an item with an OFF-LIST status appears in the catch-all section, status text visible;
// (3) the page's data-title set EQUALS the door's own items — page-vs-door agreement, exact.

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
  bootWorld,
  gql,
  registerVocabulary,
  type BoardWorld,
} from "./fixtures.js";

vi.setConfig({ testTimeout: 20000 });

const BUNDLE = readFileSync(new URL("../../demos/board/renderer.mjs", import.meta.url), "utf8");

// Every status a section claims to hold, keyed by the section that holds it.
const KNOWN: ReadonlyArray<readonly [section: string, status: string]> = [
  ["waiting", "waiting-myk"],
  ["flight", "open"],
  ["flight", "building"],
  ["flight", "review"],
  ["shipped", "shipped"],
  ["parked", "parked"],
  ["parked", "blocked"],
];
const STRAY_STATUS = "limbo"; // in no section's holds — the status a typo produces

let world: BoardWorld;

const page = (): Promise<Response> =>
  fetch(`${world.base}/${MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}`, { method: "GET" });

// The HTML between one section marker and the next — same object-level reading the §34 rails use.
function section(html: string, key: string): string {
  const marker = `data-section="${key}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const rest = html.slice(start + marker.length);
  const end = rest.indexOf("<section");
  return end < 0 ? rest : rest.slice(0, end);
}

const renderedTitles = (html: string): string[] =>
  [...html.matchAll(/data-title="([^"]*)"/g)].map((m) => m[1]!);

beforeAll(async () => {
  world = await bootWorld();
  await registerVocabulary(world.base);
  await world.gw.publishRenderer({
    route: BOARD_ROUTE,
    schema: "Board",
    consumes: ["banner", "items"],
    bundle: BUNDLE,
  });
  await world.gw.append([signClaims(publicClaims(["Board"], OPERATOR, 2), OP_SEED)]);
  for (const [, status] of KNOWN) {
    await addItem(world.base, "fable", `board:${status}`, {
      kind: "ticket",
      title: `item in ${status}`,
      status,
    });
  }
  await addItem(world.base, "fable", "board:stray", {
    kind: "ticket",
    title: "the mis-statused item",
    status: STRAY_STATUS,
  });
});
afterAll(async () => {
  await world.handle.close();
  await world.gw.close();
});

describe("T112: every item the door answers is on the page", () => {
  it("each known status renders inside its own section — all seven, none dropped", async () => {
    const res = await page();
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const [key, status] of KNOWN) {
      expect(section(html, key), `status "${status}" missing from section "${key}"`).toContain(
        `item in ${status}`,
      );
    }
  });

  it("an off-list status appears in the catch-all, its odd status legible on the card", async () => {
    const html = await (await page()).text();
    expect(html).toContain("the mis-statused item"); // visible at all — the bug was total absence
    const stray = section(html, "unplaced");
    expect(stray).toContain("the mis-statused item");
    expect(stray).toContain(STRAY_STATUS); // the card shows WHAT is wrong, not just that something is
    // And it did not leak into a real section.
    for (const key of ["waiting", "flight", "shipped", "parked"]) {
      expect(section(html, key)).not.toContain("the mis-statused item");
    }
  });

  it("page-vs-door agreement: the rendered title set equals the door's items, exactly", async () => {
    const res = await gql(
      world.base,
      `{ board(entity: ${JSON.stringify(BOARD_ENTITY)}) { items } }`,
      "op",
    );
    expect(res.json.errors).toBeUndefined();
    const doorTitles = (
      res.json.data as { board: { items: Array<Record<string, unknown>> } }
    ).board.items
      .map((i) => String(i["title"]))
      .sort();
    expect(doorTitles.length).toBeGreaterThanOrEqual(KNOWN.length + 1); // floor: never vacuous (H10)
    const html = await (await page()).text();
    expect(renderedTitles(html).sort()).toEqual(doorTitles);
  });
});
