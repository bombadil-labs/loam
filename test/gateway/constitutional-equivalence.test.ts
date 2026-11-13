import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  Reactor,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lawfulNegated } from "../../src/gateway/registration.js";
import { lawfulDeltasAt, lawfulSnapshot } from "../../src/gateway/lawful.js";
import {
  CTX_TRUST,
  TRUST_ENTITY,
  readTrustPolicy,
  readTrustPolicyAt,
  trustClaims,
} from "../../src/gateway/trust.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import {
  BUDGET_ENTITY,
  CTX_BUDGET,
  budgetClaims,
  readBudgetPolicy,
} from "../../src/gateway/budget.js";
import {
  CTX_PUBLIC,
  PUBLIC_ENTITY,
  publicClaims,
  readPublicSchemas,
} from "../../src/gateway/public.js";
import {
  ARTIFACT_ENTITY,
  CTX_ARTIFACT,
  artifactClaims,
  readArtifactRoutes,
} from "../../src/gateway/artifact.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import {
  FERN,
  GARDENER,
  GARDENER_SEED,
  SURVEYOR,
  SURVEYOR_SEED,
  observed,
} from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

function scannedNegated(reactor: Reactor, operator?: string): (id: string) => boolean {
  const lawfulIds = new Set([...lawfulSnapshot(reactor, Date.now(), operator)].map((d) => d.id));
  const memo = new Map<string, boolean>();
  const negated = (id: string): boolean => {
    const memoed = memo.get(id);
    if (memoed !== undefined) return memoed;
    memo.set(id, false);
    const verdict = reactor
      .negationsOf(id)
      .some((negation) => lawfulIds.has(negation) && !negated(negation));
    memo.set(id, verdict);
    return verdict;
  };
  return negated;
}

function scannedDeltasAt(
  reactor: Reactor,
  entity: string,
  context: string,
  operator?: string,
): Delta[] {
  const out: Delta[] = [];
  for (const delta of lawfulSnapshot(reactor, Date.now(), operator)) {
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === context,
    );
    if (filedHere) out.push(delta);
  }
  return out;
}

function scannedTrustPolicy(
  reactor: Reactor,
  subject: string,
  operator?: string,
): { mode: string; roster: string[] } {
  if (operator === undefined) return { mode: "open", roster: [] };
  const negated = scannedNegated(reactor, operator);
  const roster = new Set<string>();
  let latest: { mode: string; timestamp: number; id: string } | undefined;
  const MODES = new Set(["open", "roster", "closed"]);
  for (const delta of scannedDeltasAt(reactor, subject, CTX_TRUST, operator)) {
    if (negated(delta.id)) continue;
    let mode: string | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "mode" && mode === undefined && MODES.has(p.target.value))
        mode = p.target.value;
      if (p.role === "admit-author") roster.add(p.target.value);
    }
    if (mode === undefined) continue;
    if (
      latest === undefined ||
      delta.claims.timestamp > latest.timestamp ||
      (delta.claims.timestamp === latest.timestamp && delta.id > latest.id)
    ) {
      latest = { mode, timestamp: delta.claims.timestamp, id: delta.id };
    }
  }
  return { mode: latest === undefined ? "open" : latest.mode, roster: [...roster].sort() };
}

function scannedBudgets(reactor: Reactor, operator?: string): [string, number | undefined][] {
  if (operator === undefined) return [];
  const negated = scannedNegated(reactor, operator);
  const latest = new Map<string, { max: number | undefined; timestamp: number; id: string }>();
  for (const delta of scannedDeltasAt(reactor, BUDGET_ENTITY, CTX_BUDGET, operator)) {
    if (negated(delta.id)) continue;
    let subject: string | undefined;
    let max: number | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive") continue;
      if (p.role === "subject" && typeof p.target.value === "string" && p.target.value !== "") {
        subject = p.target.value;
      }
      if (p.role === "maxAppends" && typeof p.target.value === "number") max = p.target.value;
    }
    if (subject === undefined) continue;
    const held = latest.get(subject);
    if (
      held === undefined ||
      delta.claims.timestamp > held.timestamp ||
      (delta.claims.timestamp === held.timestamp && delta.id > held.id)
    ) {
      latest.set(subject, { max, timestamp: delta.claims.timestamp, id: delta.id });
    }
  }
  return [...latest]
    .filter(([, v]) => v.max !== undefined)
    .map(([k, v]): [string, number | undefined] => [k, v.max])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

function scannedUnion(
  reactor: Reactor,
  entity: string,
  context: string,
  role: string,
  operator?: string,
): string[] {
  if (operator === undefined) return [];
  const negated = scannedNegated(reactor, operator);
  const open = new Set<string>();
  for (const delta of scannedDeltasAt(reactor, entity, context, operator)) {
    if (negated(delta.id)) continue;
    for (const p of delta.claims.pointers) {
      if (
        p.role === role &&
        p.target.kind === "primitive" &&
        typeof p.target.value === "string" &&
        p.target.value !== ""
      ) {
        open.add(p.target.value);
      }
    }
  }
  return [...open].sort();
}

const ids = (ds: readonly Delta[]): string[] => ds.map((d) => d.id).sort();

function assertIdentical(reactor: Reactor, where: string, operator?: string): void {
  for (const [entity, context] of [
    [TRUST_ENTITY, CTX_TRUST],
    [BUDGET_ENTITY, CTX_BUDGET],
    [PUBLIC_ENTITY, CTX_PUBLIC],
    [ARTIFACT_ENTITY, CTX_ARTIFACT],
  ] as const) {
    expect(
      ids(lawfulDeltasAt(reactor, Date.now(), { entity, context }, operator)),
      `${where}: the indexed candidate set at ${entity} differs from the scanned one`,
    ).toEqual(ids(scannedDeltasAt(reactor, entity, context, operator)));
  }

  const shipped = lawfulNegated(reactor, operator);
  const oracle = scannedNegated(reactor, operator);
  for (const d of reactor.snapshot()) {
    expect(shipped(d.id), `${where}: lawfulNegated disagrees with the scan on ${d.id}`).toBe(
      oracle(d.id),
    );
  }

  const trust = readTrustPolicy(reactor, Date.now(), operator);
  const trustOracle = scannedTrustPolicy(reactor, TRUST_ENTITY, operator);
  expect({ mode: trust.mode, roster: [...trust.roster].sort() }, `${where}: trust policy`).toEqual(
    trustOracle,
  );

  const budgets = [...readBudgetPolicy(reactor, Date.now(), operator)]
    .map(([k, v]): [string, number | undefined] => [k, v.maxAppends])
    .sort((a, b) => a[0].localeCompare(b[0]));
  expect(budgets, `${where}: budget policy`).toEqual(scannedBudgets(reactor, operator));

  expect(
    [...readPublicSchemas(reactor, Date.now(), operator)].sort(),
    `${where}: public schemas`,
  ).toEqual(scannedUnion(reactor, PUBLIC_ENTITY, CTX_PUBLIC, "schema", operator));
  expect(
    [...readArtifactRoutes(reactor, Date.now(), operator)].sort(),
    `${where}: artifact routes`,
  ).toEqual(scannedUnion(reactor, ARTIFACT_ENTITY, CTX_ARTIFACT, "route", operator));
}

const sign = (c: Parameters<typeof signClaims>[0], seed = OP_SEED): Delta => signClaims(c, seed);

const CAGE = "container:equivalence";
const trustAt = (subject: string, mode: string, authors: readonly string[], ts: number) => ({
  timestamp: ts,
  validFrom: ts,
  author: OP,
  pointers: [
    {
      role: "declares",
      target: { kind: "entity" as const, entity: { id: subject, context: CTX_TRUST } },
    },
    { role: "mode", target: { kind: "primitive" as const, value: mode } },
    ...authors.map((a) => ({
      role: "admit-author",
      target: { kind: "primitive" as const, value: a },
    })),
  ],
});

describe("T37 — the indexed answer equals the scanned answer, through every mutation", () => {
  it("holds across arrival, supersession, withdrawal, revival, strangers, volume and erasure", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    await gw.append([
      sign(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 1)),
      sign(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 2)),
    ]);
    assertIdentical(gw.reactor, "an empty constitution", OP);

    const trust1 = sign(trustClaims("roster", [GARDENER], OP, 9001));
    const budget1 = sign(budgetClaims(GARDENER, 500, OP, 9002));
    const public1 = sign(publicClaims(["Plant"], OP, 9003));
    const artifact1 = sign(artifactClaims(["board"], OP, 9004));
    await gw.append([trust1, budget1, public1, artifact1]);
    assertIdentical(gw.reactor, "the law arrives", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("roster");

    const trust2 = sign(trustClaims("closed", [SURVEYOR], OP, 9100));
    const budget2 = sign(budgetClaims(GARDENER, 50, OP, 9101));
    await gw.append([trust2, budget2]);
    assertIdentical(gw.reactor, "a later declaration supersedes", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("closed");

    const strike = sign(makeNegationClaims(OP, 9200, trust2.id));
    await gw.append([strike]);
    assertIdentical(gw.reactor, "the live declaration is withdrawn", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("roster");

    const counter = sign(makeNegationClaims(OP, 9300, strike.id));
    await gw.append([counter]);
    assertIdentical(gw.reactor, "the withdrawal is itself struck", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("closed");

    await gw.append([sign(trustClaims("open", [], OP, 9350))]);

    const foreign = signClaims(trustClaims("closed", [SURVEYOR], GARDENER, 9400), GARDENER_SEED);
    expect((await gw.federate([foreign])).accepted).toBe(1);
    assertIdentical(gw.reactor, "a stranger's declaration arrives", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("open");

    const live = sign(trustClaims("roster", [GARDENER], OP, 9450));
    await gw.append([live]);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("roster");
    const foreignStrike = signClaims(makeNegationClaims(GARDENER, 9500, live.id), GARDENER_SEED);
    expect((await gw.federate([foreignStrike])).accepted).toBe(1);
    assertIdentical(gw.reactor, "a stranger strikes the operator's law", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).toBe("roster");

    await gw.append([
      sign(
        containerClaims(
          {
            container: CAGE,
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { hasPointer: { context: { exact: "readings" } } },
              in: "input",
            },
          },
          OP,
          9600,
        ),
      ),
    ]);
    await gw.append([sign(trustAt(CAGE, "roster", [SURVEYOR], 9610))]);
    const decoy = sign({
      ...trustAt(CAGE, "closed", [GARDENER], 9620),
      pointers: [
        {
          role: "declares",
          target: { kind: "entity" as const, entity: { id: CAGE, context: "loam.decoy" } },
        },
        { role: "mode", target: { kind: "primitive" as const, value: "closed" } },
        { role: "admit-author", target: { kind: "primitive" as const, value: GARDENER } },
      ],
    });
    await gw.append([decoy]);
    for (const at of [TRUST_ENTITY, CAGE]) {
      expect(
        ids(lawfulDeltasAt(gw.reactor, gw.validityNow(), { entity: at, context: CTX_TRUST }, OP)),
        `one entity, two contexts: the indexed candidates at ${at} differ from the scanned ones`,
      ).toEqual(ids(scannedDeltasAt(gw.reactor, at, CTX_TRUST, OP)));
      const shipped = readTrustPolicyAt(gw.reactor, gw.validityNow(), at, OP);
      expect({ mode: shipped.mode, roster: [...shipped.roster].sort() }).toEqual(
        scannedTrustPolicy(gw.reactor, at, OP),
      );
    }
    expect(readTrustPolicyAt(gw.reactor, gw.validityNow(), CAGE, OP).mode).toBe("roster");
    expect([...readTrustPolicyAt(gw.reactor, gw.validityNow(), CAGE, OP).roster]).toEqual([
      SURVEYOR,
    ]);
    expect(gw.reactor.byTarget(CAGE).length).toBeGreaterThan(
      lawfulDeltasAt(gw.reactor, gw.validityNow(), { entity: CAGE, context: CTX_TRUST }, OP).length,
    );
    assertIdentical(gw.reactor, "one entity carries two kinds of law", OP);

    await gw.append(
      Array.from({ length: 50 }, (_, i) => observed(FERN, "readings", i, 20000 + i, OP_SEED)),
    );
    assertIdentical(gw.reactor, "fifty deltas of unrelated ground", OP);

    await gw.erase(budget1.id, { reason: "a superseded quota, unsaid" });
    expect(gw.reactor.get(budget1.id)).toBeUndefined();
    assertIdentical(gw.reactor, "after a constitutional delta is erased", OP);

    const before = readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode;
    await gw.erase(live.id, { reason: "the governing declaration, unsaid" });
    assertIdentical(gw.reactor, "after the governing declaration is erased", OP);
    expect(readTrustPolicy(gw.reactor, gw.validityNow(), OP).mode).not.toBe(before);

    await gw.close();
  });

  const withSubstrateNegation = (
    stub: Record<string, unknown> & { get: (id: string) => unknown },
  ): Reactor => {
    const ground = Object.assign(Object.create(Reactor.prototype) as object, stub, {
      set: { get: stub.get },
      membershipRevision: 0,
    });
    return ground as unknown as Reactor;
  };

  it("a strike the store no longer HOLDS retires nothing — the purge hole, pinned directly", () => {
    const trust = sign(trustClaims("closed", [], OP, 1000));
    const purged = sign(makeNegationClaims(OP, 1100, trust.id));
    const stub = withSubstrateNegation({
      negationsOf: (id: string) => (id === trust.id ? [purged.id] : []),
      get: (id: string) => (id === trust.id ? trust : undefined),
      snapshot: () => new Set([trust]),
      byTarget: () => [trust.id],
    });

    expect(lawfulNegated(stub, OP)(trust.id)).toBe(false);
    expect(readTrustPolicy(stub, Date.now(), OP).mode).toBe("closed");
  });

  it("a ground that disagrees with its own index REFUSES — it does not read law from the gap", () => {
    const trust = sign(trustClaims("closed", [], OP, 1000));
    const stub = withSubstrateNegation({
      negationsOf: () => [],
      get: () => undefined,
      snapshot: () => new Set([trust]),
      byTarget: () => [trust.id],
    });

    expect(() =>
      lawfulDeltasAt(stub, Date.now(), { entity: TRUST_ENTITY, context: CTX_TRUST }, OP),
    ).toThrow(/cannot resolve it/);
    expect(() => readTrustPolicy(stub, Date.now(), OP)).toThrow(/cannot resolve it/);
  });

  it("holds for an UNGOVERNED store, where every voice is lawful", async () => {
    const gw = await Gateway.open(new MemoryBackend());
    await gw.federate([
      signClaims(trustClaims("roster", [GARDENER], GARDENER, 9001), GARDENER_SEED),
      signClaims(publicClaims(["Plant"], SURVEYOR, 9003), SURVEYOR_SEED),
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
    ]);
    assertIdentical(gw.reactor, "ungoverned ground, read as the operator", OP);
    assertIdentical(gw.reactor, "ungoverned ground, read ungoverned", undefined);
    expect(
      lawfulDeltasAt(
        gw.reactor,
        gw.validityNow(),
        { entity: TRUST_ENTITY, context: CTX_TRUST },
        undefined,
      ).length,
    ).toBe(1);
    expect(
      lawfulDeltasAt(
        gw.reactor,
        gw.validityNow(),
        { entity: PUBLIC_ENTITY, context: CTX_PUBLIC },
        undefined,
      ).length,
    ).toBe(1);
    expect(
      lawfulDeltasAt(gw.reactor, gw.validityNow(), { entity: TRUST_ENTITY, context: CTX_TRUST }, OP)
        .length,
    ).toBe(0);
    await gw.close();
  });
});
