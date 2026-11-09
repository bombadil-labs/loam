// The ground's revision, and the two caches keyed on it: the erased set a reading hides
// (`erasedFromReading`) and the public door's open set.
//
// The revision cases assert the count itself: one per admitted batch that adds to the held set,
// none for a batch of duplicates, one per reseat, one per declaration of erasure pins.
//
// The erased-set cases are two-sided, at both levels. Each one first reads, so a cached answer
// exists. Then one event moves the answer. After it the bytes of the target are still held (delta
// level), a reading through the Schema hides the target, and the same reading still serves a
// named bystander (object level). A cache that missed the event keeps serving the target.
//
// Not asserted here: that a purge removes bytes (test/gateway/erase.test.ts), and the law-level pin
// case on a bare reactor (test/gateway/erasure-governor-pin.test.ts).

import { describe, expect, it } from "vitest";
import { Reactor, authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { eraseClaims, erasedFromReading } from "../../src/gateway/erase-law.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  continueGroundRevision,
  groundRevision,
  raiseGroundRevision,
} from "../../src/gateway/ground-revision.js";
import { publicClaims } from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { plant } from "../helpers/plant.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "7c".repeat(32);
const OP = authorForSeed(OP_SEED);
const HOST_SEED = "e5".repeat(32);
const HOST = authorForSeed(HOST_SEED);

const boot = (backend = new MemoryBackend()): Promise<Gateway> =>
  Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

async function fern(gw: Gateway): Promise<{ height: number | null; tag: string[] }> {
  const res = await gw.query(`{ plant(entity: "${FERN}") { height tag } }`);
  expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
  return (res.data as { plant: { height: number | null; tag: string[] } }).plant;
}

const claimAndBystander = () => ({
  claim: observed(FERN, "height", 30, 1000, OP_SEED),
  bystander: observed(FERN, "tag", "shade", 1100, OP_SEED),
});

describe("the ground's revision", () => {
  it("rises once per admitted batch, and not for a batch of duplicates", async () => {
    const gw = await boot();
    const { claim, bystander } = claimAndBystander();
    const r0 = gw.revision;
    await gw.append([claim, bystander]); // two deltas, one batch
    expect(gw.revision).toBe(r0 + 1);
    await gw.append([claim, bystander]);
    expect(gw.revision).toBe(r0 + 1);

    const other = observed(FERN, "tag", "moss", 1200, OP_SEED);
    await gw.federate([other, claim]); // one new member
    expect(gw.revision).toBe(r0 + 2);
    await gw.federate([other, claim]);
    expect(gw.revision).toBe(r0 + 2);

    // Unread between them, two batches are still two revisions.
    expect(gw.reactor.ingest(observed(FERN, "tag", "fog", 1300, OP_SEED)).status).toBe("accepted");
    expect(gw.reactor.ingest(observed(FERN, "tag", "dew", 1400, OP_SEED)).status).toBe("accepted");
    expect(gw.revision).toBe(r0 + 4);
    await gw.close();
  });

  it("rises once per reseat, once per pin declaration, and never falls", async () => {
    const gw = await boot();
    const { claim, bystander } = claimAndBystander();
    await gw.append([claim, bystander]);
    const r0 = gw.revision;
    const before = gw.reactor;
    await gw.reseat();
    expect(gw.reactor).not.toBe(before);
    expect(gw.revision).toBe(r0 + 1);
    gw.pinErasureGovernors([HOST]);
    expect(gw.revision).toBe(r0 + 2);
    await gw.reseat(); // the pins are declared again on the new reactor: still one revision
    expect(gw.revision).toBe(r0 + 3);
    // An erase stores an order, purges and reseats: the revision only rises.
    await gw.erase(claim.id);
    expect(gw.revision).toBeGreaterThan(r0 + 3);
    await gw.close();
  });

  it("a bare reactor counts from its first read; a successor continues one above", () => {
    const a = new Reactor();
    const { claim, bystander } = claimAndBystander();
    a.ingest(claim);
    expect(groundRevision(a)).toBe(0);
    expect(groundRevision(a)).toBe(0);
    a.ingest(bystander);
    expect(groundRevision(a)).toBe(1);
    expect(a.ingest(bystander).status).toBe("duplicate");
    expect(groundRevision(a)).toBe(1);
    raiseGroundRevision(a);
    expect(groundRevision(a)).toBe(2);

    const b = new Reactor();
    b.ingest(claim);
    raiseGroundRevision(b); // whatever `b` counted before, the successor's count is set outright
    continueGroundRevision(a, b);
    expect(groundRevision(b)).toBe(3);
  });
});

describe("the erased set a reading hides follows every event that moves it", () => {
  it.each([
    ["the append door", (gw: Gateway, order: ReturnType<typeof signClaims>) => gw.append([order])],
    [
      "the federation door",
      (gw: Gateway, order: ReturnType<typeof signClaims>) => gw.federate([order]),
    ],
    [
      "a direct ingest",
      (gw: Gateway, order: ReturnType<typeof signClaims>) =>
        Promise.resolve(gw.reactor.ingest(order)),
    ],
  ])("an order admitted through %s hides its held target", async (_, admit) => {
    const gw = await boot();
    const { claim, bystander } = claimAndBystander();
    await gw.append([claim, bystander]);
    expect(await fern(gw)).toEqual({ height: 30, tag: ["shade"] }); // the cached answer: nothing
    expect(erasedFromReading(gw.reactor, OP).size).toBe(0);

    await admit(gw, signClaims(eraseClaims(claim.id, OP, OP, 2000), OP_SEED));
    expect(gw.reactor.get(claim.id)).toBeDefined(); // the bytes are still held
    expect(gw.reactor.get(bystander.id)).toBeDefined();

    expect(erasedFromReading(gw.reactor, OP).has(claim.id)).toBe(true);
    expect(erasedFromReading(gw.reactor, OP).has(bystander.id)).toBe(false);
    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });
    await gw.close();
  });

  // A reseat reads the admitted set again, and an order admitted through a door has taken its
  // target out of that set. So the reseat moves the answer: the target's bytes leave the reactor,
  // and nothing is left to hide. The cached entry is still stored beside the reactor object, so
  // this case passes with the revision left out of the key: it is a control for the day one
  // reactor outlives a reseat, not a gate today. The pin case below holds a target across a reseat.
  it("a reseat drops the ordered target's bytes: the hidden set empties, the bystander stays (a control)", async () => {
    const gw = await boot();
    const { claim, bystander } = claimAndBystander();
    await gw.append([claim, bystander]);
    await gw.append([signClaims(eraseClaims(claim.id, OP, OP, 2000), OP_SEED)]);
    expect(gw.reactor.get(claim.id)).toBeDefined();
    expect([...erasedFromReading(gw.reactor, OP)]).toEqual([claim.id]); // the cached answer
    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });

    const before = gw.reactor;
    await gw.reseat();
    expect(gw.reactor).not.toBe(before);
    expect(gw.reactor.get(claim.id)).toBeUndefined();
    expect(gw.reactor.get(bystander.id)).toBeDefined();

    expect(erasedFromReading(gw.reactor, OP).size).toBe(0);
    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });
    await gw.close();
  });

  it("new pins make a held host order bind: its target is hidden on the next read", async () => {
    const gw = await boot();
    const { claim, bystander } = claimAndBystander();
    await gw.append([claim, bystander]);
    // The host orders the erasure and names this ground as the receiver. Unpinned, it is testimony.
    const order = signClaims(
      eraseClaims(claim.id, OP, HOST, 2000, undefined, undefined, OP),
      HOST_SEED,
    );
    expect(gw.reactor.ingest(order).status).toBe("accepted");
    expect(await fern(gw)).toEqual({ height: 30, tag: ["shade"] });
    expect(erasedFromReading(gw.reactor, OP).size).toBe(0);

    gw.pinErasureGovernors([HOST]);
    expect(gw.reactor.get(claim.id)).toBeDefined();
    expect(gw.reactor.get(bystander.id)).toBeDefined();
    expect(erasedFromReading(gw.reactor, OP).has(claim.id)).toBe(true);
    expect(erasedFromReading(gw.reactor, OP).has(bystander.id)).toBe(false);
    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });

    // The pins and the hiding both survive a reseat.
    await gw.reseat();
    expect(gw.reactor.get(claim.id)).toBeDefined();
    expect(await fern(gw)).toEqual({ height: null, tag: ["shade"] });
    await gw.close();
  });

  it("the answer is per operator: one ground read as two operators gives two answers", () => {
    const reactor = new Reactor();
    const { claim, bystander } = claimAndBystander();
    const order = signClaims(eraseClaims(claim.id, OP, OP, 2000), OP_SEED);
    for (const d of [claim, bystander, order]) expect(reactor.ingest(d).status).toBe("accepted");

    expect(erasedFromReading(reactor, HOST).size).toBe(0); // OP's order is testimony to HOST
    const asOp = erasedFromReading(reactor, OP);
    expect(asOp.has(claim.id)).toBe(true);
    expect(asOp.has(bystander.id)).toBe(false);
    expect(erasedFromReading(reactor, HOST).size).toBe(0);
    expect(erasedFromReading(reactor, undefined).size).toBe(0);
  });
});

describe("the public door's open set follows the revision", () => {
  it("a reseat that brings in a declaration another writer stored opens the door", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    expect(gw.hasPublicSurface()).toBe(false); // the cached answer: nothing is open
    const at = gw.validityNow() - 1000;
    await plant(backend, [signClaims(publicClaims([PLANT.name], OP, at), OP_SEED)]);
    await gw.reseat();
    expect(gw.hasPublicSurface()).toBe(true);
    await gw.close();
  });

  it("a declaration that lands with no door (a direct ingest) opens it on the next read", async () => {
    const gw = await boot();
    expect(gw.hasPublicSurface()).toBe(false);
    const at = gw.validityNow() - 1000;
    const decl = signClaims(publicClaims([PLANT.name], OP, at), OP_SEED);
    expect(gw.reactor.ingest(decl).status).toBe("accepted");
    expect(gw.hasPublicSurface()).toBe(true);
    await gw.close();
  });
});
