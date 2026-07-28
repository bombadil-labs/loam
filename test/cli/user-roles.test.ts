// §36 phase 3 (T124): `loam user create|assign-role|remove-role`, driven end to end through
// `run()`. Criteria transcribed from `.adlc/specs/36-03-the-bootstrap-the-role-commands-and-per-
// operator-keys.md`. Ground/grant trust mechanics (the A-I letters that need `dataStruck`/
// `governedGatherBody`) live in `test/server/operator-keys.test.ts` instead — this file asserts
// what the CLI itself does: delta counts, refusals, help text, and the ENOENT/EACCES split.
//
// Deliberately NOT here: `loam user unlock` (deferred whole to phase 9 — `login-locks.ts` does not
// exist on `main` yet, per the working spec's §36.3.1.6). The DOOR half of "a struck role stops a
// live session" (ticket criterion 15) has no door to test against until phase 5.

import { chmodSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, userSeedPath } from "../../src/cli/config.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import {
  credentialsPath,
  readCredentials,
  type ScryptParams,
} from "../../src/server/credentials.js";
import {
  resolveUserView,
  roleClaims,
  rolesOf,
  userClaims,
  type UserRole,
} from "../../src/server/users.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

// A cheap, fixed cost so the suite does not pay the interactive scrypt floor per `create` call.
const CHEAP_SCRYPT: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = (value: string) => ({
  readSecret: () => Promise.resolve(value),
  scrypt: CHEAP_SCRYPT,
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-user-roles-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// A short-lived read-only Gateway over the same store the CLI just wrote — never held open across
// a `run()` call (the store is single-writer).
async function ground(): Promise<{
  reactor: Gateway["reactor"];
  operator: string;
  close: () => Promise<void>;
}> {
  const seed = readSeed(home);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  return { reactor: gateway.reactor, operator: gateway.operator!, close: () => gateway.close() };
}

async function deltaCount(): Promise<number> {
  const g = await ground();
  const n = g.reactor.size;
  await g.close();
  return n;
}

// Appends claims directly to the ground, operator-signed, bypassing every CLI refusal — used for
// fixtures that stand in for a federated pull (the double-grant case; criterion 11 refuses a
// second `assign-role` call, so the CLI itself cannot produce this state).
async function appendDirect(claims: Claims, seed: string): Promise<void> {
  const g = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  await g.append([signClaims(claims, seed)]);
  await g.close();
}

describe("loam user — subcommand routing", () => {
  it("refuses an unknown subcommand", async () => {
    const code = await run(["user", "frobnicate", "alice", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/wants a subcommand/);
  });
});

describe("loam user create", () => {
  it("actor: one credential at 0600, exactly two deltas, no seed file", async () => {
    await run(["init", "--home", home], io());
    const before = await deltaCount(); // 1: the genesis operator marker
    const code = await run(["user", "create", "alice", "--home", home], io(), password("pw"));
    expect(code).toBe(0);
    expect(await deltaCount()).toBe(before + 2);
    if (process.platform !== "win32") {
      expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
    }
    expect(readUserSeed(home, "alice").kind).toBe("absent");
  });

  it("--operator: three deltas (user, role, grant) and a 0600 seed file", async () => {
    await run(["init", "--home", home], io());
    const before = await deltaCount();
    const code = await run(
      ["user", "create", "bob", "--operator", "--home", home],
      io(),
      password("pw"),
    );
    expect(code).toBe(0);
    expect(await deltaCount()).toBe(before + 3);
    expect(readUserSeed(home, "bob").kind).toBe("present");
    if (process.platform !== "win32") {
      expect(statSync(userSeedPath(home, "bob")).mode & 0o777).toBe(0o600);
    }
  });

  it("a second run, once a credential exists, refuses by name and appends nothing", async () => {
    await run(["user", "create", "carol", "--home", home], io(), password("pw"));
    const before = await deltaCount();
    out.length = 0;
    err.length = 0;
    const code = await run(["user", "create", "carol", "--home", home], io(), password("pw2"));
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/already has a credential/);
    expect(await deltaCount()).toBe(before);
  });

  it("REPAIR: ground already holds the role, credential absent — writes only the credential", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("dana", operator, 10), seed);
    await appendDirect(roleClaims("dana", "actor", operator, 11), seed);
    const before = await deltaCount();

    const code = await run(["user", "create", "dana", "--home", home], io(), password("pw"));
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/repaired/);
    expect(await deltaCount()).toBe(before); // nothing new appended
    expect(readCredentials(home).users["dana"]).toBeDefined();
  });

  it("a role MISMATCH refuses and changes nothing, even in repair shape", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("erin", operator, 10), seed);
    await appendDirect(roleClaims("erin", "actor", operator, 11), seed);
    const before = await deltaCount();

    const code = await run(
      ["user", "create", "erin", "--operator", "--home", home],
      io(),
      password("pw"),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/will not change a role/);
    expect(await deltaCount()).toBe(before);
    expect(readCredentials(home).users["erin"]).toBeUndefined();
  });

  it("operator repair with NO local seed file refuses whole rather than reporting a half success", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("finn", operator, 10), seed);
    await appendDirect(roleClaims("finn", "operator", operator, 11), seed);
    await appendDirect(
      grantClaims(STORE_ENTITY, "ed25519:not-a-real-key", "admin", operator, 12),
      seed,
    );
    const before = await deltaCount();

    const code = await run(
      ["user", "create", "finn", "--operator", "--home", home],
      io(),
      password("pw"),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/remove-role finn --role=operator/);
    expect(await deltaCount()).toBe(before);
    expect(readCredentials(home).users["finn"]).toBeUndefined();
  });

  it("no delta anywhere contains the credential's salt or hash — and a planted leak proves the scan can fail", async () => {
    await run(
      ["user", "create", "gwen", "--operator", "--home", home],
      io(),
      password("s3cr3t-p4ss"),
    );
    const entry = readCredentials(home).users["gwen"]!;
    const scanFor = (log: readonly { claims: unknown }[], needle: string): boolean =>
      log.some((d) => JSON.stringify(d.claims).includes(needle));

    const before = await ground();
    expect(scanFor(before.reactor.arrivalLog(), entry.hash)).toBe(false);
    expect(scanFor(before.reactor.arrivalLog(), entry.salt)).toBe(false);
    await before.close();

    // Positive control (H10): plant a fabricated hex string and prove the SAME scan sees it —
    // otherwise the two assertions above could be passing on a scan that cannot fail at all.
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("deadbeef00112233", operator, 999), seed);
    const after = await ground();
    expect(scanFor(after.reactor.arrivalLog(), "deadbeef00112233")).toBe(true);
    await after.close();
  });

  it("--operator=true is a usage error and creates nothing", async () => {
    await run(["init", "--home", home], io());
    const before = await deltaCount();
    const code = await run(
      ["user", "create", "hank", "--operator=true", "--home", home],
      io(),
      password("pw"),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/takes no value/);
    expect(await deltaCount()).toBe(before);
    expect(readCredentials(home).users["hank"]).toBeUndefined();
  });

  it("a name carrying a path separator refuses before any file is touched", async () => {
    const code = await run(
      ["user", "create", "../operator", "--operator", "--home", home],
      io(),
      password("pw"),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/not a user name/);
    expect(readUserSeed(home, "../operator").kind).toBe("absent");
  });

  describe("unusable homes (ticket criterion 7) — create allows only 'missing'", () => {
    it("a missing home bootstraps fine (create allows it, like `serve`/`register`)", async () => {
      const fresh = join(home, "not-yet-created");
      const code = await run(["user", "create", "ivy", "--home", fresh], io(), password("pw"));
      expect(code).toBe(0);
    });

    it("a home that is a plain file refuses, naming the fault", async () => {
      const file = join(home, "a-file");
      writeFileSync(file, "not a directory");
      const code = await run(["user", "create", "jill", "--home", file], io(), password("pw"));
      expect(code).toBe(1);
      expect(err.join("\n")).toMatch(/is not a directory/);
    });

    it.skipIf(process.platform === "win32")(
      "a dangling symlink home refuses, naming the fault",
      async () => {
        const link = join(home, "dangling");
        symlinkSync(join(home, "nowhere"), link);
        const code = await run(["user", "create", "kate", "--home", link], io(), password("pw"));
        expect(code).toBe(1);
        expect(err.join("\n")).toMatch(/symlink to a path that does not exist/);
      },
    );

    // Pins the `&&` in `homeDefect`, not `||`: a symlink LOOP (ELOOP) is a symlink AND a stat
    // failure, exactly like a dangling one, but its target may well exist — reporting it as
    // "does not exist" would be a wrong diagnosis for whoever has to fix it.
    it.skipIf(process.platform === "win32")(
      "a symlink LOOP reports the generic fault, never 'does not exist'",
      async () => {
        const loop = join(home, "loop");
        symlinkSync(loop, loop); // a symlink pointing at itself: ELOOP, not ENOENT
        const code = await run(["user", "create", "loki", "--home", loop], io(), password("pw"));
        expect(code).toBe(1);
        expect(err.join("\n")).not.toMatch(/does not exist/);
        expect(err.join("\n")).toMatch(/could not be checked/);
      },
    );

    it.skipIf(process.platform === "win32")(
      "a sealed directory refuses, naming the fault",
      async () => {
        const sealed = join(home, "sealed");
        await run(["init", "--home", sealed], io());
        chmodSync(sealed, 0o000);
        try {
          const code = await run(
            ["user", "create", "liam", "--home", sealed],
            io(),
            password("pw"),
          );
          expect(code).toBe(1);
          expect(err.join("\n")).toMatch(/sealed/);
        } finally {
          chmodSync(sealed, 0o700); // afterEach's rmSync needs to get back in
        }
      },
    );
  });
});

describe("loam user assign-role", () => {
  it("actor: exactly one delta, no seed, no grant", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("nate", operator, 10), seed);
    const before = await deltaCount();

    const code = await run(["user", "assign-role", "nate", "--role=actor", "--home", home], io());
    expect(code).toBe(0);
    expect(await deltaCount()).toBe(before + 1);
    expect(readUserSeed(home, "nate").kind).toBe("absent");
  });

  it("operator: exactly two deltas (role + grant) and mints a seed file", async () => {
    await run(["init", "--home", home], io());
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(userClaims("olga", operator, 10), seed);
    const before = await deltaCount();

    const code = await run(
      ["user", "assign-role", "olga", "--role=operator", "--home", home],
      io(),
    );
    expect(code).toBe(0);
    expect(await deltaCount()).toBe(before + 2);
    expect(readUserSeed(home, "olga").kind).toBe("present");
  });

  it("refuses a name the ground does not know, and creates no user", async () => {
    await run(["init", "--home", home], io());
    const before = await deltaCount();
    const code = await run(["user", "assign-role", "pat", "--role=actor", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/does not know pat/);
    expect(await deltaCount()).toBe(before);
  });

  it("refuses an unknown role name", async () => {
    await run(["user", "create", "quinn", "--home", home], io(), password("pw"));
    const before = await deltaCount();
    const code = await run(["user", "assign-role", "quinn", "--role=admin", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/not a role this store ships/);
    expect(await deltaCount()).toBe(before);
  });

  it("assigning a role already held appends nothing and says so", async () => {
    await run(["user", "create", "rose", "--home", home], io(), password("pw")); // actor by default
    const before = await deltaCount();
    const code = await run(["user", "assign-role", "rose", "--role=actor", "--home", home], io());
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/already holds actor/);
    expect(await deltaCount()).toBe(before);
  });

  it("recovery: remove-role then assign-role mints a fresh key even after the old grant is gone", async () => {
    await run(["user", "create", "sam", "--operator", "--home", home], io(), password("pw"));
    const firstKeyRead = readUserSeed(home, "sam");
    expect(firstKeyRead.kind).toBe("present");
    const firstKey = firstKeyRead.kind === "present" ? firstKeyRead.seed : "";

    expect(await run(["user", "remove-role", "sam", "--role=operator", "--home", home], io())).toBe(
      0,
    );
    expect(await run(["user", "assign-role", "sam", "--role=operator", "--home", home], io())).toBe(
      0,
    );

    const secondKeyRead = readUserSeed(home, "sam");
    expect(secondKeyRead.kind).toBe("present");
    expect(secondKeyRead.kind === "present" ? secondKeyRead.seed : "").not.toBe(firstKey);

    const g = await ground();
    expect(rolesOf(g.reactor, g.operator, "sam").has("operator")).toBe(true);
    await g.close();
  });
});

describe("loam user remove-role", () => {
  it("appends a NEGATION of the role claim — never deletes a delta", async () => {
    await run(["user", "create", "tara", "--home", home], io(), password("pw"));
    await run(["user", "assign-role", "tara", "--role=operator", "--home", home], io());
    const before = await ground();
    const roleDeltaId = before.reactor
      .arrivalLog()
      .find(
        (d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "role" && p.target.kind === "primitive" && p.target.value === "operator",
          ) &&
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.id === "user:tara",
          ),
      )!.id;
    await before.close();

    const code = await run(
      ["user", "remove-role", "tara", "--role=operator", "--home", home],
      io(),
    );
    expect(code).toBe(0);
    const after = await ground();
    expect(after.reactor.get(roleDeltaId)).toBeDefined(); // the delta itself still exists
    expect(after.reactor.negationsOf(roleDeltaId).length).toBeGreaterThan(0);
    expect(rolesOf(after.reactor, after.operator, "tara").has("operator")).toBe(false);
    await after.close();
  });

  it("a role not held is an idempotent no-op — appends nothing", async () => {
    await run(["user", "create", "uma", "--home", home], io(), password("pw")); // actor only
    const before = await deltaCount();
    const code = await run(["user", "remove-role", "uma", "--role=operator", "--home", home], io());
    expect(code).toBe(0);
    expect(err.join("\n")).toBe("");
    expect(out.join("\n")).toMatch(/does not hold operator/);
    expect(await deltaCount()).toBe(before);
  });

  it("double-grant case: two surviving role claims, one remove-role strikes BOTH", async () => {
    await run(["user", "create", "vic", "--home", home], io(), password("pw"));
    await run(["user", "assign-role", "vic", "--role=operator", "--home", home], io());
    // A second `operator` claim, appended DIRECTLY — `assign-role` would refuse the retry
    // (criterion 11), which is exactly why a federated pull is the scenario this fixture covers.
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    await appendDirect(roleClaims("vic", "operator", operator, 99999), seed);

    const mid = await ground();
    expect(rolesOf(mid.reactor, mid.operator, "vic").has("operator")).toBe(true); // held through the 2nd claim
    await mid.close();

    const code = await run(["user", "remove-role", "vic", "--role=operator", "--home", home], io());
    expect(code).toBe(0);
    const after = await ground();
    expect(rolesOf(after.reactor, after.operator, "vic").has("operator")).toBe(false);
    await after.close();
  });

  it("removing one role leaves the other intact; removing every role leaves a readable, roleless user", async () => {
    await run(["user", "create", "wade", "--operator", "--home", home], io(), password("pw"));
    await run(["user", "assign-role", "wade", "--role=actor", "--home", home], io());
    let g = await ground();
    expect(rolesOf(g.reactor, g.operator, "wade")).toEqual(
      new Set<UserRole>(["operator", "actor"]),
    );
    await g.close();

    await run(["user", "remove-role", "wade", "--role=operator", "--home", home], io());
    g = await ground();
    expect(rolesOf(g.reactor, g.operator, "wade")).toEqual(new Set<UserRole>(["actor"]));
    await g.close();

    await run(["user", "remove-role", "wade", "--role=actor", "--home", home], io());
    g = await ground();
    expect(rolesOf(g.reactor, g.operator, "wade")).toEqual(new Set());
    expect(resolveUserView(g.reactor, g.operator, "wade")).toBeDefined(); // still a readable user
    await g.close();
  });

  it("the last operator may remove their own role and reassign it — home access alone", async () => {
    await run(["user", "create", "xena", "--operator", "--home", home], io(), password("pw"));
    expect(
      await run(["user", "remove-role", "xena", "--role=operator", "--home", home], io()),
    ).toBe(0);
    let g = await ground();
    expect(rolesOf(g.reactor, g.operator, "xena").has("operator")).toBe(false);
    await g.close();

    expect(
      await run(["user", "assign-role", "xena", "--role=operator", "--home", home], io()),
    ).toBe(0);
    g = await ground();
    expect(rolesOf(g.reactor, g.operator, "xena").has("operator")).toBe(true);
    await g.close();
  });

  it("SEED ABSENT: strikes the role, names the un-struck grant, still succeeds", async () => {
    await run(["user", "create", "yara", "--operator", "--home", home], io(), password("pw"));
    rmSync(userSeedPath(home, "yara"));

    const code = await run(
      ["user", "remove-role", "yara", "--role=operator", "--home", home],
      io(),
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/could not be located/);
    const g = await ground();
    expect(rolesOf(g.reactor, g.operator, "yara").has("operator")).toBe(false);
    await g.close();
  });

  it.skipIf(process.platform === "win32")(
    "SEED UNREADABLE (EACCES): refuses the whole command — strikes nothing",
    async () => {
      await run(["user", "create", "zane", "--operator", "--home", home], io(), password("pw"));
      chmodSync(userSeedPath(home, "zane"), 0o000);
      const before = await deltaCount();
      try {
        const code = await run(
          ["user", "remove-role", "zane", "--role=operator", "--home", home],
          io(),
        );
        expect(code).toBe(1);
        expect(err.join("\n")).toMatch(/could not be read/);
        expect(await deltaCount()).toBe(before);
        const g = await ground();
        expect(rolesOf(g.reactor, g.operator, "zane").has("operator")).toBe(true); // untouched
        await g.close();
      } finally {
        chmodSync(userSeedPath(home, "zane"), 0o600);
      }
    },
  );
});
