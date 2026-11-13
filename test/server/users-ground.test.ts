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
const IMPOSTOR_SEED = "cc".repeat(32);

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
  it("names a user as an entity resolved through a Schema, never half of a delta", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("ada", OPERATOR_SEED, 100));
    expect(userEntity("ada")).toBe("user:ada");
    expect(resolveUserView(reactor, OPERATOR, Date.now(), "ada")).toEqual({ "loam.user": "ada" });
  });

  it("admits an ordinary author's user/role claim into the ground; only the store's seed's word resolves", () => {
    const reactor = new Reactor();
    const strangerUser = ingested(reactor, mkUser("carol", STRANGER_SEED, 100));
    const strangerRole = ingested(reactor, mkRole("carol", "operator", STRANGER_SEED, 101));

    expect(reactor.get(strangerUser.id)).toBeDefined();
    expect(reactor.get(strangerRole.id)).toBeDefined();

    expect(resolveUserView(reactor, OPERATOR, Date.now(), "carol")).toBeUndefined();
    expect(rolesOf(reactor, OPERATOR, Date.now(), "carol")).toEqual(new Set());
  });

  it("a stranger's negation does not retract what the store's seed said", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("dave", OPERATOR_SEED, 1));
    const role = ingested(reactor, mkRole("dave", "operator", OPERATOR_SEED, 2));
    const strangerStrike = ingested(
      reactor,
      signClaims(makeNegationClaims(authorForSeed(STRANGER_SEED), 3, role.id), STRANGER_SEED),
    );

    expect(reactor.negationsOf(role.id)).toContain(strangerStrike.id);
    expect(rolesOf(reactor, OPERATOR, Date.now(), "dave")).toEqual(new Set<UserRole>(["operator"]));
  });

  it("a store with no operator yields no user and no role", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("erin", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("erin", "operator", OPERATOR_SEED, 2));

    expect(resolveUserView(reactor, undefined, Date.now(), "erin")).toBeUndefined();
    expect(rolesOf(reactor, undefined, Date.now(), "erin")).toEqual(new Set());
  });

  it("a store's-seed-struck role binding leaves the user readable and the role gone from the set", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("finn", OPERATOR_SEED, 1));
    const role = ingested(reactor, mkRole("finn", "operator", OPERATOR_SEED, 2));
    const strike = ingested(
      reactor,
      signClaims(makeNegationClaims(OPERATOR, 3, role.id), OPERATOR_SEED),
    );

    expect(reactor.negationsOf(role.id)).toContain(strike.id);
    expect(resolveUserView(reactor, OPERATOR, Date.now(), "finn")).toBeDefined();
    expect(rolesOf(reactor, OPERATOR, Date.now(), "finn")).toEqual(new Set());
  });

  it("a user holds many roles at once — the Policy is all, never pick", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("gail", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("gail", "operator", OPERATOR_SEED, 2));
    ingested(reactor, mkRole("gail", "actor", OPERATOR_SEED, 3));

    expect(rolesOf(reactor, OPERATOR, Date.now(), "gail")).toEqual(
      new Set<UserRole>(["operator", "actor"]),
    );
  });

  it("a user with no grants resolves to an empty set, never undefined and never a default role", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("hank", OPERATOR_SEED, 1));

    const roles = rolesOf(reactor, OPERATOR, Date.now(), "hank");
    expect(roles).toEqual(new Set());
    expect(roles.has("operator")).toBe(false);
    expect(resolveUserView(reactor, OPERATOR, Date.now(), "hank")).toBeDefined();
  });

  it("the reader is rolesOf, returning a Set — there is no singular roleOf", () => {
    expect(SRC).not.toMatch(/export function roleOf\(/);
    expect(SRC).toMatch(/export function rolesOf\(/);

    const reactor = new Reactor();
    ingested(reactor, mkUser("iris", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("iris", "operator", OPERATOR_SEED, 2));
    expect(rolesOf(reactor, OPERATOR, Date.now(), "iris")).toBeInstanceOf(Set);
  });

  it("a user name is safe in an entity id, a JSON key and an HTML page", () => {
    expect(userNameDefect("bad name")).toBeDefined();
    expect(userNameDefect("<script>")).toBeDefined();
    expect(userNameDefect("UPPER")).toBeDefined();
    expect(userNameDefect("ok-name_1.2")).toBeUndefined();
    expect(userNameDefect("9lives")).toBeUndefined();
    expect(userNameDefect("")).toBeDefined();
    expect(userNameDefect("a".repeat(64))).toBeUndefined();
    expect(userNameDefect("a".repeat(65))).toBeDefined();
    expect(userNameDefect("bad name")).toContain("1–64 characters");
    expect(userEntity("wren")).toBe("user:wren");
  });

  it("many users may hold the operator role, independently", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("jane", OPERATOR_SEED, 1));
    ingested(reactor, mkUser("kane", OPERATOR_SEED, 2));
    const janeRole = ingested(reactor, mkRole("jane", "operator", OPERATOR_SEED, 3));
    ingested(reactor, mkRole("kane", "operator", OPERATOR_SEED, 4));

    expect(rolesOf(reactor, OPERATOR, Date.now(), "jane")).toEqual(new Set<UserRole>(["operator"]));
    expect(rolesOf(reactor, OPERATOR, Date.now(), "kane")).toEqual(new Set<UserRole>(["operator"]));

    ingested(reactor, signClaims(makeNegationClaims(OPERATOR, 5, janeRole.id), OPERATOR_SEED));

    expect(rolesOf(reactor, OPERATOR, Date.now(), "jane")).toEqual(new Set());
    expect(rolesOf(reactor, OPERATOR, Date.now(), "kane")).toEqual(new Set<UserRole>(["operator"]));
  });

  it("names the role read by the store's own seed, never 'the genesis operator'", () => {
    expect(SRC.toLowerCase()).not.toContain("genesis operator");
  });

  it("a role claim signed by any other key resolves to nothing; the store's seed's own resolves", () => {
    const reactor = new Reactor();
    ingested(reactor, mkUser("carol", OPERATOR_SEED, 1));
    const impostorRole = ingested(reactor, mkRole("carol", "operator", IMPOSTOR_SEED, 2));

    expect(reactor.get(impostorRole.id)).toBeDefined();
    expect(rolesOf(reactor, OPERATOR, Date.now(), "carol")).toEqual(new Set());

    const genuineRole = ingested(reactor, mkRole("carol", "operator", OPERATOR_SEED, 3));
    expect(reactor.get(genuineRole.id)).toBeDefined();
    expect(rolesOf(reactor, OPERATOR, Date.now(), "carol")).toEqual(
      new Set<UserRole>(["operator"]),
    );
  });

  it("an unknown role name is refused before assertion; a role not held is simply absent", () => {
    expect(userRoleDefect("admin")).toContain("operator or actor");
    expect(userRoleDefect("operator")).toBeUndefined();
    expect(userRoleDefect("actor")).toBeUndefined();

    const reactor = new Reactor();
    ingested(reactor, mkUser("liam", OPERATOR_SEED, 1));
    ingested(reactor, mkRole("liam", "actor", OPERATOR_SEED, 2));
    expect(rolesOf(reactor, OPERATOR, Date.now(), "liam")).toEqual(new Set<UserRole>(["actor"]));
  });

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
