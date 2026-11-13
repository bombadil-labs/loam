import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { retraction } from "../gateway/narrowing.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 30000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-t66-cli-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("T66: the boot heal tells the operator what it restored", () => {
  it("`serve --archive` over a corrupted primary names the restored id on stdout", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const op = authorForSeed(seed);
    const path = storePath(home);
    const vault = join(home, "archive");

    const height = observed(FERN, "height", 30, 1000, seed);
    const strike = retraction(height.id, op, seed, 2000);
    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    const gw = await Gateway.boot(store, assembleGenesis({ operatorSeed: seed }));
    await gw.append([height, strike]);
    await gw.close();

    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), strike.id);
    db.close();

    out.length = 0;
    const handle = await run(
      ["serve", "--http", "--port", "0", "--token", "t", "--home", home, "--archive", vault],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error(`serve refused: exit ${handle}`);
    await handle.close();

    const said = out.join("\n");
    expect(said).toContain(strike.id);
    expect(said).toMatch(/restor/i);
    expect(err.join("\n")).not.toMatch(/could not|stranded|set aside/i);
  });

  it("a squatter the archive CANNOT fix reaches stderr — the store serves, and says so", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const op = authorForSeed(seed);
    const path = storePath(home);
    const vault = join(home, "archive");

    const height = observed(FERN, "height", 30, 1000, seed);
    const strike = retraction(height.id, op, seed, 2000);
    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    const gw = await Gateway.boot(store, assembleGenesis({ operatorSeed: seed }));
    await gw.append([height, strike]);
    await gw.close();

    rmSync(join(vault, strike.id.slice(0, 2), `${strike.id}.json`));
    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), strike.id);
    db.close();

    out.length = 0;
    err.length = 0;
    const handle = await run(
      ["serve", "--http", "--port", "0", "--token", "t", "--home", home, "--archive", vault],
      io(),
      { detach: true },
    );
    if (typeof handle === "number") throw new Error(`serve refused: exit ${handle}`);
    await handle.close();

    expect(out.join("\n")).toMatch(/serving/);
    const warned = err.join("\n");
    expect(warned).toContain(strike.id);
    expect(warned).toMatch(/repair list/);
    expect(out.join("\n")).not.toMatch(/restored/);
  });
});

describe("T66: re-admit names the recovery that now exists", () => {
  it("a still-failing row is pointed at the archive heal, not only at discard", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const path = storePath(home);
    const height = observed(FERN, "height", 30, 1000, seed);
    const gw = await Gateway.boot(new SqliteBackend(path), assembleGenesis({ operatorSeed: seed }));
    await gw.append([height]);
    await gw.close();
    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), height.id);
    db.close();

    out.length = 0;
    const code = await run(["repair", "re-admit", height.id, "--home", home], io());

    expect(code).toBe(0);
    const said = out.join("\n");
    expect(said).toMatch(/still fails admission/);
    expect(said).toContain("`loam serve --archive <dir>`");
  });
});
