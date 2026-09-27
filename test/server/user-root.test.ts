// The user record names the user's current root key (README ruling 5). Every road that mints a user
// a key writes the pointer beside the grant: `ensureUserKey`, `loam user create --operator`,
// and `loam user assign-role --role=operator`. Each case asks two levels: the delta the ground holds
// (an operator-signed `loam.root` claim naming the key) and what `rootOf` resolves.
//
// Nothing reads `rootOf` for standing yet; step 5 PR 3d does. Erasure stays with every store here
// in its own temp dir or in memory.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath } from "../../src/cli/config.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { ensureUserKey } from "../../src/server/provision.js";
import { CTX_ROOT, rootClaims, rootOf, roleClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import type { ScryptParams } from "../../src/server/credentials.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1 = authorForSeed("a1".repeat(32));
const K2 = authorForSeed("a2".repeat(32));
const WRITER_SEED = "b3".repeat(32);
const WRITER = authorForSeed(WRITER_SEED);

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-user-root-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const rootRecords = (reactor: Reactor, name: string): Delta[] =>
  [...reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === `user:${name}` &&
        p.target.entity.context === CTX_ROOT,
    ),
  );

async function store(): Promise<Gateway> {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  await gw.append([
    signClaims(userClaims("ada", OP, 10), OP_SEED),
    signClaims(roleClaims("ada", "actor", OP, 11), OP_SEED),
    signClaims(grantClaims(STORE_ENTITY, WRITER, "write", OP, 12), OP_SEED),
  ]);
  return gw;
}

const at = (gw: Gateway, name: string) => rootOf(gw.reactor, OP, gw.validityNow(), name);

describe("rootOf reads the operator's latest pointer", () => {
  it("absent until the operator names a root; then that root", async () => {
    const gw = await store();
    expect(at(gw, "ada")).toBeUndefined();
    await gw.append([signClaims(rootClaims("ada", K1, OP, 20), OP_SEED)]);
    expect(at(gw, "ada")).toBe(K1);
    expect(at(gw, "bea")).toBeUndefined(); // a user with no record has no root
    await gw.close();
  });

  it("a re-point wins, and the earlier pointer stays in the ground as history", async () => {
    const gw = await store();
    await gw.append([signClaims(rootClaims("ada", K1, OP, 20), OP_SEED)]);
    await gw.append([signClaims(rootClaims("ada", K2, OP, 21), OP_SEED)]);
    expect(at(gw, "ada")).toBe(K2);
    expect(rootRecords(gw.reactor, "ada")).toHaveLength(2);
    await gw.close();
  });

  it("a pointer anyone else signs names nobody's root, even from a writer with standing", async () => {
    const gw = await store();
    await gw.append([signClaims(rootClaims("ada", K1, OP, 20), OP_SEED)]);
    const forged = signClaims(rootClaims("ada", WRITER, WRITER, 30), WRITER_SEED);
    await gw.append([forged]); // the door admits it as ordinary data
    expect(gw.reactor.get(forged.id)).toBeDefined();
    expect(at(gw, "ada")).toBe(K1);
    await gw.close();
  });

  it("the operator strikes the current pointer; the one before it reads again", async () => {
    const gw = await store();
    await gw.append([signClaims(rootClaims("ada", K1, OP, 20), OP_SEED)]);
    const second = signClaims(rootClaims("ada", K2, OP, 21), OP_SEED);
    await gw.append([second]);
    await gw.append([signClaims(makeNegationClaims(OP, 22, second.id), OP_SEED)]);
    expect(at(gw, "ada")).toBe(K1);
    await gw.close();
  });

  it("a pointer that names something other than a key resolves to no root", async () => {
    const gw = await store();
    await gw.append([signClaims(rootClaims("ada", "user:ada", OP, 20), OP_SEED)]);
    expect(at(gw, "ada")).toBeUndefined();
    await gw.close();
  });
});

describe("every road that mints a user a key names it as their root", () => {
  it("ensureUserKey writes the grant and the root pointer together", async () => {
    const gw = await store();
    const minted = await ensureUserKey(gw, home, "ada", () => undefined);
    expect("userSeed" in minted).toBe(true);
    const key = authorForSeed((minted as { userSeed: string }).userSeed);
    const [record, ...more] = rootRecords(gw.reactor, "ada");
    expect(more).toEqual([]);
    expect(record!.claims.author).toBe(OP);
    expect(at(gw, "ada")).toBe(key);
    // A second call finds the seed present and writes nothing more.
    await ensureUserKey(gw, home, "ada", () => undefined);
    expect(rootRecords(gw.reactor, "ada")).toHaveLength(1);
    await gw.close();
  });

  const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
  const io = () => ({ out: () => undefined, err: () => undefined });
  const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };
  const cliRoot = async (name: string) => {
    const gw = await Gateway.boot(
      new SqliteBackend(storePath(home)),
      assembleGenesis({ operatorSeed: readSeed(home) }),
    );
    const root = rootOf(gw.reactor, gw.operator, gw.validityNow(), name);
    await gw.close();
    return root;
  };

  it("`loam user create --operator` names the minted key; an actor gets no root", async () => {
    expect(await run(["init", "--home", home], io())).toBe(0);
    expect(await run(["user", "create", "ada", "--operator", "--home", home], io(), password)).toBe(
      0,
    );
    const seed = readUserSeed(home, "ada");
    expect(seed.kind).toBe("present");
    expect(await cliRoot("ada")).toBe(authorForSeed((seed as { seed: string }).seed));
    expect(await run(["user", "create", "bea", "--home", home], io(), password)).toBe(0);
    expect(await cliRoot("bea")).toBeUndefined();
  });

  it("`loam user assign-role --role=operator` re-points the root to the fresh key", async () => {
    expect(await run(["init", "--home", home], io())).toBe(0);
    expect(await run(["user", "create", "ada", "--home", home], io(), password)).toBe(0);
    expect(await cliRoot("ada")).toBeUndefined();
    expect(await run(["user", "assign-role", "ada", "--role=operator", "--home", home], io())).toBe(
      0,
    );
    const seed = readUserSeed(home, "ada");
    expect(await cliRoot("ada")).toBe(authorForSeed((seed as { seed: string }).seed));
  });
});
