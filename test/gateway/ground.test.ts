import { describe, expect, it } from "vitest";
import { authorForSeed, Reactor, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { CTX_GRANTS } from "../../src/gateway/governed-trust.js";
import { grantSubjects } from "../../src/gateway/grants-law.js";
import type { Ground } from "../../src/gateway/ground.js";
import { lawfulNegated, negatedAt } from "../../src/gateway/negation.js";
import { declaresTrust, readTrustPolicy, trustClaims } from "../../src/gateway/trust.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const STRANGER_SEED = "5a".repeat(32);
const ALICE = authorForSeed("a1".repeat(32));
const BOB = authorForSeed("b0".repeat(32));
const NOW = 10_000;

const strike = (seed: string, target: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author: authorForSeed(seed),
      pointers: [{ role: "negates", target: { kind: "delta", deltaRef: { delta: target } } }],
    },
    seed,
  );

const grant = (subject: string, timestamp: number): Delta =>
  signClaims(
    {
      timestamp,
      validFrom: timestamp,
      author: OP,
      pointers: [
        {
          role: "grants",
          target: { kind: "entity", entity: { id: STORE_ENTITY, context: CTX_GRANTS } },
        },
        { role: "subject", target: { kind: "primitive", value: subject } },
        { role: "verb", target: { kind: "primitive", value: "write" } },
      ],
    } satisfies Claims,
    OP_SEED,
  );

const rosterAlice = signClaims(trustClaims("roster", [ALICE], OP, 100), OP_SEED);
const closedBob = signClaims(trustClaims("closed", [BOB], OP, 200), OP_SEED);
const strikeClosed = strike(OP_SEED, closedBob.id, 300);
const strikeTheStrike = strike(OP_SEED, strikeClosed.id, 400);
const strikeAgain = strike(OP_SEED, strikeTheStrike.id, 500);
const strangerStrike = strike(STRANGER_SEED, rosterAlice.id, 600);
const lateStrike = strike(OP_SEED, rosterAlice.id, NOW + 1);
const DELTAS: readonly Delta[] = [
  rosterAlice,
  closedBob,
  strikeClosed,
  strikeTheStrike,
  strikeAgain,
  strangerStrike,
  lateStrike,
  grant(ALICE, 700),
  grant(BOB, 800),
];

function plainGround(deltas: readonly Delta[]): Ground {
  const held = new Map(deltas.map((d) => [d.id, d]));
  const index = (keyOf: (d: Delta) => string[]): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const d of deltas) {
      for (const key of new Set(keyOf(d))) out.set(key, [...(out.get(key) ?? []), d.id]);
    }
    return out;
  };
  const byEntity = index((d) =>
    d.claims.pointers.flatMap((p) => (p.target.kind === "entity" ? [p.target.entity.id] : [])),
  );
  const byNegated = index((d) =>
    d.claims.pointers.flatMap((p) =>
      p.role === "negates" && p.target.kind === "delta" ? [p.target.deltaRef.delta] : [],
    ),
  );
  const ground: Ground = {
    get: (id) => held.get(id),
    byTarget: (entity) => byEntity.get(entity) ?? [],
    negationsOf: (id) => byNegated.get(id) ?? [],
    negationWitnesses(now, suppression) {
      const witnesses = (id: string): readonly Delta[] => {
        const target = held.get(id);
        if (target === undefined) return [];
        return ground
          .negationsOf(id)
          .map((n) => held.get(n))
          .filter(
            (n): n is Delta =>
              n !== undefined &&
              n.claims.validFrom <= now &&
              (n.claims.validUntil === undefined || now < n.claims.validUntil) &&
              suppression(n, target) &&
              witnesses(n.id).length === 0,
          );
      };
      return witnesses;
    },
    negationPredicate(now, suppression) {
      const witnesses = ground.negationWitnesses(now, suppression);
      return (id) => witnesses(id).length > 0;
    },
  };
  return ground;
}

function reactorOver(deltas: readonly Delta[]): Reactor {
  const reactor = new Reactor();
  for (const d of deltas) expect(reactor.ingest(d).status).toBe("accepted");
  return reactor;
}

describe("a Ground that is not a Reactor", () => {
  const reactor: Ground = reactorOver(DELTAS);
  const plain = plainGround(DELTAS);

  it("reads the same trust policy, with the struck declaration left out", () => {
    const fromPlain = readTrustPolicy(plain, NOW, OP);
    expect(fromPlain).toEqual(readTrustPolicy(reactor, NOW, OP));
    expect(fromPlain.mode).toBe("roster");
    expect([...fromPlain.roster]).toEqual([ALICE]);
    expect(declaresTrust(plain, NOW, OP)).toBe(declaresTrust(reactor, NOW, OP));
    expect(declaresTrust(plain, NOW, OP)).toBe(true);
  });

  it("answers every negation question the same way, for every held id", () => {
    const readers = (ground: Ground) => ({
      lawful: lawfulNegated(ground, OP),
      anyone: lawfulNegated(ground),
      operatorNow: negatedAt(ground, NOW, OP),
      anyoneNow: negatedAt(ground, NOW, undefined),
      anyoneLater: negatedAt(ground, NOW + 2, undefined),
    });
    const a = readers(plain);
    const b = readers(reactor);
    for (const key of Object.keys(a) as (keyof typeof a)[]) {
      const answers = (r: typeof a) => DELTAS.map((d) => r[key](d.id));
      expect(answers(a), key).toEqual(answers(b));
    }
    expect(a.lawful(closedBob.id)).toBe(true);
    expect(a.lawful(strikeClosed.id)).toBe(false);
    expect(a.lawful(strikeTheStrike.id)).toBe(true);
    expect(a.lawful(rosterAlice.id)).toBe(true);
    expect(a.anyoneNow(rosterAlice.id)).toBe(true);
    expect(a.operatorNow(rosterAlice.id)).toBe(false);
    expect(negatedAt(plain, NOW + 2, OP)(rosterAlice.id)).toBe(true);
    expect(a.anyoneNow("no-such-delta")).toBe(false);
  });

  it("lists the same grant subjects", () => {
    expect(grantSubjects(plain)).toEqual(grantSubjects(reactor));
    expect(grantSubjects(plain).sort()).toEqual([ALICE, BOB].sort());
  });
});
