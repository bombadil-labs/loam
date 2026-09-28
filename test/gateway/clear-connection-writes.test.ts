// An owner's clear reaches what her connections wrote (step 5 PR 3i; README ruling 8, M2 and M5).
// Delta level: which strikes land in which ground, signed by whom. Object level: what the bound
// read of the entity resolves. Keys a root ever delegated to in a pool count as hers there; only her
// current root signs the strikes.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { delegationClaims } from "../../src/gateway/principal.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const SEEDS = { ada: "a1", bea: "b1", conn: "c1", conn2: "c2", beaConn: "c3", stray: "c4" };
const seed = (k: keyof typeof SEEDS) => SEEDS[k].repeat(32);
const key = (k: keyof typeof SEEDS) => authorForSeed(seed(k));
const op = (c: Claims): Delta => signClaims(c, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
  vi.restoreAllMocks();
});

// ada and bea, each with a home and connections bound by name.
async function world() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  open.push(gw);
  let t = 10;
  for (const user of ["ada", "bea"] as const) {
    await gw.append([
      op(userClaims(user, OP, t++)),
      op(rootClaims(user, key(user), OP, t++)),
      op(grantClaims(STORE_ENTITY, `user:${user}`, "write", OP, t++)),
      op(
        containerClaims(
          {
            container: `home:${user}`,
            trust: "curated",
            posture: "shared",
            membership: writtenByUser(user, `home:${user}`),
          },
          OP,
          t++,
        ),
      ),
    ]);
  }
  const bind = async (user: "ada" | "bea", conn: keyof typeof SEEDS) => {
    const h = await gw.bindConnection({
      container: `home:${user}`,
      connectionKey: key(conn),
      ownerSeed: seed(user),
      ownerName: user,
    });
    const binding: ConnectionBinding = { container: `home:${user}`, inbox: h.entity! };
    return { name: h.entity!, pool: h.gateway!, binding };
  };
  return { gw, bind };
}
const write = async (g: Gateway, who: keyof typeof SEEDS, value: number) => {
  const d = observed(FERN, "height", value, g.stamp(key(who)).timestamp, seed(who));
  await g.append([d]);
  return d;
};
const strikesOf = (g: Gateway, id: string) =>
  g.reactor.negationsOf(id).map((n) => g.reactor.get(n)!.claims.author);
const heightFor = (gw: Gateway, binding: ConnectionBinding) =>
  (gw.resolvedNode("Plant", FERN, undefined, undefined, binding).view as Record<string, unknown>)
    .height;
const clear = (gw: Gateway, who: keyof typeof SEEDS, binding?: ConnectionBinding) =>
  gw.gqlHooks().clear("Plant", FERN, ["height"], seed(who), binding);

describe("an owner's clear fans out to her connections' writes", () => {
  it("strikes, in her pool and signed by her root, what her connection wrote; bea's are untouched", async () => {
    const { gw, bind } = await world();
    const ada = await bind("ada", "conn");
    const bea = await bind("bea", "beaConn");
    const byConn = await write(ada.pool, "conn", 7);
    const byBeaConn = await write(bea.pool, "beaConn", 9);
    expect(heightFor(gw, ada.binding)).toBe(7);
    await clear(gw, "ada");
    expect(strikesOf(ada.pool, byConn.id)).toEqual([key("ada")]);
    expect(strikesOf(bea.pool, byBeaConn.id)).toEqual([]);
    expect(heightFor(gw, ada.binding)).toBeUndefined();
    expect(heightFor(gw, bea.binding)).toBe(9);
  });

  it("M2: a revoked connection's write and an expired delegation's write are hers to clear", async () => {
    const { gw, bind } = await world();
    const one = await bind("ada", "conn");
    const two = await bind("ada", "conn2");
    const revoked = await write(one.pool, "conn", 3);
    const expiring = await write(two.pool, "conn2", 4);
    await gw.revokeConnection({
      inbox: gw.connectionInboxes.get(one.name)!,
      connectionKey: key("conn"),
      ownerSeed: seed("ada"),
    });
    // conn2's only delegation is replaced by one that has already ended.
    const [open2] = two.pool.reactor
      .arrivalLog()
      .filter(
        (d) => d.claims.author === key("ada") && d.claims.pointers.some((p) => p.role === "key"),
      );
    const t = two.pool.stamp(key("ada")).timestamp;
    await two.pool.append([
      signClaims(
        { ...delegationClaims(key("ada"), key("conn2"), two.name, t - 5), validUntil: t - 1 },
        seed("ada"),
      ),
      signClaims(makeNegationClaims(key("ada"), t, open2!.id), seed("ada")),
    ]);
    await clear(gw, "ada");
    expect(strikesOf(one.pool, revoked.id)).toEqual([key("ada")]);
    expect(strikesOf(two.pool, expiring.id)).toEqual([key("ada")]);
  });

  it("a malformed, unsigned or wrong-scope delegation makes no key hers", async () => {
    const { gw, bind } = await world();
    const one = await bind("ada", "conn");
    const stray = observed(FERN, "height", 5, 50, seed("stray"));
    expect(one.pool.reactor.ingest(stray).status).toBe("accepted"); // planted past the door
    const t = 60;
    const wrongScope = signClaims(delegationClaims(key("ada"), key("stray"), "*", t), seed("ada"));
    const extraPointer = signClaims(
      {
        ...delegationClaims(key("ada"), key("stray"), one.name, t + 1),
        pointers: [
          ...delegationClaims(key("ada"), key("stray"), one.name, t + 1).pointers,
          { role: "note", target: { kind: "primitive", value: "x" } },
        ],
      },
      seed("ada"),
    );
    const unsigned = {
      ...signClaims(delegationClaims(key("ada"), key("stray"), one.name, t + 2), seed("ada")),
      sig: "00",
    };
    for (const d of [wrongScope, extraPointer, unsigned]) one.pool.reactor.ingest(d);
    await clear(gw, "ada");
    expect(strikesOf(one.pool, stray.id)).toEqual([]);
  });

  it("remove fans out too, with its value predicate", async () => {
    const { gw, bind } = await world();
    const ada = await bind("ada", "conn");
    const seven = await write(ada.pool, "conn", 7);
    const eight = await write(ada.pool, "conn", 8);
    await gw.gqlHooks().remove("Plant", FERN, "height", [7], seed("ada"));
    expect([strikesOf(ada.pool, seven.id), strikesOf(ada.pool, eight.id)]).toEqual([
      [key("ada")],
      [],
    ]);
  });

  it("a clear by the connection's own key does not fan out", async () => {
    const { gw, bind } = await world();
    const one = await bind("ada", "conn");
    const two = await bind("ada", "conn2");
    const mine = await write(one.pool, "conn", 1);
    const sibling = await write(two.pool, "conn2", 2);
    await clear(gw, "conn", one.binding);
    expect([strikesOf(one.pool, mine.id), strikesOf(two.pool, sibling.id)]).toEqual([
      [key("conn")],
      [],
    ]);
  });
});

describe("preflight and partial work", () => {
  it("an unattached inbox beside an owned one refuses before any strike, in the host or a pool", async () => {
    const { gw, bind } = await world();
    const ada = await bind("ada", "conn");
    const byAda = await write(gw, "ada", 1);
    const byConn = await write(ada.pool, "conn", 2);
    await gw.append([
      op(
        containerClaims(
          {
            container: "inbox:home:ada:lost",
            trust: "curated",
            posture: "separate",
            inboxOf: "home:ada",
          },
          OP,
          90,
        ),
      ),
    ]);
    await expect(clear(gw, "ada")).rejects.toThrow(
      /refused before anything was signed: the inbox pools inbox:home:ada:lost \(not attached\)/,
    );
    expect([strikesOf(gw, byAda.id), strikesOf(ada.pool, byConn.id)]).toEqual([[], []]);
  });

  it("the preflight is the owner's: a connection's own clear ignores an unattached inbox outside its scope", async () => {
    const { gw, bind } = await world();
    const one = await bind("ada", "conn");
    const mine = await write(one.pool, "conn", 1);
    await gw.append([
      op(
        containerClaims(
          {
            container: "inbox:home:bea:lost",
            trust: "curated",
            posture: "separate",
            inboxOf: "home:bea",
          },
          OP,
          90,
        ),
      ),
    ]);
    await clear(gw, "conn", one.binding);
    expect(strikesOf(one.pool, mine.id)).toEqual([key("conn")]);
  });

  it("a pool append that fails is reported; a rerun finishes without a second strike", async () => {
    const { gw, bind } = await world();
    const one = await bind("ada", "conn");
    const two = await bind("ada", "conn2");
    const byAda = await write(gw, "ada", 1);
    const a = await write(one.pool, "conn", 2);
    const b = await write(two.pool, "conn2", 3);
    vi.spyOn(two.pool, "append").mockRejectedValueOnce(new Error("the disk is full"));
    await expect(clear(gw, "ada")).rejects.toThrow(
      new RegExp(
        `partial: it landed in this store and in ${one.name}, and failed in ${two.name} \\(the disk is full\\)`,
      ),
    );
    expect([strikesOf(gw, byAda.id), strikesOf(one.pool, a.id), strikesOf(two.pool, b.id)]).toEqual(
      [[key("ada")], [key("ada")], []],
    );
    await clear(gw, "ada");
    expect([strikesOf(gw, byAda.id), strikesOf(one.pool, a.id), strikesOf(two.pool, b.id)]).toEqual(
      [[key("ada")], [key("ada")], [key("ada")]],
    );
  });
});
