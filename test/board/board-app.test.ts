// §34's write side, over a real Gateway and the served doors: (a) the vocabulary binds through
// /register and boardEvent is one call, one delta, latest-wins; (b) standing decides who writes —
// a granted author passes, an ungranted one is refused; (f) `status: shipped` IS the exit, and
// nothing leaves the ground; (g) an asOf read answers the board as it stood.
//
// Both levels throughout (P3 discipline): object-level through the door (what a query answers),
// delta-level in the reactor (what actually landed — count, shape, author). The RENDERED half of
// (f) — a shipped item leaving the waiting/in-flight sections of the page — is board-render.test.ts's
// rail, beside the rest of the route assertions.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BOARD_ENTITY } from "../../demos/board/vocabulary.mjs";
import {
  FABLE,
  STRANGER,
  addItem,
  boardEvent,
  bootWorld,
  gql,
  registerVocabulary,
  statusDeltas,
  type BoardWorld,
} from "./fixtures.js";

vi.setConfig({ testTimeout: 15000 });

let world: BoardWorld;
let registrations: Response[];

beforeAll(async () => {
  world = await bootWorld();
  registrations = await registerVocabulary(world.base);
});
afterAll(async () => {
  await world.handle.close();
  await world.gw.close();
});

describe("(a) the vocabulary through /register; boardEvent is one call, one delta, latest-wins", () => {
  it("both registrations land through the door", async () => {
    expect(registrations).toHaveLength(2);
    for (const res of registrations) expect(res.status).toBe(200);
    const named = await Promise.all(
      registrations.map(async (r) => ((await r.json()) as { registered: string }).registered),
    );
    expect(named).toEqual(["BoardItem", "Board"]);
  });

  it("a transition is ONE signed delta of exactly the declared shape, and the latest wins", async () => {
    const { base, gw } = world;
    const ITEM = "board:pr-262";
    await addItem(base, "fable", ITEM, {
      kind: "ticket",
      title: "#262 — T64 piece 4: the receipt",
      status: "open",
    });
    const before = statusDeltas(gw, ITEM).length; // creation claimed status once

    const r1 = await boardEvent(base, "fable", ITEM, "review");
    expect(r1.json.errors, JSON.stringify(r1.json.errors)).toBeUndefined();
    const id = (r1.json.data as { boardEvent: { delta: string } }).boardEvent.delta;

    // Delta level: the receipt names a landed delta shaped exactly as the template declared —
    // one subject pointer at (item, status), one primitive value, nothing else.
    const landed = [...gw.reactor.snapshot()].find((d) => d.id === id);
    expect(landed).toBeDefined();
    expect(landed!.claims.pointers).toHaveLength(2);
    const [subject, value] = landed!.claims.pointers;
    expect(subject!.role).toBe("subject");
    expect(subject!.target).toEqual({
      kind: "entity",
      entity: { id: ITEM, context: "status" },
    });
    expect(value!.role).toBe("value");
    expect(value!.target).toEqual({ kind: "primitive", value: "review" });
    expect(statusDeltas(gw, ITEM)).toHaveLength(before + 1);

    // A second transition: the door answers the LATEST claim, and both survive as history.
    const r2 = await boardEvent(base, "fable", ITEM, "waiting-myk");
    expect(r2.json.errors).toBeUndefined();
    const read = await gql(base, `{ boardItem(entity: ${JSON.stringify(ITEM)}) { status } }`, "op");
    expect((read.json.data as { boardItem: { status: string } }).boardItem.status).toBe(
      "waiting-myk",
    );
    expect(statusDeltas(gw, ITEM)).toHaveLength(before + 2);
  });
});

describe("(b) standing decides who writes", () => {
  it("a granted non-operator author writes boardEvent, and the delta carries HER signature", async () => {
    const { base, gw } = world;
    const ITEM = "board:lane-t79";
    await addItem(base, "fable", ITEM, {
      kind: "lane",
      title: "T79 · pieces 7–8 of 8",
      status: "building",
    });
    const res = await boardEvent(base, "fable", ITEM, "review");
    expect(res.json.errors, JSON.stringify(res.json.errors)).toBeUndefined();
    const id = (res.json.data as { boardEvent: { delta: string } }).boardEvent.delta;
    const landed = [...gw.reactor.snapshot()].find((d) => d.id === id);
    expect(landed!.claims.author).toBe(FABLE); // attribution is the product
  });

  it("an ungranted author is refused — nothing lands, nothing changes", async () => {
    const { base, gw } = world;
    const ITEM = "board:lane-t79";
    const beforeCount = [...gw.reactor.snapshot()].length;
    const res = await boardEvent(base, "stranger", ITEM, "shipped");
    expect(res.json.errors).toBeDefined();
    expect(res.json.errors!.length).toBeGreaterThan(0);
    // Object level: the status the door answers is untouched.
    const read = await gql(base, `{ boardItem(entity: ${JSON.stringify(ITEM)}) { status } }`, "op");
    expect((read.json.data as { boardItem: { status: string } }).boardItem.status).toBe("review");
    // Delta level: no delta landed at all, and none in the ground carries the stranger's key.
    const snapshot = [...gw.reactor.snapshot()];
    expect(snapshot).toHaveLength(beforeCount);
    expect(snapshot.some((d) => d.claims.author === STRANGER)).toBe(false);
  });
});

describe("(f) status: shipped IS the exit — nothing is removed to leave the board", () => {
  it("a shipped item stays queryable, listed, and keeps its whole history", async () => {
    const { base, gw } = world;
    const ITEM = "board:ticket-T64";
    await addItem(base, "fable", ITEM, {
      kind: "ticket",
      title: "T64 — two-phase erasure",
      seam: "the slate, the closures, the cut, the receipt",
      status: "review",
    });
    const history = statusDeltas(gw, ITEM).length;
    const res = await boardEvent(base, "fable", ITEM, "shipped");
    expect(res.json.errors).toBeUndefined();

    // Object level: still fully queryable, props intact, status the exit value.
    const read = await gql(
      base,
      `{ boardItem(entity: ${JSON.stringify(ITEM)}) { title seam status } }`,
      "op",
    );
    const view = (read.json.data as { boardItem: Record<string, unknown> }).boardItem;
    expect(view["status"]).toBe("shipped");
    expect(view["title"]).toBe("T64 — two-phase erasure");
    expect(view["seam"]).toBe("the slate, the closures, the cut, the receipt");

    // Still LISTED: the board's own members carry it, shipped and all.
    const board = await gql(
      base,
      `{ board(entity: ${JSON.stringify(BOARD_ENTITY)}) { items } }`,
      "op",
    );
    const items = (board.json.data as { board: { items: Array<Record<string, unknown>> } }).board
      .items;
    expect(items.some((i) => i["title"] === "T64 — two-phase erasure")).toBe(true);

    // Delta level: the exit ADDED a claim; every prior status claim survives un-negated.
    const after = statusDeltas(gw, ITEM);
    expect(after).toHaveLength(history + 1);
    const struck = new Set(
      [...gw.reactor.snapshot()].flatMap((d) =>
        d.claims.pointers
          .filter((p) => p.target.kind === "delta" && p.role === "negates")
          .map((p) => (p.target.kind === "delta" ? p.target.deltaRef.delta : "")),
      ),
    );
    for (const d of after) expect(struck.has(d.id)).toBe(false);
  });
});

describe("(g) as-of: yesterday's board is a reading, not an archive", () => {
  it("an asOf query between two transitions answers the PRIOR status after later ones land", async () => {
    const { base, gw } = world;
    const ITEM = "board:pr-300";
    await addItem(base, "fable", ITEM, {
      kind: "lane",
      title: "T79 · piece 7",
      status: "building",
    });
    const res = await boardEvent(base, "fable", ITEM, "shipped");
    expect(res.json.errors).toBeUndefined();

    // The two moments, read off the ground itself (the gateway clock is strictly monotonic).
    const stamps = statusDeltas(gw, ITEM)
      .map((d) => d.claims.timestamp)
      .sort((a, b) => a - b);
    expect(stamps).toHaveLength(2);
    const [t1, t2] = stamps as [number, number];
    expect(t2).toBeGreaterThan(t1);

    const past = await gql(
      base,
      `{ boardItem(entity: ${JSON.stringify(ITEM)}, asOf: ${t2 - 1}) { status _asOf } }`,
      "op",
    );
    const then = (past.json.data as { boardItem: { status: string; _asOf: number } }).boardItem;
    expect(then.status).toBe("building"); // the prior status, after the later transition landed
    expect(then._asOf).toBe(t2 - 1); // the pin rides the answer

    const now = await gql(base, `{ boardItem(entity: ${JSON.stringify(ITEM)}) { status } }`, "op");
    expect((now.json.data as { boardItem: { status: string } }).boardItem.status).toBe("shipped");
  });
});
