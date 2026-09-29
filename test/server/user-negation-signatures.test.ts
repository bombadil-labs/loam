// An operator-authored NEGATION of a claim at a user entity strikes only when its signature
// verifies, and so does a counter-negation of such a strike. A reactor can hold raw-ingested rows no
// door verified (`reactor.ingest` takes them), so each case ingests an UNSIGNED negation that names
// the operator as author. A negation is filed at the delta it strikes, not at the user entity, so
// this is a separate path from the unsigned claims in user-root-signatures.test.ts. Asked of every
// reader that must agree: the indexed root reader (`userRootAt`), the View reader (`rootOf`,
// `rolesOf`), the raw reader (`userRootsRaw`), the revoke readers (`subjectCouldName`,
// `keysSubjectCouldName`) and the door (`holdsGrant`). Every case also reads a bystander user, bea,
// whose signed claims must stand.

import { afterEach, describe, expect, it } from "vitest";
import { appendWithHostCut } from "../helpers/recovery-cut.js";
import {
  authorForSeed,
  makeDelta,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  keysSubjectCouldName,
  lineageClaims,
  recoveryClaims,
  subjectCouldName,
  userGroundOf,
  userRootAt,
  userRootsRaw,
} from "../../src/gateway/user-root.js";
import { roleClaims, rolesOf, rootClaims, rootOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "5e".repeat(32);
const OP = authorForSeed(OP_SEED);
const [K1, K2, B] = ["e1", "e2", "eb"].map((s) => authorForSeed(s.repeat(32))) as [
  string,
  string,
  string,
];

const op = (claims: Claims): Delta => signClaims(claims, OP_SEED);
// The same claims with no signature: accepted by `reactor.ingest`, refused by every signed door.
const unsigned = (claims: Claims): Delta => makeDelta(claims);
const strike = (id: string, t: number): Claims => makeNegationClaims(OP, t, id);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

// ada, root K1, holds a user-named write grant and the actor role. bea, the bystander, root B, holds
// a user-named write grant and the operator role. Every claim here is signed by the operator.
async function world() {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  open.push(gw);
  const ada = {
    user: op(userClaims("ada", OP, 10)),
    root: op(rootClaims("ada", K1, OP, 11)),
    role: op(roleClaims("ada", "actor", OP, 12)),
  };
  await gw.append([
    ada.user,
    ada.root,
    ada.role,
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 13)),
    op(userClaims("bea", OP, 14)),
    op(rootClaims("bea", B, OP, 15)),
    op(roleClaims("bea", "operator", OP, 16)),
    op(grantClaims(STORE_ENTITY, "user:bea", "write", OP, 17)),
  ]);
  return { gw, ada };
}

const ingest = (gw: Gateway, d: Delta) => {
  expect(d.sig).toBeUndefined();
  expect(gw.reactor.ingest(d).status).toBe("accepted");
  // The negation is held and indexed against the delta it strikes: every reader could see it.
  const target = d.claims.pointers[0]!.target;
  expect(target.kind === "delta" && gw.reactor.negationsOf(target.deltaRef.delta)).toContain(d.id);
};

const readers = (gw: Gateway, name: string) => {
  const now = gw.validityNow();
  return {
    index: userRootAt(gw.reactor, now, OP, name, userGroundOf(gw.reactor).erased()),
    view: rootOf(gw.reactor, OP, now, name),
    raw: userRootsRaw(userGroundOf(gw.reactor), OP, name),
  };
};
const writes = (gw: Gateway, key: string) =>
  holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, key, "write", OP);
const roles = (gw: Gateway, name: string) => [...rolesOf(gw.reactor, OP, gw.validityNow(), name)];

const beaStands = (gw: Gateway) => {
  expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
  expect(writes(gw, B)).toBe(true);
  expect(roles(gw, "bea")).toEqual(["operator"]);
};

describe("an unsigned operator negation strikes no user claim", () => {
  it("an unsigned strike of ada's root claim leaves ada at K1 in every reader and at the door", async () => {
    const { gw, ada } = await world();
    ingest(gw, unsigned(strike(ada.root.id, 30)));
    expect(readers(gw, "ada")).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(writes(gw, K1)).toBe(true);
    const now = gw.validityNow();
    expect(subjectCouldName(gw.reactor, now, OP, "user:ada", K1)).toBe(true);
    expect(keysSubjectCouldName(gw.reactor, now, OP, "user:ada")).toEqual([K1]);
    beaStands(gw);
  });

  it("an unsigned strike of ada's role claim leaves her the role", async () => {
    const { gw, ada } = await world();
    ingest(gw, unsigned(strike(ada.role.id, 30)));
    expect(roles(gw, "ada")).toEqual(["actor"]);
    beaStands(gw);
  });

  it("an unsigned strike of ada's loam.user claim leaves ada a user", async () => {
    const { gw, ada } = await world();
    ingest(gw, unsigned(strike(ada.user.id, 30)));
    expect(readers(gw, "ada")).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(roles(gw, "ada")).toEqual(["actor"]);
    expect(writes(gw, K1)).toBe(true);
    beaStands(gw);
  });
});

describe("under a recovery chain, an unsigned strike leaves the head's root claim standing", () => {
  // ada recovers from K1 to K2: the signed record, lineage claim and root claim for K2.
  async function recovered() {
    const { gw, ada } = await world();
    const record = op(
      recoveryClaims({ name: "ada", attempt: "a", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const lineage = op(
      lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30),
    );
    const root = op(rootClaims("ada", K2, OP, 31));
    await appendWithHostCut(gw, OP_SEED, [record, lineage, root]);
    expect(readers(gw, "ada")).toEqual({ index: K2, view: K2, raw: [K2] });
    return { gw, ada, root };
  }

  it("an unsigned strike of the K2 root claim leaves ada at K2", async () => {
    const { gw, root } = await recovered();
    ingest(gw, unsigned(strike(root.id, 40)));
    expect(readers(gw, "ada")).toEqual({ index: K2, view: K2, raw: [K2] });
    expect(writes(gw, K2)).toBe(true);
    expect(writes(gw, K1)).toBe(false);
    beaStands(gw);
  });

  it("the same strike, signed, leaves ada no root (a control)", async () => {
    const { gw, root } = await recovered();
    await gw.append([op(strike(root.id, 40))]);
    expect(readers(gw, "ada")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K2)).toBe(false);
    beaStands(gw);
  });
});

describe("an unsigned operator counter-negation lifts no signed strike", () => {
  it("a signed strike of ada's root claim still binds under an unsigned counter-strike", async () => {
    const { gw, ada } = await world();
    const struck = op(strike(ada.root.id, 30));
    await gw.append([struck]);
    ingest(gw, unsigned(strike(struck.id, 31)));
    expect(readers(gw, "ada")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K1)).toBe(false);
    expect(roles(gw, "ada")).toEqual(["actor"]);
    beaStands(gw);
  });

  it("a signed strike of ada's role claim still binds under an unsigned counter-strike", async () => {
    const { gw, ada } = await world();
    const struck = op(strike(ada.role.id, 30));
    await gw.append([struck]);
    ingest(gw, unsigned(strike(struck.id, 31)));
    expect(roles(gw, "ada")).toEqual([]);
    beaStands(gw);
  });
});

describe("the same negations, signed, do strike (controls)", () => {
  it("a signed strike of ada's root claim removes her root in every reader and at the door", async () => {
    const { gw, ada } = await world();
    await gw.append([op(strike(ada.root.id, 30))]);
    expect(readers(gw, "ada")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K1)).toBe(false);
    const now = gw.validityNow();
    expect(subjectCouldName(gw.reactor, now, OP, "user:ada", K1)).toBe(false);
    expect(keysSubjectCouldName(gw.reactor, now, OP, "user:ada")).toEqual([]);
    beaStands(gw);
  });

  it("a signed strike of ada's role and of her user claim removes the role and the user", async () => {
    const { gw, ada } = await world();
    await gw.append([op(strike(ada.role.id, 30))]);
    expect(roles(gw, "ada")).toEqual([]);
    await gw.append([op(strike(ada.user.id, 31))]);
    expect(readers(gw, "ada")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K1)).toBe(false);
    beaStands(gw);
  });

  it("a signed counter-strike lifts a signed strike of ada's root claim", async () => {
    const { gw, ada } = await world();
    const struck = op(strike(ada.root.id, 30));
    await gw.append([struck]);
    await gw.append([op(strike(struck.id, 31))]);
    expect(readers(gw, "ada")).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(writes(gw, K1)).toBe(true);
    beaStands(gw);
  });
});
