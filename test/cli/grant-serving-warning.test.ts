import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { storePath } from "../../src/cli/config.js";

vi.setConfig({ testTimeout: 20_000 });

const WARNING = /waits for a restart/;
const CLIENT = "connector-00000000000000000000000000000001";

let dir: string;
let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });
const quiet = () => {
  out.length = 0;
  err.length = 0;
};

const ACTOR_SEED = "ab".repeat(32);
const oauthFixture = () =>
  JSON.stringify({
    version: 1,
    clients: [
      {
        clientId: CLIENT,
        clientName: "fixture",
        redirectUris: ["https://example.com/cb"],
        registeredAt: Date.now(),
        generation: 1,
      },
    ],
    grants: [
      {
        clientId: CLIENT,
        actorSeed: ACTOR_SEED,
        actor: authorForSeed(ACTOR_SEED),
        grantedAt: Date.now(),
        standing: true,
      },
    ],
    tokens: [],
  });

const deadPid = (): number => {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid ?? 999999;
};

const serving = (pid: number): void => {
  writeFileSync(
    join(home, "serving.json"),
    `${JSON.stringify({ pid, url: "http://127.0.0.1:0", store: resolve(storePath(home, undefined)), startedAt: Date.now() })}\n`,
  );
};

const mint = () =>
  run(["grant", CLIENT, "--verb=register", "--prefix=sync:", "--home", home], io());
const revoke = () => run(["grant", "revoke", CLIENT, "--home", home], io());

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "loam-grant-staleness-"));
  home = join(dir, "home");
  quiet();
  expect(await run(["init", "--home", home], io())).toBe(0);
  writeFileSync(join(home, "oauth.json"), oauthFixture());
  quiet();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("T243 — grant warns beside a live server, and only there", () => {
  it("mint under a live-pid serving record: the grant lands AND the warning fires", async () => {
    serving(process.pid);
    expect(await mint()).toBe(0);
    expect(out.join("\n")).toContain(`granted ${CLIENT} register standing`);
    expect(err.join("\n")).toMatch(WARNING);
  });

  it("mint with no serving record: the grant lands and the silence is earned", async () => {
    expect(await mint()).toBe(0);
    expect(out.join("\n")).toContain(`granted ${CLIENT} register standing`);
    expect(err.join("\n")).not.toMatch(WARNING);
  });

  it("mint beside a provably dead pid: the other earned silence", async () => {
    serving(deadPid());
    expect(await mint()).toBe(0);
    expect(err.join("\n")).not.toMatch(WARNING);
  });

  it("revoke under a live-pid serving record warns the same way", async () => {
    serving(process.pid);
    expect(await revoke()).toBe(0);
    expect(out.join("\n")).toContain(`revoked ${CLIENT}`);
    expect(err.join("\n")).toMatch(WARNING);
  });
});
