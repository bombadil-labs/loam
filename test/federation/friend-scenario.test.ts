import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";

let root: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const said = (): string => [...out, ...err].join("\n");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "loam-friend-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("§46 — the friend scenario, end to end", () => {
  it("a peer's law and data cross to a different operator, and READ from a fresh process", async () => {
    const alice = join(root, "alice");
    const bob = join(root, "bob");

    expect(await run(["init", "--home", alice], io())).toBe(0);
    expect(await run(["register", "--stock", "note", "--home", alice], io())).toBe(0);

    expect(await run(["init", "--home", bob], io())).toBe(0);

    const handle = await run(
      ["serve", "--http", "--home", alice, "--port", "0", "--token", "tok-alice"],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error("serve should return a running handle");
    const mount = `${handle.url}/default`;
    try {
      const wrote = await fetch(`${mount}/graphql`, {
        method: "POST",
        headers: {
          authorization: "Bearer tok-alice",
          "content-type": "application/json",
          connection: "close",
        },
        body: JSON.stringify({
          query:
            'mutation { note(entity: "note:hi", title: "from alice", body: "federation works") { title } }',
        }),
      });
      expect(wrote.ok, await wrote.text()).toBe(true);

      out.length = 0;
      const opened = await run(
        [
          "federate",
          "open",
          "--from",
          mount,
          "--into",
          "friends",
          "--prefix",
          "alice",
          "--token",
          "tok-alice",
          "--home",
          bob,
        ],
        io(),
      );
      expect(opened, said()).toBe(0);
      expect(said()).toContain("bound alice:Note");
    } finally {
      await handle.close();
    }

    const { Gateway } = await import("../../src/gateway/gateway.js");
    const { assembleGenesis } = await import("../../src/gateway/genesis.js");
    const { SqliteBackend } = await import("../../src/store/sqlite.js");
    const { channelBackendFor } = await import("../../src/cli/cli.js");
    const { readSeed, storePath } = await import("../../src/cli/config.js");
    const reopened = await Gateway.boot(
      new SqliteBackend(storePath(bob)),
      assembleGenesis({ operatorSeed: readSeed(bob) }),
      { channelBackend: channelBackendFor(bob, io()) },
    );
    try {
      const answer = await reopened.query('{ alice_Note(entity: "note:hi") { title body } }');
      expect(answer.errors, JSON.stringify(answer)).toBeUndefined();
      const note = (answer.data as { alice_Note: { title: string; body: string } }).alice_Note;
      expect(note.title).toBe("from alice");
      expect(note.body).toBe("federation works");
    } finally {
      await reopened.close();
    }
  }, 60_000);
});
