// The brief: a BoardItem's expandable long form — the open questions and the recommendation.
// Asserted at both levels. Delta/door level: a claimed `brief` resolves through the BoardItem
// reading and rides the Board expand into items[]. Object level: the rendered page carries it
// inside a <details> block, paragraph-split on blank lines, escaped; a card with no brief
// renders no <details> at all. Out of scope here (owned by board-render.test.ts): section
// membership, the public declaration, H1 strikes.

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

vi.setConfig({ testTimeout: 15000 });

const BUNDLE = readFileSync(new URL("../../demos/board/renderer.mjs", import.meta.url), "utf8");

const BRIEF =
  "The question: does the door refuse in one shape or two?\n\n" +
  "Recommendation: keep two shapes. Each shape protects one boundary.";

let world: BoardWorld;

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
  await addItem(world.base, "fable", "board:briefed", {
    kind: "pr",
    title: "the briefed item",
    seam: "one decision",
    status: "waiting-myk",
    brief: BRIEF,
  });
  await addItem(world.base, "fable", "board:terse", {
    kind: "note",
    title: "the terse item",
    status: "waiting-myk",
  });
});
afterAll(async () => {
  await world.handle.close();
  await world.gw.close();
});

const page = () =>
  fetch(`${world.base}/${MOUNT}/app/${BOARD_ROUTE}/${BOARD_ENTITY}`).then((r) => r.text());

// The card's HTML: from its data-title marker to the next card or section end.
function card(html: string, title: string): string {
  const marker = `data-title="${title}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const rest = html.slice(start + marker.length);
  const end = rest.search(/<div class="it"|<\/section>/);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("the brief resolves through the doors (delta/door level)", () => {
  it("boardItem answers the claimed brief verbatim", async () => {
    const res = await gql(
      world.base,
      `{ boardItem(entity: "board:briefed") { brief title } }`,
      "op",
    );
    expect(res.json.errors).toBeUndefined();
    const item = (res.json.data as { boardItem: { brief: string } }).boardItem;
    expect(item.brief).toBe(BRIEF);
  });

  it("the Board expand carries the brief into items[]; the terse item carries none", async () => {
    const res = await gql(
      world.base,
      `{ board(entity: ${JSON.stringify(BOARD_ENTITY)}) { items } }`,
    );
    expect(res.json.errors).toBeUndefined();
    const items = (res.json.data as { board: { items: Array<Record<string, unknown>> } }).board
      .items;
    expect(items.find((x) => x["title"] === "the briefed item")?.["brief"]).toBe(BRIEF);
    expect(items.find((x) => x["title"] === "the terse item")?.["brief"]).toBeUndefined();
  });
});

describe("the page renders the brief as an expandable block (object level)", () => {
  it("the briefed card holds a <details> with both paragraphs; the terse card holds none", async () => {
    const html = await page();
    const briefed = card(html, "the briefed item");
    expect(briefed).toContain('<details class="br"><summary>read the brief</summary>');
    expect(briefed).toContain("<p>The question: does the door refuse in one shape or two?</p>");
    expect(briefed).toContain(
      "<p>Recommendation: keep two shapes. Each shape protects one boundary.</p>",
    );
    expect(card(html, "the terse item")).not.toContain("<details");
  });

  it("markup in a brief arrives escaped, byte for byte", async () => {
    await addItem(world.base, "fable", "board:sneaky-brief", {
      kind: "note",
      title: "sneaky brief",
      status: "waiting-myk",
      brief: `<img src=x onerror=alert(1)>\n\na & b < c`,
    });
    const html = await page();
    const sneaky = card(html, "sneaky brief");
    expect(sneaky).not.toContain("<img");
    expect(sneaky).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(sneaky).toContain("a &amp; b &lt; c");
  });
});
