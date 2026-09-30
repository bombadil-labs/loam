// Step 6, confirmed end to end through the CLI on real sqlite homes. The story an operator lives:
//
//   I keep two notes. Alice serves a note. I open a channel from Alice into my container "friends".
//   The channel's pool is its own peer: it has its own key, kept beside my store, and my notes are
//   copied into it. I erase one of my notes; my erasure reaches the pool as an order naming it, and
//   the note's bytes leave every file under my home, the pool's file included, while my other note
//   and Alice's note stay. I restart; the pool reopens under its own key. If the pool's key is
//   lost, my store refuses to reopen that pool rather than fall back to my key.
//
// Every check reads files or runs a command; nothing here reaches into a gateway object.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { authorForSeed } from "@bombadil/rhizomatic";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";

let root: string;
const lines: string[] = [];
const io = () => ({ out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) });
const said = (): string => lines.join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loam-step6-story-"));
  lines.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Every file under `dir`, recursively: the store, its -wal sidecar, pool files, key files. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}
const homeHolds = (home: string, needle: string): boolean =>
  filesUnder(home).some((f) => readFileSync(f).includes(needle));

/** Serve `home`, write notes through its own door, and return the running handle. */
async function writeNotes(home: string, token: string, notes: readonly [string, string][]) {
  const handle = await run(
    ["serve", "--http", "--home", home, "--port", "0", "--token", token],
    io(),
    { detach: true },
  );
  if (typeof handle === "number") throw new Error(`serve refused: ${said()}`);
  for (const [entity, title] of notes) {
    const res = await fetch(`${handle.url}/default/graphql`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: `mutation { note(entity: "${entity}", title: "${title}") { title } }`,
      }),
    });
    expect(res.ok).toBe(true);
  }
  return handle;
}

/** The peers whose journals a sqlite store file holds. */
function journalPeers(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare("SELECT peer FROM journal_head").all() as { peer: string }[]).map(
      (r) => r.peer,
    );
  } finally {
    db.close();
  }
}

/** The id of the one row in a sqlite file whose claims carry `needle`. */
function rowId(file: string, needle: string): string {
  const db = new Database(file, { readonly: true });
  try {
    const row = db.prepare("SELECT id FROM deltas WHERE claims LIKE ?").get(`%${needle}%`) as
      { id: string } | undefined;
    if (row === undefined) throw new Error(`no row carries ${needle}`);
    return row.id;
  } finally {
    db.close();
  }
}

describe("step 6: a channel pool is its own peer, end to end", () => {
  it("own key, my erasure reaches the pool at the bytes, restart, and a lost key refused", async () => {
    const me = join(root, "me");
    expect(await run(["init", "--home", me], io())).toBe(0);
    expect(await run(["register", "--stock", "note", "--home", me], io())).toBe(0);
    const mine = await writeNotes(me, "tok-me", [
      ["note:gone", "ERASED-STORY-MARKER"],
      ["note:kept", "KEPT-STORY-MARKER"],
    ]);
    await mine.close();

    const alice = join(root, "alice");
    expect(await run(["init", "--home", alice], io())).toBe(0);
    expect(await run(["register", "--stock", "note", "--home", alice], io())).toBe(0);
    const peer = await writeNotes(alice, "tok-alice", [["note:alice", "ALICE-STORY-MARKER"]]);
    try {
      lines.length = 0;
      const code = await run(
        [
          "federate",
          "open",
          "--from",
          `${peer.url}/default`,
          "--into",
          "friends",
          "--prefix",
          "alice",
          "--token",
          "tok-alice",
          "--home",
          me,
        ],
        io(),
      );
      expect(code, said()).toBe(0);
    } finally {
      await peer.close();
    }

    // The pool has its own key, kept beside my store, and it is not my operator key.
    const keyFile = `${storePath(me)}.poolkeys.json`;
    expect(existsSync(keyFile)).toBe(true);
    const keys = JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, string>;
    expect(Object.keys(keys)).toEqual(["channel:friends:alice"]);
    expect(keys["channel:friends:alice"]).not.toBe(
      readFileSync(join(me, "operator.seed"), "utf8").trim(),
    );

    // The premise: my note is in my store's file and in the pool's file.
    const [poolName] = readdirSync(join(me, "channels")).filter((n) => n.endsWith(".sqlite"));
    const pool = join(me, "channels", poolName!);
    // The pool's journal belongs to the saved key's peer; my store's journal to my operator key.
    const poolKey = authorForSeed(keys["channel:friends:alice"]!);
    const operator = authorForSeed(readFileSync(join(me, "operator.seed"), "utf8").trim());
    expect(journalPeers(pool)).toEqual([poolKey]);
    expect(journalPeers(storePath(me))).toEqual([operator]);
    expect(poolKey).not.toBe(operator);
    expect(readFileSync(pool).includes("ERASED-STORY-MARKER")).toBe(true);
    expect(homeHolds(me, "ALICE-STORY-MARKER")).toBe(true);

    // I erase my first note. Its bytes leave every file under my home, the pool's too; my other
    // note and Alice's note stay.
    const gone = rowId(storePath(me), "ERASED-STORY-MARKER");
    lines.length = 0;
    expect(await run(["erase", gone, "--reason", "the story", "--home", me], io()), said()).toBe(0);
    expect(homeHolds(me, "ERASED-STORY-MARKER")).toBe(false);
    expect(readFileSync(pool).includes("KEPT-STORY-MARKER")).toBe(true);
    expect(homeHolds(me, "ALICE-STORY-MARKER")).toBe(true);

    // I restart. The pool reopens under its own key, and the channel is still listed.
    lines.length = 0;
    const again = await run(
      ["serve", "--http", "--home", me, "--port", "0", "--token", "t"],
      io(),
      {
        detach: true,
      },
    );
    if (typeof again === "number") throw new Error(`serve refused after the erase: ${said()}`);
    await again.close();
    lines.length = 0;
    expect(await run(["federate", "list", "--home", me], io())).toBe(0);
    expect(said()).toContain("channel:friends:alice");
    expect(homeHolds(me, "ERASED-STORY-MARKER")).toBe(false);

    // The pool's key is lost. My store does not reopen that pool under my key: it says so.
    writeFileSync(keyFile, "{}");
    lines.length = 0;
    const lost = await run(["serve", "--http", "--home", me, "--port", "0", "--token", "t"], io(), {
      detach: true,
    });
    if (typeof lost !== "number") await lost.close();
    expect(said()).toMatch(/its key is not here/);
    expect(said()).toContain(`Restore its key in ${keyFile}`);
  }, 180_000);
});
