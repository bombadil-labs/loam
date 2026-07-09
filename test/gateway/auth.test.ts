// Step 5's contract: no ambient authority, anywhere. A write is authorized iff a surviving,
// signed capability grant permits it — policy is data, enforcement is gateway code, and the
// chain roots in one operator identity. Revocation is negation; audit is a query; a grant on
// one tenant is nothing on another. Deny is the default; permission is always an artifact.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import {
  TENANT,
  TENANT_POLICY,
  grantClaims,
  membershipClaims,
  revocationClaims,
} from "../../src/gateway/accounts.js";
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

const GARDEN = "tenant:garden";
const MEADOW = "tenant:meadow";

let clock = 10_000;
const tick = () => (clock += 1);

// The operator plants a world: the garden tenant owns the fern; alice (the gardener) and the
// surveyor hold write on it — so the fixture deltas they signed are welcome ground.
async function grantedWorld(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(membershipClaims(GARDEN, FERN, OPERATOR, tick()), OPERATOR_SEED),
    signClaims(grantClaims(GARDEN, ALICE, "write", OPERATOR, tick()), OPERATOR_SEED),
    signClaims(grantClaims(GARDEN, SURVEYOR, "write", OPERATOR, tick()), OPERATOR_SEED),
  ]);
  await gateway.append(garden); // now authorized: their authors hold write on the garden
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  gateway.register(TENANT, TENANT_POLICY, [GARDEN]);
  return gateway;
}

const mutateHeight = (gateway: Gateway, actor: string | undefined, height: number) =>
  gateway.query(
    `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    undefined,
    actor === undefined ? undefined : { actor },
  );

describe("capabilities: deny is the default, permission is an artifact", () => {
  it("an actor with no grant is refused; nothing is persisted", async () => {
    const gateway = await grantedWorld();
    const result = await mutateHeight(gateway, MALLORY_SEED, 99);
    expect(result.errors?.join(" ")).toMatch(/not permitted/);
    const requery = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((requery.data as { plant: { height: number } }).plant.height).toBe(34);
    await gateway.close();
  });

  it("a grant permits exactly its subject: alice writes, and the claim is hers", async () => {
    const gateway = await grantedWorld();
    const result = await mutateHeight(gateway, ALICE_SEED, 40);
    expect(result.errors).toBeUndefined();
    expect((result.data as { plant: { height: number } }).plant.height).toBe(40);
    // authorship is the actor's, not the gateway's
    const persisted = await gateway.query(`{ plant(entity: "${FERN}") { _view } }`);
    expect(persisted.errors).toBeUndefined();
    const written = [...gateway.reactor.snapshot()].find(
      (d) => d.claims.author === ALICE && d.claims.timestamp > 9_000,
    );
    expect(written).toBeDefined();
    await gateway.close();
  });

  it("revocation is negation: the grant dies, the door closes again", async () => {
    const gateway = await grantedWorld();
    expect((await mutateHeight(gateway, ALICE_SEED, 41)).errors).toBeUndefined();

    // find the grant delta and negate it, as the operator
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
    await gateway.close();
  });

  it("grants are auditable via query: alive when granted, gone when revoked", async () => {
    const gateway = await grantedWorld();
    const audit = () =>
      gateway
        .query(`{ tenant(entity: "${GARDEN}") { _view } }`)
        .then(
          (r) =>
            ((r.data as { tenant: { _view: Record<string, unknown> } }).tenant._view[
              "loam.grants"
            ] ?? []) as unknown[],
        );
    expect(await audit()).toHaveLength(2); // alice's and the surveyor's grants, on the record

    const grantDelta = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === ALICE,
      ),
    )!;
    await gateway.append([
      signClaims(revocationClaims(grantDelta.id, OPERATOR, tick()), OPERATOR_SEED),
    ]);
    expect(await audit()).toHaveLength(1); // alice's struck; the surveyor's stands
    await gateway.close();
  });

  it("full multi-tenant: a grant on the garden is nothing in the meadow", async () => {
    const gateway = await grantedWorld();
    const MOSS = "plant:moss";
    await gateway.append([
      signClaims(membershipClaims(MEADOW, MOSS, OPERATOR, tick()), OPERATOR_SEED),
    ]);
    const denied = await gateway.query(
      `mutation { plant(entity: "${MOSS}", height: 2) { height } }`,
      undefined,
      { actor: ALICE_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("an entity of no tenant belongs to the operator alone", async () => {
    const gateway = await grantedWorld();
    const denied = await gateway.query(
      `mutation { plant(entity: "plant:stray", height: 1) { height } }`,
      undefined,
      { actor: ALICE_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    // the operator, by contrast, needs no grant — the chain roots in it
    const allowed = await gateway.query(
      `mutation { plant(entity: "plant:stray", height: 1) { height } }`,
    );
    expect(allowed.errors).toBeUndefined();
    await gateway.close();
  });

  it("the admin chain: operator → alice (admin) → bob (write); alice can also revoke", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await gateway.append([
      signClaims(membershipClaims(GARDEN, FERN, OPERATOR, tick()), OPERATOR_SEED),
      signClaims(grantClaims(GARDEN, ALICE, "admin", OPERATOR, tick()), OPERATOR_SEED),
    ]);
    gateway.register(PLANT, PLANT_POLICY, [FERN]);

    // alice, holding admin, grants bob write — signed by alice, not the operator
    await gateway.append([
      signClaims(grantClaims(GARDEN, BOB, "write", ALICE, tick()), ALICE_SEED),
    ]);
    expect((await mutateHeight(gateway, BOB_SEED, 60)).errors).toBeUndefined();

    // and alice can take it back
    const bobGrant = [...gateway.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === BOB,
      ),
    )!;
    await gateway.append([signClaims(revocationClaims(bobGrant.id, ALICE, tick()), ALICE_SEED)]);
    expect((await mutateHeight(gateway, BOB_SEED, 61)).errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("raw append is enforced by the delta's own verified author", async () => {
    const gateway = await grantedWorld();
    const malloryDelta: Delta = observed(FERN, "height", 3, tick(), MALLORY_SEED);
    await expect(gateway.append([malloryDelta])).rejects.toThrow(/not permitted/);
    // alice's raw delta, on her granted tenant, lands
    const aliceDelta: Delta = observed(FERN, "height", 44, tick(), GARDENER_SEED);
    await expect(gateway.append([aliceDelta])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("without an operator there is no governance: any verified delta is welcome", async () => {
    const gateway = await Gateway.open(new MemoryBackend()); // no seed: an ungoverned local store
    const anyone = observed(FERN, "height", 5, tick(), MALLORY_SEED);
    await expect(gateway.append([anyone])).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("granting itself requires standing: a write grant cannot mint grants", async () => {
    const gateway = await grantedWorld();
    // alice holds write, not admin: she may not grant bob anything
    const attempted = signClaims(grantClaims(GARDEN, BOB, "write", ALICE, tick()), ALICE_SEED);
    await expect(gateway.append([attempted])).rejects.toThrow(/not permitted/);
    await gateway.close();
  });
});
