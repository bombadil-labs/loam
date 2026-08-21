// T204 — §47.1's refusal, made READABLE. Under a declared `conflicts` policy a contested name is
// withheld from the surface. This file rails the reading that says WHICH name, BETWEEN WHOM, and
// FROM WHERE, so the absence is a stated refusal rather than a 404-shaped hole.
//
// Two grounds hold bindings, and the reading must be total over both. The root's own contests are
// resolved inside `readRegistrations`; a ROOT-vs-CHANNEL contest is resolved in the replay fold,
// which read `interpretBindingPolicy(...).winners` and dropped `.contested` on the floor — so under
// `conflicts` both contenders left the surface and nothing named either. That discard is the
// defect criterion (b) pins.
//
// What each test asserts, at both levels:
//   - delta level: every row's `deltaId` resolves to a real binding delta, in the ground the row's
//     origin names, carrying the row's own author and timestamp. A root row is absent from the
//     pool and a pool row is absent from the root, so `origin` is proved from the bytes rather
//     than from the reading's own word.
//   - object level: the surface refuses the contested name (`def` throws), an uncontested sibling
//     keeps serving, and the reading names every contender.
//
// What it deliberately does NOT assert, and the rail that would close it: that a POOL-INTERNAL
// contest can ARISE through federation. `bindArrived` keys its manifest rows by lens name, so a
// peer's two definitions for one name collapse to one row and one blessing — the channel path
// cannot produce two contenders inside one pool. The third test therefore plants them with the
// pool gateway's own `publishRegistration`, which is the call `adoptLaw` makes one layer down; the
// rail that would close the gap is a federation fixture, and it needs a blessing path that carries
// a peer's contest across.
//
// Erasure standing rule: every store here is this file's own in-memory fixture.

import { describe, expect, it } from "vitest";
import { signClaims, type Delta, type HyperSchema, type Schema } from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OP_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });
/** A second definition over the same body: a different ENTITY wanting the same living name. */
const bodyNamed = (name: string): HyperSchema => ({ name, alg: 1, body: PLANT.body });

const store = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));

const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

/** Declare `conflicts` in a ground, signed by the operator whose law that ground reads. */
const declareConflicts = (gw: Gateway, seed: string): Promise<unknown> =>
  gw.append([
    signClaims(bindingPolicyClaims("conflicts", gw.operatorAuthor!, gw.nextTimestamp()), seed),
  ]);

/**
 * The row's own binding delta, in the ground the row's origin names — and nowhere else.
 *
 * This is the assertion that makes `origin` mean something. A reading that stamped every row
 * "root" would satisfy any check on the field's shape; only resolving the delta in one ground and
 * failing to resolve it in the other proves the row says where the law actually lives.
 */
const bindingIn = (gw: Gateway, deltaId: string): Delta | undefined => gw.reactor.get(deltaId);

describe("T204 — a contested name is named, with its origin", () => {
  it("(a) a root-vs-root contest names both contenders, with origin, author, timestamp, and delta id", async () => {
    const gw = await store(OP_SEED);
    try {
      await declareConflicts(gw, OP_SEED);
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      const second = await gw.publishRegistration(
        bodyNamed("Two"),
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      expect(second.persisted).toBe(true);
      expect(second.bound).toBe(false);
      // OBJECT LEVEL: the name does not serve. The reading below is the only place a person learns
      // why, which is the whole reason it exists.
      expect(() => gw.def("Shared")).toThrow();

      const rows = gw.contestedNames().get("Shared") ?? [];
      expect(rows.map((r) => r.entity).sort()).toEqual(["hyperschema:One", "hyperschema:Two"]);
      for (const row of rows) {
        expect(row.origin).toBe("root");
        expect(row.author).toBe(gw.operatorAuthor);
        // DELTA LEVEL: the row is what the ground says, field by field. A timestamp of 0 or an
        // author copied from the operator argument would pass a shape check and fail this.
        const delta = bindingIn(gw, row.deltaId);
        expect(delta, `no binding delta ${row.deltaId} in the root ground`).toBeDefined();
        expect(delta!.claims.author).toBe(row.author);
        expect(delta!.claims.timestamp).toBe(row.timestamp);
        expect(row.timestamp).toBeGreaterThan(0);
      }
    } finally {
      await gw.close();
    }
  });

  it("(a) an uncontested lens on the same store is absent from the reading and still serves", async () => {
    const gw = await store(OP_SEED);
    try {
      await declareConflicts(gw, OP_SEED);
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      await gw.publishRegistration(
        bodyNamed("Two"),
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      await gw.publishRegistration(
        bodyNamed("Calm"),
        named("Calm"),
        [FERN],
        undefined,
        "hyperschema:Calm",
      );
      // Two-sided: a reading that named every registration would pass the test above and fail here.
      expect(gw.contestedNames().has("Shared")).toBe(true);
      expect(gw.contestedNames().has("Calm")).toBe(false);
      expect(gw.def("Calm")).toBeDefined();
    } finally {
      await gw.close();
    }
  });

  it("(b) a root-vs-channel contest names both — the fold no longer discards it", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await declareConflicts(me, OP_SEED);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      // The channel's lens SERVES before the contest — so the refusal below is the contest's doing
      // and not a channel that never bound.
      expect(me.def("alice:Plant")).toBeDefined();

      const rival = await me.publishRegistration(
        bodyNamed("Rival"),
        named("alice:Plant"),
        [FERN],
        undefined,
        "hyperschema:Rival",
      );
      expect(rival.persisted).toBe(true);
      expect(rival.bound).toBe(false);
      // OBJECT LEVEL: `conflicts` has no incumbent advantage across origins either — the channel's
      // lens leaves the surface with the challenger.
      expect(() => me.def("alice:Plant")).toThrow();

      const pool = ch.pool.gateway!;
      const rows = me.contestedNames().get("alice:Plant") ?? [];
      expect(rows).toHaveLength(2);
      const byOrigin = new Map(rows.map((r) => [r.origin, r]));
      expect([...byOrigin.keys()].sort()).toEqual(["channel:friends:alice", "root"]);

      const fromRoot = byOrigin.get("root")!;
      const fromChannel = byOrigin.get("channel:friends:alice")!;
      expect(fromRoot.entity).toBe("hyperschema:Rival");
      expect(fromChannel.entity).not.toBe("hyperschema:Rival");

      // DELTA LEVEL, both ways: each binding is in the ground its origin names and absent from the
      // other. This is what a row's `origin` claims, checked against the bytes.
      expect(bindingIn(me, fromRoot.deltaId)).toBeDefined();
      expect(bindingIn(pool, fromRoot.deltaId)).toBeUndefined();
      expect(bindingIn(pool, fromChannel.deltaId)).toBeDefined();
      expect(bindingIn(me, fromChannel.deltaId)).toBeUndefined();

      // The AUTHOR is the key that signed the binding, never the origin rank the fold ranks by: a
      // blessing is the receiving operator's own act, so both rows carry the operator's key and
      // only `origin` tells them apart.
      for (const [row, ground] of [
        [fromRoot, me],
        [fromChannel, pool],
      ] as const) {
        expect(row.author).toBe(me.operatorAuthor);
        expect(row.author.startsWith("channel:")).toBe(false);
        const delta = bindingIn(ground, row.deltaId)!;
        expect(delta.claims.author).toBe(row.author);
        expect(delta.claims.timestamp).toBe(row.timestamp);
        expect(row.timestamp).toBeGreaterThan(0);
      }
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a POOL-INTERNAL contest is named too, under the pool's own declared law", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      const pool = ch.pool.gateway!;
      // The pool is a ground of its own, and it reads its OWN policy — the root's declaration does
      // not travel. Declaring here is what makes the pool's contest resolvable at all.
      await declareConflicts(pool, OP_SEED);
      await pool.publishRegistration(
        bodyNamed("PoolOne"),
        named("alice:Shared"),
        [FERN],
        undefined,
        "hyperschema:PoolOne",
      );
      await pool.publishRegistration(
        bodyNamed("PoolTwo"),
        named("alice:Shared"),
        [FERN],
        undefined,
        "hyperschema:PoolTwo",
      );
      me.replayRegistrations();

      const rows = me.contestedNames().get("alice:Shared") ?? [];
      expect(rows.map((r) => r.entity).sort()).toEqual([
        "hyperschema:PoolOne",
        "hyperschema:PoolTwo",
      ]);
      for (const row of rows) {
        expect(row.origin).toBe("channel:friends:alice");
        expect(bindingIn(pool, row.deltaId)).toBeDefined();
        expect(bindingIn(me, row.deltaId)).toBeUndefined();
      }
      // Two-sided: the peer's own uncontested lens still serves through the same pool.
      expect(me.def("alice:Plant")).toBeDefined();
      expect(me.contestedNames().has("alice:Plant")).toBe(false);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("an undeclared store reports nothing contested — the reading is the policy's, not a scanner", async () => {
    const gw = await store(OP_SEED);
    try {
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      // No policy is declared, so a second registration for one name meets today's LOUD build-time
      // collision (§47 criterion 12) — it never lands, and nothing is withheld by law. A reading
      // that answered from the registrations alone would report a contest this store does not have.
      await expect(
        gw.publishRegistration(
          bodyNamed("Two"),
          named("Shared"),
          [FERN],
          undefined,
          "hyperschema:Two",
        ),
      ).rejects.toThrow(/collides/);
      expect(gw.contestedNames().size).toBe(0);
      expect(gw.def("Shared")).toBeDefined();
    } finally {
      await gw.close();
    }
  });
});
