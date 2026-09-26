// CLI reports say only what happened. Each case pins one door that used to report a success it
// had not achieved, and each pairs the refusal with a control where the same verb still succeeds,
// so a refusal on every input would fail here too.
//
// A "running server" is a serving record naming this very process over the same store — the shape
// `loam serve` writes. It is the probe these verbs read; the server's own behaviour (it keeps
// pulling a channel dropped behind its back) is not driven here.
//
// Erasure standing rule: every store here is this file's own mkdtemp fixture.

import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimsToJson } from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import type { ServerHandle } from "../../src/server/http.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 30_000 });

let root: string;
let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const handles: ServerHandle[] = [];

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "loam-honest-"));
  home = join(root, "home");
  expect(await run(["init", "--home", home], io())).toBe(0);
  out.length = 0;
  err.length = 0;
});
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const pretendServing = (): void =>
  writeFileSync(
    join(home, "serving.json"),
    `${JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:1", store: storePath(home), startedAt: Date.now() })}\n`,
  );
const stopServing = (): void => rmSync(join(home, "serving.json"), { force: true });

/** One channel into "peers", opened the way the CLI's own boot would read it back. */
async function withChannel(): Promise<string> {
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
    { channelBackend: channelBackendFor(home, io()) },
  );
  const channel = await gateway.openChannel({
    into: "peers",
    prefix: "alice",
    source: { pull: () => Promise.resolve([]) },
  });
  await gateway.close();
  return channel.name;
}

/** What a fresh `federate list` says about one channel, or "" when it lists no such channel. */
async function listed(name: string): Promise<string> {
  const said: string[] = [];
  expect(
    await run(["federate", "list", "--home", home], { out: (s) => said.push(s), err: () => {} }),
  ).toBe(0);
  return said.find((s) => s.startsWith(name)) ?? "";
}

// Damage one stored row so boot sets it aside: other well-formed claims no longer recompute to
// the row's own id.
async function storeWithOneDamagedRow(): Promise<void> {
  const seed = readSeed(home);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  const a = observed(FERN, "height", 30, 1000, seed);
  const b = observed(FERN, "height", 34, 2000, seed);
  await gateway.append([a, b]);
  await gateway.flush();
  await gateway.close();
  const db = new Database(storePath(home));
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run(
    JSON.stringify(claimsToJson(b.claims)),
    a.id,
  );
  db.close();
}

describe("federate drop and set refuse while a server holds the channel", () => {
  it("drop refuses, names the server, and the channel still stands; with no server it drops", async () => {
    const name = await withChannel();
    pretendServing();
    const code = await run(["federate", "drop", "--channel", name, "--yes", "--home", home], io());
    expect(code).toBe(2);
    const said = err.join("\n");
    expect(said).toContain("federate drop refused");
    expect(said).toContain(`pid ${process.pid}`);
    expect(said).toContain("Stop the server first");
    expect(said).toContain("/admin/container?name=");
    expect(out.join("\n")).not.toContain("purged");
    // The store level: the channel was not severed.
    stopServing();
    expect(await listed(name)).not.toBe("");

    // Control: the same verb, with no server, severs it.
    out.length = 0;
    expect(await run(["federate", "drop", "--channel", name, "--yes", "--home", home], io())).toBe(
      0,
    );
    expect(out.join("\n")).toContain("is severed and its pool is purged");
    expect(await listed(name)).toBe("");
  });

  it("set refuses and the toggle is unchanged; with no server it sets", async () => {
    const name = await withChannel();
    pretendServing();
    const code = await run(
      ["federate", "set", "--channel", name, "--receiving", "false", "--home", home],
      io(),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("federate set refused");
    expect(err.join("\n")).toContain("loam_federate_set");
    stopServing();
    expect(await listed(name)).toContain("receiving,");

    expect(
      await run(
        ["federate", "set", "--channel", name, "--receiving", "false", "--home", home],
        io(),
      ),
    ).toBe(0);
    expect(await listed(name)).toContain("FROZEN");
  });
});

describe("federate open says a running server will not follow the channel until restart", () => {
  it("warns beside a running server, and stays quiet without one", async () => {
    const offer = join(root, "offer.json");
    writeFileSync(offer, JSON.stringify({ deltas: [] }));
    pretendServing();
    const args = ["federate", "open", "--from", offer, "--into", "peers", "--home", home];
    expect(await run([...args, "--prefix", "alice"], io())).toBe(0);
    expect(err.join("\n")).toMatch(/will not follow channel:peers:alice until it restarts/);

    stopServing();
    err.length = 0;
    expect(await run([...args, "--prefix", "bob"], io())).toBe(0);
    expect(err.join("\n")).not.toContain("until it restarts");
  });

  it("the boot banner does not promise to follow a channel another process opens", async () => {
    const handle = (await run(
      ["serve", "--http", "--home", home, "--token", "t", "--port", "0"],
      io(),
      { detach: true },
    )) as ServerHandle;
    handles.push(handle);
    const banner = out.join("\n");
    expect(banner).toContain("no channels yet");
    expect(banner).not.toContain("opened while serving is followed too");
    expect(banner).toContain("`loam federate open` waits for a restart");
  });
});

describe("serve names the rows boot set aside", () => {
  it("prints one line with the count and `loam repair list`; a clean store prints none", async () => {
    const clean = (await run(
      ["serve", "--http", "--home", home, "--token", "t", "--port", "0"],
      io(),
      { detach: true },
    )) as ServerHandle;
    await clean.close();
    expect(err.join("\n")).not.toContain("set aside");

    await storeWithOneDamagedRow();
    err.length = 0;
    const handle = (await run(
      ["serve", "--http", "--home", home, "--token", "t", "--port", "0"],
      io(),
      { detach: true },
    )) as ServerHandle;
    handles.push(handle);
    const lines = err.filter((s) => s.includes("set aside"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^loam: 1 unreadable row was set aside/);
    expect(lines[0]).toContain("`loam repair list`");
  });
});

describe("loam store refuses a store it cannot read", () => {
  it("a pre-0.11 store is refused with boot's sentence, not counted as empty", async () => {
    const path = join(root, "pre.db");
    copyFileSync(join("test", "fixtures", "pre-t32", "store.db"), path);
    const code = await run(["store", "--store", path], io());
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/8 rows and none of them is readable.*before rhizomatic 0\.11/s);
    expect(out.join("\n")).not.toContain("0 deltas");
  });

  it("a store with one damaged row counts the rest and names the set-aside row", async () => {
    await storeWithOneDamagedRow();
    const code = await run(["store", "--home", home], io());
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/\d+ deltas/);
    expect(err.join("\n")).toContain("1 unreadable row was set aside");
  });
});

describe("repair leave refuses a key that is not quarantined", () => {
  it("names the key and exits 2, like discard", async () => {
    await storeWithOneDamagedRow();
    const code = await run(["repair", "leave", "1e20nothere", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("1e20nothere is not quarantined");
    expect(out.join("\n")).not.toContain("left 1e20nothere");
  });
});
