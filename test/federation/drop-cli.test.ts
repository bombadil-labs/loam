// §46 / T192 — severing a channel THROUGH THE CLI, on a sqlite-backed pool, from a process that did
// not open it.
//
// This is the rail whose absence let four defects live. Every other drop rail drives `openChannel`
// in-process over MemoryBackend with no channelBackend: the live-channel map is always populated, so
// the re-open path is never taken; the pool has no file, so "purged at the bytes" is trivially true;
// and there is no process boundary, so the attach state that breaks the CLI never arises.
//
// What it pins:
//  1. `federate drop --yes` SUCCEEDS on a booted store. It could not — `resumeChannels` fills
//     attachedContainers but not federationChannels, so the re-open threw "already attached".
//  2. The bytes are gone at the FILE, not merely absent from a gather.
//  3. The channel record goes with them, so `federate list` cannot contradict the drop.
//  4. A named bystander channel survives, at its own file. Two-sided, as every erasure rail here is.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  root = mkdtempSync(join(tmpdir(), "loam-drop-cli-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A peer store with one stock shape and one note, served on an ephemeral port. */
async function peer(name: string, title: string) {
  const home = join(root, name);
  expect(await run(["init", "--home", home], io())).toBe(0);
  expect(await run(["register", "--stock", "note", "--home", home], io())).toBe(0);
  const handle = await run(
    ["serve", "--http", "--home", home, "--port", "0", "--token", `tok-${name}`],
    io(),
    { detach: true },
  );
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  const res = await fetch(`${handle.url}/default/graphql`, {
    method: "POST",
    headers: { authorization: `Bearer tok-${name}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: `mutation { note(entity: "note:${name}", title: "${title}") { title } }`,
    }),
  });
  expect(res.ok).toBe(true);
  return { mount: `${handle.url}/default`, token: `tok-${name}`, stop: () => handle.close() };
}

const poolFiles = (home: string): string[] =>
  existsSync(join(home, "channels"))
    ? readdirSync(join(home, "channels")).filter((f) => f.endsWith(".sqlite"))
    : [];

// EVERY file, not just the .sqlite: sqlite runs in WAL mode, so a recent write lives in the -wal
// sidecar until a checkpoint. A byte probe that reads only the main file reports "gone" for data
// that is merely un-checkpointed — the exact false negative an erasure rail must not make.
const poolBytes = (home: string): Buffer[] =>
  existsSync(join(home, "channels"))
    ? readdirSync(join(home, "channels")).map((f) => readFileSync(join(home, "channels", f)))
    : [];

/** Does any pool file under this home still contain these bytes? Byte level, not gather level. */
const anyFileHolds = (home: string, needle: string): boolean =>
  poolBytes(home).some((b) => b.includes(needle));

describe("§46 — severing a channel through the CLI", () => {
  it("drops a sqlite-backed channel from a booted store, and leaves a named bystander whole", async () => {
    const me = join(root, "me");
    expect(await run(["init", "--home", me], io())).toBe(0);

    const alice = await peer("alice", "alice-only-marker");
    const bob = await peer("bob", "bob-only-marker");
    try {
      for (const [p, who] of [
        [alice, "alice"],
        [bob, "bob"],
      ] as const) {
        out.length = 0;
        err.length = 0;
        const code = await run(
          [
            "federate",
            "open",
            "--from",
            p.mount,
            "--into",
            "friends",
            "--prefix",
            who,
            "--token",
            p.token,
            "--home",
            me,
          ],
          io(),
        );
        expect(code, said()).toBe(0);
      }
    } finally {
      await alice.stop();
      await bob.stop();
    }

    // Both peers' bytes are on disk, in their own files — the premise the drop must respect.
    expect(poolFiles(me).length).toBe(2);
    expect(anyFileHolds(me, "alice-only-marker")).toBe(true);
    expect(anyFileHolds(me, "bob-only-marker")).toBe(true);

    // A FRESH invocation: nothing from the opens is in memory. This is the state the CLI drop
    // could not survive.
    out.length = 0;
    err.length = 0;
    const dropped = await run(
      ["federate", "drop", "--channel", "channel:friends:alice", "--yes", "--home", me],
      io(),
    );
    expect(dropped, said()).toBe(0);

    // GONE at the bytes...
    expect(anyFileHolds(me, "alice-only-marker")).toBe(false);
    // ...and the bystander is untouched, also at the bytes.
    expect(anyFileHolds(me, "bob-only-marker")).toBe(true);

    // The record went with it: one command must not contradict the next.
    out.length = 0;
    err.length = 0;
    expect(await run(["federate", "list", "--home", me], io())).toBe(0);
    expect(said()).not.toContain("channel:friends:alice");
    expect(said()).toContain("channel:friends:bob");
  }, 120_000);
});
