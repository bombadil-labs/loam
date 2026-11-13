import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import {
  TENANT_POLICY,
  grantClaims,
  membershipClaims,
  revocationClaims,
  tenantOf,
  tenantSchemaFor,
} from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./fixtures.js";
import { stamped } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = GARDENER_SEED;
const BOB_SEED = "b0".repeat(32);
const MALLORY_SEED = "e4".repeat(32);

const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE = GARDENER;
const BOB = authorForSeed(BOB_SEED);

let clock = 10_000;
const tick = () => (clock += 1);

async function grantedWorld(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, ALICE, "write", OPERATOR, tick()), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, tick()), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  gateway.register(tenantSchemaFor(OPERATOR), TENANT_POLICY, [STORE_ENTITY]);
  return gateway;
}

const mutateHeight = (gateway: Gateway, actor: string | undefined, height: number) =>
  gateway.query(
    `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    undefined,
    actor === undefined ? undefined : { actor },
  );

describe("standing: deny is the default, permission is an artifact", () => {
  it("an author with no standing is refused; nothing is persisted", async () => {
    const gateway = await grantedWorld();
    const result = await mutateHeight(gateway, MALLORY_SEED, 99);
    expect(result.errors?.join(" ")).toMatch(/not permitted.*standing/);
    const requery = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(34);
    await gateway.close();
  });

  it("standing permits exactly its subject: alice writes, and the claim is hers", async () => {
    const gateway = await grantedWorld();
    const result = await mutateHeight(gateway, ALICE_SEED, 40);
    expect(result.errors).toBeUndefined();
    expect((result.data as { plant: { height: number } }).plant.height).toBe(40);
    const written = [...gateway.reactor.snapshot()].find(
      (d) => d.claims.author === ALICE && d.claims.timestamp > 9_000,
    );
    expect(written).toBeDefined();
    await gateway.close();
  });

  it("THE RITUAL IS DEAD: one multi-pointer delta touching arbitrary entities just lands", async () => {
    const gateway = await grantedWorld();
    const hosted: Delta = signClaims(
      {
        ...stamped(tick()),
        author: ALICE,
        pointers: [
          {
            role: "host",
            target: { kind: "entity", entity: { id: "person:miles", context: "events_hosted" } },
          },
          {
            role: "film",
            target: { kind: "entity", entity: { id: "film:the-matrix", context: "screenings" } },
          },
          {
            role: "guest",
            target: { kind: "entity", entity: { id: "person:wren", context: "events_attended" } },
          },
          {
            role: "guest",
            target: { kind: "entity", entity: { id: "person:sally", context: "events_attended" } },
          },
          { role: "date", target: { kind: "primitive", value: "2026-07-04" } },
        ],
      },
      ALICE_SEED,
    );
    await expect(gateway.append([hosted])).resolves.toMatchObject({ accepted: 1 });
    expect(
      tenantOf(gateway.reactor, gateway.validityNow(), "person:wren", OPERATOR),
    ).toBeUndefined();
    await gateway.close();
  });

  it("citing another delta is provenance, not privilege: a delta-ref lands with standing", async () => {
    const gateway = await grantedWorld();
    const source = garden[0]!;
    const citing = signClaims(
      {
        ...stamped(tick()),
        author: ALICE,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "height" } } },
          { role: "translates", target: { kind: "delta", deltaRef: { delta: source.id } } },
        ],
      },
      ALICE_SEED,
    );
    await expect(gateway.append([citing])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("revocation is negation: the standing dies, the door closes again", async () => {
    const gateway = await grantedWorld();
    expect((await mutateHeight(gateway, ALICE_SEED, 41)).errors).toBeUndefined();

    const grantDelta = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === ALICE,
      ),
    )!;
    await gateway.append([
      signClaims(revocationClaims(grantDelta.id, OPERATOR, tick()), OPERATOR_SEED),
    ]);

    const denied = await mutateHeight(gateway, ALICE_SEED, 42);
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    const requery = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(41);
    await gateway.close();
  });

  it("standing is auditable via query: alive when granted, gone when revoked", async () => {
    const gateway = await grantedWorld();
    const audit = () =>
      gateway
        .query(`{ tenant(entity: "${STORE_ENTITY}") { _view } }`)
        .then(
          (r) =>
            ((r.data as { tenant: { _view: Record<string, unknown> } }).tenant._view[
              "loam.grants"
            ] ?? []) as unknown[],
        );
    expect(await audit()).toHaveLength(2);

    const grantDelta = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === ALICE,
      ),
    )!;
    await gateway.append([
      signClaims(revocationClaims(grantDelta.id, OPERATOR, tick()), OPERATOR_SEED),
    ]);
    expect(await audit()).toHaveLength(1);
    await gateway.close();
  });

  it("the admin chain: operator → alice (admin) → bob (write); alice can also revoke", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ALICE, "admin", OPERATOR, tick()), OPERATOR_SEED),
    ]);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, BOB, "write", ALICE, tick()), ALICE_SEED),
    ]);
    expect((await mutateHeight(gateway, BOB_SEED, 60)).errors).toBeUndefined();

    const bobGrant = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === BOB,
      ),
    )!;
    await gateway.append([signClaims(revocationClaims(bobGrant.id, ALICE, tick()), ALICE_SEED)]);
    expect((await mutateHeight(gateway, BOB_SEED, 61)).errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("a write grant cannot mint standing: the grant-shaped delta LANDS, and binds nothing", async () => {
    const gateway = await grantedWorld();
    const attempted = signClaims(
      grantClaims(STORE_ENTITY, BOB, "write", ALICE, tick()),
      ALICE_SEED,
    );
    await expect(gateway.append([attempted])).resolves.toMatchObject({ accepted: 1 });
    expect((await mutateHeight(gateway, BOB_SEED, 62)).errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("a writer's strike against the constitution lands, and retires nothing", async () => {
    const gateway = await grantedWorld();
    const surveyorGrant = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === SURVEYOR,
      ),
    )!;
    await expect(
      gateway.append([signClaims(revocationClaims(surveyorGrant.id, ALICE, tick()), ALICE_SEED)]),
    ).resolves.toMatchObject({ accepted: 1 });
    const surveyorWrite = observed(FERN, "height", 77, tick(), "b2".repeat(32));
    await expect(gateway.append([surveyorWrite])).resolves.toMatchObject({ accepted: 1 });

    const audited = await gateway.query(`{ tenant(entity: "${STORE_ENTITY}") { _view } }`);
    const grants = ((audited.data as { tenant: { _view: Record<string, unknown> } }).tenant._view[
      "loam.grants"
    ] ?? []) as unknown[];
    expect(grants).toHaveLength(2);
    await gateway.close();
  });

  it("revocation is transitive: revoking the admin fells every grant they minted", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const aliceAdmin = signClaims(
      grantClaims(STORE_ENTITY, ALICE, "admin", OPERATOR, tick()),
      OPERATOR_SEED,
    );
    await gateway.append([aliceAdmin]);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, BOB, "write", ALICE, tick()), ALICE_SEED),
    ]);
    expect((await mutateHeight(gateway, BOB_SEED, 80)).errors).toBeUndefined();

    await gateway.append([
      signClaims(revocationClaims(aliceAdmin.id, OPERATOR, tick()), OPERATOR_SEED),
    ]);
    expect((await mutateHeight(gateway, BOB_SEED, 81)).errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("an admin can revoke themselves — and the door stays shut behind them", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const aliceAdmin = signClaims(
      grantClaims(STORE_ENTITY, ALICE, "admin", OPERATOR, tick()),
      OPERATOR_SEED,
    );
    await gateway.append([aliceAdmin]);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    expect((await mutateHeight(gateway, ALICE_SEED, 82)).errors).toBeUndefined();

    await gateway.append([signClaims(revocationClaims(aliceAdmin.id, ALICE, tick()), ALICE_SEED)]);
    expect((await mutateHeight(gateway, ALICE_SEED, 83)).errors?.join(" ")).toMatch(
      /not permitted/,
    );
    await gateway.close();
  });

  it("INTERIM, pinned: a granted writer's negation of DATA masks it for local reads", async () => {
    const gateway = await grantedWorld();
    const surveyorHeight = [...gateway.reactor.snapshot()].find(
      (d) =>
        d.claims.author === authorForSeed("b2".repeat(32)) &&
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === "height",
        ),
    )!;
    await gateway.append([
      signClaims(revocationClaims(surveyorHeight.id, ALICE, tick()), ALICE_SEED),
    ]);
    const read = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(30);
    await gateway.close();
  });

  it("raw append is enforced by the delta's own verified author", async () => {
    const gateway = await grantedWorld();
    const malloryDelta: Delta = observed(FERN, "height", 3, tick(), MALLORY_SEED);
    await expect(gateway.append([malloryDelta])).rejects.toThrow(/not permitted/);
    const aliceDelta: Delta = observed(FERN, "height", 44, tick(), GARDENER_SEED);
    await expect(gateway.append([aliceDelta])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("without an operator there is no governance: any verified delta is welcome", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    const anyone = observed(FERN, "height", 5, tick(), MALLORY_SEED);
    await expect(gateway.append([anyone])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("poisoned ground: a store written while ungoverned cannot be opened by an operator", async () => {
    const backend = new MemoryBackend();
    const free = await Gateway.open(backend);
    const MALLORY = authorForSeed(MALLORY_SEED);
    await free.append([
      signClaims(grantClaims(STORE_ENTITY, MALLORY, "admin", MALLORY, tick()), MALLORY_SEED),
    ]);
    await free.flush();

    await expect(Gateway.open(backend, { seed: OPERATOR_SEED })).rejects.toThrow(
      /rows but no peer journal/,
    );
    expect(await backend.journalPeers()).toEqual([]);
  });

  it("a hostile strike from ungoverned days has no standing against the operator's grant", async () => {
    const backend = new MemoryBackend();
    const seedGateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await seedGateway.append([
      signClaims(grantClaims(STORE_ENTITY, ALICE, "write", OPERATOR, tick()), OPERATOR_SEED),
    ]);
    await seedGateway.flush();
    const aliceGrant = [...seedGateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === ALICE,
      ),
    )!;

    const free = await Gateway.open(backend);
    const MALLORY = authorForSeed(MALLORY_SEED);
    await free.append([signClaims(revocationClaims(aliceGrant.id, MALLORY, tick()), MALLORY_SEED)]);
    await free.flush();

    const governed = await Gateway.open(backend, { seed: OPERATOR_SEED });
    governed.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const allowed = await governed.query(
      `mutation { plant(entity: "${FERN}", height: 67) { height } }`,
      undefined,
      { actor: ALICE_SEED },
    );
    expect(allowed.errors).toBeUndefined();
    await governed.close();
  });

  it("un-revocation works: striking the strike restores the standing", async () => {
    const gateway = await grantedWorld();
    const aliceGrant = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === ALICE,
      ),
    )!;
    const revocation = signClaims(revocationClaims(aliceGrant.id, OPERATOR, tick()), OPERATOR_SEED);
    await gateway.append([revocation]);
    expect((await mutateHeight(gateway, ALICE_SEED, 70)).errors?.join(" ")).toMatch(
      /not permitted/,
    );

    await gateway.append([
      signClaims(revocationClaims(revocation.id, OPERATOR, tick()), OPERATOR_SEED),
    ]);
    expect((await mutateHeight(gateway, ALICE_SEED, 71)).errors).toBeUndefined();
    await gateway.close();
  });

  it("a grant with duplicate subjects or verbs is malformed law (it would read differently in three places)", async () => {
    const gateway = await grantedWorld();
    const twoVerbs = signClaims(
      {
        ...stamped(tick()),
        author: OPERATOR,
        pointers: [
          {
            role: "tenant",
            target: { kind: "entity", entity: { id: STORE_ENTITY, context: "loam.grants" } },
          },
          { role: "subject", target: { kind: "primitive", value: BOB } },
          { role: "verb", target: { kind: "primitive", value: "admin" } },
          { role: "verb", target: { kind: "primitive", value: "write" } },
        ],
      },
      OPERATOR_SEED,
    );
    await expect(gateway.append([twoVerbs])).rejects.toThrow(/malformed law/);
    await gateway.close();
  });

  it("the lenses reach ONE link: an operator-minted admin's strike binds them; a chain-minted admin's does not", async () => {
    const CAROL_SEED = "cc".repeat(32);
    const CAROL = authorForSeed(CAROL_SEED);
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ALICE, "admin", OPERATOR, tick()), OPERATOR_SEED),
    ]);
    const bobGrant = signClaims(
      grantClaims(STORE_ENTITY, BOB, "write", OPERATOR, tick()),
      OPERATOR_SEED,
    );
    await gateway.append([bobGrant]);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, CAROL, "admin", ALICE, tick()), ALICE_SEED),
    ]);
    gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    gateway.register(tenantSchemaFor(OPERATOR), TENANT_POLICY, [STORE_ENTITY]);
    const audit = async () =>
      (
        (
          (await gateway.query(`{ tenant(entity: "${STORE_ENTITY}") { _view } }`)).data as {
            tenant: { _view: Record<string, unknown> };
          }
        ).tenant._view["loam.grants"] as unknown[]
      ).length;

    await gateway.append([signClaims(revocationClaims(bobGrant.id, CAROL, tick()), CAROL_SEED)]);
    expect((await mutateHeight(gateway, BOB_SEED, 90)).errors?.join(" ")).toMatch(/not permitted/);
    expect(await audit()).toBe(3);

    await gateway.append([signClaims(revocationClaims(bobGrant.id, ALICE, tick()), ALICE_SEED)]);
    expect(await audit()).toBe(2);
    await gateway.close();
  });

  it("malformed law is refused for everyone, the operator included", async () => {
    const gateway = await grantedWorld();
    const bogus = signClaims(
      {
        ...stamped(tick()),
        author: OPERATOR,
        pointers: [
          {
            role: "tenant",
            target: { kind: "entity", entity: { id: STORE_ENTITY, context: "loam.grants" } },
          },
          { role: "subject", target: { kind: "primitive", value: ALICE } },
          { role: "verb", target: { kind: "primitive", value: "root" } },
        ],
      },
      OPERATOR_SEED,
    );
    await expect(gateway.append([bogus])).rejects.toThrow(/malformed law/);
    await gateway.close();
  });

  it("tenant vocabulary survives as data: memberships resolve, and authorize never asks", async () => {
    const gateway = await grantedWorld();
    await gateway.append([
      signClaims(membershipClaims("tenant:garden", "plant:moss", OPERATOR, tick()), OPERATOR_SEED),
    ]);
    expect(tenantOf(gateway.reactor, gateway.validityNow(), "plant:moss", OPERATOR)).toBe(
      "tenant:garden",
    );
    const result = await gateway.query(
      `mutation { plant(entity: "plant:moss", height: 2) { height } }`,
      undefined,
      { actor: ALICE_SEED },
    );
    expect(result.errors).toBeUndefined();
    await gateway.close();
  });
});
