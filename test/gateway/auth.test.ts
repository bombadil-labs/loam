// Step 11's contract: authors, not owners. Entities are unowned — anyone with standing may
// point at anything; whether anyone listens is the reader's lens. What the gateway enforces is
// the AUTHOR'S STANDING on this instance: one surviving, operator-rooted write grant at the
// store entity. Deny is still the default; permission is still an artifact; revocation is
// still negation; and everything that used to be refused for touching the "wrong" entity now
// lands freely — while everything constitutional stays exactly as inert as it always was
// unless the operator's chain says otherwise.

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
import { PLANT, PLANT_POLICY, garden } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const ALICE_SEED = GARDENER_SEED; // alice is the gardener
const BOB_SEED = "b0".repeat(32);
const MALLORY_SEED = "e4".repeat(32);

const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE = GARDENER;
const BOB = authorForSeed(BOB_SEED);

let clock = 10_000;
const tick = () => (clock += 1);

// The operator opens the door to alice and the surveyor: write standing on the store. That is
// the WHOLE constitution a writer needs now — no memberships, no per-entity anything.
async function grantedWorld(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, ALICE, "write", OPERATOR, tick()), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, tick()), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
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
    // alice records a hosted screening: host, film, two guests, a date — five pointers, four
    // entities she was never "granted" — no membership, no adoption, no re-tenanting.
    const hosted: Delta = signClaims(
      {
        timestamp: tick(),
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
    // and none of those entities ever needed a tenant
    expect(tenantOf(gateway.reactor, "person:wren", OPERATOR)).toBeUndefined();
    await gateway.close();
  });

  it("citing another delta is provenance, not privilege: a delta-ref lands with standing", async () => {
    const gateway = await grantedWorld();
    const source = garden[0]!;
    const citing = signClaims(
      {
        timestamp: tick(),
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
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(41); // unmoved
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
    expect(await audit()).toHaveLength(2); // alice's and the surveyor's, on the record

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
    gateway.register(PLANT, PLANT_POLICY, [FERN]);

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
    // alice holds write, not admin. Under open writes her grant-shaped delta is welcome DATA —
    // and bob's door stays shut, because her mint roots in no admin.
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
    // alice (write, not admin) strikes the surveyor's grant: the negation is admitted as an
    // assertion — and the surveyor writes on, because a writer's strike has no standing to bind
    await expect(
      gateway.append([signClaims(revocationClaims(surveyorGrant.id, ALICE, tick()), ALICE_SEED)]),
    ).resolves.toMatchObject({ accepted: 1 });
    const surveyorWrite = observed(FERN, "height", 77, tick(), "b2".repeat(32));
    await expect(gateway.append([surveyorWrite])).resolves.toMatchObject({ accepted: 1 });

    // THE DIVERGENCE IS DEAD (rhizomatic 0.2.0, rhizomatic#2 delivered): the governed audit
    // view (tenantSchemaFor) masks with an inView trusted set — operator + operator-minted
    // ADMINS, the same standing standsFor demands — so alice's standing-less strike moves the
    // audit exactly as much as it moves enforcement: not at all. Audit agrees with the door.
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
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, BOB, "write", ALICE, tick()), ALICE_SEED),
    ]);
    expect((await mutateHeight(gateway, BOB_SEED, 80)).errors).toBeUndefined();

    // the operator revokes ALICE — and bob's grant, which roots through her, dies with it
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
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    expect((await mutateHeight(gateway, ALICE_SEED, 82)).errors).toBeUndefined();

    await gateway.append([signClaims(revocationClaims(aliceAdmin.id, ALICE, tick()), ALICE_SEED)]);
    expect((await mutateHeight(gateway, ALICE_SEED, 83)).errors?.join(" ")).toMatch(
      /not permitted/,
    );
    await gateway.close();
  });

  it("INTERIM, pinned: a granted writer's negation of DATA masks it for local reads", async () => {
    const gateway = await grantedWorld();
    // the surveyor's height claim (34, the current pick) — alice strikes it
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
    // A drop-bodied schema honors any present negation BY CHOICE: the view falls back to the
    // older claim. This is no longer an interim — trust-aware bodies exist
    // (`governedGatherBody`, pinned in lenses.test.ts); `drop` remains the honest default for
    // bodies that WANT community negations to bind unconditionally.
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
    const gateway = await Gateway.open(new MemoryBackend()); // ungoverned local store
    const anyone = observed(FERN, "height", 5, tick(), MALLORY_SEED);
    await expect(gateway.append([anyone])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("poisoned ground: standing minted while ungoverned roots nowhere once an operator opens", async () => {
    const backend = new MemoryBackend();
    const free = await Gateway.open(backend); // mallory writes her own constitution
    const MALLORY = authorForSeed(MALLORY_SEED);
    await free.append([
      signClaims(grantClaims(STORE_ENTITY, MALLORY, "admin", MALLORY, tick()), MALLORY_SEED),
    ]);
    await free.flush();

    const governed = await Gateway.open(backend, { seed: OPERATOR_SEED });
    governed.register(PLANT, PLANT_POLICY, [FERN]);
    const denied = await governed.query(
      `mutation { plant(entity: "${FERN}", height: 66) { height } }`,
      undefined,
      { actor: MALLORY_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await governed.close();
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
    governed.register(PLANT, PLANT_POLICY, [FERN]);
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

  it("malformed law is refused for everyone, the operator included", async () => {
    const gateway = await grantedWorld();
    const bogus = signClaims(
      {
        timestamp: tick(),
        author: OPERATOR,
        pointers: [
          {
            role: "tenant",
            target: { kind: "entity", entity: { id: STORE_ENTITY, context: "loam.grants" } },
          },
          { role: "subject", target: { kind: "primitive", value: ALICE } },
          { role: "verb", target: { kind: "primitive", value: "root" } }, // no such verb
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
    expect(tenantOf(gateway.reactor, "plant:moss", OPERATOR)).toBe("tenant:garden");
    // and alice writes moss without any relationship to that tenant — standing is store-wide
    const result = await gateway.query(
      `mutation { plant(entity: "plant:moss", height: 2) { height } }`,
      undefined,
      { actor: ALICE_SEED },
    );
    expect(result.errors).toBeUndefined();
    await gateway.close();
  });
});
