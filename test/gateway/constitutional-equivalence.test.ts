// T37 — the INDEXED answer is the SCANNED answer, after every mutation that can change it.
//
// This is the rail that matters. Hazard H8's second half says an index that can go stale is WORSE
// than the scan it replaced, because a safety decision reading a stale index is silently wrong —
// and constitutional reads decide what is LAWFUL. Making them fast is worth nothing if any answer
// can differ. So the property railed here is not "faster". It is IDENTICAL.
//
// HOW: every case computes the answer twice. Once through the shipped reader, which now resolves
// its declarations from the reactor's target index. Once through a hand-written REFERENCE in this
// file, which walks the whole store exactly as the readers did before T37 — `[...snapshot()]`,
// filtered on author, filtered on a pointer at the entity, run through the same negation algebra
// built the old way from a materialized id set. The reference is the ORACLE and it is written out
// longhand on purpose: an expectation derived from the subject measures nothing (H10), so the
// second computation shares no code with the first.
//
// ACROSS WHICH MUTATIONS: every one that can change a constitutional answer, applied cumulatively
// to a single live store so the sequence itself is under test —
//
//   a declaration arrives · a second supersedes it · a withdrawal (negation) · a negation of the
//   negation (revival) · a federated stranger's declaration · a stranger's strike at the
//   operator's law · unrelated ground in volume · an ERASURE, which re-seats the gateway on a
//   fresh reactor replayed from what remains, rebuilding the index with it.
//
// The erasure case is the sharpest: it is the only mutation that REMOVES ground, so it is the one
// a stale index would survive by continuing to name deltas that no longer exist.
//
// WHAT THIS FILE DOES NOT ASSERT: the COST. That is `constitutional-cost.test.ts`. Split
// deliberately — a rail that mixes "same answer" with "less work" can be satisfied by weakening
// either.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lawfulDeltasAt, lawfulNegated, lawfulSnapshot } from "../../src/gateway/registration.js";
import {
  CTX_TRUST,
  TRUST_ENTITY,
  readTrustPolicy,
  readTrustPolicyAt,
  trustClaims,
} from "../../src/gateway/trust.js";
import { containerClaims } from "../../src/gateway/container.js";
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

// ---------------------------------------------------------------------------------------------
// THE ORACLE. The pre-T37 shape, written out longhand: walk the whole store, keep the operator's
// deltas, keep the ones filed at this entity under this context. Nothing here touches the target
// index, and nothing here calls the code it is the oracle for.
// ---------------------------------------------------------------------------------------------

function scannedNegated(reactor: Reactor, operator?: string): (id: string) => boolean {
  const lawfulIds = new Set([...lawfulSnapshot(reactor, operator)].map((d) => d.id));
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
  for (const delta of lawfulSnapshot(reactor, operator)) {
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

// The four readers, re-derived from the oracle. Each is the reader's own parsing over the SCANNED
// candidate list — so a divergence can only come from which deltas were found, which is the thing
// under test.

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

// The union readers share one shape: every `role` primitive across every surviving declaration.
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

// ---------------------------------------------------------------------------------------------
// The comparison, run after every mutation. Both levels: the DELTA level (which deltas did each
// route find?) and the OBJECT level (what does each reader answer?). H1's lesson is that the two
// can disagree, and the disagreement is the bug — so neither alone is enough.
// ---------------------------------------------------------------------------------------------

const ids = (ds: readonly Delta[]): string[] => ds.map((d) => d.id).sort();

function assertIdentical(reactor: Reactor, where: string, operator?: string): void {
  // delta level — the candidate sets, for every constitutional entity
  for (const [entity, context] of [
    [TRUST_ENTITY, CTX_TRUST],
    [BUDGET_ENTITY, CTX_BUDGET],
    [PUBLIC_ENTITY, CTX_PUBLIC],
    [ARTIFACT_ENTITY, CTX_ARTIFACT],
  ] as const) {
    expect(
      ids(lawfulDeltasAt(reactor, { entity, context }, operator)),
      `${where}: the indexed candidate set at ${entity} differs from the scanned one`,
    ).toEqual(ids(scannedDeltasAt(reactor, entity, context, operator)));
  }

  // delta level — the negation algebra, asked of EVERY delta the store holds, not a chosen few
  const shipped = lawfulNegated(reactor, operator);
  const oracle = scannedNegated(reactor, operator);
  for (const d of reactor.snapshot()) {
    expect(shipped(d.id), `${where}: lawfulNegated disagrees with the scan on ${d.id}`).toBe(
      oracle(d.id),
    );
  }

  // object level — what each reader ANSWERS
  const trust = readTrustPolicy(reactor, operator);
  const trustOracle = scannedTrustPolicy(reactor, TRUST_ENTITY, operator);
  expect({ mode: trust.mode, roster: [...trust.roster].sort() }, `${where}: trust policy`).toEqual(
    trustOracle,
  );

  const budgets = [...readBudgetPolicy(reactor, operator)]
    .map(([k, v]): [string, number | undefined] => [k, v.maxAppends])
    .sort((a, b) => a[0].localeCompare(b[0]));
  expect(budgets, `${where}: budget policy`).toEqual(scannedBudgets(reactor, operator));

  expect([...readPublicSchemas(reactor, operator)].sort(), `${where}: public schemas`).toEqual(
    scannedUnion(reactor, PUBLIC_ENTITY, CTX_PUBLIC, "schema", operator),
  );
  expect([...readArtifactRoutes(reactor, operator)].sort(), `${where}: artifact routes`).toEqual(
    scannedUnion(reactor, ARTIFACT_ENTITY, CTX_ARTIFACT, "route", operator),
  );
}

const sign = (c: Parameters<typeof signClaims>[0], seed = OP_SEED): Delta => signClaims(c, seed);

// A container entity, which carries TWO kinds of law at one id: its own declaration under
// `loam.container`, and its admission axis under `loam.trust` (§28.6).
const CAGE = "container:equivalence";
const trustAt = (subject: string, mode: string, authors: readonly string[], ts: number) => ({
  timestamp: ts,
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
    // Both strangers hold write standing, so their deltas reach the ground and the rail can prove
    // a STRANGER'S LAW BINDS NOTHING — the interesting case, not a delta that never arrived.
    await gw.append([
      sign(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 1)),
      sign(grantClaims(STORE_ENTITY, SURVEYOR, "write", OP, 2)),
    ]);
    assertIdentical(gw.reactor, "an empty constitution", OP);

    // 1. the declarations arrive
    const trust1 = sign(trustClaims("roster", [GARDENER], OP, 9001));
    const budget1 = sign(budgetClaims(GARDENER, 500, OP, 9002));
    const public1 = sign(publicClaims(["Plant"], OP, 9003));
    const artifact1 = sign(artifactClaims(["board"], OP, 9004));
    await gw.append([trust1, budget1, public1, artifact1]);
    assertIdentical(gw.reactor, "the law arrives", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("roster"); // a floor: it really is in force

    // 2. a second declaration supersedes the first
    const trust2 = sign(trustClaims("closed", [SURVEYOR], OP, 9100));
    const budget2 = sign(budgetClaims(GARDENER, 50, OP, 9101));
    await gw.append([trust2, budget2]);
    assertIdentical(gw.reactor, "a later declaration supersedes", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("closed");

    // 3. a withdrawal — the operator strikes the live declaration
    const strike = sign(makeNegationClaims(OP, 9200, trust2.id));
    await gw.append([strike]);
    assertIdentical(gw.reactor, "the live declaration is withdrawn", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("roster"); // the earlier one governs again

    // 4. a negation of the negation — a struck strike revives its target
    const counter = sign(makeNegationClaims(OP, 9300, strike.id));
    await gw.append([counter]);
    assertIdentical(gw.reactor, "the withdrawal is itself struck", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("closed");

    // 5+6. A FEDERATED ARRIVAL. Reopen the door first: the store is `closed` at this point, and a
    //      closed store admits nothing — so federating here would land zero deltas and the two
    //      stranger cases below would be vacuous. Every arrival asserts it was ACCEPTED, which is
    //      the floor that makes them real.
    await gw.append([sign(trustClaims("open", [], OP, 9350))]);

    // 5. a federated stranger declares law of their own — lawful to HOLD, binding on nobody
    const foreign = signClaims(trustClaims("closed", [SURVEYOR], GARDENER, 9400), GARDENER_SEED);
    expect((await gw.federate([foreign])).accepted).toBe(1);
    assertIdentical(gw.reactor, "a stranger's declaration arrives", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("open"); // a stranger cannot close the door

    // 6. a stranger strikes the operator's LIVE law — retires nothing
    const live = sign(trustClaims("roster", [GARDENER], OP, 9450));
    await gw.append([live]);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("roster");
    const foreignStrike = signClaims(makeNegationClaims(GARDENER, 9500, live.id), GARDENER_SEED);
    expect((await gw.federate([foreignStrike])).accepted).toBe(1);
    assertIdentical(gw.reactor, "a stranger strikes the operator's law", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).toBe("roster"); // unmoved

    // 6b. ONE ENTITY, TWO CONTEXTS. A container entity is targeted under `loam.container` by its
    //     declaration and under `loam.trust` by its admission axis (§28.6) — the same id in the
    //     target index, filed under different law. A route that found deltas by entity alone would
    //     hand a container declaration to the trust reader as if it were a trust declaration.
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
    // A container declaration carries no `mode` and no `admit-author`, so the trust reader would
    // SKIP it even if a context-blind route handed it over — which would leave the object-level
    // assertions below unable to see the bug at all. So file a DECOY at the same id under a
    // non-trust context that does carry both: later than the real declaration, and naming a mode
    // and a roster member the real one does not. If the context filter is dropped, the decoy wins
    // on timestamp and the answers below change.
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
        ids(lawfulDeltasAt(gw.reactor, { entity: at, context: CTX_TRUST }, OP)),
        `one entity, two contexts: the indexed candidates at ${at} differ from the scanned ones`,
      ).toEqual(ids(scannedDeltasAt(gw.reactor, at, CTX_TRUST, OP)));
      const shipped = readTrustPolicyAt(gw.reactor, at, OP);
      expect({ mode: shipped.mode, roster: [...shipped.roster].sort() }).toEqual(
        scannedTrustPolicy(gw.reactor, at, OP),
      );
    }
    // The container's own declaration is at the same id and MUST NOT be read as trust law.
    expect(readTrustPolicyAt(gw.reactor, CAGE, OP).mode).toBe("roster");
    expect([...readTrustPolicyAt(gw.reactor, CAGE, OP).roster]).toEqual([SURVEYOR]);
    expect(gw.reactor.byTarget(CAGE).length).toBeGreaterThan(
      lawfulDeltasAt(gw.reactor, { entity: CAGE, context: CTX_TRUST }, OP).length,
    ); // the index really does hold more at this id than the trust reader may see
    assertIdentical(gw.reactor, "one entity carries two kinds of law", OP);

    // 7. unrelated ground, in volume — the case the index exists for
    await gw.append(
      Array.from({ length: 50 }, (_, i) => observed(FERN, "readings", i, 20000 + i, OP_SEED)),
    );
    assertIdentical(gw.reactor, "fifty deltas of unrelated ground", OP);

    // 8. AN ERASURE — the only mutation that removes ground. The gateway re-seats on a fresh
    //    reactor replayed from what remains, so the target index is rebuilt with it. A stale index
    //    would survive this by continuing to name a delta that no longer exists.
    await gw.erase(budget1.id, { reason: "a superseded quota, unsaid" });
    expect(gw.reactor.get(budget1.id)).toBeUndefined();
    assertIdentical(gw.reactor, "after a constitutional delta is erased", OP);

    // …and erasing the delta the LIVE answer depends on, which must CHANGE the answer. An index
    // that kept naming an erased delta would keep answering with law the store no longer holds.
    const before = readTrustPolicy(gw.reactor, OP).mode;
    await gw.erase(live.id, { reason: "the governing declaration, unsaid" });
    assertIdentical(gw.reactor, "after the governing declaration is erased", OP);
    expect(readTrustPolicy(gw.reactor, OP).mode).not.toBe(before); // the hole is visible

    await gw.close();
  });

  it("a strike the store no longer HOLDS retires nothing — the purge hole, pinned directly", () => {
    // Reached with a stub ground, exactly as `closure-cost.test.ts` reaches the same branch: the
    // reactor's negation index can name a strike whose bytes are gone (§11), and no gateway-level
    // fixture can hold that state open, since an erase replays the reactor from what remains. The
    // old shape answered this with `lawfulIds.has(id)` over a materialized set — false for a delta
    // the store does not hold. The indexed shape must answer the same, from the id alone.
    const trust = sign(trustClaims("closed", [], OP, 1000));
    const purged = sign(makeNegationClaims(OP, 1100, trust.id));
    const stub = {
      negationsOf: (id: string) => (id === trust.id ? [purged.id] : []),
      get: (id: string) => (id === trust.id ? trust : undefined), // `purged` is GONE
      snapshot: () => new Set([trust]),
      byTarget: () => [trust.id],
    } as unknown as Reactor;

    expect(lawfulNegated(stub, OP)(trust.id)).toBe(false); // gone is gone; it does not invent it
    expect(readTrustPolicy(stub, OP).mode).toBe("closed"); // so the declaration still governs
  });

  it("a ground that disagrees with its own index REFUSES — it does not read law from the gap", () => {
    // The mirror of the case above, failing in the other direction. `lawfulNegated`'s unresolvable
    // id makes a strike not count, which lets its target SURVIVE — conservative. An unresolvable id
    // in `lawfulDeltasAt` would drop a DECLARATION, and an empty trust list reads as `open`
    // (trust.ts) — so a skip there would swing the federation door open on an answer nobody
    // determined. That is H9, and the remedy is to refuse rather than to guess.
    //
    // Unreachable against today's substrate, so it is pinned with a stub, as the purge hole is.
    const trust = sign(trustClaims("closed", [], OP, 1000));
    const stub = {
      negationsOf: () => [],
      get: () => undefined, // the set cannot resolve what the index names
      snapshot: () => new Set([trust]),
      byTarget: () => [trust.id],
    } as unknown as Reactor;

    expect(() => lawfulDeltasAt(stub, { entity: TRUST_ENTITY, context: CTX_TRUST }, OP)).toThrow(
      /cannot resolve it/,
    );
    // And the refusal reaches the reader — the door does not quietly open.
    expect(() => readTrustPolicy(stub, OP)).toThrow(/cannot resolve it/);
  });

  it("holds for an UNGOVERNED store, where every voice is lawful", async () => {
    // No operator: `lawfulSnapshot` is the whole store, so the author filter must be absent on
    // BOTH routes. An index consulted with a filter the scan does not apply diverges here.
    //
    // WHAT THIS CASE ASSERTS AND WHAT IT DOES NOT. The DELTA level is live: `lawfulDeltasAt` and
    // `lawfulNegated` both run their undefined-operator branch and are compared against the scan.
    // The OBJECT level is NOT — all four readers short-circuit on `operator === undefined` before
    // touching a delta, and every oracle short-circuits identically, so those four comparisons are
    // constant-against-constant. That is a property of the readers, not a gap this rail could
    // close: an ungoverned store has no lawful voice, so there is no object-level answer to
    // compare. The rail that WOULD close it does not exist because the behaviour does not.
    const gw = await Gateway.open(new MemoryBackend());
    await gw.federate([
      signClaims(trustClaims("roster", [GARDENER], GARDENER, 9001), GARDENER_SEED),
      signClaims(publicClaims(["Plant"], SURVEYOR, 9003), SURVEYOR_SEED),
      observed(FERN, "height", 30, 1000, GARDENER_SEED),
    ]);
    // Governed reads over the same ground: the operator's slice is EMPTY, and both routes agree
    // on that too.
    assertIdentical(gw.reactor, "ungoverned ground, read as the operator", OP);
    assertIdentical(gw.reactor, "ungoverned ground, read ungoverned", undefined);
    // Floors: the ungoverned store really is holding the strangers' declarations, at two entities
    // and from two different authors — so the delta-level halves above ran over a non-empty set.
    expect(
      lawfulDeltasAt(gw.reactor, { entity: TRUST_ENTITY, context: CTX_TRUST }, undefined).length,
    ).toBe(1);
    expect(
      lawfulDeltasAt(gw.reactor, { entity: PUBLIC_ENTITY, context: CTX_PUBLIC }, undefined).length,
    ).toBe(1);
    expect(
      lawfulDeltasAt(gw.reactor, { entity: TRUST_ENTITY, context: CTX_TRUST }, OP).length,
    ).toBe(0); // and none is the operator's
    await gw.close();
  });
});
