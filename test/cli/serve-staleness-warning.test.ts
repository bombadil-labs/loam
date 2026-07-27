// T103(a) — A PULL INTO A SERVED HOME SAYS SO. `loam pull` and `loam register` open their own
// sqlite handle, so a `loam serve` holding the same store keeps answering from boot-time memory:
// the deltas land, the report says "accepted", and the running server serves none of it. The
// repair railed here is the honest sentence — a stderr warning that a server will not see what
// just landed until it restarts — never a refusal: the pull still succeeds, exit 0, count printed.
//
// The detection direction is the rail's real subject (H9, inverted for a probe whose SILENCE is
// the hazard): only two silences are earned — no serving record at all, and a record whose pid is
// provably dead. A record that cannot be read, cannot be parsed, or is missing its fields WARNS.
// These rails hold both sides: the warning fires against a genuinely live server (a real detached
// serve, not a fixture record), and the earned silences stay silent.
//
// Deliberately not asserted here: that the running server later ingests anything (it does not —
// the pull door and the watcher are T103's unbuilt halves); the record-present-but-UNREADABLE
// branch (a non-ENOENT read error also warns, but no portable fixture can make a file unreadable
// on every CI platform — chmod is advisory on Windows and a no-op under root); and nothing about
// `~/.loam` or any path outside this test's own mkdtemp.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";
import { exportOffer } from "../../src/federation/offer.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

vi.setConfig({ testTimeout: 15000 }); // real sqlite homes and a real HTTP server

const WARNING = /will not see what just landed until it restarts/;

let dir: string;
let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const quiet = () => {
  out.length = 0;
  err.length = 0;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loam-staleness-"));
  home = join(dir, "home");
  quiet();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// A small frozen offer to pull — any lawful deltas will do; the rail is about the warning.
async function offerFile(): Promise<string> {
  const peer = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: "7a".repeat(32) }),
  );
  const file = join(dir, "offer.json");
  writeFileSync(file, exportOffer(peer));
  await peer.close();
  return file;
}

async function serveDetached(): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(
    ["serve", "--http", "--home", home, "--port", "0", "--token", "tok"],
    io(),
    { detach: true },
  );
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

const schemaFile = (): string => {
  const PICK = { pick: { order: { byTimestamp: "desc" } } };
  const path = join(dir, "plant.json");
  writeFileSync(
    path,
    JSON.stringify({
      hyperschema: {
        name: "Plant",
        alg: 1,
        body: {
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "drop", in: "input" },
          },
        },
      },
      schema: { props: { height: PICK }, default: PICK },
      roots: ["plant:fern"],
    }),
  );
  return path;
};

describe("T103(a) — pull and register into a served home say the server will not see it", () => {
  it("pull warns while a server holds the store, succeeds anyway, and is silent after shutdown", async () => {
    const server = await serveDetached();
    const offer = await offerFile();

    quiet();
    const code = await run(["pull", offer, "--home", home], io());
    expect(code).toBe(0); // the warning qualifies the success; it never revokes it
    expect(out.join("\n")).toMatch(/accepted/);
    const warned = err.join("\n");
    expect(warned).toMatch(WARNING);
    expect(warned).toMatch(/pid \d+/); // it names the server it found...
    expect(warned).toContain(server.url); // ...and where that server answers

    await server.close();
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING); // a clean shutdown earns the silence
  });

  it("register warns the same way against a served home", async () => {
    const server = await serveDetached();
    quiet();
    const code = await run(["register", schemaFile(), "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/registered.*Plant/i);
    expect(err.join("\n")).toMatch(WARNING);
    await server.close();
  });

  it("a record whose pid is provably dead is the other earned silence", async () => {
    const server = await serveDetached();
    await server.close();
    const offer = await offerFile();

    // A pid that certainly lived and certainly exited: a crash's stale record, reconstructed.
    const dead = spawnSync(process.execPath, ["-e", ""]);
    writeFileSync(
      join(home, "serving.json"),
      `${JSON.stringify({
        pid: dead.pid,
        url: "http://127.0.0.1:1",
        store: resolve(storePath(home)),
        startedAt: new Date().toISOString(),
      })}\n`,
    );
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING);
  });

  it("uncertainty warns: an unparseable record, and one missing its fields", async () => {
    const server = await serveDetached();
    await server.close();
    const offer = await offerFile();

    writeFileSync(join(home, "serving.json"), "{ this is not a record");
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(WARNING);

    // Legible JSON that answers neither "who" nor "which store" is still a maybe, and a maybe warns.
    writeFileSync(join(home, "serving.json"), JSON.stringify({ startedAt: "yesterday" }));
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(WARNING);

    // JSON that parses to no object at all is the same maybe — warned, never thrown over.
    writeFileSync(join(home, "serving.json"), "null");
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(WARNING);

    // A pid no process table could hold, over THIS store: the record is garbage, and garbage
    // must warn as a maybe rather than be probed into a confident silence.
    writeFileSync(
      join(home, "serving.json"),
      JSON.stringify({ pid: -3, url: "http://127.0.0.1:1", store: resolve(storePath(home)) }),
    );
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(/may be serving/);
  });

  it("a pull into a DIFFERENT store file in the same home is not the trap, and stays quiet", async () => {
    const server = await serveDetached(); // serves the home's default store
    const offer = await offerFile();
    quiet();
    const other = join(dir, "other.sqlite");
    expect(await run(["pull", offer, "--home", home, "--store", other], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING); // the served world is not the one that moved
    await server.close();
  });
});
