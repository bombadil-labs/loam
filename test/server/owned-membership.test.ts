// Provisioned containers name their user (step 5, 3g). Delta level: the declaration's membership is
// `loam.memberOf` for a user the store resolves by name, and the key form for one it cannot. Object
// level: the home gathers what the user writes, and after a recovery it gathers the new key's writes
// and the old key's earlier ones, never the old key's later ones.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { channelBackendFor, run } from "../../src/cli/cli.js";
import { readSeed, readUserSeed, storePath, writeUserSeed } from "../../src/cli/config.js";
import { recoverUser } from "../../src/cli/user-recover.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { authoredBy } from "../../src/gateway/membership.js";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { declareOwned, ownedMembership } from "../../src/server/provision.js";
import type { ScryptParams } from "../../src/server/credentials.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";

let home: string;
const io = { out: () => {}, err: () => {} };
const CHEAP: ScryptParams = { N: 16, r: 1, p: 1, keylen: 16 };
const password = { readSecret: () => Promise.resolve("pw"), scrypt: CHEAP };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-owned-membership-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function ground<T>(fn: (gw: Gateway) => T | Promise<T>): Promise<T> {
  const gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: readSeed(home) }),
    { channelBackend: channelBackendFor(home, io) },
  );
  try {
    return await fn(gw);
  } finally {
    await gw.close();
  }
}
const seedOf = (name: string): string => {
  const r = readUserSeed(home, name);
  if (r.kind !== "present") throw new Error(`${name} has a key file`);
  return r.seed;
};
const declareHome = (name: string) =>
  ground(async (gw) => {
    const faults: string[] = [];
    expect(
      await declareOwned(gw, name, { user: name, seed: seedOf(name) }, undefined, (m) =>
        faults.push(m),
      ),
    ).toBeUndefined();
    expect(faults).toEqual([]);
    return gw.containers().containers.get(name)!.membership;
  });
const write = (seed: string, value: number) =>
  ground(async (gw) => {
    const d = observed(FERN, "height", value, gw.stamp(authorForSeed(seed)).timestamp, seed);
    await gw.append([d]);
    return d;
  });
const gathered = (name: string) =>
  ground((gw) => {
    const term = gw.containers().containers.get(name)!.membership!;
    return new Set(gw.select(term).map((d: Delta) => d.id));
  });

describe("provisioned containers name their user", () => {
  it("a user made by `user create` gets a home in the user form, and it follows a recovery", async () => {
    expect(await run(["init", "--home", home], io)).toBe(0);
    expect(await run(["user", "create", "ada", "--operator", "--home", home], io, password)).toBe(
      0,
    );
    const k1Seed = seedOf("ada");
    expect(await declareHome("ada")).toEqual(writtenByUser("ada", "ada"));
    const before = await write(k1Seed, 1);
    expect((await gathered("ada")).has(before.id)).toBe(true);

    expect(
      await recoverUser({
        home,
        name: "ada",
        replaceSeed: true,
        storePath: storePath(home),
        io,
        openBackend: (path) => new SqliteBackend(path),
        channelBackend: channelBackendFor(home, io),
      }),
    ).toBe(0);
    const byK2 = await write(seedOf("ada"), 2);
    const home2 = await gathered("ada");
    expect([home2.has(byK2.id), home2.has(before.id)]).toEqual([true, true]);
  });

  it("a known user's retired key file is refused, never pinned: no container, no suggestion", async () => {
    expect(await run(["init", "--home", home], io)).toBe(0);
    expect(await run(["user", "create", "ada", "--operator", "--home", home], io, password)).toBe(
      0,
    );
    const k1Seed = seedOf("ada");
    expect(
      await recoverUser({
        home,
        name: "ada",
        replaceSeed: true,
        storePath: storePath(home),
        io,
        openBackend: (path) => new SqliteBackend(path),
        channelBackend: channelBackendFor(home, io),
      }),
    ).toBe(0);
    await ground(async (gw) => {
      expect(ownedMembership(gw, { user: "ada", seed: k1Seed }, "ada:old")).toHaveProperty(
        "refusal",
      );
      const faults: string[] = [];
      const refused = await declareOwned(gw, "ada:old", { user: "ada", seed: k1Seed }, "ada", (m) =>
        faults.push(m),
      );
      expect(refused?.status).toBe(409);
      expect(faults.join("\n")).toMatch(/not their current key/);
      expect(gw.containers().containers.has("ada:old")).toBe(false);
    });
  });

  it("a user the store cannot resolve by name keeps the key form, which still gathers their writes", async () => {
    expect(await run(["init", "--home", home], io)).toBe(0);
    const seed = "cc".repeat(32);
    writeUserSeed(home, "cal", seed); // a key file, and no user record
    expect(await declareHome("cal")).toEqual(authoredBy(authorForSeed(seed)));
  });
});
