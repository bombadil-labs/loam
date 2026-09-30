// A grant may name a Loam USER (`user:<name>`) rather than a key; the door resolves it to the
// user's current root at read time (step 5, PLAN). Asked at two levels: the resolution itself
// (`userRootAt`, the door's indexed reader, held equal to `rootOf`, the View reader) and the door
// (an append signed by a key is admitted or refused; `holdsGrant` and the grant readers).
//
// Nothing writes user-named grants yet (step 5 PR 3d-ii does); every one here is hand-appended.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
  type Pointer,
} from "@bombadil/rhizomatic";
import { grantClaims, grantsHeldBy, grantsNaming, holdsGrant } from "../../src/gateway/accounts.js";
import { connectionGrantState } from "../../src/server/admin-federation.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { containerClaims, inboxName } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { delegationClaims } from "../../src/gateway/principal.js";
import { declareUserGround, subjectKeyAt, userRootAt } from "../../src/gateway/user-root.js";
import { rootClaims, rootOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "a1".repeat(32);
const K1 = authorForSeed(K1_SEED);
const K2_SEED = "a2".repeat(32);
const K2 = authorForSeed(K2_SEED);
const X_SEED = "b3".repeat(32);
const X = authorForSeed(X_SEED);
const CONN_SEED = "c4".repeat(32);
const CONN = authorForSeed(CONN_SEED);

afterEach(() => {
  vi.useRealTimers();
});

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
}

const op = (claims: Parameters<typeof signClaims>[0]) => signClaims(claims, OP_SEED);
/** A pool's own law, signed by the pool's key. */
const law = (pool: Gateway, claims: Claims): Delta => pool.signer!.sign(claims);
const both = (gw: Gateway, name: string) => {
  const now = gw.validityNow();
  return { index: userRootAt(gw.reactor, now, OP, name), view: rootOf(gw.reactor, OP, now, name) };
};

async function door(ground: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await ground.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

describe("the door's indexed root reader agrees with the View reader", () => {
  it("across record, re-point, strike, forgery, a non-key value and a struck record", async () => {
    const gw = await store();
    const seen: unknown[] = [];
    const look = () => seen.push(both(gw, "ada"));
    look(); // nothing
    await gw.append([op(rootClaims("ada", K1, OP, 10))]);
    look(); // a root with no user record
    const record = op(userClaims("ada", OP, 11));
    await gw.append([record]);
    look(); // K1
    const second = op(rootClaims("ada", K2, OP, 12));
    await gw.append([second]);
    look(); // K2
    await gw.append([op(makeNegationClaims(OP, 13, second.id))]);
    look(); // back to K1
    await gw.append([signClaims(grantClaims(STORE_ENTITY, X, "write", OP, 14), OP_SEED)]);
    await gw.append([signClaims(rootClaims("ada", X, X, 15), X_SEED)]);
    look(); // a writer's forged root: still K1
    await gw.append([op(rootClaims("ada", "user:ada", OP, 16))]);
    look(); // latest names no key: none
    await gw.append([op(makeNegationClaims(OP, 17, record.id))]);
    look(); // record struck: none
    for (const s of seen) {
      const { index, view } = s as { index: unknown; view: unknown };
      expect(index).toBe(view);
    }
    expect(seen.map((s) => (s as { index: unknown }).index)).toEqual([
      undefined,
      undefined,
      K1,
      K2,
      K1,
      K1,
      undefined,
      undefined,
    ]);
    await gw.close();
  });

  it("an equal timestamp goes to the smaller id, in both readers", async () => {
    const gw = await store();
    await gw.append([op(userClaims("ada", OP, 10))]);
    const a = op(rootClaims("ada", K1, OP, 20));
    const b = op(rootClaims("ada", K2, OP, 20));
    await gw.append([a, b]);
    const winner = a.id < b.id ? K1 : K2;
    expect(both(gw, "ada")).toEqual({ index: winner, view: winner });
    await gw.close();
  });
});

async function adaWithTwoRoots(): Promise<Gateway> {
  const gw = await store();
  await gw.append([op(userClaims("ada", OP, 10)), op(rootClaims("ada", K1, OP, 11))]);
  await gw.append([op(rootClaims("ada", K2, OP, 12))]);
  return gw;
}
const rootsOf = (gw: Gateway) =>
  [...gw.reactor.byTarget("user:ada")]
    .map((id) => gw.reactor.get(id)!)
    .filter((d) => d.claims.pointers.some((p) => p.role === "root"))
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp);

describe("erasure, and claim shapes, as the View reader sees them", () => {
  it("an erased latest root falls back to the earlier one in both readers", async () => {
    const gw = await store();
    await gw.append([op(userClaims("ada", OP, 10)), op(rootClaims("ada", K1, OP, 11))]);
    const second = op(rootClaims("ada", K2, OP, 12));
    await gw.append([second]);
    await gw.erase(second.id);
    expect(both(gw, "ada")).toEqual({ index: K1, view: K1 });
    await gw.close();
  });

  it("a claim erased but still held counts as gone at the door", async () => {
    const gw = await store();
    await gw.append([op(userClaims("ada", OP, 10)), op(rootClaims("ada", K1, OP, 11))]);
    const second = op(rootClaims("ada", K2, OP, 12));
    await gw.append([second]);
    // Stand in for a purge that has not finished: the ground still holds the claim.
    const reactor = gw.reactor;
    declareUserGround(reactor, () => ({ reactor, erased: () => new Set([second.id]) }));
    expect(subjectKeyAt(reactor, gw.validityNow(), OP, "user:ada")).toBe(K1);
    await gw.close();
  });

  it("the gateway hides a root claim erased but not yet purged, as the View does", async () => {
    const gw = await adaWithTwoRoots();
    // An erasure record lands while the claim's bytes stay held: the state a purge fault leaves.
    const [, second] = rootsOf(gw);
    expect(gw.reactor.ingest(op(eraseClaims(second!.id, OP, OP, 30))).status).toBe("accepted");
    expect(gw.reactor.get(second!.id)).toBeDefined();
    expect(subjectKeyAt(gw.reactor, gw.validityNow(), OP, "user:ada")).toBe(K1);
    expect(rootOf(gw.reactor, OP, gw.validityNow(), "ada")).toBe(K1);
    await gw.close();
  });

  it("a latest root under another role, or as an entity, reads as its value in both readers", async () => {
    const gw = await store();
    await gw.append([op(userClaims("ada", OP, 10)), op(rootClaims("ada", K1, OP, 11))]);
    const base = rootClaims("ada", K2, OP, 12);
    const filing = base.pointers.filter((p) => p.target.kind === "entity");
    await gw.append([
      op({
        ...base,
        pointers: [...filing, { role: "key", target: { kind: "primitive", value: K2 } }],
      }),
    ]);
    expect(both(gw, "ada")).toEqual({ index: K2, view: K2 });
    const later = rootClaims("ada", K1, OP, 13);
    await gw.append([
      op({
        ...later,
        pointers: [
          ...filing,
          { role: "root", target: { kind: "entity", entity: { id: K1, context: "k" } } },
        ],
      }),
    ]);
    expect(both(gw, "ada")).toEqual({ index: K1, view: K1 });
    await gw.close();
  });

  it("a latest root of the wrong shape resolves to nothing in both readers", async () => {
    const gw = await store();
    await gw.append([op(userClaims("ada", OP, 10)), op(rootClaims("ada", K1, OP, 11))]);
    const odd = rootClaims("ada", K2, OP, 12);
    await gw.append([
      op({
        ...odd,
        pointers: [...odd.pointers, { role: "note", target: { kind: "primitive", value: "x" } }],
      }),
    ]);
    expect(both(gw, "ada")).toEqual({ index: undefined, view: undefined });
    await gw.close();
  });
});

describe("a grant that names a user stands for the user's current root", () => {
  async function adaGranted() {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 12)),
    ]);
    return gw;
  }

  it("ada's root writes; a bystander does not; the grant reads under the root, not literally", async () => {
    const gw = await adaGranted();
    expect(await door(gw, observed(FERN, "height", 1, 100, K1_SEED))).toBe("admitted");
    expect(await door(gw, observed(FERN, "height", 2, 101, X_SEED))).toBe("refused");
    const now = gw.validityNow();
    expect(grantsHeldBy(gw.reactor, now, K1, OP).map((g) => g.verb)).toEqual(["write"]);
    expect(grantsNaming(gw.reactor, now, K1, OP)).toEqual([]); // selection stays literal
    expect(grantsNaming(gw.reactor, now, "user:ada", OP).map((g) => g.verb)).toEqual(["write"]);
    await gw.close();
  });

  it("re-pointing ada's root moves the grant: the new key writes, the old key does not", async () => {
    const gw = await adaGranted();
    await gw.append([op(rootClaims("ada", K2, OP, 13))]);
    expect(await door(gw, observed(FERN, "height", 3, 102, K2_SEED))).toBe("admitted");
    expect(await door(gw, observed(FERN, "height", 4, 103, K1_SEED))).toBe("refused");
    expect(holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, K1, "write", OP)).toBe(false);
    await gw.close();
  });

  it("a user with no standing record or root holds nothing through the grant", async () => {
    const gw = await store();
    await gw.append([op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 12))]);
    expect(await door(gw, observed(FERN, "height", 5, 104, K1_SEED))).toBe("refused");
    await gw.append([op(rootClaims("ada", K1, OP, 13))]); // a root, but no user record
    expect(await door(gw, observed(FERN, "height", 6, 105, K1_SEED))).toBe("refused");
    await gw.close();
  });

  it("striking ada's user record ends the grant's standing at once", async () => {
    const gw = await adaGranted();
    const record = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p: Pointer) => p.target.kind === "entity" && p.target.entity.context === "loam.user",
      ),
    )!;
    await gw.append([op(makeNegationClaims(OP, 20, record.id))]);
    expect(await door(gw, observed(FERN, "height", 7, 106, K1_SEED))).toBe("refused");
    await gw.close();
  });

  it("an admin grant naming ada lets her root issue grants that bind", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, "user:ada", "admin", OP, 12)),
    ]);
    expect(await door(gw, signClaims(grantClaims(STORE_ENTITY, X, "write", K1, 13), K1_SEED))).toBe(
      "admitted",
    );
    expect(await door(gw, observed(FERN, "height", 8, 107, X_SEED))).toBe("admitted");
    await gw.close();
  });
});

describe("a pool reads its host's users", () => {
  it("an inbox owner named as a user follows a re-point at the host", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, 12)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          13,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    // The pool's owner grant now names the user, not the key.
    await pool.append([
      law(pool, grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, 20)),
    ]);
    expect(await door(pool, observed(FERN, "height", 9, 108, CONN_SEED))).toBe("admitted");
    // Re-pointing ada at the HOST reaches the pool: K1's delegation no longer carries standing
    // through the user-named grant. (The key-literal owner grant bind wrote is struck first, so
    // only the user-named grant is left to consult.)
    const literal = [...pool.reactor.snapshot()].find(
      (d) =>
        d.claims.author === pool.operatorAuthor &&
        d.claims.pointers.some(
          (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === K1,
        ),
    )!;
    await pool.append([law(pool, makeNegationClaims(pool.operatorAuthor!, 21, literal.id))]);
    expect(await door(pool, observed(FERN, "height", 10, 109, CONN_SEED))).toBe("admitted");
    await gw.append([op(rootClaims("ada", K2, OP, 22))]);
    expect(await door(pool, observed(FERN, "height", 11, 110, CONN_SEED))).toBe("refused");
    // Control: a delegation from ada's NEW root lets the connection write again.
    await pool.append([
      signClaims(delegationClaims(K2, CONN, inboxName("home:ada", CONN), 23), K2_SEED),
    ]);
    expect(await door(pool, observed(FERN, "height", 12, 111, CONN_SEED))).toBe("admitted");
    await gw.close();
  });

  it("a re-bind keeps the owner's user-named grant, and revoke finds the delegation through it", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, 12)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          13,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    const named = law(
      pool,
      grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, 20),
    );
    await pool.append([named]);
    const literal = [...pool.reactor.snapshot()].find(
      (d) =>
        d.claims.author === pool.operatorAuthor &&
        d.claims.pointers.some(
          (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === K1,
        ),
    )!;
    await pool.append([law(pool, makeNegationClaims(pool.operatorAuthor!, 21, literal.id))]);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: K1_SEED });
    expect(pool.reactor.negationsOf(named.id)).toEqual([]); // the owner's own grant is kept
    expect(await door(pool, observed(FERN, "height", 13, 112, CONN_SEED))).toBe("admitted");
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
    expect(await door(pool, observed(FERN, "height", 14, 113, CONN_SEED))).toBe("refused");
    expect(connectionGrantState(pool.reactor, pool.validityNow(), pool.operatorAuthor, CONN)).toBe(
      "revoked",
    );
    await gw.close();
  });

  it("revoke finds a delegation from a re-pointed root that no grant names literally", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, 12)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          13,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    await pool.append([
      law(pool, grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, 20)),
    ]);
    const literal = [...pool.reactor.snapshot()].find(
      (d) =>
        d.claims.author === pool.operatorAuthor &&
        d.claims.pointers.some(
          (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === K1,
        ),
    )!;
    await pool.append([law(pool, makeNegationClaims(pool.operatorAuthor!, 20, literal.id))]);
    await gw.append([op(rootClaims("ada", K2, OP, 21))]);
    await pool.append([
      signClaims(delegationClaims(K2, CONN, inboxName("home:ada", CONN), 22), K2_SEED),
    ]);
    expect(await door(pool, observed(FERN, "height", 15, 114, CONN_SEED))).toBe("admitted");
    // K1's old delegation could revive if ada's root ever went back to K1; a re-bind by ada's
    // current key strikes it for good, as recovery does.
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: K2_SEED });
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K2_SEED });
    expect(await door(pool, observed(FERN, "height", 16, 115, CONN_SEED))).toBe("refused");
    await gw.close();
  });

  it("a user unreadable for a while keeps their grant at bind, and revoke refuses to guess", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const T0 = Date.now();
    vi.setSystemTime(T0);
    const gw = await store();
    const record = op(userClaims("ada", OP, T0));
    await gw.append([
      record,
      op(rootClaims("ada", K1, OP, T0 + 1)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          T0 + 3,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    const named = law(
      pool,
      grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, T0 + 10),
    );
    await pool.append([named]);
    // Ada's record is struck until T0+1000: for now her root cannot be read.
    vi.setSystemTime(T0 + 20);
    await gw.append([
      signClaims({ ...makeNegationClaims(OP, T0 + 20, record.id), validUntil: T0 + 1000 }, OP_SEED),
    ]);
    await gw.bindConnection({ container: "home:ada", connectionKey: CONN, ownerSeed: K1_SEED });
    expect(pool.reactor.negationsOf(named.id)).toEqual([]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
    ).rejects.toThrow(/cannot be read now/);
    // Striking the owner grant itself for a while does not let revoke claim success: it stands
    // again when the strike lapses.
    await pool.append([
      law(pool, {
        ...makeNegationClaims(pool.operatorAuthor!, T0 + 21, named.id),
        validUntil: T0 + 1000,
      }),
    ]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
    ).rejects.toThrow(/cannot be read now/);
    await gw.close();
  });

  it("a connection cannot block its own revoke by filing grants that bind nothing", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, 12)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          13,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    // The connection may write, so its grant-shaped deltas land; they bind nothing. It even names
    // itself admin first, to vouch for its own grant — the chain still reaches no operator.
    expect(
      await door(pool, signClaims(grantClaims(STORE_ENTITY, CONN, "admin", CONN, 29), CONN_SEED)),
    ).toBe("admitted");
    for (const verb of ["write", "admin"] as const) {
      expect(
        await door(
          pool,
          signClaims(grantClaims(STORE_ENTITY, "user:ghost", verb, CONN, 30), CONN_SEED),
        ),
      ).toBe("admitted");
    }
    // An owner-side grant for a ghost the operator struck for good stays dead, even when the
    // connection counter-strikes that strike.
    const ghost = law(
      pool,
      grantClaims(STORE_ENTITY, "user:ghost", "admin", pool.operatorAuthor!, 31),
    );
    const forGood = law(pool, makeNegationClaims(pool.operatorAuthor!, 32, ghost.id));
    await pool.append([ghost, forGood]);
    expect(await door(pool, signClaims(makeNegationClaims(CONN, 33, forGood.id), CONN_SEED))).toBe(
      "admitted",
    );
    await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
    expect(await door(pool, observed(FERN, "height", 17, 116, CONN_SEED))).toBe("refused");
    await gw.close();
  });

  it("an owner-issued grant naming an unreadable user still makes revoke refuse", async () => {
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, 10)),
      op(rootClaims("ada", K1, OP, 11)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, 12)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          13,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    // The owner (not the operator) names bob admin; bob has no readable root here.
    await pool.append([
      signClaims(grantClaims(STORE_ENTITY, "user:bob", "admin", K1, 40), K1_SEED),
    ]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
    ).rejects.toThrow(/cannot be read now/);
    await gw.close();
  });

  it("a counter-strike by an admin whose standing lapses for a while still revives the grant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const T0 = Date.now();
    vi.setSystemTime(T0);
    const gw = await store();
    await gw.append([
      op(userClaims("ada", OP, T0)),
      op(rootClaims("ada", K1, OP, T0 + 1)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          T0 + 3,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    vi.setSystemTime(T0 + 100);
    const k3Admin = law(
      pool,
      grantClaims(STORE_ENTITY, K2, "admin", pool.operatorAuthor!, T0 + 10),
    );
    const ghost = law(
      pool,
      grantClaims(STORE_ENTITY, "user:ghost", "admin", pool.operatorAuthor!, T0 + 11),
    );
    const strike = law(pool, makeNegationClaims(pool.operatorAuthor!, T0 + 12, ghost.id));
    await pool.append([k3Admin, ghost, strike]);
    // K2, holding admin, undoes the operator's strike; then K2's own admin is struck for a while.
    await pool.append([signClaims(makeNegationClaims(K2, T0 + 13, strike.id), K2_SEED)]);
    await pool.append([
      law(pool, {
        ...makeNegationClaims(pool.operatorAuthor!, T0 + 14, k3Admin.id),
        validUntil: T0 + 10_000,
      }),
    ]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
    ).rejects.toThrow(/cannot be read now/);
    await gw.close();
  });

  it("admin held only through an unreadable user can still undo a strike, so revoke refuses", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const T0 = Date.now();
    vi.setSystemTime(T0);
    const gw = await store();
    const xRecord = op(userClaims("x", OP, T0));
    await gw.append([
      op(userClaims("ada", OP, T0)),
      op(rootClaims("ada", K1, OP, T0 + 1)),
      op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
      xRecord,
      op(rootClaims("x", K2, OP, T0 + 3)),
      op(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: K1 } },
              in: "input",
            },
          },
          OP,
          T0 + 4,
        ),
      ),
    ]);
    const conn = await gw.bindConnection({
      container: "home:ada",
      connectionKey: CONN,
      ownerSeed: K1_SEED,
    });
    const pool = conn.gateway!;
    vi.setSystemTime(T0 + 100);
    // K2 is admin here only as user x, through two grants.
    const g1 = law(
      pool,
      grantClaims(STORE_ENTITY, "user:x", "admin", pool.operatorAuthor!, T0 + 10),
    );
    const g2 = law(
      pool,
      grantClaims(STORE_ENTITY, "user:x", "admin", pool.operatorAuthor!, T0 + 11),
    );
    await pool.append([g1, g2]);
    // The operator strikes each for good; K2, still admin through the other, undoes each strike.
    const s1 = law(pool, makeNegationClaims(pool.operatorAuthor!, T0 + 12, g1.id));
    await pool.append([s1]);
    await pool.append([signClaims(makeNegationClaims(K2, T0 + 13, s1.id), K2_SEED)]);
    const s2 = law(pool, makeNegationClaims(pool.operatorAuthor!, T0 + 14, g2.id));
    await pool.append([s2]);
    await pool.append([signClaims(makeNegationClaims(K2, T0 + 15, s2.id), K2_SEED)]);
    // Now x cannot be read for a while.
    await gw.append([
      signClaims(
        { ...makeNegationClaims(OP, T0 + 16, xRecord.id), validUntil: T0 + 10_000 },
        OP_SEED,
      ),
    ]);
    await expect(
      gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
    ).rejects.toThrow(/cannot be read now/);
    await gw.close();
  });

  describe("a user whose root is or may become the connection's own key", () => {
    async function inbox(T0: number) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const gw = await store();
      const adaRecord = op(userClaims("ada", OP, T0));
      await gw.append([
        adaRecord,
        op(rootClaims("ada", K1, OP, T0 + 1)),
        op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
        op(
          containerClaims(
            {
              container: "home:ada",
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { match: { field: "author", cmp: "eq", const: K1 } },
                in: "input",
              },
            },
            OP,
            T0 + 3,
          ),
        ),
      ]);
      const conn = await gw.bindConnection({
        container: "home:ada",
        connectionKey: CONN,
        ownerSeed: K1_SEED,
      });
      vi.setSystemTime(T0 + 100);
      await conn.gateway!.append([
        law(
          conn.gateway!,
          grantClaims(STORE_ENTITY, "user:ada", "write", conn.gateway!.operatorAuthor!, T0 + 10),
        ),
      ]);
      return { gw, conn, adaRecord };
    }

    it("a root claim naming the connection that becomes valid later makes revoke refuse", async () => {
      const T0 = Date.now();
      const { gw, conn } = await inbox(T0);
      await gw.append([op({ ...rootClaims("ada", CONN, OP, T0 + 20), validFrom: T0 + 10_000 })]);
      await expect(
        gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
      ).rejects.toThrow(/may become/);
      await gw.close();
    });

    it("a root claim naming the connection while the user is struck for a while makes revoke refuse", async () => {
      const T0 = Date.now();
      const { gw, conn, adaRecord } = await inbox(T0);
      await gw.append([
        op(rootClaims("ada", CONN, OP, T0 + 20)),
        signClaims(
          { ...makeNegationClaims(OP, T0 + 21, adaRecord.id), validUntil: T0 + 10_000 },
          OP_SEED,
        ),
      ]);
      await expect(
        gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
      ).rejects.toThrow(/may become/);
      await gw.close();
    });

    it("striking that root claim for good, as the refusal advises, lets revoke proceed", async () => {
      const T0 = Date.now();
      const { gw, conn } = await inbox(T0);
      const bad = op({ ...rootClaims("ada", CONN, OP, T0 + 20), validFrom: T0 + 10_000 });
      await gw.append([bad]);
      await gw.append([op(makeNegationClaims(OP, T0 + 30, bad.id))]);
      await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
      expect(await door(conn.gateway!, observed(FERN, "height", 31, T0 + 200, CONN_SEED))).toBe(
        "refused",
      );
      await gw.close();
    });

    it("control: with no root claim naming the connection, revoke proceeds", async () => {
      const T0 = Date.now();
      const { gw, conn } = await inbox(T0);
      await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
      expect(await door(conn.gateway!, observed(FERN, "height", 30, T0 + 200, CONN_SEED))).toBe(
        "refused",
      );
      await gw.close();
    });
  });

  describe("authority that may activate later", () => {
    async function inbox(T0: number) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const gw = await store();
      await gw.append([
        op(userClaims("ada", OP, T0)),
        op(rootClaims("ada", K1, OP, T0 + 1)),
        op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
        op(
          containerClaims(
            {
              container: "home:ada",
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { match: { field: "author", cmp: "eq", const: K1 } },
                in: "input",
              },
            },
            OP,
            T0 + 3,
          ),
        ),
      ]);
      const conn = await gw.bindConnection({
        container: "home:ada",
        connectionKey: CONN,
        ownerSeed: K1_SEED,
      });
      vi.setSystemTime(T0 + 100);
      return { gw, conn, pool: conn.gateway! };
    }

    async function futureRoot(T0: number) {
      const { gw, conn, pool } = await inbox(T0);
      // A user-named owner grant, and K2 with write standing that pre-signs a delegation.
      await pool.append([
        law(pool, grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, T0 + 10)),
        law(pool, grantClaims(STORE_ENTITY, K2, "write", pool.operatorAuthor!, T0 + 11)),
      ]);
      await pool.append([
        signClaims(delegationClaims(K2, CONN, inboxName("home:ada", CONN), T0 + 12), K2_SEED),
      ]);
      // The host already holds ada's re-point to K2, valid only later.
      await gw.append([op({ ...rootClaims("ada", K2, OP, T0 + 13), validFrom: T0 + 10_000 })]);
      return { gw, conn, pool };
    }

    it("a pre-signed delegation from a root a timed re-point selects later makes an owner revoke refuse", async () => {
      const T0 = Date.now();
      const { gw, conn, pool } = await futureRoot(T0);
      const before = pool.reactor.size;
      await expect(
        gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
      ).rejects.toThrow(/may later hold/);
      expect(pool.reactor.size).toBe(before); // nothing was struck
      await gw.close();
    });

    it("once the operator strikes that timed re-point for good, an owner revoke proceeds", async () => {
      const T0 = Date.now();
      const { gw, conn, pool } = await futureRoot(T0);
      const later = [...gw.reactor.byTarget("user:ada")]
        .map((id) => gw.reactor.get(id)!)
        .find((d) => d.claims.validFrom === T0 + 10_000)!;
      await gw.append([op(makeNegationClaims(OP, T0 + 20, later.id))]);
      await pool.append([
        // K2's literal write grant is not admin; only the user-named grant could have carried it.
        law(
          pool,
          makeNegationClaims(
            pool.operatorAuthor!,
            T0 + 21,
            [...pool.reactor.snapshot()].find((d) =>
              d.claims.pointers.some(
                (p) =>
                  p.role === "subject" && p.target.kind === "primitive" && p.target.value === K2,
              ),
            )!.id,
          ),
        ),
      ]);
      await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
      expect(await door(pool, observed(FERN, "height", 41, T0 + 200, CONN_SEED))).toBe("refused");
      await gw.close();
    });

    it("the operator's revoke strikes that latent delegation too, so it stays dead after the re-point", async () => {
      const T0 = Date.now();
      const { gw, conn, pool } = await futureRoot(T0);
      await gw.revokeConnection({ inbox: conn, connectionKey: CONN, asPool: true });
      vi.setSystemTime(T0 + 20_000);
      expect(await door(pool, observed(FERN, "height", 40, T0 + 20_001, CONN_SEED))).toBe(
        "refused",
      );
      await gw.close();
    });

    it("a delegation from a key whose admin grant is struck only for a while makes an owner revoke refuse", async () => {
      const T0 = Date.now();
      const { gw, conn, pool } = await inbox(T0);
      const k2Admin = law(
        pool,
        grantClaims(STORE_ENTITY, K2, "admin", pool.operatorAuthor!, T0 + 10),
      );
      await pool.append([k2Admin]);
      await pool.append([
        signClaims(delegationClaims(K2, CONN, inboxName("home:ada", CONN), T0 + 11), K2_SEED),
      ]);
      await pool.append([
        law(pool, {
          ...makeNegationClaims(pool.operatorAuthor!, T0 + 12, k2Admin.id),
          validUntil: T0 + 10_000,
        }),
      ]);
      await expect(
        gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED }),
      ).rejects.toThrow(/may later hold/);
      await gw.close();
    });
  });

  describe("a strike that has not started is not a strike yet", () => {
    async function inbox(T0: number) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(T0);
      const gw = await store();
      await gw.append([
        op(userClaims("ada", OP, T0)),
        op(rootClaims("ada", K1, OP, T0 + 1)),
        op(grantClaims(STORE_ENTITY, K1, "write", OP, T0 + 2)),
        op(
          containerClaims(
            {
              container: "home:ada",
              trust: "curated",
              posture: "shared",
              membership: {
                op: "select",
                pred: { match: { field: "author", cmp: "eq", const: K1 } },
                in: "input",
              },
            },
            OP,
            T0 + 3,
          ),
        ),
      ]);
      const conn = await gw.bindConnection({
        container: "home:ada",
        connectionKey: CONN,
        ownerSeed: K1_SEED,
      });
      vi.setSystemTime(T0 + 10);
      return { gw, conn, pool: conn.gateway! };
    }
    const outcome = async (gw: Gateway, conn: Awaited<ReturnType<typeof inbox>>["conn"]) => {
      try {
        await gw.revokeConnection({ inbox: conn, connectionKey: CONN, ownerSeed: K1_SEED });
        return "revoked";
      } catch {
        return "refused";
      }
    };

    it("a future-start strike on a latent delegation counts only once it starts", async () => {
      const T0 = Date.now();
      const results: string[] = [];
      for (const at of [T0 + 20, T0 + 2000]) {
        const { gw, conn, pool } = await inbox(T0);
        await pool.append([
          law(pool, grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, T0 + 4)),
          law(pool, grantClaims(STORE_ENTITY, K2, "write", pool.operatorAuthor!, T0 + 5)),
        ]);
        const d = signClaims(
          delegationClaims(K2, CONN, inboxName("home:ada", CONN), T0 + 6),
          K2_SEED,
        );
        await pool.append([d]);
        await pool.append([
          law(pool, {
            ...makeNegationClaims(pool.operatorAuthor!, T0 + 7, d.id),
            validFrom: T0 + 2000,
          }),
        ]);
        await gw.append([op({ ...rootClaims("ada", K2, OP, T0 + 8), validFrom: T0 + 1000 })]);
        vi.setSystemTime(at);
        results.push(await outcome(gw, conn));
        await gw.close();
      }
      expect(results).toEqual(["refused", "revoked"]);
    });

    it("a future-start strike on a timed re-point counts only once it starts", async () => {
      const T0 = Date.now();
      const results: string[] = [];
      for (const at of [T0 + 20, T0 + 2000]) {
        const { gw, conn, pool } = await inbox(T0);
        await pool.append([
          law(pool, grantClaims(STORE_ENTITY, "user:ada", "admin", pool.operatorAuthor!, T0 + 4)),
          law(pool, grantClaims(STORE_ENTITY, K2, "write", pool.operatorAuthor!, T0 + 5)),
        ]);
        await pool.append([
          signClaims(delegationClaims(K2, CONN, inboxName("home:ada", CONN), T0 + 6), K2_SEED),
        ]);
        const repoint = op({ ...rootClaims("ada", K2, OP, T0 + 7), validFrom: T0 + 1000 });
        await gw.append([repoint]);
        await gw.append([
          op({ ...makeNegationClaims(OP, T0 + 8, repoint.id), validFrom: T0 + 2000 }),
        ]);
        vi.setSystemTime(at);
        results.push(await outcome(gw, conn));
        await gw.close();
      }
      expect(results).toEqual(["refused", "revoked"]);
    });

    it("a future-start strike on a root claim naming the connection counts only once it starts", async () => {
      const T0 = Date.now();
      const results: string[] = [];
      for (const at of [T0 + 20, T0 + 2000]) {
        const { gw, conn, pool } = await inbox(T0);
        await pool.append([
          law(pool, grantClaims(STORE_ENTITY, "user:ada", "write", pool.operatorAuthor!, T0 + 4)),
        ]);
        const bad = op({ ...rootClaims("ada", CONN, OP, T0 + 5), validFrom: T0 + 1000 });
        await gw.append([bad]);
        await gw.append([op({ ...makeNegationClaims(OP, T0 + 6, bad.id), validFrom: T0 + 2000 })]);
        vi.setSystemTime(at);
        results.push(await outcome(gw, conn));
        await gw.close();
      }
      expect(results).toEqual(["refused", "revoked"]);
    });
  });
});
