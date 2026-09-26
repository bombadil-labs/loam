// Step-4 trial: four properties of rhizomatic #48's governed-read APIs that Loam's swap relies on,
// checked against the substrate directly and through Loam's seams. Plus one gateway case: a
// registration struck from T is unbound at T by the validity timer, with no write and no replay.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DeltaSet,
  HYPER_SCHEMA_SCHEMA,
  latestByKey,
  loadGovernedHyperSchema,
  makeDelta,
  makeNegationClaims,
  publishHyperSchemaClaims,
  Reactor,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { dataStruck, honoredStrikeOn } from "../../src/gateway/accounts.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lawfulNegated, negatedAt } from "../../src/gateway/negation.js";
import { CTX_REGISTRATION } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { SEEDS, strike } from "../../refactor/recordings/corpus.js";

const A = "author:A";
const B = "author:B";

const claim = (author: string, t: number, value: string, validUntil?: number): Delta =>
  makeDelta({
    timestamp: t,
    validFrom: t,
    ...(validUntil === undefined ? {} : { validUntil }),
    author,
    pointers: [
      { role: "key", target: { kind: "primitive", value: "k" } },
      { role: "value", target: { kind: "primitive", value } },
    ],
  });

const negate = (target: Delta, author: string, t: number, validUntil?: number): Delta =>
  makeDelta({
    ...makeNegationClaims(author, t, target.id),
    ...(validUntil === undefined ? {} : { validUntil }),
  });

const reactorOf = (deltas: readonly Delta[]): Reactor => {
  const r = new Reactor();
  for (const d of deltas) expect(r.ingest(d).status).toBe("accepted");
  return r;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("step-4 substrate properties (rhizomatic #48)", () => {
  it("(a) author selection happens before masking", () => {
    const target = claim(A, 1, "x");
    const foreign = negate(target, B, 2);
    const r1 = reactorOf([target, foreign]);
    // Predicate form: suppression is the caller's author selection.
    expect(r1.negationPredicate(10, (n) => n.claims.author === A)(target.id)).toBe(false);
    expect(negatedAt(r1, 10, A)(target.id)).toBe(false);
    expect(negatedAt(r1, 10, undefined)(target.id)).toBe(true);
    const own = negate(target, A, 3);
    const r2 = reactorOf([target, own]);
    expect(negatedAt(r2, 10, A)(target.id)).toBe(true);

    // Governed load form: a foreign negation of the selected author's definition is dropped with
    // the foreign author, before the bootstrap's mask runs.
    const def = makeDelta(publishHyperSchemaClaims(HYPER_SCHEMA_SCHEMA, "schema:x", A, 1));
    const foreignDefStrike = negate(def, B, 2);
    const ownDefStrike = negate(def, A, 2);
    const governed = new Set([A]);
    const order = { kind: "byTimestamp", dir: "desc" } as const;
    expect(
      loadGovernedHyperSchema(
        DeltaSet.from([def, foreignDefStrike]),
        "schema:x",
        10,
        governed,
        order,
      ).name,
    ).toBe(HYPER_SCHEMA_SCHEMA.name);
    expect(() =>
      loadGovernedHyperSchema(DeltaSet.from([def, ownDefStrike]), "schema:x", 10, governed, order),
    ).toThrow(/no surviving schema definition/);
    // Selecting both authors lets the foreign strike bind.
    expect(() =>
      loadGovernedHyperSchema(
        DeltaSet.from([def, foreignDefStrike]),
        "schema:x",
        10,
        new Set([A, B]),
        order,
      ),
    ).toThrow(/no surviving schema definition/);
  });

  it("(b) target validity is independent of the negation witnesses", () => {
    const target = claim(A, 0, "x", 12); // expires at 12
    const neg = negate(target, A, 10, 20); // valid over [10, 20)
    const r = reactorOf([target, neg]);
    expect(
      r
        .negationWitnesses(
          13,
          () => true,
        )(target.id)
        .map((d) => d.id),
    ).toEqual([neg.id]);
    expect(negatedAt(r, 13, A)(target.id)).toBe(true);
    expect(honoredStrikeOn(r, 13, target.id, A)?.id).toBe(neg.id);
    expect(dataStruck(r, 13, A)(target.id)).toBe(true);
    // The negation's own window still binds: at 20 it has ended.
    expect(negatedAt(r, 20, A)(target.id)).toBe(false);
  });

  it("(c) a missing or purged target reports false and no witness", () => {
    const target = claim(A, 0, "x");
    const neg = negate(target, A, 1);
    const r = reactorOf([neg]); // the target was never held, or was purged and the reactor replayed
    expect(r.negationWitnesses(5, () => true)(target.id)).toEqual([]);
    expect(negatedAt(r, 5, A)(target.id)).toBe(false);
    expect(dataStruck(r, 5, A)(target.id)).toBe(false);
    expect(honoredStrikeOn(r, 5, target.id, A)).toBeUndefined();
    // Behaviour change: the step-3 Loam walk answered TRUE for an absent target.
    expect(lawfulNegated(r, A)(target.id)).toBe(true);
  });

  it("(d) latestByKey does not mask: it picks a negated candidate unless the caller masks first", () => {
    const older = claim(A, 1, "old");
    const newer = claim(A, 2, "new");
    const neg = negate(newer, A, 3);
    const r = reactorOf([older, newer, neg]);
    const keyOf = (d: Delta) => (d.claims.pointers.some((p) => p.role === "key") ? "k" : undefined);
    const unmasked = latestByKey(r.snapshot(), 10, new Set([A]), keyOf);
    expect(unmasked.get("k")?.id).toBe(newer.id); // the negated claim wins
    const negated = r.negationPredicate(10, (n) => n.claims.author === A);
    const masked = latestByKey(
      DeltaSet.from([...r.snapshot()].filter((d) => !negated(d.id))),
      10,
      new Set([A]),
      keyOf,
    );
    expect(masked.get("k")?.id).toBe(older.id);
  });

  it("(d') latestByKey breaks a timestamp tie toward the SMALLER id", () => {
    const x = claim(A, 5, "x");
    const y = claim(A, 5, "y");
    const [small, large] = x.id < y.id ? [x, y] : [y, x];
    const keyOf = () => "k";
    expect(latestByKey(DeltaSet.from([x, y]), 10, new Set([A]), keyOf).get("k")?.id).toBe(small.id);
    // Loam's own latest-wins readers (trust, budget, envelope, binding-policy, tenantOf) break
    // the same tie toward the LARGER id.
    expect(large.id > small.id).toBe(true);
  });

  it("a registration struck from T is unbound at T, with nothing written", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const T0 = 1_000_000;
    vi.setSystemTime(T0 - 1);
    const genesis = assembleGenesis({
      operatorSeed: SEEDS.operator,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: ["plant:fern"], writable: [] },
        {
          hyperschema: { ...PLANT, name: "Shrub" },
          schema: PLANT_POLICY,
          roots: ["plant:fern"],
          writable: [],
        },
      ],
    });
    const shrub = genesis.deltas.find(
      (d) =>
        d.claims.pointers.some(
          (p) => p.target.kind === "entity" && p.target.entity.context === CTX_REGISTRATION,
        ) && JSON.stringify(d.claims).includes("registration:hyperschema:Shrub"),
    )!;
    const gw = await Gateway.boot(new MemoryBackend(), genesis);
    await gw.append([
      signClaims({ ...strike(shrub, "operator", T0 - 1).claims, validFrom: T0 }, SEEDS.operator),
    ]);
    const names = () => gw.registered.map((r) => r.hyperschema.name).sort();
    expect(names()).toEqual(["Plant", "Shrub"]); // T-1: the strike is not valid yet
    await vi.advanceTimersByTimeAsync(1);
    expect(names()).toEqual(["Plant"]); // T: the timer replayed the registrations
    await gw.close();
  });
});
