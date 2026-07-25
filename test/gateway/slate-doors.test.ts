// T64 (SPEC §29.3/§29.4) — THE THREE CLOSURES, at the doors that honour them.
//
// Criteria 4, 5, 6, 7, 8, 18. This is the file where the slogan "a closure is a set subtraction"
// gets tested against the machinery, which is true of the SET and false of the code:
//
//   - EGRESS subtracts from a set `withNegationClosure` deliberately ENLARGED, so the withheld set
//     must be negation-closed TRANSITIVELY or a naive subtraction re-opens the exact leak that
//     closure exists to seal (H1 read from the other side). Asserted on the PEER's own store,
//     through a Schema — never on what this store's `offeredDeltas` happens to return.
//   - CITE is ONE predicate at TWO doors differing only in DISCLOSURE, and "direct" means NAMES A
//     MEMBER: including through an enumerated PRIMITIVE role that is a delta reference by convention.
//   - READ is a gather-level narrowing whose hardest site is the WARM one, and whose most dangerous
//     mistake would be pushing it down into `select` — where a read-closed slate would self-invalidate
//     and jam its own cut forever. Both halves are asserted here, as explicitly as each other.
//
// NAMED GAP: the PUBLIC door is exercised through `queryPublic` over a declared-public lens, and the
// BYTE door through `serveBytes`; neither is driven over a real HTTP mount here. The closing rail for
// the transport layer would be an integration test in `test/surface/`, which no T64 criterion asks
// for because both doors resolve through the same `hooks.resolve` seam this file already narrows.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  contentAddress,
  signClaims,
  type Delta,
  type Policy,
  type Schema,
} from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { publicClaims } from "../../src/gateway/public.js";
import { gatherImpl } from "../../src/gateway/reads.js";
import { readClosedIds } from "../../src/gateway/slate.js";
import type { LensName } from "../../src/gateway/registration.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";
import {
  AFTER_DEADLINE,
  BEFORE_DEADLINE,
  DEADLINE,
  LAPSED_DEADLINE,
  OP,
  OP_SEED,
  bootSlateStore,
  standSlate,
  strike,
} from "./slating.js";

const L = (n: string): LensName => n as LensName;

/** A second store with its OWN operator — a real peer, never a replica of this one. */
const PEER_SEED = "9a".repeat(32);
const bootPeer = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: PEER_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

/** The height a store resolves THROUGH ITS SCHEMA — the object-level question, at the door. */
async function heightAt(gw: Gateway): Promise<number | null> {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null } }).plant.height;
}

const OPERATOR_GROUND = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: OP } },
  in: "input",
};

describe("T64 criterion 4 — egress closure over a slated NEGATION, asked of the PEER", () => {
  it("withholds the strike AND its target, transitively, and returns them when un-slated", async () => {
    const gw = await bootSlateStore();
    const peer = await bootPeer();
    // The chain: `claim` says height 30. `strike1` retracts it. `strike2` retracts the retraction —
    // so `claim` is LIVE again (a struck strike revives). The slate names only `strike2`.
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike1 = strike(claim.id, 2000);
    await gw.append([strike1]);
    const strike2 = strike(strike1.id, 3000);
    await gw.append([strike2]);
    expect(await heightAt(gw)).toBe(30); // revived at the source: the chain is real

    const stood = await standSlate(gw, { members: [strike2], closes: ["egress"] });

    const report = await peer.federate(gw.offeredDeltas(), { admit: () => true });
    expect(report.accepted).toBeGreaterThan(0);
    // OBJECT LEVEL, on the peer's own store, through a Schema: the peer must not resolve the
    // RETRACTED claim as live. Withholding `strike2` alone would have left `strike1` in the peer's
    // hands with `claim`, and the peer would read 30 — the revived reading the source has and the
    // peer is not entitled to during the window.
    expect(await heightAt(peer)).toBeNull();
    // The whole chain is withheld — the transitive leg, at the delta level.
    for (const id of [strike2.id, strike1.id, claim.id]) {
      expect(peer.reactor.get(id)).toBeUndefined();
    }
    // TWO-SIDED, and the half that catches over-withholding: every non-member is PRESENT. A rail that
    // withheld everything would pass the assertions above and must fail this one.
    expect(peer.reactor.get(bystander.id)).toBeDefined();
    const tags = await peer.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

    // Un-slating returns the members and the withheld targets to the offer on the NEXT pull.
    await gw.append([strike(stood.declaration, 4000)]);
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    await peer.federate(gw.offeredDeltas(), { admit: () => true });
    for (const id of [strike2.id, strike1.id, claim.id]) {
      expect(peer.reactor.get(id)).toBeDefined();
    }
    expect(await heightAt(peer)).toBe(30);
    await gw.close();
    await peer.close();
  });

  it("the WALL-RESEED path inherits it — a wall attached during the window is born clean", async () => {
    const gw = await bootSlateStore();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike1 = strike(claim.id, 2000);
    await gw.append([strike1]);
    const strike2 = strike(strike1.id, 3000);
    await gw.append([strike2]);
    await standSlate(gw, { members: [strike2], closes: ["egress"] });

    // `openWall` seeds from `gw.offeredDeltas()`, so the one subtraction closes this door too — and
    // that is the point on the merits, not a coincidence: a wall that never receives a condemned
    // delta is one fewer copy for the cut to sweep (§24.8's recursion warning, answered).
    const wall = await gw.openContainer({
      trust: "curated",
      posture: "wall",
      membership: OPERATOR_GROUND,
    });
    const inside = wall.gateway!;
    for (const id of [strike2.id, strike1.id, claim.id]) {
      expect(inside.reactor.get(id)).toBeUndefined();
    }
    // Read the fresh container's store THROUGH A SCHEMA: it must not resolve the retracted claim.
    expect(await heightAt(inside)).toBeNull();
    // Two-sided: the bystander crossed, so the seeding edge was not simply empty.
    expect(inside.reactor.get(bystander.id)).toBeDefined();
    await wall.drop();
    await gw.close();
  });
});

describe("T64 criterion 5 — cite closure: ONE predicate, two doors, asymmetric disclosure", () => {
  it("append NAMES the container; federation answers counts only", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    const stood = await standSlate(gw, { members: [member], closes: ["cite"] });

    const citing = (target: string, ts: number): Delta =>
      signClaims(
        {
          timestamp: ts,
          author: OP,
          pointers: [
            { role: "notes", target: { kind: "delta", deltaRef: { delta: target } } },
            { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
          ],
        },
        OP_SEED,
      );

    // THE APPEND DOOR: informative, naming the container. The only parties who can trigger it are
    // parties who could already read the target, so telling them IS the notice.
    await expect(gw.append([citing(member.id, 60_000)])).rejects.toThrow(
      new RegExp(`SLATED FOR ERASURE by the container "${stood.container}"`),
    );
    // THE FEDERATION DOOR: the same predicate, counted and never named. A FederationReport
    // indistinguishable from any other rejection — a peer pushing a citation may have no read access
    // to the target, and a distinguishable refusal would announce that something exists and is leaving.
    const strangerSeed = "c3".repeat(32);
    const strangerCite = signClaims(
      {
        timestamp: 60_100,
        author: authorForSeed(strangerSeed),
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      strangerSeed,
    );
    const refused = await gw.federate([strangerCite], { admit: () => true });
    expect(refused).toEqual({ offered: 1, accepted: 0, rejected: 1 });
    // The shape of an ORDINARY federation rejection, for comparison: no field distinguishes them.
    const forged = { ...strangerCite, id: contentAddress(new TextEncoder().encode("nope")) };
    expect(await gw.federate([forged], { admit: () => true })).toEqual({
      offered: 1,
      accepted: 0,
      rejected: 1,
    });

    // TWO-SIDED: a citation of the BYSTANDER passes both doors while the slate stands.
    await expect(gw.append([citing(bystander.id, 60_200)])).resolves.toBeDefined();
    const strangerOk = signClaims(
      {
        timestamp: 60_300,
        author: authorForSeed(strangerSeed),
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: bystander.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      strangerSeed,
    );
    expect((await gw.federate([strangerOk], { admit: () => true })).accepted).toBe(1);
    await gw.close();
  });
});

describe("T64 criterion 6 — cite is DIRECT only, and the post-cut resubmission is INTENDED", () => {
  it("a delta citing a delta that cites a member is ADMITTED", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    // The first-hop citation lands BEFORE the slate; the second hop arrives during the window.
    const hop1 = signClaims(
      {
        timestamp: 1500,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
    await gw.append([hop1]);
    await standSlate(gw, { members: [member], closes: ["cite"] });
    const hop2 = signClaims(
      {
        timestamp: 60_000,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: hop1.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
    // A DECISION, not an accident: transitive closure is the unbounded scan H8 exists to warn about.
    await expect(gw.append([hop2])).resolves.toBeDefined();
    expect(gw.reactor.get(hop2.id)).toBeDefined();
    await gw.close();
  });

  it("a citation refused during the window is ADMITTED after the cut, as a dangling reference", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["cite"] });
    const cite = signClaims(
      {
        timestamp: 60_000,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([cite])).rejects.toThrow(/SLATED FOR ERASURE/);
    await gw.cut(stood.container, { now: BEFORE_DEADLINE });
    // Cite-closure is a WINDOW property about the orphan set at cut time, never a promise of
    // referential integrity a grow-only union cannot make: admission refuses a delta whose OWN id is
    // dead and does not inspect pointers, so this lands and DANGLES — which is correct, and which
    // §11's citations manifest exists precisely because of.
    await expect(gw.append([cite])).resolves.toBeDefined();
    expect(gw.reactor.get(cite.id)).toBeDefined();
    expect(gw.reactor.get(member.id)).toBeUndefined();
    await gw.close();
  });
});

// --- read closure -------------------------------------------------------------------------------

const pickLatest: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const PROFILE: Schema = {
  props: new Map<string, Policy>([["avatar", pickLatest]]),
  default: pickLatest,
};
const AVATAR = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const bytesFact = (value: Uint8Array, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "avatar" } } },
        { role: "value", target: { kind: "bytes", mime: "image/png", value } },
      ],
    },
    OP_SEED,
  );

describe("T64 criterion 7 — read closure at EVERY door, and the operator's review still answers", () => {
  it("entity/GraphQL, public, byte, as-of BEFORE the slate, and a pinned older lens all decline", async () => {
    // Two readings over ONE program, so the pinned door has a real version to answer under, plus a
    // bytes leaf for the byte door and a public declaration for the anonymous one.
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
          { hyperschema: PLANT, schema: { ...PROFILE, name: "Profile" }, roots: [FERN] },
        ],
      }),
    );
    await gw.append([signClaims(publicClaims(["Plant"], OP, 40_000), OP_SEED)]);
    const height = observed(FERN, "height", 30, 1000, OP_SEED);
    const tag = observed(FERN, "tag", "shade", 1100, OP_SEED);
    const avatar = bytesFact(AVATAR, 1200);
    await gw.append([height, tag, avatar]);

    const ref = contentAddress(AVATAR);
    expect(gw.serveBytes(ref, L("Profile"), FERN, "full").status).toBe(200);
    const pinnedReg = gw.registered.find((r) => r.hyperschema.name === "Plant")!;
    expect(gw.resolvePinned(pinnedReg, FERN).view["height"]).toBe(30);

    // A moment strictly BEFORE the slate lands — the as-of door's most tempting hole.
    const beforeSlate = 30_000;
    await standSlate(gw, { members: [height, avatar], closes: ["read"] });

    // 1. the entity/GraphQL read: the same absence an absent delta produces.
    expect(await heightAt(gw)).toBeNull();
    // 2. the PUBLIC door: the anonymous surface resolves through the same seam.
    const pub = await gw.queryPublic(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((pub.data as { plant: { height: number | null } }).plant.height).toBeNull();
    // 3. the BYTE door: proof-of-read re-resolves the lens, so the uniform 404 it already serves for
    //    an erased source is what a read-closed source gets too.
    expect(gw.serveBytes(ref, L("Profile"), FERN, "full").status).toBe(404);
    // 4. AS-OF at a moment BEFORE the slate: §26 reconstructs the surviving ground at T, and a moment
    //    before the slate would happily serve the condemned delta. The narrowing is applied AFTER the
    //    reconstruction, and the temporal door CONFESSES a suppression count.
    const asOf = await gw.query(`{ plant(entity: "${FERN}") { height tag _asOf } }`);
    expect((asOf.data as { plant: { height: number | null } }).plant.height).toBeNull();
    expect(gw.resolvedNode("Plant", FERN, beforeSlate).suppressed).toBe(2);
    // 5. a PINNED older lens — an old lens over today's ground is still a read door.
    expect(gw.resolvePinned(pinnedReg, FERN).view["height"]).toBeUndefined();

    // "THE SAME UNIFORM REFUSAL AN ABSENT DELTA GETS", proven rather than asserted by eye: a sibling
    // store that never held the member resolves the SAME view and the same content address.
    const never = await bootSlateStore();
    await never.append([tag]);
    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).view).toEqual(
      never.resolvedNode("Plant", FERN).view,
    );
    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).hex).toBe(
      never.resolvedNode("Plant", FERN).hex,
    );
    await never.close();

    // TWO-SIDED, everywhere: the live bystander still answers at every one of those doors.
    expect((pub.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    expect((asOf.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    expect(gw.resolvePinned(pinnedReg, FERN).view["tag"]).toEqual(["shade"]);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "full").status).toBe(404); // a lens without the leaf

    // AND THE OPERATOR'S REVIEW READ STILL ANSWERS: the controller must be able to examine what they
    // are about to destroy, so read closure applies at the doors and never here.
    const stoodContainer = gw.slates(BEFORE_DEADLINE)[0]!;
    expect([...stoodContainer.members].sort()).toEqual([height.id, avatar.id].sort());
    expect(
      gw
        .containerScope({ containers: [stoodContainer.container] })
        .map((d) => d.id)
        .sort(),
    ).toEqual([height.id, avatar.id].sort());
    // Not one byte moved: read closure is suppression, never erasure.
    expect(await gw.backend.holds(height.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 8 — the lapse is computed AT THE DOOR, and the clock is NAMED", () => {
  it("`read` is NOT declared, yet a lapsed deadline closes it — with no delta appended between", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);
    await standSlate(gw, { members: [member], closes: ["egress", "cite"], deadline: DEADLINE });
    const groundBefore = [...gw.reactor.snapshot()].map((d) => d.id).sort();

    // Passed a moment BEFORE the deadline, the door SERVES.
    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).view["height"]).toBe(30);
    // Passed a moment AFTER it, the same door DECLINES — and no delta was appended between the two
    // probes. Nothing in Loam runs a timer, and this design must not pretend one exists.
    expect(
      gw.resolvedNode("Plant", FERN, undefined, AFTER_DEADLINE).view["height"],
    ).toBeUndefined();
    expect([...gw.reactor.snapshot()].map((d) => d.id).sort()).toEqual(groundBefore);
    // Two-sided at both moments: the bystander never moves.
    expect(gw.resolvedNode("Plant", FERN, undefined, AFTER_DEADLINE).view["tag"]).toEqual([
      "shade",
    ]);
    await gw.close();
  });

  it("a read door reached with NO moment REFUSES rather than serving", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    await standSlate(gw, { members: [member], closes: [] });
    // The fail-OPEN direction is the one that matters: an optional `now` defaulting to anything at
    // all would serve the member past a lapsed deadline and look healthy doing it. So the rail
    // asserts a REFUSAL, never a default.
    expect(() => gatherImpl(gw, "Plant", FERN, undefined as unknown as number)).toThrow(
      /no moment was passed/,
    );
    expect(() => readClosedIds(gw, undefined as unknown as number)).toThrow(/no moment was passed/);
    expect(() => readClosedIds(gw, Number.NaN)).toThrow(/no moment was passed/);
    // Two-sided: WITH a moment, the same door serves.
    expect(gatherImpl(gw, "Plant", FERN, BEFORE_DEADLINE)).toBeDefined();
    await gw.close();
  });

  it("THE CLOCKS DO NOT CROSS: delta-time running far ahead must not lapse a live deadline", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    // `nextTimestamp()` is `max(Date.now(), last + 1)`, so a tight append loop drives DELTA-TIME far
    // ahead of wall-clock. A deadline minted in one clock and compared against the other is a bug
    // that only appears on a busy store.
    for (let i = 0; i < 40; i += 1) {
      await gw.append([
        signClaims(
          {
            timestamp: gw.nextTimestamp(),
            author: OP,
            pointers: [
              {
                role: "subject",
                target: { kind: "entity", entity: { id: FERN, context: "churn" } },
              },
              { role: "value", target: { kind: "primitive", value: i } },
            ],
          },
          OP_SEED,
        ),
      ]);
    }
    const deltaTime = gw.nextTimestamp();
    const deadline = Date.now() + 10 * 60_000; // live in WALL-CLOCK, long past in delta-time
    expect(deltaTime).toBeGreaterThan(0);
    await standSlate(gw, {
      members: [member],
      closes: ["cite"],
      deadline,
      requestedAt: Date.now(),
    });
    // The slate is NOT lapsed — the door compares `now` against `deadline`, both wall-clock, and a
    // delta's own timestamp is never compared against a deadline at all.
    const report = gw.slates(Date.now())[0]!;
    expect(report.lapsed).toBe(false);
    expect(report.closes).toEqual(["cite"]);
    expect(await heightAt(gw)).toBe(30);
    await gw.close();
  });

  it("health().slates reports the lapse, and health().status is UNCHANGED by it", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, {
      members: [member],
      closes: ["cite"],
      deadline: LAPSED_DEADLINE,
      requestedAt: LAPSED_DEADLINE - 60_000,
    });
    const health = await gw.health(LAPSED_DEADLINE + 60_000);
    expect(health.slates).toEqual({ open: 1, lapsed: 1, lapsedIds: [stood.container] });
    // A lapsed compliance clock is NOT byte debt: `settling` means a promise already MADE has not
    // reached the bytes, and routing a compliance window through that field is how `settling` earns
    // the right to be ignored. A rail that accepted "settling" here would encode the conflation.
    expect(health.status).toBe("ok");
    expect(health.erasure).toEqual({
      settled: true,
      promised: 0,
      pending: 0,
      outstanding: [],
      unproven: false,
    });
    expect(health.forgiven).toEqual({ count: 0, present: 0, ids: [] });
    // Two-sided: BEFORE the deadline the same store reports the slate open and NOT lapsed.
    const early = await gw.health(LAPSED_DEADLINE - 30_000);
    expect(early.slates).toEqual({ open: 1, lapsed: 0, lapsedIds: [] });
    expect(early.status).toBe("ok");
    await gw.close();
  });
});

describe("T64 criterion 18 — read closure survives the WARM paths, and leaves the primitives alone", () => {
  it("demotes a warm registered root and a live stream, and does NOT narrow select/freeze/scope", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([member, bystander]);

    // THE FIXTURE'S WARMTH IS ASSERTED FIRST — a cold-fixture rail would pass here with the warm path
    // leaking. FERN is a registered root, so reading it materializes the program's hyperview.
    expect(await heightAt(gw)).toBe(30);
    const program = gw.def("Plant").hyperschema.name;
    expect(gw.reactor.materializedView(gw.matName(program), FERN)).toBeDefined();

    // AND a live subscription is OPEN and has received its initial frame carrying the member.
    const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    const first = await stream.next();
    expect((first.value as { plant: { height: number } }).plant.height).toBe(30);

    const stood = await standSlate(gw, { members: [member], closes: ["read"] });

    // The registered-root read no longer serves it, WITH the materialization still standing: a
    // materialization is maintained incrementally from ingest events, so it is not an operand set
    // anything can subtract from — the gather must ignore it, and a re-seat is NOT the fix.
    expect(gw.reactor.materializedView(gw.matName(program), FERN)).toBeDefined();
    expect(await heightAt(gw)).toBeNull();

    // The open stream ENDED (readers wake with `done` and resubscribe into the narrowed gather), so
    // the member never appears in a frame delivered after the slate.
    const framesAfter: unknown[] = [];
    for (;;) {
      const next = await stream.next();
      if (next.done === true) break;
      framesAfter.push(next.value);
    }
    for (const frame of framesAfter) {
      expect((frame as { plant: { height: number | null } }).plant.height).toBeNull();
    }

    // AND STREAMS STILL WORK: resubscribe, then move an UNRELATED member of the same entity.
    const narrowed = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    const snapshot = await narrowed.next();
    expect((snapshot.value as { plant: { height: number | null } }).plant.height).toBeNull();
    const patchPromise = narrowed.next();
    await gw.append([observed(FERN, "tag", "fronds", 90_000, OP_SEED)]);
    const patch = await patchPromise;
    expect((patch.value as { plant: { tag: string[] } }).plant.tag).toEqual(["shade", "fronds"]);
    expect((patch.value as { plant: { height: number | null } }).plant.height).toBeNull();
    await narrowed.return(undefined);

    // THE INVARIANT, asserted as explicitly as the closure itself. If ANY of these four narrows, the
    // store DEADLOCKS instead of leaking: a read-closed slate evaluating its own membership over a
    // narrowed snapshot freezes to a different address than `version`, self-invalidates, and the
    // cut's pre-flight then refuses forever at the exact moment the deadline passes.
    expect(gw.select(stood.term).map((d) => d.id)).toEqual([member.id]);
    expect(gw.containerScope({ containers: [stood.container] }).map((d) => d.id)).toEqual([
      member.id,
    ]);
    const handle = await gw.openContainer({ name: stood.container });
    expect(handle.members().map((d) => d.id)).toEqual([member.id]);
    expect(gw.freeze(stood.term).id).toBe(stood.version);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([member.id]);
    // And the proof that the invariant is what keeps the store unjammed: the cut RUNS.
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).resolves.toBeDefined();
    await gw.close();
  });
});
