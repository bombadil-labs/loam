// `dataStruck` and the gather's trust mask read one rule: the operator, plus the subject of every
// surviving operator grant. This rail asks both on the same store and requires the same answer,
// including for subjects the mask's `inView` extract treats specially: a NUMBER primitive names no
// author, and an ENTITY subject names its id.

import { describe, expect, it } from "vitest";
import {
  evalTerm,
  makeDelta,
  makeNegationClaims,
  parseTerm,
  Reactor,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { CTX_GRANTS, dataStruck, lawfulStrikersJson } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";

const OP = "ed25519:" + "0a".repeat(32);
const NOW = 1_000;

const grant = (subject: Claims["pointers"][number]["target"], t: number): Delta =>
  makeDelta({
    timestamp: t,
    validFrom: t,
    author: OP,
    pointers: [
      {
        role: "grants",
        target: { kind: "entity", entity: { id: STORE_ENTITY, context: CTX_GRANTS } },
      },
      { role: "subject", target: subject },
      { role: "verb", target: { kind: "primitive", value: "write" } },
    ],
  });
const claim = (t: number): Delta =>
  makeDelta({
    timestamp: t,
    validFrom: t,
    author: "someone",
    pointers: [{ role: "note", target: { kind: "primitive", value: t } }],
  });
const strike = (by: string, target: Delta, t: number): Delta =>
  makeDelta(makeNegationClaims(by, t, target.id));

function bothReadings(deltas: Delta[], target: Delta): { dataStruck: boolean; mask: boolean } {
  const reactor = new Reactor();
  for (const d of deltas) reactor.ingest(d);
  const masked = evalTerm(
    parseTerm({ op: "mask", policy: { trust: lawfulStrikersJson(OP, false) }, in: "input" }),
    reactor.snapshot(),
    NOW,
  );
  if (masked.sort !== "dset") throw new Error("a mask evaluates to a delta set");
  return {
    dataStruck: dataStruck(reactor, NOW, OP)(target.id),
    mask: !new Set([...masked.set].map((d) => d.id)).has(target.id),
  };
}

describe("dataStruck agrees with the gather's trust mask", () => {
  it("a grant whose subject is a number primitive makes no striker", () => {
    const target = claim(10);
    const r = bothReadings(
      [grant({ kind: "primitive", value: 123 }, 1), target, strike("123", target, 20)],
      target,
    );
    expect(r).toEqual({ dataStruck: false, mask: false });
  });

  it("a grant whose subject is an entity makes that entity's id a striker", () => {
    const target = claim(10);
    const r = bothReadings(
      [
        grant({ kind: "entity", entity: { id: "author:X", context: "who" } }, 1),
        target,
        strike("author:X", target, 20),
      ],
      target,
    );
    expect(r).toEqual({ dataStruck: true, mask: true });
  });

  it("a grant the operator has negated makes no striker, in both readings", () => {
    const target = claim(10);
    const g = grant({ kind: "primitive", value: "author:Z" }, 1);
    const r = bothReadings([g, strike(OP, g, 5), target, strike("author:Z", target, 20)], target);
    expect(r).toEqual({ dataStruck: false, mask: false });
  });

  it("a grant whose subject is a string makes that string a striker (a control)", () => {
    const target = claim(10);
    const r = bothReadings(
      [grant({ kind: "primitive", value: "author:Y" }, 1), target, strike("author:Y", target, 20)],
      target,
    );
    expect(r).toEqual({ dataStruck: true, mask: true });
  });
});
