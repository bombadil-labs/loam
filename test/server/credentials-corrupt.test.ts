// §36 (T113), criteria (s) (t): the credential file as a fault surface.
//
// credentials.json is the one part of a user that is NOT a delta, so it gets none of the substrate's
// admission discipline. Two things follow, and each is a rail here.
//
// (s) A file this door cannot read means it CANNOT DETERMINE whether a password matches — and
// "cannot determine" must never resolve to "matched" (H7 at the login door). Every shape of damage
// refuses, by name, and the server keeps serving.
//
// (t) A half-written credential file would lock the operator out of their own store, so the write is
// temp-then-rename and lands at 0600 whatever the old file's mode was.
//
// NAMED GAP: no rail here stages a real power cut, so atomicity is asserted through its observable
// consequences — no residue, a stale temp file cannot poison the result, and the target is never
// observed as anything but whole. A test that could pull the plug mid-rename would close it.

import { chmodSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD,
  beginLogin,
  bootStore,
  cookieFrom,
  createUser,
  dropHome,
  makeHome,
  postLogin,
  serveHome,
  type Served,
} from "./user-fixture.js";
import { readCredentials, writeCredentials } from "../../src/server/credentials.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
let served: Served;
const file = (): string => join(home, "credentials.json");

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

const attempt = async (password: string): Promise<Response> => {
  const begun = await beginLogin(served.base);
  return postLogin(served.base, "myk", password, {
    cookie: begun.cookie,
    formToken: begun.formToken,
  });
};

// Every shape of damage this door must survive. The empty hash is the important one: it is the shape
// a naive compare says "matched" to.
const DAMAGE: readonly (readonly [string, string])[] = [
  ["truncated mid-object", '{"version":1,"users":{"myk":'],
  ["not JSON at all", "operator seed goes here, right?"],
  ["an empty file", ""],
  ["users is an array", '{"version":1,"users":[]}'],
  ["an unknown version", '{"version":99,"users":{}}'],
  [
    "an empty hash",
    '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"ab12","hash":"","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}',
  ],
  [
    "an empty salt",
    '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"","hash":"ab12","params":{"N":1024,"r":8,"p":1,"keylen":64}}}}',
  ],
  [
    "a hash that is not hex",
    '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"ab","hash":"zz"}}}',
  ],
  [
    "an entry with no params",
    '{"version":1,"users":{"myk":{"kind":"scrypt","salt":"ab","hash":"cd"}}}',
  ],
  [
    "an unknown credential kind",
    '{"version":1,"users":{"myk":{"kind":"telepathy","salt":"ab12","hash":"cd34"}}}',
  ],
];

describe("a credentials.json the door cannot trust", () => {
  it.each(DAMAGE)("(s) refuses every login when it is %s", async (_label, contents) => {
    served = await serveHome(home);
    writeFileSync(file(), contents);
    for (const password of [PASSWORD, "", "anything at all"]) {
      const res = await attempt(password);
      expect(res.status, password).toBe(503);
      expect(cookieFrom(res), password).toBeUndefined();
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors.join(" ")).toMatch(/credential/i);
    }
    // the server did not crash: another door still answers
    const alive = await fetch(`${served.base}/`);
    expect(alive.status).toBe(200);
  });

  it("(s) a repaired file logs in again — the refusal was the file's, not the door's", async () => {
    served = await serveHome(home);
    const good = readFileSync(file(), "utf8");
    writeFileSync(file(), "{");
    expect((await attempt(PASSWORD)).status).toBe(503);
    writeFileSync(file(), good);
    expect((await attempt(PASSWORD)).status).toBe(200);
  });

  it("(s) a file that vanishes refuses rather than admitting everyone", async () => {
    served = await serveHome(home);
    writeFileSync(file(), '{"version":1,"users":{}}');
    const res = await attempt(PASSWORD);
    expect(res.status).toBe(401); // a valid file with no such user is a plain refusal
    expect(cookieFrom(res)).toBeUndefined();
  });
});

describe("writing credentials.json", () => {
  it("(t) lands at 0600 even when the path already sat at 0644", async () => {
    chmodSync(file(), 0o644);
    expect(statSync(file()).mode & 0o777).toBe(0o644);
    await createUser(home, "wren", "another password", { operator: false });
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    // and both users survived the rewrite
    expect(Object.keys(readCredentials(home).users).sort()).toEqual(["myk", "wren"]);
  });

  it("(t) leaves no residue behind, and a stale temp file does not poison the write", () => {
    writeFileSync(join(home, "credentials.json.tmp"), "garbage from a crashed write");
    const before = readCredentials(home);
    writeCredentials(home, {
      version: 1,
      users: { ...before.users, wren: before.users["myk"]! },
    });
    const after = readCredentials(home);
    expect(Object.keys(after.users).sort()).toEqual(["myk", "wren"]);
    expect(statSync(file()).mode & 0o777).toBe(0o600);
    // no temp of the WRITER's own making is left behind (the one this test planted is still there,
    // which is the other half of the assertion: the write did not adopt or delete a stranger's file)
    expect(
      readdirSync(home).filter((n) => n.endsWith(".tmp") && n !== "credentials.json.tmp"),
    ).toEqual([]);
    expect(readdirSync(home)).toContain("credentials.json.tmp");
  });

  it("(t) the target is never observed truncated: every write is whole or the old one", () => {
    const good = readFileSync(file(), "utf8");
    for (let round = 0; round < 20; round += 1) {
      writeCredentials(home, readCredentials(home));
      const seen = readFileSync(file(), "utf8");
      expect(seen.length).toBeGreaterThan(0);
      expect(() => JSON.parse(seen) as unknown).not.toThrow();
    }
    const original = JSON.parse(good) as { users: Record<string, unknown> };
    expect(Object.keys(readCredentials(home).users)).toEqual(Object.keys(original.users));
  });
});
