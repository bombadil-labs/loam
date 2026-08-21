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

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
import { readContestedBindings, readRegistrations } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
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
      // OBJECT LEVEL: the withholding reaches the SURFACE. The pool's own reader drops both
      // contenders, so without this the reading could be right while a door served one of them.
      expect(() => me.def("alice:Shared")).toThrow();
      // Two-sided: the peer's own uncontested lens still serves through the same pool.
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
      const pool = ch.pool.gateway!;
      await declareConflicts(pool, OP_SEED);
      // A BARE name — outside the channel's namespace. The pool holds a real contest over it.
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

      // Two-sided, and this is the whole point: the POOL names the contest...
      expect(readContestedBindings(pool.reactor, pool.operatorAuthor).has("Sneaky")).toBe(true);
      // ...and the receiver's reading does not, because the name is outside the prefix the fold
      // aggregates by. A pool that could name any lens could put a contest a person did not cause
      // in front of them, over a name this store binds itself.
      expect(me.contestedNames().has("Sneaky")).toBe(false);
      // And the pool's IN-prefix contests still come through, so the filter is not just "nothing".
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
      // Declared FIRST, so both rivals actually land — an undeclared store refuses the second
      // publish loudly (§47 criterion 12), and a store holding one binding proves nothing about a
      // reading that only ever reports contests between two.
      const declaration = signClaims(
        bindingPolicyClaims("conflicts", gw.operatorAuthor!, gw.nextTimestamp()),
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
      const contended = gw.contestedNames().get("Shared") ?? [];
      expect(contended).toHaveLength(2);

      // Now STRIKE the declaration. The policy read is latest-SURVIVING, so no mode is in force —
      // and the reading must fall silent even though both rival bindings are still legible.
      await gw.append([
        signClaims(
          makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), declaration.id),
          OP_SEED,
        ),
      ]);
      gw.replayRegistrations();

      // DELTA LEVEL: nothing was withdrawn but the law — both bindings are still in the ground.
      for (const row of contended) expect(bindingIn(gw, row.deltaId)).toBeDefined();
      // OBJECT LEVEL: no policy withholds anything, so the name serves again...
      expect(gw.def("Shared")).toBeDefined();
      // ...and the reading says nothing. A reading that answered from the registrations alone
      // would report a contest this store's law no longer has.
      expect(gw.contestedNames().size).toBe(0);
      // Asserted on the single-ground reader too, which has no served-surface reconciliation to
      // fall back on — so this pins the POLICY check rather than the surface check.
      expect(readContestedBindings(gw.reactor, gw.operatorAuthor).size).toBe(0);
    } finally {
      await gw.close();
    }
  });

  it("an undeclared store keeps its cross-origin shape: the root's binding wins, and nothing is withheld", async () => {
    const alice = await store(ALICE_SEED);
    const me = await store(OP_SEED);
    try {
      // ORDER IS THE WHOLE RAIL, and the channel is opened FIRST for a reason: a pool is seeded
      // with a copy of the root ground at open, so a root binding published under the channel's
      // prefix BEFORE the open lands in the pool and there is no cross-origin contest to have.
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
      // alice publishes AFTER the root claimed the name, so the blessing is the LATER binding. Any
      // recency rule would hand the name over; §47 criterion 12 says an undeclared store keeps
      // today's shape, where root rows enter the fixpoint first and win.
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      await ch.sync();
      const pool = ch.pool.gateway!;
      const channelRow = readRegistrations(pool.reactor, pool.operatorAuthor).find(
        (r) => r.lensName === "alice:Plant",
      );
      // The fixture's own premise, asserted: the pool holds the PEER's binding, and it is later.
      expect(channelRow?.entity).toBe("hyperschema:Plant");
      expect(channelRow?.boundAt ?? 0).toBeGreaterThan(rootAt);

      // OBJECT LEVEL: the ROOT's definition is what the surface serves under that name — the later
      // binding did NOT take it, because no policy is in force to hand it over.
      expect(me.def("alice:Plant").entity).toBe("hyperschema:Rival");
      // DELTA LEVEL: the peer's binding is in the pool all the same — it lost the fold, it was not
      // refused at the door.
      expect(bindingIn(pool, channelRow!.boundId!)).toBeDefined();
      // And no law withholds anything, so the reading is silent.
      expect(me.contestedNames().size).toBe(0);
    } finally {
      await alice.close();
      await me.close();
    }
  });

  it("a name the surface SERVES is never reported as withheld, whatever a ground says", async () => {
    // A channel pool is seeded with a COPY of the receiver's root ground, so a re-attach can put
    // the ROOT's own binding into the pool as a second contender for a name the root is meanwhile
    // serving. The pool then reads a contest that the surface does not have. The reading must
    // follow the surface: announcing a refusal the doors are not honouring is the failure that
    // matters. (The copying itself is §46/§47 ground, not this reading's to change.)
    const home = mkdtempSync(join(tmpdir(), "loam-t204-"));
    const alice = await store(ALICE_SEED);
    try {
      await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);
      const genesis = assembleGenesis({ operatorSeed: OP_SEED, registrations: [] });
      const backendFor = (pool: string): SqliteBackend =>
        new SqliteBackend(join(home, `${pool.replace(/[^A-Za-z0-9._-]/g, "_")}.sqlite`));

      const first = await Gateway.boot(new SqliteBackend(join(home, "store.sqlite")), genesis, {
        channelBackend: backendFor,
      });
      await declareConflicts(first, OP_SEED);
      const ch = await first.openChannel({
        into: "friends",
        prefix: "alice",
        from: "https://peer.example/default",
        source: feed(alice),
      });
      await ch.sync();
      await first.publishRegistration(
        bodyNamed("Rival"),
        named("alice:Plant"),
        [FERN],
        undefined,
        "hyperschema:Rival",
      );
      // Before the reboot this IS a live cross-origin contest, and the surface refuses the name.
      expect(first.contestedNames().has("alice:Plant")).toBe(true);
      expect(() => first.def("alice:Plant")).toThrow();
      await first.close();

      const rebooted = await Gateway.boot(new SqliteBackend(join(home, "store.sqlite")), genesis, {
        channelBackend: backendFor,
        channelToken: () => "tok",
      });
      try {
        // The re-attach changed which binding the fold sees, and the name now SERVES...
        expect(rebooted.def("alice:Plant")).toBeDefined();
        // ...so the reading must not call it withheld — that sentence would be false on the page.
        expect(rebooted.contestedNames().has("alice:Plant")).toBe(false);
      } finally {
        await rebooted.close();
      }
    } finally {
      await alice.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
