// The open door's law (SPEC §12). An operator-signed declaration at `loam:public` names which
// REGISTERED schemas answer without a token — query and subscribe only. The declaration is
// data: union across surviving declarations, revocation is one negation, and in a governed
// store only the operator's voice opens anything. Anonymous execution runs against a
// RESTRICTED GraphQL schema — the public schemas' query + subscription fields and no Mutation
// type at all — so a write through the public door is a validation impossibility, not a
// policed string.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  CTX_PUBLIC,
  PUBLIC_ENTITY,
  publicClaims,
  publicDefect,
  readPublicSchemas,
} from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, SURVEYOR } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, garden } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MALLORY_SEED = "e4".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);

// A second registered schema that is NEVER declared public: the restricted surface must not
// merely fail to answer it — it must not even admit it exists.
const LEDGER = { ...PLANT, name: "Ledger" };

async function governedGarden(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9001), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9002), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, MALLORY, "write", OPERATOR, 9003), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  gateway.register(LEDGER, PLANT_POLICY, ["ledger:1"]);
  return gateway;
}

const declare = (gateway: Gateway, schemas: string[], seed = OPERATOR_SEED, ts = Date.now()) => {
  const delta = signClaims(publicClaims(schemas, authorForSeed(seed), ts), seed);
  return gateway.append([delta]).then(() => delta);
};

describe("the loam.public law", () => {
  it("no declaration: nothing is public", async () => {
    const gateway = await governedGarden();
    expect(readPublicSchemas(gateway.reactor, OPERATOR).size).toBe(0);
    expect(gateway.hasPublicSurface()).toBe(false);
    await gateway.close();
  });

  it("an operator declaration opens exactly the named schemas; union across declarations", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Plant"], OPERATOR_SEED, 10_000);
    let open = readPublicSchemas(gateway.reactor, OPERATOR);
    expect([...open]).toEqual(["Plant"]);
    await declare(gateway, ["Ledger"], OPERATOR_SEED, 10_001);
    open = readPublicSchemas(gateway.reactor, OPERATOR);
    expect(open.has("Plant")).toBe(true);
    expect(open.has("Ledger")).toBe(true);
    await gateway.close();
  });

  it("revocation is one negation, and a stranger's strike revokes nothing", async () => {
    const gateway = await governedGarden();
    const declaration = await declare(gateway, ["Plant"], OPERATOR_SEED, 10_000);

    // Mallory holds write standing — the strike LANDS as data, but the law does not bend.
    await gateway.append([
      signClaims(makeNegationClaims(MALLORY, 10_001, declaration.id), MALLORY_SEED),
    ]);
    expect(readPublicSchemas(gateway.reactor, OPERATOR).has("Plant")).toBe(true);

    // The operator's own strike closes the door.
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 10_002, declaration.id), OPERATOR_SEED),
    ]);
    expect(readPublicSchemas(gateway.reactor, OPERATOR).size).toBe(0);
    expect(gateway.hasPublicSurface()).toBe(false);
    await gateway.close();
  });

  it("a stranger's declaration binds nothing in a governed store", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Plant"], MALLORY_SEED, 10_000);
    expect(readPublicSchemas(gateway.reactor, OPERATOR).size).toBe(0);
    expect(gateway.hasPublicSurface()).toBe(false);
    await gateway.close();
  });

  it("an ungoverned store exposes nothing publicly — no lawful voice to open a door", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append([
      signClaims(publicClaims(["Plant"], OPERATOR, 10_000), OPERATOR_SEED),
      signClaims(publicClaims(["Plant"], GARDENER, 10_001), GARDENER_SEED),
    ]);
    expect(readPublicSchemas(gateway.reactor, undefined).size).toBe(0);
    expect(gateway.hasPublicSurface()).toBe(false);
    await gateway.close();
  });

  it("a malformed declaration is refused at the door, for everyone", async () => {
    const gateway = await governedGarden();
    const malformed: Claims = {
      timestamp: 10_000,
      author: OPERATOR,
      pointers: [
        {
          role: "declares",
          target: { kind: "entity", entity: { id: PUBLIC_ENTITY, context: CTX_PUBLIC } },
        },
        { role: "schema", target: { kind: "primitive", value: 42 } },
      ],
    };
    await expect(gateway.append([signClaims(malformed, OPERATOR_SEED)])).rejects.toThrow(
      /malformed law/,
    );

    const empty: Claims = {
      timestamp: 10_001,
      author: OPERATOR,
      pointers: [
        {
          role: "declares",
          target: { kind: "entity", entity: { id: PUBLIC_ENTITY, context: CTX_PUBLIC } },
        },
      ],
    };
    await expect(gateway.append([signClaims(empty, OPERATOR_SEED)])).rejects.toThrow(
      /malformed law/,
    );
    await gateway.close();
  });

  it("publicDefect leaves non-declarations alone", () => {
    expect(publicDefect(garden[0]!.claims)).toBeUndefined();
    expect(publicDefect(publicClaims(["Plant"], OPERATOR, 1))).toBeUndefined();
  });
});

describe("the restricted surface", () => {
  it("with nothing public, queryPublic refuses plainly", async () => {
    const gateway = await governedGarden();
    await expect(gateway.queryPublic(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /public/,
    );
    await gateway.close();
  });

  it("a public schema answers; a private one is invisible even to introspection", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Plant"]);

    const answer = await gateway.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(34);

    // Not merely unanswered — unknown to the validator.
    const denied = await gateway.queryPublic(`{ ledger(entity: "ledger:1") { height } }`);
    expect(denied.errors?.join(" ")).toMatch(/Cannot query field/);

    // Introspection is a feature here: it reveals ONLY the public shapes.
    const shapes = await gateway.queryPublic(`{ __schema { types { name } } }`);
    const names = (shapes.data as { __schema: { types: Array<{ name: string }> } }).__schema.types
      .map((t) => t.name)
      .join(" ");
    expect(names).toContain("PlantView");
    expect(names).not.toContain("LedgerView");
    await gateway.close();
  });

  it("mutation operations are structurally impossible — no Mutation type exists", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Plant"]);

    const attempt = await gateway.queryPublic(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
    );
    expect(attempt.errors?.length).toBeGreaterThan(0);
    const claimAttempt = await gateway.queryPublic(
      `mutation { _claim(pointers: [{ role: "x", value: 1 }]) { delta } }`,
    );
    expect(claimAttempt.errors?.length).toBeGreaterThan(0);

    // And the refusals refused: the ground did not move.
    const after = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((after.data as { plant: { height: number } }).plant.height).toBe(34);

    // The restricted schema simply has no mutation root.
    const probe = await gateway.queryPublic(`{ __schema { mutationType { name } } }`);
    expect(
      (probe.data as { __schema: { mutationType: null | { name: string } } }).__schema.mutationType,
    ).toBeNull();
    await gateway.close();
  });

  it("subscribePublic streams a public schema and refuses a private one", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Plant"]);

    const stream = await gateway.subscribePublic(
      `subscription { plant(entity: "${FERN}") { height _fromHex } }`,
    );
    const first = await stream.next();
    expect(
      (first.value as { plant: { height: number; _fromHex: string | null } }).plant._fromHex,
    ).toBeNull();
    await stream.return(undefined);

    await expect(
      gateway.subscribePublic(`subscription { ledger(entity: "ledger:1") { height } }`),
    ).rejects.toThrow(/Cannot query field|subscription failed/);
    await gateway.close();
  });

  it("the surface follows the data live: declare → answers; revoke → refuses", async () => {
    const gateway = await governedGarden();
    const declaration = await declare(gateway, ["Plant"], OPERATOR_SEED, 10_000);
    expect(gateway.hasPublicSurface()).toBe(true);
    const open = await gateway.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect(open.errors).toBeUndefined();

    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 10_001, declaration.id), OPERATOR_SEED),
    ]);
    await expect(gateway.queryPublic(`{ plant(entity: "${FERN}") { height } }`)).rejects.toThrow(
      /public/,
    );
    await gateway.close();
  });

  it("a public declaration naming an unregistered schema opens nothing until it binds", async () => {
    const gateway = await governedGarden();
    await declare(gateway, ["Orchard"]);
    expect(gateway.hasPublicSurface()).toBe(false);

    // The declaration names Plant too late? No — declare Plant now; the surface appears with
    // no restart: the door is a lens over live data.
    await declare(gateway, ["Plant"], OPERATOR_SEED, Date.now() + 1);
    expect(gateway.hasPublicSurface()).toBe(true);
    const writes = await gateway.queryPublic(`{ plant(entity: "${FERN}") { height } }`);
    expect((writes.data as { plant: { height: number } }).plant.height).toBe(34);
    await gateway.close();
  });
});
