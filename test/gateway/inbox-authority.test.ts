// A connection inbox composes into its parent by its owner's authority (step 5 PR 3h; README ruling
// 8, M3). Delta level: what each pool holds. Object level: what the parent's scope serves. A pool's
// bytes never move; only the parent's view of them does.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims, poolOwner } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { writtenByUser } from "../../src/gateway/member-of.js";
import { delegationClaims } from "../../src/gateway/principal.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { boundGroundFor } from "../../src/gateway/reads.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const [ADA_SEED, CONN_SEED, CONN2_SEED] = ["a1", "c1", "c2"].map((h) => h.repeat(32)) as [
  string,
  string,
  string,
];
const [ADA, CONN, CONN2] = [ADA_SEED, CONN_SEED, CONN2_SEED].map(authorForSeed) as [
  string,
  string,
  string,
];
const op = (c: Claims): Delta => signClaims(c, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
  vi.useRealTimers();
});

// A store where ada (root ADA) owns home:ada. `named` binds connections by her name (the user
// form); otherwise by her key.
async function home(named = true) {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  open.push(gw);
  let t = 10;
  await gw.append([
    op(userClaims("ada", OP, t++)),
    op(rootClaims("ada", ADA, OP, t++)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, t++)),
    op(
      containerClaims(
        {
          container: "home:ada",
          trust: "curated",
          posture: "shared",
          membership: writtenByUser("ada", "home:ada"),
        },
        OP,
        t++,
      ),
    ),
  ]);
  const bind = async (seed: string) => {
    const handle = await gw.bindConnection({
      container: "home:ada",
      connectionKey: authorForSeed(seed),
      ownerSeed: ADA_SEED,
      ...(named ? { ownerName: "ada" } : {}),
    });
    return { name: handle.entity!, pool: handle.gateway! };
  };
  const scope = () => new Set(gw.connectionScope({ bound: "home:ada" }).map((d) => d.id));
  return { gw, bind, scope };
}
const writeIn = async (pool: Gateway, seed: string, value: number) => {
  const d = observed(FERN, "height", value, pool.stamp(authorForSeed(seed)).timestamp, seed);
  await pool.append([d]);
  return d;
};

describe("inbox composition by authority", () => {
  for (const named of [true, false]) {
    it(`a revoked connection's writes stay in its pool and leave the parent; a sibling's stay (${named ? "user" : "key"} owner)`, async () => {
      const { gw, bind, scope } = await home(named);
      const one = await bind(CONN_SEED);
      const two = await bind(CONN2_SEED);
      const past = await writeIn(one.pool, CONN_SEED, 1);
      const sibling = await writeIn(two.pool, CONN2_SEED, 2);
      expect([scope().has(past.id), scope().has(sibling.id)]).toEqual([true, true]);
      await gw.revokeConnection({
        inbox: gw.connectionInboxes.get(one.name)!,
        connectionKey: CONN,
        ownerSeed: ADA_SEED,
      });
      expect(one.pool.reactor.get(past.id)).toBeDefined(); // delta level: still held
      expect([scope().has(past.id), scope().has(sibling.id)]).toEqual([false, true]);
    });
  }

  it("a revoked connection's past strike of a parent claim still crosses; its own claims do not", async () => {
    const { gw, bind, scope } = await home();
    const one = await bind(CONN_SEED);
    const primary = observed(FERN, "height", 30, gw.stamp(ADA).timestamp, ADA_SEED);
    await gw.append([primary]);
    const claim = await writeIn(one.pool, CONN_SEED, 8);
    const strike = signClaims(
      makeNegationClaims(CONN, one.pool.stamp(CONN).timestamp, primary.id),
      CONN_SEED,
    );
    await one.pool.append([strike]);
    await gw.revokeConnection({
      inbox: gw.connectionInboxes.get(one.name)!,
      connectionKey: CONN,
      ownerSeed: ADA_SEED,
    });
    const s = scope();
    expect([s.has(primary.id), s.has(strike.id), s.has(claim.id)]).toEqual([true, true, false]);
  });

  it("the owner's own write in a pool composes; a stranger's does not", async () => {
    const { bind, scope } = await home();
    const one = await bind(CONN_SEED);
    const mine = await writeIn(one.pool, ADA_SEED, 3);
    const stranger = observed(FERN, "height", 4, 50, "5e".repeat(32));
    expect(one.pool.reactor.ingest(stranger).status).toBe("accepted"); // planted past the door
    expect([scope().has(mine.id), scope().has(stranger.id)]).toEqual([true, false]);
  });

  it("an owner's strike and an operator's strike of a connection write both cross into the parent", async () => {
    const { gw, bind, scope } = await home();
    const one = await bind(CONN_SEED);
    const a = await writeIn(one.pool, CONN_SEED, 5);
    const b = await writeIn(one.pool, CONN_SEED, 6);
    const byOwner = signClaims(makeNegationClaims(ADA, 60, a.id), ADA_SEED);
    const byOperator = op(makeNegationClaims(OP, 61, b.id));
    await one.pool.append([byOwner]);
    await one.pool.append([byOperator]);
    // The authority filter keeps both strikes beside their claims, in the scope and in the bound
    // ground a reading resolves over; the substrate suppresses a claim whose strike is in the
    // operand set. What a View then serves is the suppression rails' question, not this file's.
    const s = scope();
    expect([s.has(byOwner.id), s.has(byOperator.id)]).toEqual([true, true]);
    const read = boundGroundFor(gw, { container: "home:ada", inbox: one.name }, Date.now());
    expect([byOwner, byOperator, a, b].map((d) => read.has(d.id))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([one.pool.reactor.get(a.id), one.pool.reactor.get(b.id)].every(Boolean)).toBe(true);
  });

  it("a pool with no owner grant, or two owners, fails the parent read; two grants to one owner do not", async () => {
    const { bind, scope } = await home();
    const one = await bind(CONN_SEED);
    // A second grant to the same owner, by key: one owner still.
    await one.pool.append([op(grantClaims(STORE_ENTITY, ADA, "admin", OP, 70))]);
    expect(poolOwner(one.pool)).toEqual({ key: ADA, user: "ada" });
    expect(() => scope()).not.toThrow();
    // A second owner.
    await one.pool.append([op(grantClaims(STORE_ENTITY, CONN2, "admin", OP, 71))]);
    expect(poolOwner(one.pool)).toHaveProperty("refusal");
    expect(() => scope()).toThrow(/containerScope refused: the inbox .* names 2 owners/);
    // No owner at all.
    const grants = one.pool.reactor
      .arrivalLog()
      .filter((d) =>
        d.claims.pointers.some(
          (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === "admin",
        ),
      );
    await one.pool.append(grants.map((g, i) => op(makeNegationClaims(OP, 80 + i, g.id))));
    expect(() => scope()).toThrow(/has no owner/);
  });

  it("F5: a delegation that expires wakes a watch over the owner's term with a narrowed frame", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const { bind } = await home();
    const one = await bind(CONN_SEED);
    const [bound] = one.pool.reactor
      .arrivalLog()
      .filter(
        (d) =>
          d.claims.author === ADA &&
          d.claims.pointers.some(
            (p) =>
              p.role === "kind" && p.target.kind === "primitive" && p.target.value === "delegation",
          ),
      );
    const T = Date.now() + 10_000;
    const t = one.pool.stamp(ADA).timestamp;
    await one.pool.append([
      signClaims({ ...delegationClaims(ADA, CONN, one.name, t), validUntil: T }, ADA_SEED),
    ]);
    await one.pool.append([signClaims(makeNegationClaims(ADA, t + 1, bound!.id), ADA_SEED)]);
    const w = await writeIn(one.pool, CONN_SEED, 7);
    const watch = one.pool.watch(writtenByUser("ada", one.name));
    const first = (await watch.next()).value as Delta[];
    expect(first.map((d) => d.id)).toContain(w.id);
    const next = watch.next(); // the frame itself, awaited
    await vi.advanceTimersByTimeAsync(T - Date.now() + 1);
    const frame = (await next).value as Delta[];
    expect(frame.map((d) => d.id)).not.toContain(w.id);
    await watch.return();
  });
});
