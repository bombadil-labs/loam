import { describe, expect, it, vi } from "vitest";
import {
  makeNegationClaims,
  signClaims,
  type Delta,
  type HyperSchema,
  type Schema,
} from "@bombadil/rhizomatic";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import type { ContestedName } from "../../src/gateway/lifecycle.js";
import {
  readContestedBindings,
  readLawfulContested,
  readRegistrations,
} from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";
import { gatewayOf } from "../helpers/pool-gateway.js";

const OP_SEED = "cc".repeat(32);
const ALICE_SEED = "a1".repeat(32);
const named = (name: string): Schema => ({ ...PLANT_POLICY, name });
const bodyNamed = (name: string): HyperSchema => ({ name, alg: 1, body: PLANT.body });

const store = (seed: string): Promise<Gateway> =>
  Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: seed, registrations: [] }));

const feed = (g: Gateway) => ({ pull: () => Promise.resolve(g.reactor.arrivalLog()) });

const declareConflicts = (gw: Gateway): Promise<Delta> => {
  const declaration = gw.signer!.sign(
    withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
  );
  return gw.append([declaration]).then(() => declaration);
};

const bindingIn = (gw: Gateway, deltaId: string): Delta | undefined => gw.reactor.get(deltaId);

const contendersOf = (gw: Gateway, lens: string): readonly ContestedName[] =>
  gw.contestedNames().get(lens)?.contenders ?? [];

describe("T204 — a contested name is named, with its origin", () => {
  it("(a) a root-vs-root contest names both contenders, with origin, author, timestamp, and delta id", async () => {
    const gw = await store(OP_SEED);
    try {
      await declareConflicts(gw);
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
      expect(() => gw.def("Shared")).toThrow();

      const rows = contendersOf(gw, "Shared");
      expect(rows.map((r) => r.entity).sort()).toEqual(["hyperschema:One", "hyperschema:Two"]);
      expect(rows.map((r) => r.entity)).toEqual(["hyperschema:One", "hyperschema:Two"]);
      expect(rows[0]!.timestamp).toBeLessThan(rows[1]!.timestamp);
      expect(rows.some((r) => r.served)).toBe(false);
      for (const row of rows) {
        expect(row.origin).toBe("root");
        expect(row.author).toBe(gw.operatorAuthor);
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
      await declareConflicts(gw);
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
      await declareConflicts(me);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
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
      expect(() => me.def("alice:Plant")).toThrow();

      const pool = gatewayOf(ch.pool);
      const rows = contendersOf(me, "alice:Plant");
      expect(rows).toHaveLength(2);
      const byOrigin = new Map(rows.map((r) => [r.origin, r]));
      expect([...byOrigin.keys()].sort()).toEqual(["channel:friends:alice", "root"]);

      const fromRoot = byOrigin.get("root")!;
      const fromChannel = byOrigin.get("channel:friends:alice")!;
      expect(fromRoot.entity).toBe("hyperschema:Rival");
      expect(fromChannel.entity).not.toBe("hyperschema:Rival");

      expect(bindingIn(me, fromRoot.deltaId)).toBeDefined();
      expect(bindingIn(pool, fromRoot.deltaId)).toBeUndefined();
      expect(bindingIn(pool, fromChannel.deltaId)).toBeDefined();
      expect(bindingIn(me, fromChannel.deltaId)).toBeUndefined();

      expect(pool.operatorAuthor).not.toBe(me.operatorAuthor);
      for (const [row, ground] of [
        [fromRoot, me],
        [fromChannel, pool],
      ] as const) {
        expect(row.author).toBe(ground.operatorAuthor);
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
      const pool = gatewayOf(ch.pool);
      await declareConflicts(pool);
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

      const rows = contendersOf(me, "alice:Shared");
      expect(rows.map((r) => r.entity).sort()).toEqual([
        "hyperschema:PoolOne",
        "hyperschema:PoolTwo",
      ]);
      for (const row of rows) {
        expect(row.origin).toBe("channel:friends:alice");
        expect(bindingIn(pool, row.deltaId)).toBeDefined();
        expect(bindingIn(me, row.deltaId)).toBeUndefined();
      }
      expect(() => me.def("alice:Shared")).toThrow();
      expect(me.def("alice:Plant")).toBeDefined();
      expect(me.contestedNames().has("alice:Plant")).toBe(false);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a pool cannot name a contest outside its own prefix", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      const pool = gatewayOf(ch.pool);
      await declareConflicts(pool);
      for (const n of ["One", "Two"]) {
        await pool.publishRegistration(
          bodyNamed(`Sneaky${n}`),
          named("Sneaky"),
          [FERN],
          undefined,
          `hyperschema:Sneaky${n}`,
        );
      }
      me.replayRegistrations();

      const planted = readRegistrations(
        pool.reactor,
        pool.validityNow(),
        pool.operatorAuthor,
      ).filter((r) => r.lensName === "Sneaky");
      expect(planted).toHaveLength(0);
      expect(
        [...pool.reactor.snapshot()].filter((d) =>
          d.claims.pointers.some(
            (p) => p.target.kind === "entity" && p.target.entity.id === "schema:Sneaky",
          ),
        ).length,
      ).toBeGreaterThan(1);
      expect(
        readContestedBindings(pool.reactor, pool.validityNow(), pool.operatorAuthor).has("Sneaky"),
      ).toBe(true);
      expect(me.contestedNames().has("Sneaky")).toBe(false);
      expect(() => me.def("Sneaky")).toThrow();
      await pool.publishRegistration(
        bodyNamed("InOne"),
        named("alice:Both"),
        [FERN],
        undefined,
        "hyperschema:InOne",
      );
      await pool.publishRegistration(
        bodyNamed("InTwo"),
        named("alice:Both"),
        [FERN],
        undefined,
        "hyperschema:InTwo",
      );
      me.replayRegistrations();
      expect(me.contestedNames().has("alice:Both")).toBe(true);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("an undeclared store reports nothing contested, with both rivals live in the ground", async () => {
    const gw = await store(OP_SEED);
    try {
      const declaration = signClaims(
        withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
        OP_SEED,
      );
      await gw.append([declaration]);
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      await gw.publishRegistration(
        bodyNamed("Two"),
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      const contended = contendersOf(gw, "Shared");
      expect(contended).toHaveLength(2);

      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, declaration.id)),
          OP_SEED,
        ),
      ]);
      gw.replayRegistrations();

      for (const row of contended) expect(bindingIn(gw, row.deltaId)).toBeDefined();
      expect(gw.def("Shared")).toBeDefined();
      expect(gw.contestedNames().size).toBe(0);
      expect(readContestedBindings(gw.reactor, gw.validityNow(), gw.operatorAuthor).size).toBe(0);
    } finally {
      await gw.close();
    }
  });

  it("an undeclared store keeps its cross-origin shape: the root's binding wins, and nothing is withheld", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      await me.publishRegistration(
        bodyNamed("Rival"),
        named("alice:Plant"),
        [FERN],
        undefined,
        "hyperschema:Rival",
      );
      const rootAt = me.def("alice:Plant").boundAt!;
      for (let t = 0; t <= rootAt + 1000;) t = alice.nextTimestamp();
      for (let t = 0; t <= rootAt + 1000;) t = gatewayOf(ch.pool).nextTimestamp();
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(rootAt + 5_000);
      await ch.sync();
      const pool = gatewayOf(ch.pool);
      const channelRow = readRegistrations(
        pool.reactor,
        pool.validityNow(),
        pool.operatorAuthor,
      ).find((r) => r.lensName === "alice:Plant");
      expect(channelRow?.entity).toBe("hyperschema:Plant");
      expect(channelRow?.boundAt ?? 0).toBeGreaterThan(rootAt);

      expect(me.def("alice:Plant").entity).toBe("hyperschema:Rival");
      expect(bindingIn(pool, channelRow!.boundId!)).toBeDefined();
      expect(me.contestedNames().size).toBe(0);
    } finally {
      vi.useRealTimers();
      await alice.close();
      await me.close();
    }
  });

  it("a served name is MARKED, never dropped — and a bystander contest survives beside it", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      const declaration = await declareConflicts(me);
      for (const n of ["One", "Two"]) {
        await me.publishRegistration(
          bodyNamed(`Shared${n}`),
          named("alice:Shared"),
          [FERN],
          undefined,
          `hyperschema:Shared${n}`,
        );
      }
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      const pool = gatewayOf(ch.pool);
      await declareConflicts(pool);
      for (const n of ["One", "Two"]) {
        await pool.publishRegistration(
          bodyNamed(`Burdock${n}`),
          named("alice:Burdock"),
          [FERN],
          undefined,
          `hyperschema:Burdock${n}`,
        );
      }
      expect(me.contestedNames().has("alice:Shared")).toBe(true);
      expect(() => me.def("alice:Shared")).toThrow();
      expect(contendersOf(me, "alice:Shared").some((r) => r.served)).toBe(false);

      await me.append([
        me.signer!.sign(
          withStamp(me.stamp(), (t) => makeNegationClaims(me.operatorAuthor!, t, declaration.id)),
        ),
      ]);
      me.replayRegistrations();
      expect(
        readLawfulContested(pool.reactor, pool.validityNow(), pool.lawAuthors("registrations")).has(
          "alice:Shared",
        ),
      ).toBe(true);
      expect(me.def("alice:Shared")).toBeDefined();
      const rows = contendersOf(me, "alice:Shared");
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.filter((r) => r.served)).toHaveLength(1);
      const marked = rows.find((r) => r.served)!;
      expect(marked.deltaId).toBe(me.def("alice:Shared").boundId);
      expect(marked.origin).toBe("root");
      expect(contendersOf(me, "alice:Burdock")).toHaveLength(2);
      expect(contendersOf(me, "alice:Burdock").some((r) => r.served)).toBe(false);
      expect(() => me.def("alice:Burdock")).toThrow();
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a contest a THIRD binding serves stays listed, with the report naming what answers", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const ch = await me.openChannel({ into: "friends", prefix: "alice", source: feed(alice) });
      await ch.sync();
      const pool = gatewayOf(ch.pool);
      await declareConflicts(pool);
      for (const n of ["One", "Two"]) {
        await pool.publishRegistration(
          bodyNamed(`Pool${n}`),
          named("alice:Shared"),
          [FERN],
          undefined,
          `hyperschema:Pool${n}`,
        );
      }
      await me.publishRegistration(
        bodyNamed("Third"),
        named("alice:Shared"),
        [FERN],
        undefined,
        "hyperschema:Third",
      );

      expect(me.def("alice:Shared").entity).toBe("hyperschema:Third");
      const rows = contendersOf(me, "alice:Shared");
      expect(rows.map((r) => r.entity).sort()).toEqual([
        "hyperschema:PoolOne",
        "hyperschema:PoolTwo",
      ]);
      expect(rows.some((r) => r.served)).toBe(false);
      const other = me.contestedNames().get("alice:Shared")!.servedByOther;
      expect(other?.entity).toBe("hyperschema:Third");
      expect(other?.origin).toBe("root");
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a policy struck after a page load stops withholding — the reading refolds first", async () => {
    const gw = await store(OP_SEED);
    try {
      const declaration = signClaims(
        withStamp(gw.stamp(), (t) => bindingPolicyClaims("conflicts", gw.operatorAuthor!, t)),
        OP_SEED,
      );
      await gw.append([declaration]);
      await gw.publishRegistration(PLANT, named("Shared"), [FERN], undefined, "hyperschema:One");
      await gw.publishRegistration(
        bodyNamed("Two"),
        named("Shared"),
        [FERN],
        undefined,
        "hyperschema:Two",
      );
      expect(contendersOf(gw, "Shared")).toHaveLength(2);

      await gw.append([
        signClaims(
          withStamp(gw.stamp(), (t) => makeNegationClaims(gw.operatorAuthor!, t, declaration.id)),
          OP_SEED,
        ),
      ]);
      expect(gw.contestedNames().size).toBe(0);
      expect(gw.def("Shared")).toBeDefined();
    } finally {
      await gw.close();
    }
  });
});
