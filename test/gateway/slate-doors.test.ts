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
import { readClosedIds } from "../../src/gateway/slate-law.js";
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
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike1 = strike(claim.id, 2000);
    await gw.append([strike1]);
    const strike2 = strike(strike1.id, 3000);
    await gw.append([strike2]);
    expect(await heightAt(gw)).toBe(30);

    const stood = await standSlate(gw, { members: [strike2], closes: ["egress"] });

    const report = await peer.federate(gw.offeredDeltas(), { admit: () => true });
    expect(report.accepted).toBeGreaterThan(0);
    expect(await heightAt(peer)).toBeNull();
    for (const id of [strike2.id, strike1.id, claim.id]) {
      expect(peer.reactor.get(id)).toBeUndefined();
    }
    expect(peer.reactor.get(bystander.id)).toBeDefined();
    const tags = await peer.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);

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

    const wall = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      membership: OPERATOR_GROUND,
    });
    const inside = wall.gateway!;
    for (const id of [strike2.id, strike1.id, claim.id]) {
      expect(inside.reactor.get(id)).toBeUndefined();
    }
    expect(await heightAt(inside)).toBeNull();
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
          validFrom: ts,
          author: OP,
          pointers: [
            { role: "notes", target: { kind: "delta", deltaRef: { delta: target } } },
            { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
          ],
        },
        OP_SEED,
      );

    await expect(gw.append([citing(member.id, 60_000)])).rejects.toThrow(
      new RegExp(`SLATED FOR ERASURE by the container "${stood.container}"`),
    );
    const strangerSeed = "c3".repeat(32);
    const strangerCite = signClaims(
      {
        timestamp: 60_100,
        validFrom: 60_100,
        author: authorForSeed(strangerSeed),
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      strangerSeed,
    );
    const refused = await gw.federate([strangerCite], { admit: () => true });
    expect(refused).toEqual({ offered: 1, accepted: 0, rejected: 1, held: 0 });
    const forged = { ...strangerCite, id: contentAddress(new TextEncoder().encode("nope")) };
    expect(await gw.federate([forged], { admit: () => true })).toEqual({
      offered: 1,
      accepted: 0,
      rejected: 1,
      held: 0,
    });

    await expect(gw.append([citing(bystander.id, 60_200)])).resolves.toBeDefined();
    const strangerOk = signClaims(
      {
        timestamp: 60_300,
        validFrom: 60_300,
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

describe("T64 criterion 5 — a NEGATION is not a citation: cite closure must never strand a strike", () => {
  it("a strike of a member is ADMITTED at BOTH doors during a cite-closed window", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["egress", "cite"] });

    const own = strike(member.id, 60_000);
    await expect(gw.append([own])).resolves.toBeDefined();
    expect(gw.reactor.get(own.id)).toBeDefined();

    const peerSeed = "e5".repeat(32);
    const peerStrike = signClaims(
      {
        timestamp: 60_100,
        validFrom: 60_100,
        author: authorForSeed(peerSeed),
        pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: member.id } } }],
      },
      peerSeed,
    );
    expect(await gw.federate([peerStrike], { admit: () => true })).toEqual({
      offered: 1,
      accepted: 1,
      rejected: 0,
      held: 0,
    });

    const both = signClaims(
      {
        timestamp: 60_200,
        validFrom: 60_200,
        author: OP,
        pointers: [
          { role: "negates", target: { kind: "delta", deltaRef: { delta: member.id } } },
          { role: "notes", target: { kind: "delta", deltaRef: { delta: member.id } } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([both])).rejects.toThrow(/SLATED FOR ERASURE/);
    await gw.append([strike(stood.declaration, 60_300)]);
    expect(gw.reactor.get(own.id)).toBeDefined();
    expect(await heightAt(gw)).toBeNull();
    await gw.close();
  });

  it("a `clear` over a field with one slated contribution still retracts the caller's others", async () => {
    const gw = await bootSlateStore();
    const slated = observed(FERN, "tag", "shade", 1000, OP_SEED);
    const other = observed(FERN, "tag", "fronds", 1100, OP_SEED);
    await gw.append([slated, other]);
    await standSlate(gw, { members: [slated], closes: ["cite"] });
    const res = await gw.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["tag"]) { tag } }`,
    );
    expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
    expect((res.data as { clearPlant: { tag: string[] | null } }).clearPlant.tag).toBeNull();
    for (const d of [slated, other]) {
      expect(gw.reactor.negationsOf(d.id).length).toBeGreaterThan(0);
    }
    expect(await gw.backend.holds(slated.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 criterion 7 — a read-closed member's OWN retraction is not a silent no-op", () => {
  it("the strike is really minted, and it holds after the slate is gone", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const stood = await standSlate(gw, { members: [member], closes: ["read"] });
    expect(await heightAt(gw)).toBeNull();

    const res = await gw.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["height"]) { height } }`,
    );
    expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

    expect(gw.reactor.negationsOf(member.id).length).toBeGreaterThan(0);
    await gw.append([strike(stood.declaration, 70_000)]);
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    expect(await heightAt(gw)).toBeNull();
    const pub = await gw
      .queryPublic(`{ plant(entity: "${FERN}") { height } }`)
      .catch(() => undefined);
    if (pub !== undefined) {
      expect(
        (pub.data as { plant: { height: number | null } } | undefined)?.plant.height ?? null,
      ).toBeNull();
    }
    expect(await gw.backend.holds(member.id)).toBe(true);
    expect(gw.reactor.get(member.id)).toBeDefined();
    await gw.close();
  });
});

describe("T64 criterion 6 — cite is DIRECT only, and the post-cut resubmission is INTENDED", () => {
  it("a delta citing a delta that cites a member is ADMITTED", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const hop1 = signClaims(
      {
        timestamp: 1500,
        validFrom: 1500,
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
        validFrom: 60_000,
        author: OP,
        pointers: [
          { role: "notes", target: { kind: "delta", deltaRef: { delta: hop1.id } } },
          { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "note" } } },
        ],
      },
      OP_SEED,
    );
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
        validFrom: 60_000,
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
    await expect(gw.append([cite])).resolves.toBeDefined();
    expect(gw.reactor.get(cite.id)).toBeDefined();
    expect(gw.reactor.get(member.id)).toBeUndefined();
    await gw.close();
  });
});

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
      validFrom: ts,
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

    const beforeSlate = 30_000;
    await standSlate(gw, { members: [height, avatar], closes: ["read"] });

    expect(await heightAt(gw)).toBeNull();
    const pub = await gw.queryPublic(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((pub.data as { plant: { height: number | null } }).plant.height).toBeNull();
    expect(gw.serveBytes(ref, L("Profile"), FERN, "full").status).toBe(404);
    expect(gw.surface("full")!.hooks.resolve("Plant", FERN).view["height"]).toBeUndefined();
    expect(gw.surface("full")!.hooks.resolve("Plant", FERN).view["tag"]).toEqual(["shade"]);
    const asOf = await gw.query(`{ plant(entity: "${FERN}") { height tag _asOf } }`);
    expect((asOf.data as { plant: { height: number | null } }).plant.height).toBeNull();
    expect(gw.resolvedNode("Plant", FERN, beforeSlate).suppressed).toBe(2);
    expect(gw.resolvePinned(pinnedReg, FERN).view["height"]).toBeUndefined();

    const never = await bootSlateStore();
    await never.append([tag]);
    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).view).toEqual(
      never.resolvedNode("Plant", FERN).view,
    );
    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).hex).toBe(
      never.resolvedNode("Plant", FERN).hex,
    );
    await never.close();

    expect((pub.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    expect((asOf.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    expect(gw.resolvePinned(pinnedReg, FERN).view["tag"]).toEqual(["shade"]);
    expect(gw.serveBytes(ref, L("Plant"), FERN, "full").status).toBe(404);

    const stoodContainer = gw.slates(BEFORE_DEADLINE)[0]!;
    expect([...stoodContainer.members].sort()).toEqual([height.id, avatar.id].sort());
    expect(
      gw
        .containerScope({ containers: [stoodContainer.container] })
        .map((d) => d.id)
        .sort(),
    ).toEqual([height.id, avatar.id].sort());
    expect(await gw.backend.holds(height.id)).toBe(true);
    await gw.close();
  });
});

describe("T64 — READ closure preserves suppression (H1, the same question the egress rail asks)", () => {
  it("a slated STRIKE withholds its target too, so no door serves a retracted claim as live", async () => {
    const gw = await bootSlateStore();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    const bystander = observed(FERN, "tag", "shade", 1100, OP_SEED);
    await gw.append([claim, bystander]);
    const strike1 = strike(claim.id, 2000);
    await gw.append([strike1]);
    const strike2 = strike(strike1.id, 3000);
    await gw.append([strike2]);
    expect(await heightAt(gw)).toBe(30);

    await standSlate(gw, { members: [strike2], closes: ["read"] });

    expect(await heightAt(gw)).toBeNull();
    expect(
      gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).view["height"],
    ).toBeUndefined();
    expect(gw.resolvedNode("Plant", FERN, 30_000, BEFORE_DEADLINE).view["height"]).toBeUndefined();
    const tags = await gw.query(`{ plant(entity: "${FERN}") { tag } }`);
    expect((tags.data as { plant: { tag: string[] } }).plant.tag).toEqual(["shade"]);
    for (const d of [claim, strike1, strike2]) {
      expect(gw.reactor.get(d.id)).toBeDefined();
      expect(await gw.backend.holds(d.id)).toBe(true);
    }
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

    expect(gw.resolvedNode("Plant", FERN, undefined, BEFORE_DEADLINE).view["height"]).toBe(30);
    expect(
      gw.resolvedNode("Plant", FERN, undefined, AFTER_DEADLINE).view["height"],
    ).toBeUndefined();
    expect([...gw.reactor.snapshot()].map((d) => d.id).sort()).toEqual(groundBefore);
    expect(gw.resolvedNode("Plant", FERN, undefined, AFTER_DEADLINE).view["tag"]).toEqual([
      "shade",
    ]);
    expect(gw.resolvedNode("Plant", FERN, 40_000, AFTER_DEADLINE).suppressed).toBe(1);
    expect(gw.resolvedNode("Plant", FERN, 40_000, BEFORE_DEADLINE).suppressed).toBeUndefined();
    await gw.close();
  });

  it("a read door reached with NO moment REFUSES rather than serving", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    await standSlate(gw, { members: [member], closes: [] });
    expect(() => gatherImpl(gw, "Plant", FERN, undefined as unknown as number)).toThrow(
      /no moment was passed/,
    );
    expect(() => readClosedIds(gw, undefined as unknown as number)).toThrow(/no moment was passed/);
    expect(() => readClosedIds(gw, Number.NaN)).toThrow(/no moment was passed/);
    expect(gatherImpl(gw, "Plant", FERN, BEFORE_DEADLINE)).toBeDefined();
    await gw.close();
  });

  it("THE CLOCKS DO NOT CROSS: delta-time running far ahead must not lapse a live deadline", async () => {
    const gw = await bootSlateStore();
    const member = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([member]);
    const deadline = Date.now() + 5_000;
    let deltaTime = 0;
    for (let i = 0; i < 20_000; i += 1) deltaTime = gw.nextTimestamp();
    expect(deltaTime).toBeGreaterThan(deadline);
    await standSlate(gw, {
      members: [member],
      closes: ["cite"],
      deadline,
      requestedAt: Date.now(),
      ts: deltaTime + 1,
      validFrom: Date.now(),
    });
    const report = gw.slates(Date.now())[0]!;
    expect(gw.reactor.get(report.record)!.claims.timestamp).toBeGreaterThan(deadline);
    expect(report.lapsed).toBe(false);
    expect(report.closes).toEqual(["cite"]);
    expect(report.enforced).toEqual(["cite"]);
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
    expect(health.slates).toEqual({
      open: 1,
      lapsed: 1,
      lapsedIds: [stood.container],
      unresolved: [],
      disagreeing: [],
    });
    expect(health.status).toBe("ok");
    expect(health.erasure).toEqual({
      settled: true,
      promised: 0,
      pending: 0,
      outstanding: [],
      unproven: false,
    });
    expect(health.negated).toEqual({ count: 0, present: 0, ids: [], unreadable: [] });
    const early = await gw.health(LAPSED_DEADLINE - 30_000);
    expect(early.slates).toEqual({
      open: 1,
      lapsed: 0,
      lapsedIds: [],
      unresolved: [],
      disagreeing: [],
    });
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

    expect(await heightAt(gw)).toBe(30);
    const program = gw.def("Plant").hyperschema.name;
    expect(gw.reactor.materializedView(gw.matName(program), FERN)).toBeDefined();

    const stream = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    const first = await stream.next();
    expect((first.value as { plant: { height: number } }).plant.height).toBe(30);

    const stood = await standSlate(gw, { members: [member], closes: ["read"] });

    expect(gw.reactor.materializedView(gw.matName(program), FERN)).toBeDefined();
    expect(await heightAt(gw)).toBeNull();

    const framesAfter: unknown[] = [];
    for (;;) {
      const next = await stream.next();
      if (next.done === true) break;
      framesAfter.push(next.value);
    }
    for (const frame of framesAfter) {
      expect((frame as { plant: { height: number | null } }).plant.height).toBeNull();
    }

    const narrowed = await gw.subscribe(`subscription { plant(entity: "${FERN}") { height tag } }`);
    const snapshot = await narrowed.next();
    expect((snapshot.value as { plant: { height: number | null } }).plant.height).toBeNull();
    const patchPromise = narrowed.next();
    await gw.append([observed(FERN, "tag", "fronds", 90_000, OP_SEED)]);
    const patch = await patchPromise;
    expect((patch.value as { plant: { tag: string[] } }).plant.tag).toEqual(["shade", "fronds"]);
    expect((patch.value as { plant: { height: number | null } }).plant.height).toBeNull();
    await narrowed.return(undefined);

    expect(gw.select(stood.term).map((d) => d.id)).toEqual([member.id]);
    expect(gw.containerScope({ containers: [stood.container] }).map((d) => d.id)).toEqual([
      member.id,
    ]);
    const handle = await gw.openContainer({ name: stood.container });
    expect(handle.members().map((d) => d.id)).toEqual([member.id]);
    expect(gw.freeze(stood.term).id).toBe(stood.version);
    expect(gw.slates(BEFORE_DEADLINE)[0]!.members).toEqual([member.id]);
    await expect(gw.cut(stood.container, { now: BEFORE_DEADLINE })).resolves.toBeDefined();
    await gw.close();
  });
});
