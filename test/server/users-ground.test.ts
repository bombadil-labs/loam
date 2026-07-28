// §36 phase 2 — a user is a fact (T123). Ticket's 13 criteria, transcribed from
// .adlc/specs/36-02-a-user-is-a-fact.md. Two levels asserted wherever a negation is in play: the
// DELTA level (is the strike genuinely in the store?) and the OBJECT level (what does a reader
// resolve through USER_SCHEMA?).
//
// What this file deliberately does NOT rail: a struck USER-record claim (only a struck ROLE
// binding, per criterion 5) — phase 10 (erasure honesty) owns that. And nothing here reads a raw
// View's `loam.role` field directly; every functional assertion goes through `rolesOf`, which is
// the point of criterion 8.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Reactor } from "@bombadil/rhizomatic";
import { entityGatherJson } from "../../src/gateway/gather.js";
import {
  resolveUserView,
  roleClaims,
  rolesOf,
  userClaims,
  userEntity,
  userNameDefect,
  userRoleDefect,
  type UserRole,
} from "../../src/server/users.js";

const OPERATOR_SEED = "aa".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const STRANGER_SEED = "bb".repeat(32);
const IMPOSTOR_SEED = "cc".repeat(32); // "any other key" — not the store's seed, not a stranger's

function mkUser(name: string, seed: string, ts: number): Delta {
  return signClaims(userClaims(name, authorForSeed(seed), ts), seed);
}

function mkRole(name: string, role: UserRole, seed: string, ts: number): Delta {
  return signClaims(roleClaims(name, role, authorForSeed(seed), ts), seed);
}

function ingested(reactor: Reactor, delta: Delta): Delta {
  const result = reactor.ingest(delta);
  if (result.status !== "accepted") {
    throw new Error(`fixture delta refused: ${JSON.stringify(result)}`);
  }
  return delta;
}

const SRC = readFileSync(new URL("../../src/server/users.ts", import.meta.url), "utf8");

describe("§36 phase 2 — a user is a fact", () => {
  // Criterion 1
  it("names a user as an entity resolved through a Schema, never half of a delta", () => {
    expect(SRC).not.toMatch(/half of a user that IS a delta/i);
    expect(SRC).toMatch(/is an ENTITY/);
    expect(SRC).toMatch(
      /resolves? through a Schema|resolved into a View|Schema over a HyperSchema/i,
    );
  });

  // Criterion 2 — delta level (admitted) and object level (excluded) in one rail
  it("admits an ordinary author's user/role claim into the ground; only the store's seed's word resolves", () => {
    const reactor = new Reactor();
    const strangerUser = ingested(reactor, mkUser("carol", STRANGER_SEED, 100));
    const strangerRole = ingested(reactor, mkRole("carol", "operator", STRANGER_SEED, 101));

    // delta level: nothing at the append door refused these
    expect(reactor.get(strangerUser.id)).toBeDefined();
    expect(reactor.get(strangerRole.id)).toBeDefined();

    // object level: the store's seed never spoke, so no user resolves at all
    expect(resolveUserView(reactor, OPERATOR, "carol")).toBeUndefined();
    expect(rolesOf(reactor, OPERATOR, "carol")).toEqual(new Set());
  });

  // Criterion 3 — two-sided
  it("a stranger's negation does not retract what the store's seed said", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("dave", OPERATOR_SEED, 1));
    const role = ingested(reactor, mkRole("dave", "operator", OPERATOR_SEED, 2));
    const strangerStrike = ingested(
      reactor,
      signClaims(makeNegationClaims(authorForSeed(STRANGER_SEED), 3, role.id), STRANGER_SEED),
    );

    // delta level: the strike really is in the store
    expect(reactor.negationsOf(role.id)).toContain(strangerStrike.id);
    // object level: it does not bind — the role still resolves
    expect(rolesOf(reactor, OPERATOR, "dave")).toEqual(new Set<UserRole>(["operator"]));
  });

  // Criterion 4
  it("a store with no operator yields no user and no role", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("erin", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("erin", "operator", OPERATOR_SEED, 2));

    expect(resolveUserView(reactor, undefined, "erin")).toBeUndefined();
    expect(rolesOf(reactor, undefined, "erin")).toEqual(new Set());
  });

  // Criterion 5 — two-sided
  it("a store's-seed-struck role binding leaves the user readable and the role gone from the set", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("finn", OPERATOR_SEED, 1));
    const role = ingested(reactor, mkRole("finn", "operator", OPERATOR_SEED, 2));
    const strike = ingested(
      reactor,
      signClaims(makeNegationClaims(OPERATOR, 3, role.id), OPERATOR_SEED),
    );

    // delta level
    expect(reactor.negationsOf(role.id)).toContain(strike.id);
    // object level: user still readable, role gone
    expect(resolveUserView(reactor, OPERATOR, "finn")).toBeDefined();
    expect(rolesOf(reactor, OPERATOR, "finn")).toEqual(new Set());
  });

  // Criterion 6
  it("a user holds many roles at once — the Policy is all, never pick", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("gail", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("gail", "operator", OPERATOR_SEED, 2));
    ingested(reactor, mkRole("gail", "actor", OPERATOR_SEED, 3));

    expect(rolesOf(reactor, OPERATOR, "gail")).toEqual(new Set<UserRole>(["operator", "actor"]));
  });

  // Criterion 7
  it("a user with no grants resolves to an empty set, never undefined and never a default role", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("hank", OPERATOR_SEED, 1));

    const roles = rolesOf(reactor, OPERATOR, "hank");
    expect(roles).toEqual(new Set());
    expect(roles.has("operator")).toBe(false); // membership, not equality
    expect(resolveUserView(reactor, OPERATOR, "hank")).toBeDefined(); // the user is still readable
  });

  // Criterion 8
  it("the reader is rolesOf, returning a Set — there is no singular roleOf", () => {
    expect(SRC).not.toMatch(/export function roleOf\(/);
    expect(SRC).toMatch(/export function rolesOf\(/);

    const reactor = new Reactor();
    ingested(reactor, mkUser("iris", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("iris", "operator", OPERATOR_SEED, 2));
    expect(rolesOf(reactor, OPERATOR, "iris")).toBeInstanceOf(Set);
  });

  // Criterion 9
  it("a user name is safe in an entity id, a JSON key and an HTML page", () => {
    expect(userNameDefect("bad name")).toBeDefined();
    expect(userNameDefect("<script>")).toBeDefined();
    expect(userNameDefect("UPPER")).toBeDefined();
    expect(userNameDefect("ok-name_1.2")).toBeUndefined();
    expect(userEntity("wren")).toBe("user:wren");
  });

  // Criterion 10 — two-sided
  it("many users may hold the operator role, independently", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("jane", OPERATOR_SEED, 1));
    ingested(reactor, mkUser("kane", OPERATOR_SEED, 2));
    const janeRole = ingested(reactor, mkRole("jane", "operator", OPERATOR_SEED, 3));
    ingested(reactor, mkRole("kane", "operator", OPERATOR_SEED, 4));

    expect(rolesOf(reactor, OPERATOR, "jane")).toEqual(new Set<UserRole>(["operator"]));
    expect(rolesOf(reactor, OPERATOR, "kane")).toEqual(new Set<UserRole>(["operator"]));

    ingested(reactor, signClaims(makeNegationClaims(OPERATOR, 5, janeRole.id), OPERATOR_SEED));

    expect(rolesOf(reactor, OPERATOR, "jane")).toEqual(new Set()); // revoked
    expect(rolesOf(reactor, OPERATOR, "kane")).toEqual(new Set<UserRole>(["operator"])); // survives
  });

  // Criterion 11
  it("names the role read by the store's own seed, never 'the genesis operator'", () => {
    expect(SRC.toLowerCase()).not.toContain("genesis operator");
  });

  // Criterion 12 — two-sided, with a positive control
  it("a role claim signed by any other key resolves to nothing; the store's seed's own resolves", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("carol", OPERATOR_SEED, 1));
    const impostorRole = ingested(reactor, mkRole("carol", "operator", IMPOSTOR_SEED, 2));

    // delta level: the stray claim IS in the store
    expect(reactor.get(impostorRole.id)).toBeDefined();
    // object level: no reading admits it
    expect(rolesOf(reactor, OPERATOR, "carol")).toEqual(new Set());

    // positive control: the identical claim, signed by the store's seed, does resolve
    const genuineRole = ingested(reactor, mkRole("carol", "operator", OPERATOR_SEED, 3));
    expect(reactor.get(genuineRole.id)).toBeDefined();
    expect(rolesOf(reactor, OPERATOR, "carol")).toEqual(new Set<UserRole>(["operator"]));
  });

  // Criterion 13
  it("an unknown role name is refused before assertion; a role not held is simply absent", () => {
    expect(userRoleDefect("admin")).toBeDefined();
    expect(userRoleDefect("operator")).toBeUndefined();
    expect(userRoleDefect("actor")).toBeUndefined();

    const reactor = new Reactor();
    ingested(reactor, mkUser("liam", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("liam", "actor", OPERATOR_SEED, 2));
    expect(rolesOf(reactor, OPERATOR, "liam")).toEqual(new Set<UserRole>(["actor"]));
  });

  // Not one of the ticket's 13, but earned by the P1 premortem (T123): entityGatherBody's new
  // `authoredBy` option must leave every existing caller's Term byte-identical when omitted.
  // Hand-written, not derived from the code under test (H10).
  it("omitting authoredBy leaves the ordinary entity gather unchanged for every other caller", () => {
    expect(entityGatherJson()).toEqual({
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    });
  });
});
