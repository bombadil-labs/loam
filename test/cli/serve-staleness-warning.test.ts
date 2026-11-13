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

vi.setConfig({ testTimeout: 20_000 });

const WARNING = /waits for a restart/;

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
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/accepted/);
    const warned = err.join("\n");
    expect(warned).toMatch(WARNING);
    expect(warned).toMatch(/pid \d+/);
    expect(warned).toContain(server.url);

    await server.close();
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING);
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

    writeFileSync(join(home, "serving.json"), JSON.stringify({ startedAt: "yesterday" }));
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(WARNING);

    writeFileSync(join(home, "serving.json"), "null");
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(WARNING);

    writeFileSync(
      join(home, "serving.json"),
      JSON.stringify({ pid: -3, url: "http://127.0.0.1:1", store: resolve(storePath(home)) }),
    );
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(/may be serving/);

    writeFileSync(
      join(home, "serving.json"),
      JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:1" }),
    );
    quiet();
    expect(await run(["pull", offer, "--home", home], io())).toBe(0);
    expect(err.join("\n")).toMatch(/may be serving/);
  });

  it("a pull into a DIFFERENT store file in the same home is not the trap, and stays quiet", async () => {
    const server = await serveDetached();
    const offer = await offerFile();
    quiet();
    const other = join(dir, "other.sqlite");
    expect(await run(["pull", offer, "--home", home, "--store", other], io())).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING);
    await server.close();
  });
});
