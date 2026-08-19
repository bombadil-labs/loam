// §46 criterion 16 — THE FRIEND SCENARIO, end to end, against live HTTP servers.
//
// This is the rail T143 taught us to write. That day every gate was green — spec-lint, rails red then
// green, hollow-test, cross-model review — and no human could log in, because no rail drove the real
// surface. The unit rails here are honest about mechanisms and cannot see whether a PERSON can
// federate: tonight they were all green while a bound lens answered null over a pool that had
// evaporated with the process that filled it.
//
// So this drives what Myk's friend actually does: two stores, two DIFFERENT operator keys, a real
// door over HTTP, a channel opened from one process and READ FROM ANOTHER. Nothing is stubbed.

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

    // Alice: her own store, her own operator key, one stock shape and one real note.
    expect(await run(["init", "--home", alice], io())).toBe(0);
    expect(await run(["register", "--stock", "note", "--home", alice], io())).toBe(0);

    // Bob: a genuinely separate store with a DIFFERENT operator. This is the case that answered
    // "nothing is registered: foreign law is inert on a governed store" before §46.
    expect(await run(["init", "--home", bob], io())).toBe(0);

    // Port 0: an ephemeral port, so the suite never fights for one. A hardcoded port is how a
    // forgotten server turns an unrelated run red (the quickstart/`npm test` collision, and T187).
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
        headers: { authorization: "Bearer tok-alice", "content-type": "application/json" },
        body: JSON.stringify({
          query:
            'mutation { note(entity: "note:hi", title: "from alice", body: "federation works") { title } }',
        }),
      });
      expect(wrote.ok).toBe(true);

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

    // A FRESH PROCESS-equivalent boot: nothing from the open call is in memory. This is the half
    // that caught the in-memory pool — the bytes must be on disk and the channel must re-attach.
    const { Gateway } = await import("../../src/gateway/gateway.js");
    const { assembleGenesis } = await import("../../src/gateway/genesis.js");
    const { SqliteBackend } = await import("../../src/store/sqlite.js");
    const { channelBackendFor } = await import("../../src/cli/cli.js");
    const { readSeed, storePath } = await import("../../src/cli/config.js");
    const reopened = await Gateway.boot(
      new SqliteBackend(storePath(bob)),
      assembleGenesis({ operatorSeed: readSeed(bob) }),
      // THE SHIPPED FACTORY, imported — never a copy. A rail that re-implements the path mangling
      // stays green while the real one diverges: when the filename gained its collision-proof
      // digest, this test kept pointing at the old name and read null. The duplicate WAS the bug.
      { channelBackend: channelBackendFor(bob, io()) },
    );
    try {
      const answer = await reopened.query('{ alice_Note(entity: "note:hi") { title body } }');
      expect(answer.errors, JSON.stringify(answer)).toBeUndefined();
      const note = (answer.data as { alice_Note: { title: string; body: string } }).alice_Note;
      // THE VALUE. A served field answering null is what this rail exists to refuse.
      expect(note.title).toBe("from alice");
      expect(note.body).toBe("federation works");
    } finally {
      await reopened.close();
    }
  }, 60_000);
});
