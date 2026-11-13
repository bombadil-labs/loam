import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { rolesOf } from "../../src/server/users.js";
import type { ScryptParams } from "../../src/server/credentials.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-user-seed-guard-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function groundRoles(name: string): Promise<ReadonlySet<string>> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    return rolesOf(gw.reactor, gw.operator, Date.now(), name);
  } finally {
    await gw.close();
  }
}

describe("T166: loam user remove-role on a malformed operator seed", () => {
  it("refuses without echoing a single byte of the file, and negates nothing", async () => {
    await run(["init", "--home", home], io());
    await run(["user", "create", "alice", "--operator", "--home", home], io(), password("pw"));
    expect(await groundRoles("alice")).toContain("operator");

    const garbage = "not-a-key GARBLE_MARKER_9Q7 =============";
    writeFileSync(userSeedPath(home, "alice"), garbage);
    out.length = 0;
    err.length = 0;

    const code = await run(
      ["user", "remove-role", "alice", "--role=operator", "--home", home],
      io(),
    );
    const all = [...out, ...err].join("\n");
    expect(code).toBe(1);
    expect(all).toContain(userSeedPath(home, "alice"));
    expect(all).toContain("does not hold a 64-hex seed");
    expect(all).toContain("nothing was negated");
    for (const fragment of ["GARBLE_MARKER_9Q7", "not-a-key", "hex string expected"]) {
      expect(all).not.toContain(fragment);
    }

    expect(await groundRoles("alice")).toContain("operator");
  });

  it("CONTROL: a well-formed seed still negates the role as before", async () => {
    await run(["init", "--home", home], io());
    await run(["user", "create", "bob", "--operator", "--home", home], io(), password("pw"));
    const code = await run(["user", "remove-role", "bob", "--role=operator", "--home", home], io());
    expect(code).toBe(0);
    expect(await groundRoles("bob")).not.toContain("operator");
  });
});
