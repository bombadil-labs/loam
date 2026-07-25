// T66 at the operator's surface. Two disclosures, both load-bearing, because the whole ticket exists
// because the operator was TOLD a strike was stranded (T57) and handed no tool to settle it:
//
//   - `loam serve --archive` heals before boot, so the restore happens on the path the operator
//     already runs. A change to the ground must be VISIBLE: the restored id reaches stdout, and a
//     restore that could not be made reaches stderr beside the erasure sweep's refusals — a store
//     that serves while a strike is still stranded must say so.
//   - `repair re-admit` on a row that still fails admission now names the recovery that exists,
//     rather than leaving "discard it as garbage" as the only end.
//
// The re-admit case asserts the message NAMES the archive path, not merely that it is longer: an
// operator who cannot find the verb has not been told anything.

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

    // The negation's signature is damaged in the PRIMARY only; the archive keeps the healthy copy.
    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), strike.id);
    db.close();

    out.length = 0;
    // An ABSOLUTE --archive on purpose: `archivePath` returns the override verbatim, so a relative
    // one resolves against the CWD rather than the home its help text promises — a separate defect,
    // and one that would silently point this rail at an empty vault.
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
    expect(said).toMatch(/still fails admission/); // the existing promise, unbroken
    // ...and the new one: the operator is NAMED a recovery, not left with discard as the only end.
    expect(said).toMatch(/--archive/);
  });
});
