// Governed trust lowering (governed-trust.ts), asked below the door: what the lowered predicate
// trusts, over the same deltas the canonical predicate reflects. A grant naming `user:<name>` must
// trust that user's ROOT key, never the subject's text; a key-named grant must trust exactly what
// it trusted before lowering existed. The door and the served View are asked in
// governed-user-trust.test.ts.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  evalTerm,
  evalTermRaw,
  makeNegationClaims,
  parseTerm,
  Reactor,
  SchemaRegistry,
  signClaims,
  termToJson,
  type Delta,
  type EvalResult,
  type Term,
} from "@bombadil/rhizomatic";
import {
  dataStruck,
  governedGatherBody,
  grantClaims,
  lawfulStrikersJson,
} from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import {
  governedProgram,
  governs,
  lowerGovernedTerm,
  type TrustRead,
} from "../../src/gateway/governed-trust.js";
import { userGroundOf } from "../../src/gateway/user-root.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "d1".repeat(32);
const K1 = authorForSeed(K1_SEED);
const K2_SEED = "d2".repeat(32);
const K2 = authorForSeed(K2_SEED);
const X_SEED = "b3".repeat(32);
const X = authorForSeed(X_SEED);
const NOW = 5_000;

const op = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);
const grant = (subject: string, t: number, until?: number): Delta =>
  op({
    ...grantClaims(STORE_ENTITY, subject, "write", OP, t),
    ...(until && { validUntil: until }),
  });
const strike = (seed: string, target: Delta, t: number): Delta =>
  signClaims(makeNegationClaims(authorForSeed(seed), t, target.id), seed);
const reactorOf = (deltas: readonly Delta[]): Reactor => {
  const r = new Reactor();
  for (const d of deltas) r.ingest(d);
  return r;
};

const MASK = (flag = false): Term =>
  parseTerm({ op: "mask", policy: { trust: lawfulStrikersJson(OP, flag) }, in: "input" });

// The ids a mask keeps, evaluated as written (`lowered: false`) or lowered first.
function kept(r: Reactor, read: TrustRead, lowered: boolean, term: Term = MASK()): Set<string> {
  const input = r.snapshot();
  const program = lowered
    ? governedProgram(term, undefined, input, read, userGroundOf(r)).term
    : term;
  const out: EvalResult =
    "raw" in read ? evalTermRaw(program, input) : evalTerm(program, input, read.now);
  if (out.sort !== "dset") throw new Error("a mask evaluates to a delta set");
  return new Set([...out.set].map((d) => d.id));
}

// ada, whose root is K1, recorded by the operator.
const ada = (t = 1): Delta[] => [op(userClaims("ada", OP, t)), op(rootClaims("ada", K1, OP, t))];

describe("R1: key-named grants trust what they trusted before lowering (a control)", () => {
  const fixtures: Record<string, () => { deltas: Delta[]; target: Delta }> = {
    "a live grant": () => {
      const target = observed(FERN, "height", 1, 100, X_SEED);
      return { deltas: [grant(K1, 1), target, strike(K1_SEED, target, 200)], target };
    },
    "a grant the operator struck": () => {
      const g = grant(K1, 1);
      const target = observed(FERN, "height", 1, 100, X_SEED);
      return {
        deltas: [g, op(makeNegationClaims(OP, 2, g.id)), target, strike(K1_SEED, target, 200)],
        target,
      };
    },
    "an expired grant": () => {
      const target = observed(FERN, "height", 1, 100, X_SEED);
      return { deltas: [grant(K1, 1, 50), target, strike(K1_SEED, target, 200)], target };
    },
    "a stranger's strike": () => {
      const target = observed(FERN, "height", 1, 100, K1_SEED);
      return { deltas: [grant(K1, 1), target, strike(X_SEED, target, 200)], target };
    },
  };
  for (const [name, make] of Object.entries(fixtures)) {
    it(`${name}: present and raw, lowered equals written`, () => {
      const { deltas } = make();
      const r = reactorOf(deltas);
      for (const read of [{ now: NOW }, { raw: true as const }]) {
        expect(kept(r, read, true)).toEqual(kept(r, read, false));
      }
    });
  }
});

describe("R10: a grant naming a user trusts that user's root, in dataStruck and the mask alike", () => {
  it("ada's root strike binds; a stranger's does not; the subject text is no author", () => {
    const byRoot = observed(FERN, "height", 1, 100, X_SEED);
    const byStranger = observed(FERN, "height", 2, 101, K1_SEED);
    const byText = observed(FERN, "height", 3, 102, K1_SEED);
    const r = reactorOf([
      ...ada(),
      grant("user:ada", 2),
      byRoot,
      byStranger,
      byText,
      strike(K1_SEED, byRoot, 200),
      strike(X_SEED, byStranger, 201),
    ]);
    // A delta authored by the literal text "user:ada" cannot be signed; the lowered set is asked
    // directly for it below.
    const live = kept(r, { now: NOW }, true);
    const struck = dataStruck(r, NOW, OP);
    expect([live.has(byRoot.id), struck(byRoot.id)]).toEqual([false, true]);
    expect([live.has(byStranger.id), struck(byStranger.id)]).toEqual([true, false]);
    expect(live.has(byText.id)).toBe(true);
    const lowered = JSON.stringify(
      termToJson(lowerGovernedTerm(MASK(), r.snapshot(), { now: NOW }, userGroundOf(r))),
    );
    expect(lowered).toContain(K1);
    expect(lowered).not.toContain("user:ada");
    // Written, the mask reflects the text: ada's root is NOT trusted. This is the gap lowering closes.
    expect(kept(r, { now: NOW }, false).has(byRoot.id)).toBe(true);
  });

  it("a user with no root adds nobody (a control: the text was inert before too)", () => {
    const target = observed(FERN, "height", 1, 100, X_SEED);
    const r = reactorOf([
      op(userClaims("ada", OP, 1)),
      grant("user:ada", 2),
      target,
      strike(K1_SEED, target, 200),
    ]);
    expect(kept(r, { now: NOW }, true).has(target.id)).toBe(true);
    expect(dataStruck(r, NOW, OP)(target.id)).toBe(false);
  });
});

describe("R12: the WHOLE predicate is lowered", () => {
  it("no grant reflection survives, and the operator's own strike still binds", () => {
    const target = observed(FERN, "height", 1, 100, X_SEED);
    const r = reactorOf([...ada(), grant("user:ada", 2), target, strike(OP_SEED, target, 200)]);
    const lowered = lowerGovernedTerm(MASK(), r.snapshot(), { now: NOW }, userGroundOf(r));
    expect(JSON.stringify(termToJson(lowered))).not.toContain("inView");
    expect(kept(r, { now: NOW }, true).has(target.id)).toBe(false);
  });

  it("the grant reflection alone, outside its or, is refused rather than lowered", () => {
    const leaf = (lawfulStrikersJson(OP, false) as { or: unknown[] }).or[1];
    const term = parseTerm({ op: "mask", policy: { trust: leaf }, in: "input" });
    const r = reactorOf([...ada(), grant("user:ada", 2)]);
    expect(governs(term)).toBe(true);
    expect(() => lowerGovernedTerm(term, r.snapshot(), { now: NOW }, userGroundOf(r))).toThrow(
      /does not recognize as governed trust/,
    );
  });
});

describe("R13: a near miss fails closed; an unrelated inView is ordinary law", () => {
  const canonical = lawfulStrikersJson(OP, false) as {
    or: [unknown, { inView: Record<string, unknown> }];
  };
  const variant = (inView: Record<string, unknown>): Term =>
    parseTerm({
      op: "mask",
      policy: {
        trust: { or: [canonical.or[0], { inView: { ...canonical.or[1].inView, ...inView } }] },
      },
      in: "input",
    });
  const r = reactorOf([...ada(), grant("user:ada", 2)]);
  const lower = (t: Term) => () =>
    lowerGovernedTerm(t, r.snapshot(), { now: NOW }, userGroundOf(r));

  it("another extract role over the grants", () => {
    expect(lower(variant({ extract: { role: "grantee" } }))).toThrow(/governed trust/);
  });
  it("the id field in place of the author", () => {
    expect(lower(variant({ field: "id" }))).toThrow(/governed trust/);
  });
  it("grants of another operator under this operator's name", () => {
    const other = (lawfulStrikersJson(X, false) as typeof canonical).or[1].inView;
    expect(lower(variant({ term: other.term }))).toThrow(/governed trust/);
  });
  it("an inView outside a trust policy is left alone and evaluates (a control)", () => {
    const term = parseTerm({
      op: "select",
      pred: {
        inView: {
          term: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: OP } },
            in: "input",
          },
          field: "author",
          extract: { role: "subject" },
        },
      },
      in: "input",
    });
    expect(governs(term)).toBe(false);
    expect(termToJson(lower(term)())).toEqual(termToJson(term));
  });
});

describe("R14: raw mode never narrows what the raw machinery trusts (a control)", () => {
  it("an expired key grant's subject still strikes under raw evaluation, lowered or not", () => {
    const target = observed(FERN, "height", 1, 100, X_SEED);
    const r = reactorOf([grant(K1, 1, 50), target, strike(K1_SEED, target, 200)]);
    expect(kept(r, { raw: true }, false).has(target.id)).toBe(false);
    expect(kept(r, { raw: true }, true).has(target.id)).toBe(false);
    // and present evaluation, where the grant has lapsed, keeps it
    expect(kept(r, { now: NOW }, true).has(target.id)).toBe(true);
  });

  it("raw mode expands a user to every root the operator named and did not strike", () => {
    const byK1 = observed(FERN, "height", 1, 100, X_SEED);
    const byK2 = observed(FERN, "height", 2, 101, X_SEED);
    const later = op({ ...rootClaims("ada", K2, OP, 3000), validFrom: 3000 });
    const r = reactorOf([
      ...ada(),
      later,
      grant("user:ada", 2),
      byK1,
      byK2,
      strike(K1_SEED, byK1, 200),
      strike(K2_SEED, byK2, 201),
    ]);
    const raw = kept(r, { raw: true }, true);
    expect([raw.has(byK1.id), raw.has(byK2.id)]).toEqual([false, false]);
    // present at NOW (after 3000) is K2 alone
    const present = kept(r, { now: NOW }, true);
    expect([present.has(byK1.id), present.has(byK2.id)]).toEqual([true, false]);
    // a root claim the operator struck is gone from raw too
    const r2 = reactorOf([
      ...ada(),
      later,
      op(makeNegationClaims(OP, 3001, later.id)),
      grant("user:ada", 2),
      byK2,
      strike(K2_SEED, byK2, 201),
    ]);
    expect(kept(r2, { raw: true }, true).has(byK2.id)).toBe(true);
  });
});

describe("R16: no memo outlives one evaluation", () => {
  it("two grounds of the same size with different roots read their own roots", () => {
    const make = (root: string) => {
      const target = observed(FERN, "height", 1, 100, X_SEED);
      return reactorOf([
        op(userClaims("ada", OP, 1)),
        op(rootClaims("ada", root, OP, 1)),
        grant("user:ada", 2),
        target,
        strike(K1_SEED, target, 200),
      ]);
    };
    const withK1 = make(K1);
    const withK2 = make(K2);
    expect(withK1.size).toBe(withK2.size);
    const idOf = (r: Reactor) => [...r.snapshot()].find((d) => d.claims.timestamp === 100)!.id;
    expect(kept(withK1, { now: NOW }, true).has(idOf(withK1))).toBe(false);
    expect(kept(withK2, { now: NOW }, true).has(idOf(withK2))).toBe(true);
    expect(kept(withK1, { now: NOW }, true).has(idOf(withK1))).toBe(false);
  });
});

describe("R17: a governed body reached through the registry is lowered too", () => {
  it("a fix naming a governed schema trusts ada's root", () => {
    const target = observed(FERN, "height", 1, 100, X_SEED);
    const stranger = observed(FERN, "height", 2, 101, K1_SEED);
    const r = reactorOf([
      ...ada(),
      grant("user:ada", 2),
      target,
      stranger,
      strike(K1_SEED, target, 200),
      strike(X_SEED, stranger, 201),
    ]);
    const registry = SchemaRegistry.build([{ name: "Gov", alg: 1, body: governedGatherBody(OP) }]);
    const term = parseTerm({ op: "fix", schema: "Gov", entity: FERN });
    expect(governs(term)).toBe(false);
    const input = r.snapshot();
    const program = governedProgram(term, registry, input, { now: NOW }, userGroundOf(r));
    const out = evalTerm(program.term, input, NOW, FERN, program.registry);
    if (out.sort !== "hview") throw new Error("a gather yields a hyperview");
    const ids = new Set([...out.hview.props.values()].flat().map((e) => e.delta.id));
    expect(ids.has(target.id)).toBe(false);
    expect(ids.has(stranger.id)).toBe(true);
    // the registry's signed body is untouched
    expect(
      JSON.stringify(termToJson(registry.resolve({ kind: "name", name: "Gov" })!.body)),
    ).toContain("inView");
  });
});
