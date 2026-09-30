// An operator-authored claim at a user entity counts only when its signature verifies. A reactor
// can hold raw-ingested rows no door verified (`reactor.ingest` takes them), so each case here
// ingests an UNSIGNED row that names the operator as author and would otherwise win. Asked of every
// reader that must agree: the indexed root reader (`userRootAt`), the View reader (`rootOf`,
// `rolesOf`), the raw reader (`userRootsRaw`), the revoke readers (`subjectCouldName`,
// `keysSubjectCouldName`), the name reader (`nameStillHeld`) and the door (`holdsGrant`). Every
// case also reads a bystander user, bea, whose signed claims must stand.

import { afterEach, describe, expect, it } from "vitest";
import { appendWithHostCut } from "../helpers/recovery-cut.js";
import {
  authorForSeed,
  makeDelta,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  CTX_USER,
  keysSubjectCouldName,
  lineageClaims,
  recoveryClaims,
  subjectCouldName,
  userEntity,
  userGroundOf,
  userRootAt,
  userRootsRaw,
} from "../../src/gateway/user-root.js";
import {
  nameStillHeld,
  roleClaims,
  rolesOf,
  rootClaims,
  rootOf,
  userClaims,
} from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { unjournaled } from "../helpers/unjournaled.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const [K1, K2, B] = ["d1", "d2", "db"].map((s) => authorForSeed(s.repeat(32))) as [
  string,
  string,
  string,
];

const op = (claims: Claims): Delta => signClaims(claims, OP_SEED);
// The same claims with no signature: accepted by `reactor.ingest`, refused by every signed door.
const unsigned = (claims: Claims): Delta => makeDelta(claims);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

// ada, root K1, holds a user-named write grant and the actor role. bea, the bystander, root B, holds
// a user-named write grant and the operator role. Every claim here is signed by the operator.
async function world(): Promise<Gateway> {
  const gw = await Gateway.boot(
    unjournaled(new MemoryBackend()),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  open.push(gw);
  await gw.append([
    op(userClaims("ada", OP, 10)),
    op(rootClaims("ada", K1, OP, 11)),
    op(roleClaims("ada", "actor", OP, 12)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 13)),
    op(userClaims("bea", OP, 14)),
    op(rootClaims("bea", B, OP, 15)),
    op(roleClaims("bea", "operator", OP, 16)),
    op(grantClaims(STORE_ENTITY, "user:bea", "write", OP, 17)),
  ]);
  return gw;
}

const ingest = (gw: Gateway, d: Delta) => {
  expect(d.sig).toBeUndefined();
  expect(gw.reactor.ingest(d).status).toBe("accepted");
  // The row is held, filed at the user's own index: every reader below could see it.
  const entity = d.claims.pointers.find((p) => p.target.kind === "entity")!.target;
  expect(entity.kind === "entity" && gw.reactor.byTarget(entity.entity.id).includes(d.id)).toBe(
    true,
  );
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

describe("an unsigned operator root claim changes no user's root", () => {
  it("a later unsigned root claim for K2 leaves ada at K1 in every reader and at the door", async () => {
    const gw = await world();
    ingest(gw, unsigned(rootClaims("ada", K2, OP, 30)));
    expect(readers(gw, "ada")).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(writes(gw, K1)).toBe(true);
    expect(writes(gw, K2)).toBe(false);
    const now = gw.validityNow();
    expect(subjectCouldName(gw.reactor, now, OP, "user:ada", K2)).toBe(false);
    expect(subjectCouldName(gw.reactor, now, OP, "user:ada", K1)).toBe(true);
    expect(keysSubjectCouldName(gw.reactor, now, OP, "user:ada")).toEqual([K1]);
    // The bystander.
    expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
    expect(writes(gw, B)).toBe(true);
  });

  it("the same claim, signed, does move ada to K2 (a control)", async () => {
    const gw = await world();
    await gw.append([op(rootClaims("ada", K2, OP, 30))]);
    expect(readers(gw, "ada")).toEqual({ index: K2, view: K2, raw: [K1, K2].sort() });
    expect(writes(gw, K2)).toBe(true);
    expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
  });

  it("under a recovery chain, an unsigned root claim for the head's key gives the head no standing", async () => {
    const gw = await world();
    // The record and lineage claim are signed; the operator's root claim for K2 is not.
    const record = op(
      recoveryClaims({ name: "ada", attempt: "a", previous: K1, root: K2, retired: [K1] }, OP, 30),
    );
    const lineage = op(
      lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30),
    );
    await appendWithHostCut(gw, OP_SEED, [record, lineage]);
    ingest(gw, unsigned(rootClaims("ada", K2, OP, 31)));
    expect(readers(gw, "ada")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K2)).toBe(false);
    expect(writes(gw, K1)).toBe(false);
    expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
    expect(writes(gw, B)).toBe(true);
  });
});

describe("an unsigned operator user record neither creates nor un-names a user", () => {
  it("an unsigned loam.user claim for cid, beside a signed root and grant, does not create cid", async () => {
    const gw = await world();
    await gw.append([
      op(rootClaims("cid", K2, OP, 20)),
      op(grantClaims(STORE_ENTITY, "user:cid", "write", OP, 21)),
    ]);
    ingest(gw, unsigned(userClaims("cid", OP, 22)));
    expect(readers(gw, "cid")).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K2)).toBe(false);
    expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
    expect(writes(gw, B)).toBe(true);
  });

  it("a later unsigned loam.user claim with another value does not un-name ada", async () => {
    const gw = await world();
    const rename = userClaims("ada", OP, 30);
    ingest(
      gw,
      unsigned({
        ...rename,
        pointers: [
          {
            role: "user",
            target: { kind: "entity", entity: { id: userEntity("ada"), context: CTX_USER } },
          },
          { role: "name", target: { kind: "primitive", value: "eve" } },
        ],
      }),
    );
    expect(readers(gw, "ada")).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(writes(gw, K1)).toBe(true);
    expect(readers(gw, "bea")).toEqual({ index: B, view: B, raw: [B] });
  });

  it("a name held only by unsigned rows is free; a signed name stays held", async () => {
    const gw = await world();
    ingest(gw, unsigned(userClaims("dan", OP, 30)));
    ingest(gw, unsigned(rootClaims("dan", K2, OP, 31)));
    const now = gw.validityNow();
    expect(nameStillHeld(gw.reactor, OP, now, "dan")).toEqual({ held: false });
    expect(nameStillHeld(gw.reactor, OP, now, "bea").held).toBe(true);
  });
});

describe("an unsigned operator role claim grants no role", () => {
  it("ada keeps only her signed role; bea keeps hers", async () => {
    const gw = await world();
    ingest(gw, unsigned(roleClaims("ada", "operator", OP, 30)));
    const now = gw.validityNow();
    expect([...rolesOf(gw.reactor, OP, now, "ada")]).toEqual(["actor"]);
    expect([...rolesOf(gw.reactor, OP, now, "bea")]).toEqual(["operator"]);
  });
});
