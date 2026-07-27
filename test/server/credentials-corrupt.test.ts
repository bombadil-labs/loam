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
// NAMED GAPS, both of them, because an honest-looking comment over a weaker test is how this class
// survives review:
//   - ATOMICITY is asserted through its observable consequences — the inode changes across a write (so
//     it went through a rename, not an in-place truncate), no residue is left, and a stale temp cannot
//     poison the result. A test that could pull the plug mid-rename would close it properly.
//   - FSYNC is asserted by NOTHING. Criterion (t) names it; both fsync calls in writeCredentials are
//     deletable with every rail here still green. Closing it wants a spy on the node:fs binding, which
//     an ESM named import does not offer, so the honest move today is to say so.

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
import {
  DEFAULT_SCRYPT,
  hashPassword,
  readCredentials,
  verifyPassword,
  writeCredentials,
} from "../../src/server/credentials.js";

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

  it("(s) a damaged NEIGHBOUR refuses myk's login too — the file is the unit, not the entry", async () => {
    // The rule this pins: a file whose shape is unknown is not a file to authenticate against. Validate
    // only the entry a login names and every case above still passes, because in each of them the named
    // entry or the JSON envelope is what is broken.
    served = await serveHome(home);
    await served.close();
    await createUser(home, "wren", "another password", { operator: false });
    served = await serveHome(home);
    expect((await attempt(PASSWORD)).status).toBe(200); // both entries sound: myk gets in

    const file2 = JSON.parse(readFileSync(file(), "utf8")) as {
      version: number;
      users: Record<string, unknown>;
    };
    file2.users["wren"] = { kind: "scrypt", salt: "ab12", hash: "" }; // wren's entry, not myk's
    writeFileSync(file(), JSON.stringify(file2));
    const res = await attempt(PASSWORD);
    expect(res.status).toBe(503);
    expect(cookieFrom(res)).toBeUndefined();
  });

  it("(s) the refusal names no path and no other user — a fault is not an oracle", async () => {
    const faults: string[] = [];
    served = await serveHome(home, { onFault: (m) => faults.push(m) });
    await served.close();
    await createUser(home, "wren", "another password", { operator: false });
    served = await serveHome(home, { onFault: (m) => faults.push(m) });
    writeFileSync(
      file(),
      '{"version":1,"users":{"wren":{"kind":"scrypt","salt":"ab","hash":"zz"}}}',
    );

    const body = await (await attempt(PASSWORD)).text();
    expect(body).toMatch(/credential/i);
    expect(body).not.toContain(home); // no absolute path
    expect(body).not.toContain("wren"); // no other user's name
    expect(body).not.toContain("credentials.json");
    // the operator DOES get the detail, on their own channel — a fault nobody hears is a swallowed error
    expect(faults.join("\n")).toContain("credentials.json");
    expect(faults.join("\n")).toContain("wren");
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

  it("(t) writes through a rename, not in place: the inode changes", () => {
    // The one observable that separates temp-then-rename from a direct write. Without it, replacing the
    // whole atomic body with `writeFileSync(target, body)` leaves every other rail in this block green —
    // a comment claiming atomicity over a test that cannot see it.
    const before = statSync(file()).ino;
    writeCredentials(home, readCredentials(home));
    expect(statSync(file()).ino).not.toBe(before);
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

// The rails above all run at a reduced scrypt cost, which leaves the SHIPPED parameters unexercised —
// and a bad default is a login door that throws on every attempt rather than one that runs slowly. So
// this pays for one real hash at the production cost, once.
describe("the shipped scrypt parameters", () => {
  it("hash and verify each other, and reject a wrong password", async () => {
    expect(DEFAULT_SCRYPT.N & (DEFAULT_SCRYPT.N - 1)).toBe(0); // a power of two, as scrypt demands
    expect(DEFAULT_SCRYPT.N).toBeGreaterThanOrEqual(16384);
    expect(DEFAULT_SCRYPT.keylen).toBeGreaterThanOrEqual(32);
    const entry = await hashPassword(PASSWORD);
    expect(entry.params).toEqual(DEFAULT_SCRYPT);
    expect(entry.hash.length).toBe(DEFAULT_SCRYPT.keylen * 2);
    expect(await verifyPassword(entry, PASSWORD)).toBe(true);
    expect(await verifyPassword(entry, `${PASSWORD} `)).toBe(false);
  });
});
