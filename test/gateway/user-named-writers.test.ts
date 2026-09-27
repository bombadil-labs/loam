// The writers name the USER (step 5, PR 3d-ii C): provisioning's write grant, and a bound
// connection's owner admin grant in its inbox pool, name `user:<name>`, so they follow the user's
// current root. Each case asks the delta (what the grant names) and the door (which key it
// authorizes). A writer names the user only when the user's root resolves to the key it would
// otherwise name; else it names the key, as before.
//
// Recovery itself (`loam user recover`) is 3e; the re-point here is the operator's root claim.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { dataStruck, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { ensureUserKey } from "../../src/server/provision.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONN_SEED = "d7".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const OTHER_SEED = "d8".repeat(32);
const K2_SEED = "e2".repeat(32);
const K2 = authorForSeed(K2_SEED);

const op = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

// A host where ada is a user whose root is the gardener's key, and bea is a user with no root.
async function home(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { channelBackend: () => new MemoryBackend() },
  );
  await gw.append([
    op(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500)),
    op(userClaims("ada", OP, 501)),
    op(rootClaims("ada", GARDENER, OP, 501)),
    op(userClaims("bea", OP, 502)),
  ]);
  await gw.append([
    op(
      containerClaims(
        {
          container: "home:ada",
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
            in: "input",
          },
        },
        OP,
        600,
      ),
    ),
  ]);
  return gw;
}

const bind = async (gw: Gateway, seed: string, ownerName?: string): Promise<Gateway> => {
  const inbox = (
    await gw.bindConnection({
      container: "home:ada",
      connectionKey: authorForSeed(seed),
      ownerSeed: GARDENER_SEED,
      ...(ownerName === undefined ? {} : { ownerName }),
    })
  ).entity!;
  return gw.connectionInboxes.get(inbox)!.gateway!;
};

const adminSubjects = (pool: Gateway): unknown[] =>
  [...pool.reactor.snapshot()]
    .filter(
      (d) =>
        d.claims.pointers.some(
          (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === "admin",
        ) && d.claims.author === OP,
    )
    .map((d) => {
      const s = d.claims.pointers.find((p) => p.role === "subject")?.target;
      return s?.kind === "primitive" ? s.value : undefined;
    });

async function door(ground: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await ground.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

describe("bind names the owner by user when their root is the owner's key", () => {
  it("the admin grant names user:ada, and the door reads it as the gardener's", async () => {
    const gw = await home();
    const pool = await bind(gw, CONN_SEED, "ada");
    expect(adminSubjects(pool)).toEqual(["user:ada"]);
    expect(holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, GARDENER, "admin", OP)).toBe(
      true,
    );
    expect(await door(pool, observed(FERN, "height", 1, 1000, CONN_SEED))).toBe("admitted");
    await gw.close();
  });

  it("R11: a user with no root, or a root that is not the owner, gets the key (the fallback)", async () => {
    const gw = await home();
    const noRoot = await bind(gw, CONN_SEED, "bea");
    expect(adminSubjects(noRoot)).toEqual([GARDENER]);
    const gw2 = await home();
    await gw2.append([op(rootClaims("ada", K2, OP, 700))]);
    const otherRoot = await bind(gw2, CONN_SEED, "ada");
    expect(adminSubjects(otherRoot)).toEqual([GARDENER]);
    expect(await door(otherRoot, observed(FERN, "height", 1, 1000, CONN_SEED))).toBe("admitted");
    await gw.close();
    await gw2.close();
  });
});

describe("R3: a re-point moves the user-named grant, and nothing else carries over", () => {
  it("the new root holds admin; the old key and its connection lose it", async () => {
    const gw = await home();
    const pool = await bind(gw, CONN_SEED, "ada");
    const bystanderPool = await bind(gw, OTHER_SEED);
    await gw.append([op(rootClaims("ada", K2, OP, 800))]);
    const now = pool.validityNow();
    expect(holdsGrant(pool.reactor, now, STORE_ENTITY, K2, "admin", OP)).toBe(true);
    expect(holdsGrant(pool.reactor, now, STORE_ENTITY, GARDENER, "admin", OP)).toBe(false);
    // The connection wrote by the OLD root's delegation; a recovered user re-authorizes (PLAN).
    expect(await door(pool, observed(FERN, "height", 2, 1001, CONN_SEED))).toBe("refused");
    // Bystander: a connection bound without a user name keeps the gardener's key grant, and writes.
    expect(await door(bystanderPool, observed(FERN, "height", 3, 1002, OTHER_SEED))).toBe(
      "admitted",
    );
    await gw.close();
  });
});

describe("R4 (M5, a control: it held before the writers switched): a connection's own strike does not count; the root's does", () => {
  it("in the inbox pool, as data", async () => {
    const gw = await home();
    const pool = await bind(gw, CONN_SEED, "ada");
    const a = observed(FERN, "height", 1, 1000, CONN_SEED);
    const b = observed(FERN, "height", 2, 1001, CONN_SEED);
    await pool.append([a, b]);
    await pool.federate([
      signClaims(makeNegationClaims(CONN, 1100, a.id), CONN_SEED),
      signClaims(makeNegationClaims(GARDENER, 1101, b.id), GARDENER_SEED),
    ]);
    expect(pool.reactor.negationsOf(a.id)).toHaveLength(1);
    const struck = dataStruck(pool.reactor, pool.validityNow(), OP);
    expect(struck(a.id)).toBe(false);
    expect(struck(b.id)).toBe(true);
    await gw.close();
  });
});

describe("provisioning names the user", () => {
  it("ensureUserKey's write grant names user:<name>, and the minted key writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-user-named-"));
    temps.push(dir);
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
    await gw.append([op(userClaims("cy", OP, 10))]);
    const made = await ensureUserKey(gw, dir, "cy", () => {});
    if (!("userSeed" in made)) throw new Error("provisioning refused");
    const key = authorForSeed(made.userSeed);
    const writes = [...gw.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === "write",
      ),
    );
    expect(
      writes.map((d) => {
        const s = d.claims.pointers.find((p) => p.role === "subject")?.target;
        return s?.kind === "primitive" ? s.value : undefined;
      }),
    ).toEqual(["user:cy"]);
    expect(holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, key, "write", OP)).toBe(true);
    await gw.close();
  });

  it("R11: a user with no record gets a grant naming the key, and the key writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-user-named-"));
    temps.push(dir);
    const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
    const made = await ensureUserKey(gw, dir, "dee", () => {});
    if (!("userSeed" in made)) throw new Error("provisioning refused");
    const key = authorForSeed(made.userSeed);
    const subjects = [...gw.reactor.snapshot()]
      .filter((d) =>
        d.claims.pointers.some(
          (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === "write",
        ),
      )
      .map((d) => {
        const s = d.claims.pointers.find((p) => p.role === "subject")?.target;
        return s?.kind === "primitive" ? s.value : undefined;
      });
    expect(subjects).toEqual([key]);
    expect(holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, key, "write", OP)).toBe(true);
    await gw.close();
  });
});
