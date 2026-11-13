import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { type Container } from "../../src/gateway/container.js";
import { containerClaims, CTX_CONTAINER, inboxName } from "../../src/gateway/container-law.js";
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
const SEPARATE = "home:alice-vault";
const PEER_SEED = "b7".repeat(32);
const MOSS = "plant:moss";
const OAK = "plant:oak";

const ALICES_OWN = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OWNER } },
  in: "input",
};

const strikeBy = (gw: Gateway, target: string, author: string, seed: string): Delta =>
  signClaims(
    {
      ...gw.stamp(author),
      author,
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: target } } }],
    },
    seed,
  );
const strikeOf = (gw: Gateway, target: string): Delta => strikeBy(gw, target, OWNER, OWNER_SEED);

const bootStore = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

async function home(): Promise<{ gw: Gateway; inbox: Container; binding: ConnectionBinding }> {
  const gw = await bootStore();
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
    observed(FERN, "height", 30, 1000, OWNER_SEED),
  ]);
  const inbox = await gw.bindConnection({
    container: HOME,
    connectionKey: CONN,
    ownerSeed: OWNER_SEED,
  });
  return { gw, inbox, binding: { container: HOME, inbox: inbox.entity! } };
}

async function separateHome(): Promise<{
  gw: Gateway;
  inbox: Container;
  binding: ConnectionBinding;
}> {
  const gw = await bootStore();
  await gw.append([signClaims(grantClaims(STORE_ENTITY, OWNER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        { container: SEPARATE, trust: "curated", posture: "separate", membership: ALICES_OWN },
        OP,
        600,
      ),
      OP_SEED,
    ),
    observed(FERN, "height", 30, 1000, OWNER_SEED),
  ]);
  await gw.openContainer({ name: SEPARATE });
  const inbox = await gw.bindConnection({
    container: SEPARATE,
    connectionKey: CONN,
    ownerSeed: OWNER_SEED,
  });
  return { gw, inbox, binding: { container: SEPARATE, inbox: inbox.entity! } };
}

const byConn = (gw: Gateway): Delta[] =>
  [...gw.reactor.snapshot()].filter((d) => d.claims.author === CONN);
const isNegation = (d: Delta): boolean => d.claims.pointers.some((p) => p.role === "negates");
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

    const pooled = byConn(inbox.gateway!);
    expect(pooled).toHaveLength(1);
    expect(pooled[0]!.claims.pointers.some((p) => p.target.kind === "primitive")).toBe(true);
    expect(byConn(gw)).toEqual([]);
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
    expect(heightClaimsIn(inbox.gateway!)).toEqual([]);
    expect(plain(gw)["height"]).toBe(30);
    await gw.close();
  });

  it("an inbox that is not attached refuses, and nothing falls back to the primary", async () => {
    const { gw, inbox, binding } = await home();
    const nobody = { container: HOME, inbox: inboxName(HOME, "nobody") };
    await expect(gw.mutateEntity("Plant", FERN, { height: 1 }, CONN_SEED, nobody)).rejects.toThrow(
      /not attached here, so this write is refused/,
    );
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
    expect(cleared.view["height"]).toBe(30);
    expect(bound(gw, binding)["height"]).toBe(30);
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
    expect(bound(gw, binding)["height"]).toBe(7);
    const claim = byConn(inbox.gateway!)[0]!;
    await gw.append([strikeOf(gw, claim.id)]);
    expect(bound(gw, binding)["height"]).toBe(30);
    await gw.close();
  });

  it("a SEPARATE bound container: the scope admits the struck claim, and the read still refuses it", async () => {
    const { gw, inbox, binding } = await separateHome();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    expect(bound(gw, binding)["height"]).toBe(7);
    const claim = byConn(inbox.gateway!)[0]!;
    await gw.append([strikeOf(gw, claim.id)]);

    expect(gw.connectionScope({ bound: SEPARATE }).map((d) => d.id)).toContain(claim.id);
    expect(bound(gw, binding)["height"]).toBe(30);
    expect(inbox.gateway!.reactor.get(claim.id)).toBeDefined();
    await gw.close();
  });

  it("a strike chain three links deep still suppresses: a strike binds unless it is itself struck", async () => {
    const { gw, inbox, binding } = await separateHome();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    const claim = byConn(inbox.gateway!)[0]!;

    const n1 = strikeOf(gw, claim.id);
    await gw.append([n1]);
    expect(bound(gw, binding)["height"]).toBe(30);
    const n2 = strikeOf(gw, n1.id);
    await gw.append([n2]);
    expect(bound(gw, binding)["height"]).toBe(7);
    await gw.append([strikeOf(gw, n2.id)]);
    expect(bound(gw, binding)["height"]).toBe(30);
    await gw.close();
  });

  it("a write refuses when the container the connection is bound to no longer stands", async () => {
    const { gw, inbox, binding } = await home();
    await gw.mutateEntity("Plant", FERN, { height: 7 }, CONN_SEED, binding);
    const before = byConn(inbox.gateway!).length;

    const declaration = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "container" &&
          p.target.kind === "entity" &&
          p.target.entity.id === HOME &&
          p.target.entity.context === CTX_CONTAINER,
      ),
    )!;
    expect(declaration, "the home's declaration was not found").toBeDefined();
    await gw.append([strikeBy(gw, declaration.id, OP, OP_SEED)]);
    expect(gw.containers().containers.has(HOME)).toBe(false);

    await expect(gw.mutateEntity("Plant", FERN, { height: 9 }, CONN_SEED, binding)).rejects.toThrow(
      /no longer stands/,
    );
    expect(byConn(inbox.gateway!).length).toBe(before);
    expect(
      heightClaimsIn(inbox.gateway!).some((d) =>
        d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === 9),
      ),
    ).toBe(false);
    await gw.close();
  });

  it("a channel's lens under a binding is refused — that pool is outside the connection's scope", async () => {
    const { gw, binding } = await home();
    const peer = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: PEER_SEED, registrations: [] }),
    );
    await peer.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
    await peer.append([observed(FERN, "height", 11, 1200, PEER_SEED)]);
    const channel = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      source: { pull: () => Promise.resolve(peer.reactor.arrivalLog()) },
    });
    expect((await channel.sync()).bound).toContain("peer:Plant");

    expect(gw.resolvedNode("peer:Plant", FERN).view["height"]).toBe(11);
    expect(() => gw.resolvedNode("peer:Plant", FERN, undefined, undefined, binding)).toThrow(
      /arrived through a federation channel/,
    );
    expect(bound(gw, binding)["height"]).toBe(30);
    await peer.close();
    await gw.close();
  });
});

describe("T262 — a bound read resolves over the container's scope, never the whole store", () => {
  it("a claim outside the container is invisible to the bound read and visible to the plain read", async () => {
    const { gw, binding } = await home();
    await gw.append([observed(FERN, "height", 99, 5000, OP_SEED)]);
    expect(plain(gw)["height"]).toBe(99);
    expect(bound(gw, binding)["height"]).toBe(30);
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
    expect(gw.resolvePinned(reg, FERN).view["height"]).toBe(30);
    await gw.close();
  });

  it("a bound listing pages the scope only; the plain listing still sees the whole store", async () => {
    const { gw, binding } = await home();
    await gw.mutateEntity("Plant", MOSS, { tag: "pooled" }, CONN_SEED, binding);
    await gw.append([observed(OAK, "height", 1, 5000, OP_SEED)]);
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
    const first = await gw.query(`{ plants(limit: 1) { _entity } }`, undefined, {
      actor: CONN_SEED,
      binding,
    });
    expect(first.data).toEqual({ plants: [{ _entity: FERN }] });
    const rest = await gw.query(`{ plants(after: "${FERN}") { _entity } }`, undefined, {
      actor: CONN_SEED,
      binding,
    });
    expect(rest.data).toEqual({ plants: [{ _entity: MOSS }] });
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
