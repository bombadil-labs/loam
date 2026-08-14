// A KEY FILE'S BYTES NEVER REACH THE TERMINAL — §36.3, T166. `loam user remove-role` must derive
// the operator key's author to strike its grants, and a malformed `user.<name>.seed` used to reach
// rhizomatic's hex parser raw: the error quoted characters of the key file back to the caller
// (measured on the pen twin: `hex string expected, got non-hex character "no" at index 0`). The
// repair applies the boot path's own `isSeedHex` test before `authorForSeed`, refuses the whole
// command (H9 — striking the role alone would report a partial success), and prints nothing read
// from the file.
//
// Two-sided: the malformed seed refuses with the cure named and NO planted byte in the output, and
// a well-formed seed still strikes the role exactly as before. (The well-formed flows are pinned by
// the frozen test/cli/user-roles.test.ts; this file owns only the state those rails never stage.)

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

// The suite-wide cheap scrypt: the interactive floor is a login-door property, not this rail's.
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

// The object-level half: what the ground says the user's roles are, read fresh per assertion.
async function groundRoles(name: string): Promise<ReadonlySet<string>> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    return rolesOf(gw.reactor, gw.operator, name);
  } finally {
    await gw.close();
  }
}

describe("T166: loam user remove-role on a malformed operator seed", () => {
  it("refuses without echoing a single byte of the file, and strikes nothing", async () => {
    await run(["init", "--home", home], io());
    await run(["user", "create", "alice", "--operator", "--home", home], io(), password("pw"));
    expect(await groundRoles("alice")).toContain("operator");

    // Garbage with DISTINCTIVE markers: the rail asserts their absence positively, so an error
    // that quoted even a fragment of the file goes red.
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
    expect(all).toContain(userSeedPath(home, "alice")); // the path, so the operator can act
    expect(all).toContain("does not hold a 64-hex seed"); // the rule, in the crafted voice
    expect(all).toContain("nothing was struck");
    for (const fragment of ["GARBLE_MARKER_9Q7", "not-a-key", "hex string expected"]) {
      expect(all).not.toContain(fragment);
    }

    // Object level: the role survives — the refusal really did strike nothing.
    expect(await groundRoles("alice")).toContain("operator");
  });

  it("CONTROL: a well-formed seed still strikes the role as before", async () => {
    await run(["init", "--home", home], io());
    await run(["user", "create", "bob", "--operator", "--home", home], io(), password("pw"));
    const code = await run(["user", "remove-role", "bob", "--role=operator", "--home", home], io());
    expect(code).toBe(0);
    expect(await groundRoles("bob")).not.toContain("operator");
  });
});
