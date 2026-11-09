// Ordinary reads cost their own footprint, not the store (rhizomatic SPEC-17 P7). The rail counts
// every reactor access a whole read makes: the indexed lookups, and the two whole-store doors
// (`snapshot`, `arrivalLog`). A present read, an as-of read, the pinned door and a governed read
// must never open a whole-store door, and must make the same accesses with 0 and with 2000
// unrelated facts in the store. The rail also checks answers where the read's selection splits a
// negation chain or cuts a fact said after the as-of moment, at the delta level and the View level.
//
// Not covered here, and named in the PR: the slate probe and the governed lowering still walk the
// whole erasure index and the grant history on governed stores. Those grow with law, not with data,
// so the bystanders below cannot see them.

import { describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type AnchoredRead,
  type Delta,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY, assembleGenesis } from "../../src/gateway/genesis.js";
import { lensOf } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import {
  PLANT,
  PLANT_POLICY,
  PLANT_READING,
  PLANT_WRITABLE,
  garden,
  governedBootstrap,
} from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const MOSS = "plant:moss";
const SPLIT = "plant:split";
const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OP) };

const strike = (target: Delta, t: number): Delta =>
  signClaims(makeNegationClaims(authorForSeed(GARDENER_SEED), t, target.id), GARDENER_SEED);

// d ← n1 ← n2 on SPLIT. At 1500, n1 has been said and n2 has not, so d is struck as of 1500 and
// live now.
const chainHead = observed(SPLIT, "height", 7, 1000, GARDENER_SEED);
const chainStrike = strike(chainHead, 1100);
const chainRevive = strike(chainStrike, 1800);
// Said at 2000, holding since 1000: an as-of read at 1500 has not heard it yet.
const lateSaid = observed(MOSS, "height", 9, { timestamp: 2000, validFrom: 1000 }, GARDENER_SEED);

const mossFacts = () => [
  observed(MOSS, "height", 3, 1000, GARDENER_SEED),
  observed(MOSS, "height", 4, 2000, GARDENER_SEED),
  lateSaid,
  chainHead,
  chainStrike,
  chainRevive,
];
const bystanders = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    observed(`plant:other-${n}`, "height", n, 1000 + n, GARDENER_SEED),
  );

async function plainStore(count: number): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gw.append(governedBootstrap(KEEPER_SEED));
  await gw.append(garden);
  await gw.publishRegistration(
    PLANT,
    PLANT_READING,
    [],
    { actor: KEEPER_SEED },
    undefined,
    undefined,
    PLANT_WRITABLE,
  );
  await gw.append(mossFacts());
  if (count > 0) await gw.append(bystanders(count));
  return gw;
}

async function governedStore(count: number, lenses = 1): Promise<Gateway> {
  // Further governed lenses sit in the registry beside Guarded; a read of Guarded lowers them too.
  const extra = Array.from({ length: lenses - 1 }, (_, n) => ({
    hyperschema: { ...GUARDED, name: `Guarded${n}` },
    schema: PLANT_POLICY,
    roots: [],
    writable: [...PLANT_WRITABLE],
  }));
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
        ...extra,
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 1), OP_SEED)]);
  await gw.append(mossFacts());
  if (count > 0) await gw.append(bystanders(count));
  return gw;
}

const ACCESSES = [
  "get",
  "targets",
  "negators",
  "byTarget",
  "negationsOf",
  "snapshot",
  "arrivalLog",
] as const;
type Accesses = Record<(typeof ACCESSES)[number], number> & { anchored: AnchoredRead[] };

// Every reactor access made while `read` runs, and every anchored read it made.
function accesses(gw: Gateway, read: () => void): Accesses {
  const spies = ACCESSES.map((m) => [m, vi.spyOn(gw.reactor, m)] as const);
  const anchored = vi.spyOn(gw.reactor, "evalAnchored");
  read();
  const counts = Object.fromEntries(spies.map(([m, s]) => [m, s.mock.calls.length]));
  const out = { ...counts, anchored: [] } as unknown as Accesses;
  out.anchored = anchored.mock.results.map((r) => r.value as AnchoredRead);
  vi.restoreAllMocks();
  return out;
}

const pinnedPlant = (gw: Gateway) =>
  gw.registrationVersions().filter((v) => lensOf(v) === "Plant")[0]!;

// Each case prepares outside the measurement (finding the pinned version reads the registration
// log) and returns the read itself.
const reads: [string, (gw: Gateway) => () => void, (n: number) => Promise<Gateway>][] = [
  ["a present read", (gw) => () => gw.resolvedNode("Plant", MOSS), plainStore],
  ["an as-of read", (gw) => () => gw.resolvedNode("Plant", MOSS, 1500), plainStore],
  [
    "the pinned door",
    (gw) => {
      const reg = pinnedPlant(gw);
      return () => gw.resolvePinned(reg, MOSS);
    },
    plainStore,
  ],
  ["a governed read", (gw) => () => gw.resolvedNode("Guarded", MOSS), governedStore],
];

describe("an ordinary read costs its footprint (SPEC-17 P7)", () => {
  for (const [name, read, open] of reads) {
    it(`${name} opens no whole-store door and does not grow with 2000 unrelated facts`, async () => {
      const small = await open(0),
        large = await open(2000);
      const a = accesses(small, read(small)),
        b = accesses(large, read(large));
      expect(a.snapshot).toBe(0);
      expect(a.arrivalLog).toBe(0);
      expect(a.anchored.length).toBeGreaterThan(0);
      expect(b).toEqual(a);
      await small.close();
      await large.close();
    }, 120_000);
  }
});

describe("a read's selection keeps negation and as-of rules", () => {
  it("a fact said after the cut is absent as of the cut, even though it holds then", async () => {
    const gw = await plainStore(0);
    const seen = accesses(gw, () => {
      expect(gw.resolvedNode("Plant", MOSS, 1500).view["height"]).toBe(3);
    });
    expect(seen.anchored[0]!.members).not.toContain(lateSaid.id);
    expect(gw.resolvedNode("Plant", MOSS).view["height"]).toBe(9);
    await gw.close();
  });

  it("a strike said before the cut binds; its own strike, said after, does not yet", async () => {
    const gw = await plainStore(0);
    const past = accesses(gw, () => {
      expect(gw.resolvedNode("Plant", SPLIT, 1500).view["height"]).toBeUndefined();
    });
    expect(past.anchored[0]!.members).toEqual(
      expect.arrayContaining([chainHead.id, chainStrike.id]),
    );
    expect(past.anchored[0]!.members).not.toContain(chainRevive.id);
    const now = accesses(gw, () => {
      expect(gw.resolvedNode("Plant", SPLIT).view["height"]).toBe(7);
    });
    expect(now.anchored[0]!.members).toEqual(
      expect.arrayContaining([chainHead.id, chainStrike.id, chainRevive.id]),
    );
    await gw.close();
  });
});

describe("a governed read pays the grant walk once", () => {
  it("the same reactor accesses with 1 governed lens registered as with 4", async () => {
    const one = await governedStore(0, 1),
      four = await governedStore(0, 4);
    const read = (gw: Gateway) => () => gw.resolvedNode("Guarded", MOSS);
    const a = accesses(one, read(one)),
      b = accesses(four, read(four));
    expect(b.byTarget).toBe(a.byTarget);
    expect(b.get).toBe(a.get);
    await one.close();
    await four.close();
  }, 120_000);
});
