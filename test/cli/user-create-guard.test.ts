// `loam user create <name>` refuses while held claims would pass to a new person given the entity
// `user:<name>` (refactor/audit/user-identity.md). The existing check (the account's own record,
// roles and root) is unchanged and railed elsewhere; these rails pin what it ADDS: a grant naming the
// entity, a membership naming the user, and recovery evidence at the entity. Each refusal writes
// nothing; a similar but different name is not caught.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { recoveryClaims } from "../../src/gateway/user-root.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import { SqliteBackend } from "../../src/store/sqlite.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };
const K1 = authorForSeed("f1".repeat(32));
const K2 = authorForSeed("f2".repeat(32));

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-create-guard-"));
  out.length = 0;
  err.length = 0;
  expect(await run(["init", "--home", home], io)).toBe(0);
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Append operator-signed claims to the store, and return what each became.
async function plant(build: (op: string, t: number) => Claims[]): Promise<string[]> {
  const seed = readSeed(home);
  const op = authorForSeed(seed);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    const deltas = build(op, gw.stamp(op).timestamp).map((c) => signClaims(c, seed));
    await gw.append(deltas);
    return deltas.map((d) => d.id);
  } finally {
    await gw.close();
  }
}
const size = async (): Promise<number> => {
  const seed = readSeed(home);
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  try {
    return gw.reactor.size;
  } finally {
    await gw.close();
  }
};
async function refused(ids: string[]): Promise<void> {
  const before = await size();
  expect(await run(["user", "create", "ada", "--home", home], io, password)).toBe(2);
  const said = err.join("\n");
  expect(said).toMatch(/still named by held claims/);
  for (const id of ids) expect(said).toContain(id);
  expect(await size()).toBe(before);
}

describe("user create refuses what would pass to a new person", () => {
  it("a grant naming user:ada, with no record left", async () => {
    await refused(await plant((op, t) => [grantClaims(STORE_ENTITY, "user:ada", "write", op, t)]));
  });

  it("a grant naming user:ada that is struck (a strike can lapse)", async () => {
    const [grant] = await plant((op, t) => [grantClaims(STORE_ENTITY, "user:ada", "write", op, t)]);
    await plant((op, t) => [makeNegationClaims(op, t, grant!)]);
    await refused([grant!]);
  });

  it("a container membership naming ada", async () => {
    await refused(
      await plant((op, t) => [
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: writtenByUser("ada", "inbox:x"),
          },
          op,
          t,
        ),
      ]),
    );
  });

  it("recovery evidence at user:ada", async () => {
    await refused(
      await plant((op, t) => {
        return [
          recoveryClaims(
            { name: "ada", attempt: "a", previous: K1, root: K2, retired: [K1] },
            op,
            t,
          ),
        ];
      }),
    );
  });
});

describe("a similar but different name is not caught (a control)", () => {
  it("claims naming user:adam do not block creating ada", async () => {
    await plant((op, t) => [
      grantClaims(STORE_ENTITY, "user:adam", "write", op, t),
      containerClaims(
        {
          container: "home:adam",
          trust: "curated",
          posture: "shared",
          membership: writtenByUser("adam", "inbox:x"),
        },
        op,
        t + 1,
      ),
    ]);
    expect(await run(["user", "create", "ada", "--home", home], io, password)).toBe(0);
  });
});
