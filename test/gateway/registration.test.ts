// Step 10's contract, part 1: registrations REFERENCE, definitions DEFINE. A schema is defined
// by schema-schema deltas (rhizomatic's publishSchemaClaims shape) at a schema entity; a
// registration delta holds only a pointer to that entity, the policy as canonical JSON, and the
// roots. readRegistrations GENERATES each HyperSchema via loadSchema over the store's surviving
// definitions — so evolution is append, deprecation is negation, and in a governed store only
// the operator's law binds.

import { describe, expect, it } from "vitest";
import {
  Reactor,
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  parseTerm,
  publishSchemaClaims,
  termCanonicalHex,
  termHash,
  type Delta,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import {
  CTX_REGISTRATION,
  readRegistrations,
  registrationClaims,
} from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OPERATOR = authorForSeed("0e".repeat(32));
const MALLORY = authorForSeed("ee".repeat(32));
const ENTITY = "schema:Plant";

// A different body, so supersession is provable by term hash: heights only.
const V2_BODY = parseTerm({
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { context: { exact: "height" } } },
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  },
});
const PLANT_V2: HyperSchema = { name: "Plant", alg: 1, body: V2_BODY };

const define = (schema: HyperSchema, author: string, ts: number): Delta =>
  makeDelta(publishSchemaClaims(schema, ENTITY, author, ts));
const register = (author: string, ts: number): Delta =>
  makeDelta(registrationClaims(ENTITY, PLANT_POLICY, [FERN], author, ts));

const world = (...deltas: Delta[]): Reactor => {
  const reactor = new Reactor();
  for (const d of deltas) reactor.ingest(d);
  return reactor;
};

describe("registration claims: a reference, never a carrier", () => {
  it("holds a schema-entity pointer, policy and roots — and no schema body anywhere", () => {
    const claims = registrationClaims(ENTITY, PLANT_POLICY, [FERN], OPERATOR, 5);
    const files = claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    expect(files).toBeDefined();
    const schemaRef = claims.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.id === ENTITY,
    );
    expect(schemaRef).toBeDefined();
    // the body travels ONLY in the definition delta: no term blob rides the registration
    const flat = JSON.stringify(claims);
    expect(flat).not.toContain(termCanonicalHex(PLANT.body));
    expect(flat).not.toContain('"group"');
  });

  it("does not file under the schema entity's definition bucket (loadSchema stays clean)", () => {
    const claims = registrationClaims(ENTITY, PLANT_POLICY, [FERN], OPERATOR, 5);
    for (const p of claims.pointers) {
      if (p.target.kind === "entity" && p.target.entity.id === ENTITY) {
        expect(p.target.entity.context).not.toBe("definition");
      }
    }
  });
});

describe("readRegistrations: the surface is generated from surviving definitions", () => {
  it("loads the schema from its definition deltas and round-trips policy and roots", () => {
    const reactor = world(define(PLANT, OPERATOR, 1), register(OPERATOR, 2));
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.hyperschema.name).toBe("Plant");
    expect(termHash(regs[0]!.hyperschema.body)).toBe(termHash(PLANT.body));
    expect(regs[0]!.schema.props.get("height")?.kind).toBe("pick");
    expect(regs[0]!.roots).toEqual([FERN]);
  });

  it("evolution is append: the latest surviving definition wins, body and all", () => {
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      register(OPERATOR, 2),
      define(PLANT_V2, OPERATOR, 3),
    );
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1);
    expect(termHash(regs[0]!.hyperschema.body)).toBe(termHash(V2_BODY));
  });

  it("deprecation is negation: a negated definition unbinds its registration, quietly", () => {
    const definition = define(PLANT, OPERATOR, 1);
    const reactor = world(
      definition,
      register(OPERATOR, 2),
      makeDelta(makeNegationClaims(OPERATOR, 3, definition.id)),
    );
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("a negated registration binds nothing even while its definition survives", () => {
    const registration = register(OPERATOR, 2);
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      registration,
      makeDelta(makeNegationClaims(OPERATOR, 3, registration.id)),
    );
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("negating the negation revives: the substrate's algebra, honored on registrations too", () => {
    const registration = register(OPERATOR, 2);
    const retirement = makeDelta(makeNegationClaims(OPERATOR, 3, registration.id));
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      registration,
      retirement,
      makeDelta(makeNegationClaims(OPERATOR, 4, retirement.id)), // the retirement, retired
    );
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1); // the registration lives again
  });

  it("a foreign negation of the operator's registration retires nothing", () => {
    const registration = register(OPERATOR, 2);
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      registration,
      makeDelta(makeNegationClaims(MALLORY, 3, registration.id)), // Mallory's, roots in nobody
    );
    expect(readRegistrations(reactor, OPERATOR)).toHaveLength(1);
  });

  it("foreign law is inert: a newer non-operator definition cannot reshape a governed surface", () => {
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      register(OPERATOR, 2),
      define(PLANT_V2, MALLORY, 999), // newer, but Mallory roots in nobody the operator blessed
    );
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1);
    expect(termHash(regs[0]!.hyperschema.body)).toBe(termHash(PLANT.body)); // the operator's v1 holds
  });

  it("a foreign registration is likewise inert in a governed store", () => {
    const reactor = world(define(PLANT, OPERATOR, 1), register(MALLORY, 2));
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("ungoverned (no operator): any verified author's definition binds", () => {
    const reactor = world(define(PLANT, MALLORY, 1), register(MALLORY, 2));
    const regs = readRegistrations(reactor);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.hyperschema.name).toBe("Plant");
  });

  it("a registration whose definition never arrived binds nothing (unbound, not a crash)", () => {
    const reactor = world(register(OPERATOR, 2));
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("a malformed registration binds nothing", () => {
    const claims = registrationClaims(ENTITY, PLANT_POLICY, [FERN], OPERATOR, 5);
    const mangled = makeDelta({
      ...claims,
      pointers: claims.pointers.filter((p) => p.role !== "roots"),
    });
    const reactor = world(define(PLANT, OPERATOR, 1), mangled);
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });
});
