// A governed read under a grant that names a USER, asked where people meet it: the served View (the
// warm materialization, the cold gather, and the as-of gather), the listing door, and the erasure
// audit's reading of the same mask. Each case also asks the delta level: the strike is in the store,
// so a value missing from the View is missing because the strike BINDS, not because it never came.
//
// The grants here are hand-appended; no writer names a user yet (PR 3d-ii C switches them). Pools
// and validity boundaries are PR B's rails.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  termCanonicalHex,
  type Delta,
  type HView,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import {
  dataStruck,
  governedGatherBody,
  grantClaims,
  lawfulStrikersJson,
} from "../../src/gateway/accounts.js";
import { eraseClaims, readGrounds } from "../../src/gateway/erase.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { listingContainerName } from "../../src/gateway/listing.js";
import { gatherImpl } from "../../src/gateway/reads.js";
import { rootClaims, rootOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "d1".repeat(32);
const K1 = authorForSeed(K1_SEED);
const K2_SEED = "d2".repeat(32);
const K2 = authorForSeed(K2_SEED);
const X_SEED = "b3".repeat(32);

const MOSS = "plant:moss";
const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OP) };
const op = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);
const strike = (seed: string, target: Delta, t: number): Delta =>
  signClaims(makeNegationClaims(authorForSeed(seed), t, target.id), seed);
const valuesOf = (h: HView, prop: string): unknown[] =>
  (h.props.get(prop) ?? []).map((e) => {
    const p = e.delta.claims.pointers.find((q) => q.target.kind === "primitive");
    return p?.target.kind === "primitive" ? p.target.value : undefined;
  });
const heights = (h: HView): unknown[] => valuesOf(h, "height");

// A governed store: the gardener writes; ada (root K1) holds a write grant BY NAME. The lens is a
// genesis registration, so the erasure audit's table of readings holds it too.
async function world(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: GUARDED,
          schema: PLANT_POLICY,
          roots: [FERN],
          writable: [...PLANT_WRITABLE],
        },
      ],
    }),
  );
  await gw.append([
    op(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 1)),
    op(userClaims("ada", OP, 2)),
    op(rootClaims("ada", K1, OP, 2)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, 3)),
  ]);
  return gw;
}

describe("R2: a user-named grant trusts the user's root in the served View", () => {
  it("ada's root strike binds; a stranger's is inert (warm, cold, delta)", async () => {
    const gw = await world();
    // ada strikes the LATER value, so a warm read that ignored her strike would serve it (pickLatest).
    const byAda = observed(FERN, "height", 30, 101, GARDENER_SEED);
    const bystander = observed(FERN, "height", 34, 100, GARDENER_SEED);
    await gw.append([byAda, bystander]);
    const adaStrike = strike(K1_SEED, byAda, 200);
    const strangerStrike = strike(X_SEED, bystander, 201);
    await gw.federate([adaStrike, strangerStrike]);
    // delta level: both strikes are held
    expect(gw.reactor.negationsOf(byAda.id)).toContain(adaStrike.id);
    expect(gw.reactor.negationsOf(bystander.id)).toContain(strangerStrike.id);
    // object level, warm (the materialization re-lowers on refresh) and cold
    const cold = gatherImpl(gw, "Guarded", FERN, gw.validityNow());
    expect(heights(cold)).toEqual([34]);
    const live = await gw.query(`{ guarded(entity: "${FERN}") { height } }`);
    expect(JSON.stringify(live.data)).toContain("34");
    expect(JSON.stringify(live.data)).not.toContain("30");
    await gw.close();
  });
});

describe("R7: the listing agrees with the point read", () => {
  it("an entity ada's root struck is absent from both; one a stranger struck is in both", async () => {
    const gw = await world();
    const moss = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    const fern = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    await gw.append([fern, moss]);
    await gw.federate([strike(X_SEED, fern, 3000)]);
    expect((await gw.list("Guarded")).map((n) => n.entity)).toEqual([FERN, MOSS]);
    await gw.federate([strike(K1_SEED, moss, 3001)]);
    const listed = (await gw.list("Guarded")).map((n) => n.entity);
    expect(listed).toEqual([FERN]);
    expect(valuesOf(gatherImpl(gw, "Guarded", MOSS, gw.validityNow()), "tag")).toEqual([]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([30]);
    expect(gw.reactor.get(moss.id)).toBeDefined();
    const members = gw.containerScope({ containers: [listingContainerName("Guarded")] });
    expect(members.some((d) => d.id === moss.id)).toBe(false);
    expect(members.some((d) => d.id === fern.id)).toBe(true);
    await gw.close();
  });
});

describe("R8: the erasure audit reads the governed mask as the door does", () => {
  it("ada's struck claim is not live to the governed reading; the stranger-struck one is", async () => {
    const gw = await world();
    const byAda = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const bystander = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([byAda, bystander]);
    await gw.federate([strike(K1_SEED, byAda, 200), strike(X_SEED, bystander, 201)]);
    const [reading] = readGrounds(gw, [], gw.validityNow());
    const governed = reading!.masks.find(
      (m) => m.policy !== null && JSON.stringify(m.policy).includes("inView"),
    );
    expect(governed).toBeDefined();
    expect(governed!.live.has(byAda.id)).toBe(false);
    expect(governed!.live.has(bystander.id)).toBe(true);
    await gw.close();
  });
});

describe("R9: lowering never touches what is signed or stored (a control)", () => {
  it("the registered body keeps its canonical bytes, and a listing read writes nothing", async () => {
    const gw = await world();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const registered = gw.registered.find((r) => r.hyperschema.name === "Guarded")!;
    expect(termCanonicalHex(registered.hyperschema.body)).toBe(
      termCanonicalHex(governedGatherBody(OP)),
    );
    await gw.list("Guarded");
    const size = gw.reactor.size;
    await gw.list("Guarded");
    await gw.list("Guarded");
    expect(gw.reactor.size).toBe(size);
    await gw.close();
  });
});

describe("R15: an as-of read resolves the user as they stood then", () => {
  it("a re-point signed after asOf, valid from before it, does not reach back", async () => {
    const gw = await world();
    const v1 = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const v2 = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([v1, v2]);
    await gw.federate([strike(K1_SEED, v1, 200), strike(K2_SEED, v2, 220)]);
    // Signed at 300, valid from 100: without the as-of cut, a read at 250 would already see K2.
    await gw.append([op({ ...rootClaims("ada", K2, OP, 300), validFrom: 100 })]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow(), 250))).toEqual([34]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([30]);
    await gw.close();
  });
});

describe("R15b: the as-of cut applies to the operator's strikes too", () => {
  it("a strike on a root claim, signed after asOf, does not reach back", async () => {
    const gw = await world();
    const v1 = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const v2 = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([v1, v2]);
    const toK2 = op(rootClaims("ada", K2, OP, 150));
    await gw.append([toK2]);
    await gw.federate([strike(K1_SEED, v1, 200), strike(K2_SEED, v2, 220)]);
    // Signed at 300, valid from 100: a cut that filtered claims but not strikes would drop K2 at 250.
    await gw.append([op({ ...makeNegationClaims(OP, 300, toK2.id), validFrom: 100 })]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow(), 250))).toEqual([30]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([34]);
    await gw.close();
  });
});

describe("R18: a root claim erased but still held is gone to the governed read", () => {
  it("present and raw both fall back to the earlier root", async () => {
    const gw = await world();
    const v1 = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const v2 = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([v1, v2]);
    const toK2 = op(rootClaims("ada", K2, OP, 50));
    await gw.append([toK2]);
    await gw.federate([strike(K1_SEED, v1, 200), strike(K2_SEED, v2, 220)]);
    // The erasure record lands while the claim's bytes stay held: the state a purge fault leaves.
    expect(gw.reactor.ingest(op(eraseClaims(toK2.id, OP, OP, 400))).status).toBe("accepted");
    expect(gw.reactor.get(toK2.id)).toBeDefined();
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([34]);
    expect(dataStruck(gw.reactor, gw.validityNow(), OP)(v1.id)).toBe(true);
    expect(dataStruck(gw.reactor, gw.validityNow(), OP)(v2.id)).toBe(false);
    // raw membership machinery: K2 is not among the raw roots either
    const kept = new Set(
      gw
        .select({ op: "mask", policy: { trust: lawfulStrikersJson(OP, false) }, in: "input" })
        .map((d) => d.id),
    );
    expect([kept.has(v1.id), kept.has(v2.id)]).toEqual([false, true]);
    await gw.close();
  });
});

describe("R7b: re-pointing a user updates a warm listing", () => {
  it("a strike by the new root, dormant before the re-point, drops the entity after it", async () => {
    const gw = await world();
    const moss = observed(MOSS, "tag", "soft", 1200, GARDENER_SEED);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED), moss]);
    await gw.federate([strike(K2_SEED, moss, 3000)]);
    // K2 is nobody's root yet: its strike is inert, and the listing is warm with moss in it.
    expect((await gw.list("Guarded")).map((n) => n.entity)).toEqual([FERN, MOSS]);
    await gw.append([op(rootClaims("ada", K2, OP, 3100))]);
    expect((await gw.list("Guarded")).map((n) => n.entity)).toEqual([FERN]);
    expect(valuesOf(gatherImpl(gw, "Guarded", MOSS, gw.validityNow()), "tag")).toEqual([]);
    await gw.close();
  });
});

describe("R19: an erased strike on a root claim reads as the View reader says (a control)", () => {
  // The erasure reading hides the TARGET of an erased-but-held strike too, so the root claim stays
  // hidden until the purge completes: neither reader revives it early.
  it("the claim the strike retired stays gone through the purge window", async () => {
    const gw = await world();
    const v1 = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const v2 = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([v1, v2]);
    const toK2 = op(rootClaims("ada", K2, OP, 50));
    const drop = op(makeNegationClaims(OP, 60, toK2.id));
    await gw.append([toK2, drop]);
    await gw.federate([strike(K1_SEED, v1, 200), strike(K2_SEED, v2, 220)]);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([34]);
    expect(gw.reactor.ingest(op(eraseClaims(drop.id, OP, OP, 400))).status).toBe("accepted");
    expect(gw.reactor.get(drop.id)).toBeDefined();
    expect(rootOf(gw.reactor, OP, gw.validityNow(), "ada")).toBe(K1);
    expect(heights(gatherImpl(gw, "Guarded", FERN, gw.validityNow()))).toEqual([34]);
    await gw.close();
  });
});

describe("R20: an erased-but-held grant stops counting in dataStruck, as in the governed read", () => {
  it("the grantee's strike no longer binds either way; ada's still does", async () => {
    const gw = await world();
    const X = authorForSeed(X_SEED);
    const toX = op(grantClaims(STORE_ENTITY, X, "write", OP, 4));
    await gw.append([toX]);
    const d = observed(FERN, "height", 30, 100, GARDENER_SEED);
    const bystander = observed(FERN, "height", 34, 101, GARDENER_SEED);
    await gw.append([d, bystander]);
    await gw.federate([strike(X_SEED, d, 200), strike(K1_SEED, bystander, 201)]);
    const now = () => gw.validityNow();
    expect(heights(gatherImpl(gw, "Guarded", FERN, now()))).toEqual([]);
    expect(dataStruck(gw.reactor, now(), OP)(d.id)).toBe(true);
    // The erasure record for the grant lands while its bytes stay held.
    expect(gw.reactor.ingest(op(eraseClaims(toX.id, OP, OP, 400))).status).toBe("accepted");
    expect(gw.reactor.get(toX.id)).toBeDefined();
    expect(heights(gatherImpl(gw, "Guarded", FERN, now()))).toEqual([30]);
    expect(dataStruck(gw.reactor, now(), OP)(d.id)).toBe(false);
    expect(dataStruck(gw.reactor, now(), OP)(bystander.id)).toBe(true);
    await gw.close();
  });
});
