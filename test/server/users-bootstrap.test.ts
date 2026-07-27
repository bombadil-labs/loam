// §36 (T113), criteria (a) (b) (c) (v): the bootstrap CLI.
//
// `loam user create <name> --operator` writes ONE credential entry into the home and appends
// EXACTLY TWO deltas to the ground — the user record and the role binding — both signed by the
// operator seed. It is the one place the two homes of a user meet, so this file asserts at both
// levels: what the store holds in deltas and in bytes, and what a reader resolves through the
// Schema into a View.
//
// What it deliberately does NOT assert: that erasing a user record removes the credential entry.
// It does not, by design (§36 "Deferred, named"), and users-erasure-honesty.test.ts pins the
// report that says so.

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, canonicalHex, signClaims } from "@bombadil/rhizomatic";
import { readSeed, storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import {
  CTX_ROLE,
  CTX_USER,
  resolveUserView,
  roleClaims,
  roleOf,
  userEntity,
  userNameDefect,
} from "../../src/server/users.js";
import { readCredentials } from "../../src/server/credentials.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import {
  PASSWORD,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  serveHome,
  signIn,
  storeDeltas,
} from "./user-fixture.js";

vi.setConfig({ testTimeout: 20000 });

// An author the operator grants ordinary write standing — everything an app author has, and nothing more.
const STRANGER_SEED = "57".repeat(32);
const STRANGER = authorForSeed(STRANGER_SEED);

let home: string;
beforeEach(async () => {
  home = makeHome();
  await bootStore(home); // genesis lands FIRST, so a create's own count is exactly its own
});
afterEach(() => {
  dropHome(home);
});

// A pointer filed at `entity` under `context`, and the primitive it carries.
const filedValue = (
  delta: { claims: { pointers: readonly unknown[] } },
  entity: string,
  context: string,
): string | undefined => {
  type P = {
    role: string;
    target:
      | { kind: "entity"; entity: { id: string; context: string } }
      | { kind: "primitive"; value: unknown };
  };
  const pointers = delta.claims.pointers as readonly P[];
  const filed = pointers.some(
    (p) =>
      p.target.kind === "entity" &&
      p.target.entity.id === entity &&
      p.target.entity.context === context,
  );
  if (!filed) return undefined;
  const value = pointers.find((p) => p.target.kind === "primitive");
  return value?.target.kind === "primitive" ? String(value.target.value) : undefined;
};

// Every form a secret could take on the way into the ground or the store file. The hex STRING is the
// form the credential file holds, so its ASCII is the likely leak; the decoded bytes are the form a
// `bytes` target would carry. Both, for each secret, at both levels.
const secretNeedles = (entry: {
  salt: string;
  hash: string;
}): readonly (readonly [string, Buffer])[] => [
  ["salt (as text)", Buffer.from(entry.salt, "utf8")],
  ["salt (decoded)", Buffer.from(entry.salt, "hex")],
  ["hash (as text)", Buffer.from(entry.hash, "utf8")],
  ["hash (decoded)", Buffer.from(entry.hash, "hex")],
  ["the password", Buffer.from(PASSWORD, "utf8")],
];

// Which secrets this delta's canonical bytes carry, by name. Empty is the answer every delta must give.
const leaks = (
  delta: { claims: { author: string; timestamp: number; pointers: readonly unknown[] } },
  entry: { salt: string; hash: string },
): string[] => {
  const canonical = Buffer.from(canonicalHex(delta.claims as never), "hex");
  return secretNeedles(entry)
    .filter(([, needle]) => canonical.includes(needle))
    .map(([what]) => what);
};

describe("loam user create — the bootstrap door", () => {
  it("(a) writes a 0600 credential entry and appends exactly two operator-signed deltas", async () => {
    const before = await storeDeltas(home);
    const { code, io } = await createUser(home, "myk", PASSWORD);
    expect(code, io.err.join("\n")).toBe(0);

    // the home half: one entry, scrypt-shaped, mode 0600, and NOT the password
    const file = join(home, "credentials.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const entry = readCredentials(home).users["myk"];
    expect(entry?.kind).toBe("scrypt");
    expect(entry?.salt).toMatch(/^[0-9a-f]{32,}$/);
    expect(entry?.hash).toMatch(/^[0-9a-f]{64,}$/);
    expect(readFileSync(file, "utf8")).not.toContain(PASSWORD);

    // the ground half: EXACTLY two deltas, both the operator's
    const after = await storeDeltas(home);
    expect(after.length - before.length).toBe(2);
    const operator = authorForSeed(readSeed(home));
    const fresh = after.filter((d) => !before.some((b) => b.id === d.id));
    expect(fresh.map((d) => d.claims.author)).toEqual([operator, operator]);

    // one is the user record, one is the role binding — and nothing else came along
    const entity = userEntity("myk");
    expect(
      fresh.map((d) => filedValue(d, entity, CTX_USER)).filter((v) => v !== undefined),
    ).toEqual(["myk"]);
    expect(
      fresh.map((d) => filedValue(d, entity, CTX_ROLE)).filter((v) => v !== undefined),
    ).toEqual(["operator"]);
  });

  it("(b) refuses a second create of the same name and appends nothing", async () => {
    expect((await createUser(home, "myk", PASSWORD)).code).toBe(0);
    const before = await storeDeltas(home);
    const firstEntry = readFileSync(join(home, "credentials.json"), "utf8");

    const second = await createUser(home, "myk", "a different password entirely");
    expect(second.code).toBe(2);
    expect(second.io.err.join("\n")).toMatch(/myk/);
    expect(second.io.err.join("\n")).toMatch(/already/i);

    // nothing moved: not the ground, not the credential entry
    expect((await storeDeltas(home)).length).toBe(before.length);
    expect(readFileSync(join(home, "credentials.json"), "utf8")).toBe(firstEntry);
  });

  it("(b) a create after the credential is removed appends NOTHING — one user, one record", async () => {
    // The dangerous shape this closes: a second user-record pair for the same name. The operator then
    // erases one record, `pickLatest` resolves the other, and the login door stays open on a user they
    // ordered forgotten — while the erasure report says it settled. The claims carry a fresh timestamp,
    // so a re-append is NOT the same delta by content address; only asking the ground prevents it.
    expect((await createUser(home, "myk", PASSWORD)).code).toBe(0);
    const before = await storeDeltas(home);

    // the credential file is where this command's own guard lives, so take the guard away
    writeFileSync(join(home, "credentials.json"), JSON.stringify({ version: 1, users: {} }));
    const again = await createUser(home, "myk", "a brand new password");
    expect(again.code, again.io.err.join("\n")).toBe(0);
    expect(again.io.out.join("\n")).toMatch(/nothing was appended/);

    // the ground did not grow, and the new password is the one that works
    expect((await storeDeltas(home)).length).toBe(before.length);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      const view = resolveUserView(gateway.reactor, gateway.operator, "myk") as Record<
        string,
        unknown
      >;
      expect(view[CTX_ROLE]).toBe("operator");
    } finally {
      await gateway.close();
    }
  });

  it("(b) a record with no readable role refuses too, and still appends nothing", async () => {
    // The guard asks whether the RECORD is there, not what role reads from it. Asking `roleOf` instead
    // would answer undefined here — the record stands, the role does not read — and append a second
    // record, which is the duplicate the guard exists to prevent.
    expect((await createUser(home, "myk", PASSWORD)).code).toBe(0);
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      const roleDelta = (await storeDeltas(home)).find(
        (d) => filedValue(d, userEntity("myk"), CTX_ROLE) === "operator",
      );
      // the operator retires their own role binding, leaving the record standing and no role readable
      await gateway.append([
        signClaims(
          {
            timestamp: Date.now(),
            author: operator,
            pointers: [
              { role: "negates", target: { kind: "delta", deltaRef: { delta: roleDelta!.id } } },
            ],
          },
          seed,
        ),
      ]);
      expect(resolveUserView(gateway.reactor, operator, "myk")).toBeDefined();
      expect(roleOf(gateway.reactor, operator, "myk")).toBeUndefined();
    } finally {
      await gateway.close();
    }

    const before = await storeDeltas(home);
    writeFileSync(join(home, "credentials.json"), JSON.stringify({ version: 1, users: {} }));
    const again = await createUser(home, "myk", PASSWORD);
    expect(again.code).toBe(2);
    expect(again.io.err.join("\n")).toMatch(/no readable role binding/);
    expect((await storeDeltas(home)).length).toBe(before.length);
    expect(existsSync(join(home, "credentials.json"))).toBe(true);
    expect(readCredentials(home).users["myk"]).toBeUndefined();
  });

  it("(b) a create that asks for a different role than the ground holds refuses", async () => {
    expect((await createUser(home, "wren", PASSWORD, { operator: false })).code).toBe(0);
    const before = await storeDeltas(home);
    writeFileSync(join(home, "credentials.json"), JSON.stringify({ version: 1, users: {} }));

    const escalate = await createUser(home, "wren", PASSWORD); // --operator, over an actor
    expect(escalate.code).toBe(2);
    expect(escalate.io.err.join("\n")).toMatch(/will not change a role/);
    expect((await storeDeltas(home)).length).toBe(before.length);
  });

  it("(b) refuses when the two password prompts disagree, and writes nothing at all", async () => {
    const before = await storeDeltas(home);
    const result = await createUser(home, "myk", PASSWORD, { confirm: "typo" });
    expect(result.code).toBe(2);
    expect(result.io.err.join("\n")).toMatch(/did not match/i);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
    expect((await storeDeltas(home)).length).toBe(before.length);
  });

  it("(c) no delta and no store byte carries the salt or the hash, after bootstrap and a login", async () => {
    await createUser(home, "myk", PASSWORD);
    const entry = readCredentials(home).users["myk"]!;
    const served = await serveHome(home);
    try {
      await signIn(served.base); // one real login, so a login-time write would be caught too
    } finally {
      await served.close();
    }

    // ENCODINGS ARE THE WHOLE DIFFICULTY HERE. `salt` and `hash` are hex STRINGS in the file, so a
    // delta that leaked one would carry the ASCII of that string — and a search for the DECODED bytes
    // would never find it. So every secret is looked for in both forms, at both levels, and `leaks`
    // below is exercised against a deliberate leak so it cannot go quietly blind.
    const deltas = await storeDeltas(home);
    expect(deltas.length).toBeGreaterThan(2);
    for (const delta of deltas) expect(leaks(delta, entry), delta.id).toEqual([]);

    // object level, the other direction: the store FILE itself, in bytes. A delta scan alone cannot see
    // a store that holds the secret somewhere a reader does not look.
    const bytes = readFileSync(storePath(home));
    for (const [what, needle] of secretNeedles(entry)) {
      expect(bytes.includes(needle), `${what} in the store file`).toBe(false);
    }
  });

  it("(c) and the scan that says so can SEE a leak — the same check, over a planted one", async () => {
    // Without this, criterion (c) rests on a search whose encoding nobody has ever verified. A rail
    // that has never gone red has proven nothing.
    await createUser(home, "myk", PASSWORD);
    const entry = readCredentials(home).users["myk"]!;
    const seed = readSeed(home);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      // the exact mistake §36 exists to prevent: the credential entry, appended into the ground
      await gateway.append([
        signClaims(
          {
            timestamp: Date.now(),
            author: authorForSeed(seed),
            pointers: [
              {
                role: "user",
                target: { kind: "entity", entity: { id: userEntity("myk"), context: CTX_USER } },
              },
              { role: "hash", target: { kind: "primitive", value: entry.hash } },
            ],
          },
          seed,
        ),
      ]);
    } finally {
      await gateway.close();
    }
    const planted = (await storeDeltas(home)).flatMap((d) => leaks(d, entry));
    expect(planted).toContain("hash (as text)");
    const bytes = readFileSync(storePath(home));
    expect(bytes.includes(Buffer.from(entry.hash, "utf8"))).toBe(true);
  });

  it("(v) the user record and role binding resolve through the reading into a View", async () => {
    await createUser(home, "myk", PASSWORD);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      const view = resolveUserView(gateway.reactor, gateway.operator, "myk") as Record<
        string,
        unknown
      >;
      expect(view[CTX_USER]).toBe("myk");
      expect(view[CTX_ROLE]).toBe("operator");
      // a name nobody created resolves to no user at all — absence is absence, not a default
      expect(resolveUserView(gateway.reactor, gateway.operator, "nobody")).toBeUndefined();
    } finally {
      await gateway.close();
    }
  });
});

// A ROLE BINDING IS ONLY THE OPERATOR'S WORD. It is filed at an ordinary entity in an ordinary
// context, so it has no grant shape for the constitutional gate to recognise and nothing refuses it at
// the append door: any author holding ordinary write standing may sign one. If the reading counted every
// author and picked the latest claim, that author could name themselves — or anyone — an operator.
//
// Two-sided, because one side alone cannot see this: the forged claim must not bind, AND the operator's
// own binding must still resolve. A reading that returned undefined for everyone would pass half of it.
describe("who may say what role a user holds", () => {
  it("counts only the operator's claim, and a write-grantee's later claim binds nothing", async () => {
    await createUser(home, "wren", "a password", { operator: false });
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      expect(roleOf(gateway.reactor, operator, "wren")).toBe("actor");

      // a stranger with ordinary write standing — the grant is the operator's, the forgery is not
      await gateway.append([
        signClaims(grantClaims(STORE_ENTITY, STRANGER, "write", operator, 9101), seed),
      ]);
      const forged = signClaims(
        roleClaims("wren", "operator", STRANGER, Date.now() + 60_000),
        STRANGER_SEED,
      );
      const receipt = await gateway.append([forged]);
      expect(receipt.accepted, "the append door takes it: nothing there refuses this shape").toBe(
        1,
      );

      // the READING is what refuses. wren is still an actor, and the operator's word still resolves.
      expect(roleOf(gateway.reactor, operator, "wren")).toBe("actor");
      const view = resolveUserView(gateway.reactor, operator, "wren") as Record<string, unknown>;
      expect(view[CTX_USER]).toBe("wren");
      expect(view[CTX_ROLE]).toBe("actor");
    } finally {
      await gateway.close();
    }
  });

  it("counts only the operator's STRIKES too — a write-grantee cannot delete a role binding", async () => {
    // The other axis, and it needs its own rail: narrowing whose CLAIMS count leaves whose STRIKES bind
    // wide open. The wider data posture honours every operator-grantee's negation, so the party who
    // could no longer forge a role could still retract one — a lockout rather than an escalation, and
    // no better. Two-sided: the stranger's strike is inert AND the operator's own strike binds.
    await createUser(home, "myk", PASSWORD);
    const seed = readSeed(home);
    const operator = authorForSeed(seed);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: seed }),
    );
    try {
      await gateway.append([
        signClaims(grantClaims(STORE_ENTITY, STRANGER, "write", operator, 9201), seed),
      ]);
      const roleDelta = (await storeDeltas(home)).find(
        (d) => filedValue(d, userEntity("myk"), CTX_ROLE) === "operator",
      );
      expect(roleDelta).toBeDefined();

      // the stranger strikes the operator's own role binding
      await gateway.append([
        signClaims(
          {
            timestamp: Date.now(),
            author: STRANGER,
            pointers: [
              { role: "negates", target: { kind: "delta", deltaRef: { delta: roleDelta!.id } } },
            ],
          },
          STRANGER_SEED,
        ),
      ]);
      expect(roleOf(gateway.reactor, operator, "myk")).toBe("operator"); // inert

      // the operator's own strike is not
      await gateway.append([
        signClaims(
          {
            timestamp: Date.now() + 1,
            author: operator,
            pointers: [
              { role: "negates", target: { kind: "delta", deltaRef: { delta: roleDelta!.id } } },
            ],
          },
          seed,
        ),
      ]);
      expect(roleOf(gateway.reactor, operator, "myk")).toBeUndefined();
    } finally {
      await gateway.close();
    }
  });

  it("has no ungoverned form: with no operator, there is no user and no role", async () => {
    await createUser(home, "myk", PASSWORD);
    const gateway = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    try {
      expect(resolveUserView(gateway.reactor, undefined, "myk")).toBeUndefined();
      expect(roleOf(gateway.reactor, undefined, "myk")).toBeUndefined();
    } finally {
      await gateway.close();
    }
  });
});

// A user name reaches three places that each have their own idea of a dangerous character: an entity
// id in the ground, a key in a JSON object, and text on an HTML page. The policy is one regular
// expression, so it earns a rail of its own — a mutation probe found nothing else pinning it.
describe("what may be a user name", () => {
  it("accepts the shapes the ground and the page can both carry", () => {
    for (const name of ["myk", "wren", "7of9", "a", "a.b", "a-b", "a_b", "x".repeat(64)]) {
      expect(userNameDefect(name), name).toBeUndefined();
    }
  });

  it("refuses everything else, and the bootstrap door refuses with it", async () => {
    const bad = ["", "Myk", "a b", "a/b", "../etc", "__proto__", "user:myk", "x".repeat(65), "-a"];
    for (const name of bad) {
      expect(userNameDefect(name), name).toBeDefined();
    }
    const refused = await createUser(home, "Myk", PASSWORD);
    expect(refused.code).toBe(2);
    expect(refused.io.err.join("\n")).toMatch(/user name/i);
    expect(existsSync(join(home, "credentials.json"))).toBe(false);
  });
});
