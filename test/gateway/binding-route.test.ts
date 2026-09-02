// T262 — a request that carries a §58 binding lands in the connection's inbox pool and reads over
// the container its consent named, at the LIBRARY seam (SPEC §58, S1b/S1c). Railed at both levels:
// which reactor holds the bytes (the pool's, never the primary's) AND what a reader resolves
// through the Plant lens with and without the binding. Two-sided wherever something is refused or
// retracted: a named bystander — the owner's own primary claim — survives every one.
//
// Deliberately NOT here: the doors. `contextFor`, the raw `/append` door, whoami and the exchange
// pass or withhold the binding in their own rails (`test/server/connection-writes.test.ts`,
// `test/server/read-scope.test.ts`). A channel lens under a binding is refused in `gatherImpl`; it
// needs a live federation channel to reach and is exercised beside the channel rails, not here.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims, inboxName, type Container } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway, type ConnectionBinding } from "../../src/gateway/gateway.js";
import { lensOf } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const OWNER_SEED = GARDENER_SEED;
const OWNER = GARDENER;
const CONN_SEED = "c3".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const HOME = "home:alice";
const MOSS = "plant:moss";
const OAK = "plant:oak";

// The home container IS its membership: everything the owner authors, by key.
const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

async function home(): Promise<{ gw: Gateway; inbox: Container; binding: ConnectionBinding }> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        { container: HOME, trust: "curated", posture: "shared", membership: ALICES_OWN },
        OP,
        600,
      ),
      OP_SEED,
    ),
    // The owner's own claim, a member of the home: the bystander every case below keeps.
    observed(FERN, "height", 30, 1000, OWNER_SEED),
  ]);
  const inbox = await gw.bindConnection({
    container: HOME,
    connectionKey: CONN,
    ownerSeed: OWNER_SEED,
  });
  // The connection holds NO grant on the primary: the pool's own chain is its only standing.
  return { gw, inbox, binding: { container: HOME, inbox: inbox.entity! } };
}

const byConn = (gw: Gateway): Delta[] =>
  [...gw.reactor.snapshot()].filter((d) => d.claims.author === CONN);
const isNegation = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");
// Every height claim a reactor holds, whoever signed it: the pool's seeded copy carries the
// operator's provisioning, so "nothing landed" is asked of the DATA, not of the author.
const heightClaimsIn = (gw: Gateway): Delta[] =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === "height",
    ),
  );

const bound = (gw: Gateway, binding: ConnectionBinding, asOf?: number) =>
  gw.resolvedNode("Plant", FERN, asOf, undefined, binding).view;
const plain = (gw: Gateway) => gw.resolvedNode("Plant", FERN).view;

describe("T262 — a bound write lands in the inbox pool, never the primary", () => {
  it("mutate: the pool holds the claim, the primary holds nothing of the key's; each read answers its own ground", async () => {
    const { gw, inbox, binding } = await home();
    const node = await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    expect(node.view["height"]).toBe(7);

    // Delta level: exactly one delta of the key's, in the POOL's reactor; none in the primary's.
    const pooled = byConn(inbox.gateway!);
    expect(pooled).toHaveLength(1);
    expect(pooled[0]!.claims.pointers.some((p) => p.target.kind === "primitive")).toBe(true);
    expect(byConn(gw)).toEqual([]);
    // Object level: the bound read composes the pool; the operator's plain read never sees it.
    expect(bound(gw, binding)["height"]).toBe(7);
    expect(plain(gw)["height"]).toBe(30);
    await gw.close();
  });

  it("the GraphQL door threads the binding from the request context into the pool", async () => {
    const { gw, inbox, binding } = await home();
    const written = await gw.query(
      `mutation { plant(entity: "${FERN}", tag: "pooled") { tag } }`,
      undefined,
      { actor: CONN_SEED, binding },
    );
    expect(written.errors).toBeUndefined();
    expect((written.data as { plant: { tag: string[] } }).plant.tag).toEqual(["pooled"]);
    expect(byConn(inbox.gateway!)).toHaveLength(1);
    expect(byConn(gw)).toEqual([]);
    // The query door reads through the same context: bound sees the tag, plain does not.
    const boundRead = await gw.query(`{ plant(entity: "${FERN}") { tag height } }`, undefined, {
      actor: CONN_SEED,
      binding,
    });
    expect(boundRead.data).toEqual({ plant: { tag: ["pooled"], height: 30 } });
    const plainRead = await gw.query(`{ plant(entity: "${FERN}") { tag height } }`);
    expect(plainRead.data).toEqual({ plant: { tag: null, height: 30 } });
    await gw.close();
  });

  it("the REST door threads the binding: POST lands in the pool, GET reads over the scope", async () => {
    const { gw, inbox, binding } = await home();
    const posted = await handleRest(
      gw,
      "full",
      "POST",
      ["v1", "Plant", FERN],
      JSON.stringify({ height: 11 }),
      CONN_SEED,
      undefined,
      binding,
    );
    expect(posted.status).toBe(200);
    expect((posted.body as { view: { height: number } }).view.height).toBe(11);
    expect(byConn(inbox.gateway!)).toHaveLength(1);
    expect(byConn(gw)).toEqual([]);
    const withBinding = await handleRest(
      gw,
      "full",
      "GET",
      ["v1", "Plant", FERN],
      undefined,
      CONN_SEED,
      undefined,
      binding,
    );
    expect((withBinding.body as { view: { height: number } }).view.height).toBe(11);
    const without = await handleRest(gw, "full", "GET", ["v1", "Plant", FERN], undefined);
    expect((without.body as { view: { height: number } }).view.height).toBe(30);
    await gw.close();
  });

  it("a binding with no actor is refused before anything is signed — the operator never writes into a pool", async () => {
    const { gw, inbox, binding } = await home();
    await expect(gw.mutateEntity("Plant", FERN, { height: 1 }, undefined, binding)).rejects.toThrow(
      /names no actor/,
    );
    expect(heightClaimsIn(inbox.gateway!)).toEqual([]); // nothing was signed into the pool
    expect(plain(gw)["height"]).toBe(30); // no operator-signed 1 landed in the primary either
    await gw.close();
  });

  it("an inbox that is not attached refuses, and nothing falls back to the primary", async () => {
    const { gw, inbox, binding } = await home();
    const nobody = { container: HOME, inbox: inboxName(HOME, "nobody") };
    await expect(gw.mutateEntity("Plant", FERN, { height: 1 }, CONN_SEED, nobody)).rejects.toThrow(
      /not attached here, so this write is refused/,
    );
    // After a drop the real binding meets the same refusal: the pool is gone, not replaced.
    await inbox.drop();
    await expect(gw.mutateEntity("Plant", FERN, { height: 2 }, CONN_SEED, binding)).rejects.toThrow(
      /refused/,
    );
    expect(byConn(gw)).toEqual([]);
    expect(plain(gw)["height"]).toBe(30);
    await gw.close();
  });

  it("a pool mid-drop — unregistered, its handle still held — refuses until the drop settles", async () => {
    const { gw, inbox, binding } = await home();
    const name = inbox.entity!;
    const live = gw.attachedContainers.get(name)!;
    gw.attachedContainers.delete(name);
    await expect(gw.mutateEntity("Plant", FERN, { height: 3 }, CONN_SEED, binding)).rejects.toThrow(
      /being dropped, so this write is refused/,
    );
    gw.attachedContainers.set(name, live);
    await gw.mutateEntity("Plant", FERN, { height: 4 }, CONN_SEED, binding);
    expect(byConn(inbox.gateway!)).toHaveLength(1);
    await gw.close();
  });
});

describe("T262 — a bound retraction strikes only the connection's own pool claims", () => {
  it("clear: the pool holds the negation, the owner's primary claim stands, the primary holds no strike", async () => {
    const { gw, inbox, binding } = await home();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    const cleared = await gw.gqlHooks().clear("Plant", FERN, ["height"], CONN_SEED, binding);
    // Object level: the pick falls back to the owner's 30 — the bystander survives the clear.
    expect(cleared.view["height"]).toBe(30);
    expect(bound(gw, binding)["height"]).toBe(30);
    // Delta level: one claim and one negation, both the key's, both in the pool; nothing primary.
    const pooled = byConn(inbox.gateway!);
    expect(pooled).toHaveLength(2);
    expect(pooled.filter(isNegation)).toHaveLength(1);
    expect(byConn(gw)).toEqual([]);
    expect([...gw.reactor.snapshot()].filter(isNegation)).toEqual([]);
    await gw.close();
  });

  it("remove: only the matching own value is withdrawn; the other own tag stands", async () => {
    const { gw, inbox, binding } = await home();
    await gw.mutateEntity("Plant", FERN, { tag: "a" }, CONN_SEED, binding);
    await gw.mutateEntity("Plant", FERN, { tag: "b" }, CONN_SEED, binding);
    expect(bound(gw, binding)["tag"]).toEqual(["a", "b"]);
    const node = await gw.gqlHooks().remove("Plant", FERN, "tag", ["a"], CONN_SEED, binding);
    expect(node.view["tag"]).toEqual(["b"]);
    expect(byConn(inbox.gateway!).filter(isNegation)).toHaveLength(1);
    expect(byConn(gw)).toEqual([]);
    await gw.close();
  });

  it("a strike the owner lands in the PRIMARY binds on a pool claim (H1) — the bound read does not revive it", async () => {
    const { gw, inbox, binding } = await home();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    const claim = byConn(inbox.gateway!)[0]!;
    await gw.append([
      signClaims(
        {
          timestamp: gw.nextTimestamp(),
          author: OWNER,
          pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: claim.id } } }],
        },
        OWNER_SEED,
      ),
    ]);
    expect(bound(gw, binding)["height"]).toBe(30);
    await gw.close();
  });
});

describe("T262 — a bound read resolves over the container's scope, never the whole store", () => {
  it("a claim outside the container is invisible to the bound read and visible to the plain read", async () => {
    const { gw, binding } = await home();
    // The operator's claim is nobody's member: not the owner's, not in any pool.
    await gw.append([observed(FERN, "height", 99, 5000, OP_SEED)]);
    expect(plain(gw)["height"]).toBe(99);
    expect(bound(gw, binding)["height"]).toBe(30); // the owner's member is the positive control
    expect(gw.gqlHooks().resolve("Plant", FERN, undefined, binding).view["height"]).toBe(30);
    await gw.close();
  });

  it("a time pin rides the bound read, live and pinned alike", async () => {
    const { gw, inbox, binding } = await home();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    const at = byConn(inbox.gateway!)[0]!.claims.timestamp;
    expect(bound(gw, binding, at - 1)["height"]).toBe(30);
    expect(bound(gw, binding, at)["height"]).toBe(7);
    const reg = gw.registered.find((r) => lensOf(r) === "Plant")!;
    expect(gw.resolvePinned(reg, FERN, undefined, undefined, binding).view["height"]).toBe(7);
    expect(gw.resolvePinned(reg, FERN, at - 1, undefined, binding).view["height"]).toBe(30);
    expect(gw.resolvePinned(reg, FERN).view["height"]).toBe(30); // the plain pinned read: no pool
    await gw.close();
  });

  it("a bound listing pages the scope only; the plain listing still sees the whole store", async () => {
    const { gw, binding } = await home();
    await gw.mutateEntity("Plant", MOSS, { tag: "pooled" }, CONN_SEED, binding);
    await gw.append([observed(OAK, "height", 1, 5000, OP_SEED)]); // outside every scope
    const scoped = (await gw.list("Plant", {}, binding)).map((n) => n.entity);
    expect(scoped).toEqual([FERN, MOSS]);
    const listed = await gw.query(`{ plants(limit: 10) { _entity tag } }`, undefined, {
      actor: CONN_SEED,
      binding,
    });
    expect(listed.data).toEqual({
      plants: [
        { _entity: FERN, tag: null },
        { _entity: MOSS, tag: ["pooled"] },
      ],
    });
    expect((await gw.list("Plant")).map((n) => n.entity)).toEqual([FERN, OAK]);
    await gw.close();
  });

  it("a bound subscribe is refused: no materialization stands over a connection's scope", async () => {
    const { gw, binding } = await home();
    await expect(
      gw.subscribe(`subscription { plant(entity: "${FERN}") { height } }`, undefined, {
        actor: CONN_SEED,
        binding,
      }),
    ).rejects.toThrow(/a bound connection cannot subscribe/);
    await gw.close();
  });
});
