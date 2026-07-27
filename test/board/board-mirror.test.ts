// §34 (e) — the generated mirror. `scripts/render-board-artifact.mjs` queries the store's own
// door and emits the artifact HTML, so the artifact can never disagree with the store. The rail
// is two-sided and exact: the set of titles the script renders EQUALS the set of titles the
// door's own view answers — an item added appears on the next run, and a probe string in no view
// never appears. A floor on the view set keeps the equality from ever passing vacuously (H10).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BOARD_ENTITY } from "../../demos/board/vocabulary.mjs";
import { MOUNT, addItem, bootWorld, gql, registerVocabulary, type BoardWorld } from "./fixtures.js";

vi.setConfig({ testTimeout: 20000 });

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/render-board-artifact.mjs", import.meta.url));
const PROBE = "The item nobody ever claimed";

let world: BoardWorld;

beforeAll(async () => {
  world = await bootWorld();
  await registerVocabulary(world.base);
  await gql(
    world.base,
    `mutation { board(entity: ${JSON.stringify(BOARD_ENTITY)}, banner: "Loam — the board · generated mirror") { banner } }`,
    "op",
  );
  await addItem(world.base, "fable", "board:t42", {
    kind: "ticket",
    title: "sign the erasure spec",
    seam: "one read, one yes",
    status: "waiting-myk",
  });
  await addItem(world.base, "fable", "board:pr-300", {
    kind: "lane",
    title: "T79 · piece 7 of 8",
    status: "building",
  });
  await addItem(world.base, "fable", "board:pr-266", {
    kind: "ticket",
    title: "T64 COMPLETE — two-phase erasure",
    status: "shipped",
  });
});
afterAll(async () => {
  await world.handle.close();
  await world.gw.close();
});

async function mirror(): Promise<string> {
  const { stdout } = await run(process.execPath, [
    SCRIPT,
    "--url",
    `${world.base}/${MOUNT}`,
    "--token",
    "op",
  ]);
  return stdout;
}

// The titles the door itself answers — the expectation's independent source.
async function viewTitles(): Promise<string[]> {
  const res = await gql(
    world.base,
    `{ board(entity: ${JSON.stringify(BOARD_ENTITY)}) { banner items } }`,
    "op",
  );
  expect(res.json.errors).toBeUndefined();
  const items = (res.json.data as { board: { items: Array<Record<string, unknown>> } }).board.items;
  return items.map((i) => String(i["title"]));
}

// The titles the script rendered, read off its own markers.
const renderedTitles = (html: string): string[] =>
  [...html.matchAll(/data-title="([^"]*)"/g)].map((m) => m[1]!);

describe("(e) the mirror renders exactly the store's items", () => {
  it("title-for-title equal to the door's own view set — nothing added, nothing dropped", async () => {
    const expected = await viewTitles();
    expect(expected.length).toBeGreaterThanOrEqual(3); // the floor: equality over ∅ proves nothing
    const html = await mirror();
    expect(new Set(renderedTitles(html))).toEqual(new Set(expected));
    expect(html).toContain("Loam — the board · generated mirror"); // the banner rides too
    expect(html).not.toContain(PROBE); // a string in no view is in no artifact
  });

  it("an item added to the store appears on the next run", async () => {
    await addItem(world.base, "fable", "board:lane-fresh", {
      kind: "lane",
      title: "A freshly reported lane",
      status: "building",
    });
    const html = await mirror();
    expect(html).toContain("A freshly reported lane");
    expect(new Set(renderedTitles(html))).toEqual(new Set(await viewTitles()));
  });
});
