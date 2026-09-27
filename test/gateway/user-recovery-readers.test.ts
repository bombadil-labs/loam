// The readers of a user recovery (refactor/audit/user-recovery.md), with the records written by
// hand; `loam user recover` (3e-2) writes the same shapes. Asked of every reader that must agree:
// the indexed root reader (`userRootAt`), the View reader (`rootOf`), the raw reader
// (`userRootsRaw`), the door (`holdsGrant`), the governed mask (`dataStruck`), and ownership
// (`keysEverOf`). A bystander user with a literal grant rides every case.

import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { dataStruck, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { governedStrikers } from "../../src/gateway/governed-trust.js";
import { keysEverOf } from "../../src/gateway/principal.js";
import {
  lineageClaims,
  recoveryClaims,
  userGroundOf,
  userRootAt,
  userRootsRaw,
} from "../../src/gateway/user-root.js";
import { rootClaims, rootOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const seedOf = (n: string) => n.repeat(32);
const K0_SEED = seedOf("f0");
const K1_SEED = seedOf("f1");
const K2_SEED = seedOf("f2");
const B_SEED = seedOf("fb");
const M_SEED = seedOf("fe");
const [K0, K1, K2, B, M] = [K0_SEED, K1_SEED, K2_SEED, B_SEED, M_SEED].map(authorForSeed) as [
  string,
  string,
  string,
  string,
  string,
];

const op = (claims: Claims): Delta => signClaims(claims, OP_SEED);
const binding = (seed: string, key: string, t: number): Delta => {
  const root = authorForSeed(seed);
  return signClaims(
    {
      timestamp: t,
      validFrom: t,
      author: root,
      pointers: [
        {
          role: "principal",
          target: { kind: "entity", entity: { id: root, context: "rhizomatic.principal" } },
        },
        { role: "kind", target: { kind: "primitive", value: "binding" } },
        { role: "key", target: { kind: "primitive", value: key } },
      ],
    },
    seed,
  );
};

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

// ada, root K1 (via user-named grants), and bea, a bystander with a literal grant on key B. K1 also
// holds a literal write grant, which a recovery must neutralize without striking it.
async function world(): Promise<Gateway> {
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
  await gw.append([
    op(userClaims("ada", OP, 10)),
    op(rootClaims("ada", K1, OP, 20)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 21)),
    op(grantClaims(STORE_ENTITY, K1, "write", OP, 22)),
    op(userClaims("bea", OP, 23)),
    op(grantClaims(STORE_ENTITY, B, "write", OP, 24)),
    op(grantClaims(STORE_ENTITY, M, "write", OP, 25)),
  ]);
  return gw;
}

// A recovery as the command writes it: the record, its lineage claim, and the new root claim.
async function recover(
  gw: Gateway,
  spec: { previous?: string; root: string; supersedes?: string; retired: string[] },
  t: number,
): Promise<{ record: Delta; lineage: Delta; root: Delta }> {
  const record = op(recoveryClaims({ name: "ada", attempt: `a${t}`, ...spec }, OP, t));
  const lineage = op(
    lineageClaims(
      { name: "ada", recovery: record.id, root: spec.root, retired: spec.retired },
      OP,
      t,
    ),
  );
  const root = op(rootClaims("ada", spec.root, OP, t));
  await gw.append([record, lineage, root]);
  return { record, lineage, root };
}

const readers = (gw: Gateway, at?: number) => {
  const now = at ?? gw.validityNow();
  return {
    index: userRootAt(gw.reactor, now, OP, "ada", new Set(), at ?? Infinity),
    view: at === undefined ? rootOf(gw.reactor, OP, now, "ada") : undefined,
    raw: userRootsRaw(userGroundOf(gw.reactor), OP, "ada"),
  };
};
const writes = (gw: Gateway, key: string) =>
  holdsGrant(gw.reactor, gw.validityNow(), STORE_ENTITY, key, "write", OP);

describe("E3: the head's root is the only eligible root", () => {
  it("after K1→K2, all three readers say K2, and K1 holds no standing through its literal grant", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    expect(readers(gw)).toEqual({ index: K2, view: K2, raw: [K2] });
    expect(writes(gw, K2)).toBe(true);
    expect(writes(gw, K1)).toBe(false);
    expect(writes(gw, B)).toBe(true); // bystander
  });

  it("a LATER operator K1 root claim does not win, in either reader", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await gw.append([op(rootClaims("ada", K1, OP, 40))]);
    expect(readers(gw)).toEqual({ index: K2, view: K2, raw: [K2] });
  });

  it("a K1 claim with a future timestamp does not win", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await gw.federate([op({ ...rootClaims("ada", K1, OP, 10_000), validFrom: 25 })]);
    expect(readers(gw).index).toBe(K2);
    expect(readers(gw).view).toBe(K2);
  });

  it("K0 at 10, K1 at 20, K1→K2 at 30: striking K2's claim leaves NO root; K0 does not revive", async () => {
    const gw = await world();
    await gw.append([op(rootClaims("ada", K0, OP, 11))]);
    const { root } = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await gw.append([op(makeNegationClaims(OP, 31, root.id))]);
    expect(readers(gw)).toEqual({ index: undefined, view: undefined, raw: [] });
    expect(writes(gw, K0)).toBe(false);
    expect(writes(gw, B)).toBe(true);
  });

  it("a recovery superseding the first and naming K1 as root makes K1 the root again", async () => {
    const gw = await world();
    const first = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await recover(gw, { previous: K2, root: K1, supersedes: first.record.id, retired: [K2] }, 40);
    expect(readers(gw)).toEqual({ index: K1, view: K1, raw: [K1] });
    expect(writes(gw, K1)).toBe(true);
    expect(writes(gw, K2)).toBe(false);
  });

  it("an as-of read before the recovery still reads K1 (a control)", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    expect(userRootAt(gw.reactor, 25, OP, "ada", new Set(), 25)).toBe(K1);
  });

  it("an as-of read before the recovery still trusts K1's strike; the present does not", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    const users = userGroundOf(gw.reactor);
    const grants = gw.reactor.snapshot();
    expect(governedStrikers(grants, { now: 25 }, OP, false, { ...users, cut: 25 })).toContain(K1);
    expect(governedStrikers(grants, { now: gw.validityNow() }, OP, false, users)).not.toContain(K1);
  });
});

describe("E4: recovery is durable history", () => {
  it("a negation of the record, or a validUntil on it, changes neither the fence nor keysEverOf", async () => {
    const gw = await world();
    const { record } = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await gw.append([binding(K2_SEED, K1, 32)]);
    await gw.append([op(makeNegationClaims(OP, 33, record.id))]);
    expect(readers(gw)).toEqual({ index: K2, view: K2, raw: [K2] });
    expect([...keysEverOf(gw.reactor, { root: K2 }, OP)].sort()).toEqual([K1, K2].sort());
    expect(writes(gw, K1)).toBe(false);
  });

  it("a record written with a validUntil already past still counts", async () => {
    const gw = await world();
    const record = op({
      ...recoveryClaims(
        { name: "ada", attempt: "x", previous: K1, root: K2, retired: [K1] },
        OP,
        30,
      ),
      validUntil: 31,
    });
    await gw.append([
      record,
      op(lineageClaims({ name: "ada", recovery: record.id, root: K2, retired: [K1] }, OP, 30)),
      op(rootClaims("ada", K2, OP, 30)),
    ]);
    expect(readers(gw).index).toBe(K2);
    expect(writes(gw, K1)).toBe(false);
  });
});

describe("E2: ownership needs the operator record AND the new root's binding", () => {
  it("K2 clears what K1 wrote; bea's value stays; Mallory's binding of B clears nothing", async () => {
    const gw = await world();
    const byK1 = observed(FERN, "tag", "old", 26, K1_SEED);
    const byB = observed(FERN, "tag", "bea", 27, B_SEED);
    await gw.append([byK1, byB]);
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    // the record alone is not ownership
    expect([...keysEverOf(gw.reactor, { root: K2 }, OP)]).toEqual([K2]);
    await gw.append([binding(K2_SEED, K1, 32)]);
    expect([...keysEverOf(gw.reactor, { root: K2 }, OP)].sort()).toEqual([K1, K2].sort());
    await gw.gqlHooks().clear("Plant", FERN, ["tag"], K2_SEED);
    expect(gw.reactor.negationsOf(byK1.id).length).toBeGreaterThan(0);
    expect(gw.reactor.negationsOf(byB.id)).toEqual([]);
    // Mallory binds bea's key: no operator record names that pair, so it is not Mallory's own.
    await gw.append([binding(M_SEED, B, 40)]);
    expect([...keysEverOf(gw.reactor, { root: M }, OP)]).toEqual([M]);
    await gw.gqlHooks().clear("Plant", FERN, ["tag"], M_SEED);
    expect(gw.reactor.negationsOf(byB.id)).toEqual([]);
  });
});

describe("E5: a broken recovery history fails closed, and quarantines every key it names", () => {
  const brokenShapes: Record<string, (gw: Gateway) => Promise<void>> = {
    "a second record that does not supersede": async (gw) => {
      await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
      await recover(gw, { previous: K2, root: K0, retired: [K2] }, 40);
    },
    "an orphan whose supersedes is not held": async (gw) => {
      await recover(
        gw,
        { previous: K1, root: K2, supersedes: "no-such-record", retired: [K1] },
        30,
      );
    },
    "the only record erased while its lineage claim stands": async (gw) => {
      const { record } = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
      await gw.erase(record.id);
    },
    "the head erased while an earlier record and the head's lineage stand": async (gw) => {
      const first = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
      const head = await recover(
        gw,
        { previous: K2, root: K0, supersedes: first.record.id, retired: [K1, K2] },
        40,
      );
      await gw.erase(head.record.id);
    },
    "a first record erased while its successor stands": async (gw) => {
      const first = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
      await recover(
        gw,
        { previous: K2, root: K0, supersedes: first.record.id, retired: [K1, K2] },
        40,
      );
      await gw.erase(first.record.id);
    },
  };
  for (const [shape, breakIt] of Object.entries(brokenShapes)) {
    it(shape, async () => {
      const gw = await world();
      const byK1 = observed(FERN, "height", 1, 26, K1_SEED);
      const byB = observed(FERN, "height", 2, 27, B_SEED);
      await gw.append([byK1, byB]);
      // K1's literal grant, struck then counter-struck: it stands again as a grant.
      const k1Grant = op(grantClaims(STORE_ENTITY, K1, "write", OP, 28));
      const strikeIt = op(makeNegationClaims(OP, 29, k1Grant.id));
      await gw.append([k1Grant, strikeIt, op(makeNegationClaims(OP, 29, strikeIt.id))]);
      await breakIt(gw);
      expect(readers(gw).index).toBeUndefined();
      expect(readers(gw).view).toBeUndefined();
      expect(readers(gw).raw).toEqual([]);
      expect([...keysEverOf(gw.reactor, { root: K2 }, OP)]).toEqual([K2]);
      // door: K1 refused; the bystander writes
      expect(writes(gw, K1)).toBe(false);
      expect(writes(gw, B)).toBe(true);
      // governed mask: K1's strike does not bind; the bystander's does
      const target1 = observed(FERN, "height", 3, 50, B_SEED);
      const target2 = observed(FERN, "height", 4, 51, B_SEED);
      await gw.append([target1, target2]);
      await gw.federate([
        signClaims(makeNegationClaims(K1, 52, target1.id), K1_SEED),
        signClaims(makeNegationClaims(B, 53, target2.id), B_SEED),
      ]);
      const struck = dataStruck(gw.reactor, gw.validityNow(), OP);
      expect(struck(target1.id)).toBe(false);
      expect(struck(target2.id)).toBe(true);
    });
  }

  it("resolving a competing head by erasing the wrong record restores the single chain", async () => {
    const gw = await world();
    await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    const wrong = await recover(gw, { previous: K2, root: K0, retired: [K2] }, 40);
    expect(readers(gw).index).toBeUndefined();
    await gw.erase(wrong.record.id);
    await gw.erase(wrong.lineage.id);
    await gw.erase(wrong.root.id);
    expect(readers(gw)).toEqual({ index: K2, view: K2, raw: [K2] });
    expect(writes(gw, K2)).toBe(true);
  });
});

// The operator's K1 root claim, which a recovery strikes for good (the command does; here, by hand).
const k1RootClaim = (gw: Gateway): Delta =>
  [...gw.reactor.byTarget("user:ada")]
    .map((id) => gw.reactor.get(id)!)
    .find((d) =>
      d.claims.pointers.some(
        (p) => p.role === "root" && p.target.kind === "primitive" && p.target.value === K1,
      ),
    )!;

describe("resets", () => {
  it("erasing only the head record and its lineage is NOT a completed reset: the plain K2 claim reads", async () => {
    const gw = await world();
    await gw.append([op(makeNegationClaims(OP, 29, k1RootClaim(gw).id))]);
    const { record, lineage } = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    await gw.erase(record.id);
    await gw.erase(lineage.id);
    expect(readers(gw).index).toBe(K2);
    expect(readers(gw).view).toBe(K2);
  });

  it("a complete reset (record, lineage and the head's root claim) leaves no root", async () => {
    const gw = await world();
    await gw.append([op(makeNegationClaims(OP, 29, k1RootClaim(gw).id))]);
    const r = await recover(gw, { previous: K1, root: K2, retired: [K1] }, 30);
    for (const d of [r.record, r.lineage, r.root]) await gw.erase(d.id);
    expect(readers(gw)).toEqual({ index: undefined, view: undefined, raw: [] });
  });
});

describe("E11: a pool reads its host's recovery evidence", () => {
  it("keysEverOf and the fence reach a pool that reads the host; a pool with no host answers the root alone", async () => {
    const host = await world();
    await recover(host, { previous: K1, root: K2, retired: [K1] }, 30);
    await host.append([binding(K2_SEED, K1, 32)]);
    const pool = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    open.push(pool);
    await pool.append([op(grantClaims(STORE_ENTITY, K1, "write", OP, 40))]);
    // no host yet: the pool's own ground holds no recovery
    expect([...keysEverOf(pool.reactor, { root: K2 }, OP)]).toEqual([K2]);
    expect(holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, K1, "write", OP)).toBe(true);
    pool.readUsersFrom(host);
    expect([...keysEverOf(pool.reactor, { root: K2 }, OP)].sort()).toEqual([K1, K2].sort());
    expect(holdsGrant(pool.reactor, pool.validityNow(), STORE_ENTITY, K1, "write", OP)).toBe(false);
  });
});
