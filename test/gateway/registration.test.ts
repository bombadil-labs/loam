// Step 10's contract, part 1, as §21 leaves it: registrations BIND, definitions DEFINE. A
// hyperschema is defined by schema-schema deltas (publishHyperSchemaClaims) at a hyperschema entity,
// and — since §21 — the resolution Schema is likewise a first-class entity (publishSchemaClaims at
// `schema:<name>`), with a frozen VersionedSchema snapshot beside it. A registration delta is now a
// pure BINDING: it names those entities and the roots, and quotes neither. readRegistrations
// GENERATES each HyperSchema via loadHyperSchema and each Schema via loadSchema over the store's
// surviving deltas — so evolution is append, deprecation is negation, and in a governed store only
// the operator's law binds.

import { describe, expect, it } from "vitest";
import {
  Reactor,
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  parseTerm,
  publishHyperSchemaClaims,
  termCanonicalHex,
  termHash,
  type Delta,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import {
  CTX_REGISTRATION,
  readRegistrations,
  registrationDeltaClaims,
  schemaLivingEntityFor,
} from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OPERATOR = authorForSeed("0e".repeat(32));
const MALLORY = authorForSeed("ee".repeat(32));
// Post-slice-1 naming: the hyperschema lives at `hyperschema:Plant`, freeing `schema:Plant` for the
// living resolution Schema entity §21 lifts it into — the two never share an id.
const ENTITY = "hyperschema:Plant";
const LIVING = schemaLivingEntityFor("Plant");

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
  makeDelta(publishHyperSchemaClaims(schema, ENTITY, author, ts));

// A registration now plants THREE deltas (SPEC §21): the living Schema entity, its frozen
// VersionedSchema snapshot, and the BINDING that references both. `register` returns them in that
// order; the binding (last) is the delta a negation strikes to retire the registration.
const register = (author: string, ts: number): Delta[] => {
  const { living, snapshot, binding } = registrationDeltaClaims(
    ENTITY,
    "Plant",
    PLANT_POLICY,
    [FERN],
    author,
    () => ts,
  );
  return [makeDelta(living), makeDelta(snapshot), makeDelta(binding)];
};
const bindingOf = (deltas: Delta[]): Delta => deltas[deltas.length - 1]!;

const world = (...deltas: Delta[]): Reactor => {
  const reactor = new Reactor();
  for (const d of deltas) reactor.ingest(d);
  return reactor;
};

describe("registration claims: a binding, never a carrier", () => {
  it("names the hyperschema, the living Schema, and a frozen snapshot — and quotes NO schema anywhere", () => {
    const { binding, livingEntity, snapshotEntity } = registrationDeltaClaims(
      ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 5,
    );
    const files = binding.pointers.find(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
    );
    expect(files).toBeDefined();
    // the binding NAMES three entities and quotes none of them: hyperschema, living Schema, snapshot
    const named = (role: string): string | undefined => {
      const p = binding.pointers.find((x) => x.role === role);
      return p?.target.kind === "entity" ? p.target.entity.id : undefined;
    };
    expect(named("hyperschema")).toBe(ENTITY);
    expect(named("schema")).toBe(livingEntity);
    expect(named("schema")).toBe(LIVING);
    expect(named("schemaVersion")).toBe(snapshotEntity);
    // the living entity and its snapshot share the `schema:` prefix but the snapshot pins a @hash
    expect(snapshotEntity.startsWith(`${LIVING}@`)).toBe(true);
    // §21: the Schema is no longer a passenger — no inline policy JSON, no term blob rides the binding
    const flat = JSON.stringify(binding);
    expect(flat).not.toContain(termCanonicalHex(PLANT.body));
    expect(flat).not.toContain('"group"');
    expect(flat).not.toContain('"pick"'); // the resolution policy lives at its own entity now
  });

  it("does not file its entity pointers under the definition bucket (loadHyperSchema/loadSchema stay clean)", () => {
    const { binding } = registrationDeltaClaims(
      ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 5,
    );
    for (const p of binding.pointers) {
      if (p.target.kind === "entity") {
        expect(p.target.entity.context).not.toBe("definition");
      }
    }
  });

  it("publishes the living Schema and its snapshot with identical resolution bytes", () => {
    const { living, snapshot } = registrationDeltaClaims(
      ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 5,
    );
    // both are SCHEMA_SCHEMA publications carrying the same canonical term (props+default); only the
    // entity they file under differs (the living lens vs. the frozen version).
    const term = (c: typeof living): string | undefined => {
      const p = c.pointers.find((x) => x.role.endsWith(".schema.term"));
      return p?.target.kind === "primitive" && typeof p.target.value === "string"
        ? p.target.value
        : undefined;
    };
    expect(term(living)).toBeDefined();
    expect(term(snapshot)).toBe(term(living));
  });
});

describe("readRegistrations: the surface is generated from surviving definitions", () => {
  it("loads the schema from its own entity deltas and round-trips policy and roots", () => {
    const reactor = world(define(PLANT, OPERATOR, 1), ...register(OPERATOR, 2));
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.hyperschema.name).toBe("Plant");
    expect(termHash(regs[0]!.hyperschema.body)).toBe(termHash(PLANT.body));
    // the resolution Schema is now loaded from the living `schema:Plant` entity, not an inline blob
    expect(regs[0]!.schema.props.get("height")?.kind).toBe("pick");
    expect(regs[0]!.schema.name).toBe("Plant"); // a published Schema carries its own name (0.5.0)
    expect(regs[0]!.roots).toEqual([FERN]);
  });

  it("evolution is append: the latest surviving definition wins, body and all", () => {
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      ...register(OPERATOR, 2),
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
      ...register(OPERATOR, 2),
      makeDelta(makeNegationClaims(OPERATOR, 3, definition.id)),
    );
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("a negated registration binds nothing even while its definition survives", () => {
    const registration = register(OPERATOR, 2);
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      ...registration,
      makeDelta(makeNegationClaims(OPERATOR, 3, bindingOf(registration).id)),
    );
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("negating the negation revives: the substrate's algebra, honored on registrations too", () => {
    const registration = register(OPERATOR, 2);
    const retirement = makeDelta(makeNegationClaims(OPERATOR, 3, bindingOf(registration).id));
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      ...registration,
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
      ...registration,
      makeDelta(makeNegationClaims(MALLORY, 3, bindingOf(registration).id)), // Mallory's, roots in nobody
    );
    expect(readRegistrations(reactor, OPERATOR)).toHaveLength(1);
  });

  it("foreign law is inert: a newer non-operator definition cannot reshape a governed surface", () => {
    const reactor = world(
      define(PLANT, OPERATOR, 1),
      ...register(OPERATOR, 2),
      define(PLANT_V2, MALLORY, 999), // newer, but Mallory roots in nobody the operator blessed
    );
    const regs = readRegistrations(reactor, OPERATOR);
    expect(regs).toHaveLength(1);
    expect(termHash(regs[0]!.hyperschema.body)).toBe(termHash(PLANT.body)); // the operator's v1 holds
  });

  it("a foreign registration is likewise inert in a governed store", () => {
    const reactor = world(define(PLANT, OPERATOR, 1), ...register(MALLORY, 2));
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("ungoverned (no operator): any verified author's definition binds", () => {
    const reactor = world(define(PLANT, MALLORY, 1), ...register(MALLORY, 2));
    const regs = readRegistrations(reactor);
    expect(regs).toHaveLength(1);
    expect(regs[0]!.hyperschema.name).toBe("Plant");
  });

  it("a registration whose definition never arrived binds nothing (unbound, not a crash)", () => {
    const reactor = world(...register(OPERATOR, 2));
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("a malformed binding binds nothing (roots stripped)", () => {
    const { binding } = registrationDeltaClaims(
      ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 5,
    );
    const mangled = makeDelta({
      ...binding,
      pointers: binding.pointers.filter((p) => p.role !== "roots"),
    });
    const reactor = world(define(PLANT, OPERATOR, 1), mangled);
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });

  it("a binding whose schema entity was never planted binds nothing (unbound, not a crash)", () => {
    // the binding NAMES a living Schema entity; if only the hyperschema arrives, loadSchema throws
    // and the registration is quietly unbound — never a boot crash.
    const { binding } = registrationDeltaClaims(
      ENTITY,
      "Plant",
      PLANT_POLICY,
      [FERN],
      OPERATOR,
      () => 5,
    );
    const reactor = world(define(PLANT, OPERATOR, 1), makeDelta(binding));
    expect(readRegistrations(reactor, OPERATOR)).toEqual([]);
  });
});
