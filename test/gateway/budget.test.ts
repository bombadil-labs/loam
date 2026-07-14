// Door resource budgets (SPEC §25). §12 caps the STRANGER at the public door as a safety law; a
// GRANTED author is trusted, so metering their append VOLUME is deployment config, not a
// constitutional invariant — and being Loam, config is data. An operator-signed declaration at
// `loam:budget` names an author and the maximum count of deltas they may hold; the
// append door consults it, re-resolved live, so raising a quota is a delta not a restart. Absent
// a declaration a granted author stays UNMETERED (today's behavior — this slice is additive).
// Only the operator's voice budgets in a governed store; an ungoverned store meters no one; and
// none of this touches §12's stranger caps, which remain law.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Claims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import {
  BUDGET_ENTITY,
  CTX_BUDGET,
  budgetClaims,
  budgetDefect,
  readBudgetPolicy,
} from "../../src/gateway/budget.js";
import { publicClaims } from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import {
  FERN,
  GARDENER,
  GARDENER_SEED,
  SURVEYOR,
  SURVEYOR_SEED,
  observed,
} from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);

// A fresh governed store where the gardener and surveyor hold write standing but hold zero
// deltas of their own yet — so a budget's arithmetic is exact and legible.
async function governed(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9001), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9002), OPERATOR_SEED),
  ]);
  return gateway;
}

const setBudget = (gateway: Gateway, subject: string, max: number, ts = Date.now()) => {
  const delta = signClaims(budgetClaims(subject, max, OPERATOR, ts), OPERATOR_SEED);
  return gateway.append([delta]).then(() => delta);
};

// A budget declaration with ARBITRARY limit dimensions — the shape a newer store would author, so
// forward-compatibility can be exercised (an unknown dimension is tolerated here, never rejected).
const budgetWith = (
  subject: string,
  limits: readonly { readonly role: string; readonly value: number }[],
  ts: number,
): Claims => ({
  timestamp: ts,
  author: OPERATOR,
  pointers: [
    {
      role: "declares",
      target: { kind: "entity", entity: { id: BUDGET_ENTITY, context: CTX_BUDGET } },
    },
    { role: "subject", target: { kind: "primitive", value: subject } },
    ...limits.map((l) => ({
      role: l.role,
      target: { kind: "primitive" as const, value: l.value },
    })),
  ],
});

// A distinct gardener-authored delta each call — distinct timestamps give distinct ids, so each
// is a genuine unit of volume.
const grow = (gateway: Gateway, ts: number, seed = GARDENER_SEED) =>
  gateway.append([observed(FERN, "height", ts, ts, seed)]);

describe("per-author door budgets (SPEC §25)", () => {
  it("a granted author with no budget policy appends freely — unchanged", async () => {
    const gateway = await governed();
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).size).toBe(0);
    for (let i = 0; i < 5; i += 1) {
      await expect(grow(gateway, 1000 + i)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("an operator-signed budget meters that author at the append door", async () => {
    const gateway = await governed();
    await setBudget(gateway, GARDENER, 2, 5000);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).get(GARDENER)?.maxAppends).toBe(2);

    await expect(grow(gateway, 1001)).resolves.toMatchObject({ accepted: 1 }); // held 0 → 1
    await expect(grow(gateway, 1002)).resolves.toMatchObject({ accepted: 1 }); // held 1 → 2
    await expect(grow(gateway, 1003)).rejects.toThrow(/over budget/); // held 2, no room

    // The refusal moved nothing: the gardener still holds exactly the two the quota allows.
    let held = 0;
    for (const d of gateway.reactor.snapshot()) if (d.claims.author === GARDENER) held += 1;
    expect(held).toBe(2);
    await gateway.close();
  });

  it("the budget meters only its subject — another granted author is untouched", async () => {
    const gateway = await governed();
    await setBudget(gateway, GARDENER, 1, 5000);
    await expect(grow(gateway, 1001)).resolves.toMatchObject({ accepted: 1 });
    await expect(grow(gateway, 1002)).rejects.toThrow(/over budget/);
    // The surveyor, unbudgeted, appends without limit.
    for (let i = 0; i < 4; i += 1) {
      await expect(grow(gateway, 2000 + i, SURVEYOR_SEED)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("the policy re-resolves live: raising the quota lifts the door with no restart", async () => {
    const gateway = await governed();
    await setBudget(gateway, GARDENER, 2, 5000);
    await grow(gateway, 1001);
    await grow(gateway, 1002);
    await expect(grow(gateway, 1003)).rejects.toThrow(/over budget/); // metered out at 2

    // A fresh declaration raises the ceiling — a delta, not a reboot — and the same live
    // gateway lets the next append through.
    await setBudget(gateway, GARDENER, 3, 5001);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).get(GARDENER)?.maxAppends).toBe(3);
    await expect(grow(gateway, 1004)).resolves.toMatchObject({ accepted: 1 }); // held 2 → 3
    await expect(grow(gateway, 1005)).rejects.toThrow(/over budget/); // and metered again at 3
    await gateway.close();
  });

  it("volume is the grow-only FOOTPRINT: monotonic, lowered only by an operator erasure", async () => {
    const gateway = await governed();
    await setBudget(gateway, GARDENER, 3, 5000);
    const first = observed(FERN, "height", 1, 1001, GARDENER_SEED);
    await gateway.append([first]);
    await grow(gateway, 1002); // held 2

    // Grow-only honesty: a negation is ITSELF a delta. The gardener negating their own claim
    // spends the third slot rather than reclaiming one — footprint stays monotonic.
    await gateway.append([signClaims(makeNegationClaims(GARDENER, 1003, first.id), GARDENER_SEED)]);
    await expect(grow(gateway, 1004)).rejects.toThrow(/over budget/); // held 3 (incl. the negation)

    // The one thing that lowers the footprint is an operator ERASURE (§11) — it removes a delta
    // from the ground and the reactor is rebuilt, so the gardener's held count falls and the
    // door reopens on the next request, live.
    await gateway.erase(first.id);
    await expect(grow(gateway, 1005)).resolves.toMatchObject({ accepted: 1 });
    await gateway.close();
  });

  it("revocation is one negation: strike the budget and the author is unmetered again", async () => {
    const gateway = await governed();
    const budget = await setBudget(gateway, GARDENER, 1, 5000);
    await grow(gateway, 1001);
    await expect(grow(gateway, 1002)).rejects.toThrow(/over budget/);

    // The operator strikes the budget declaration; the ceiling lifts entirely, live.
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 5001, budget.id), OPERATOR_SEED),
    ]);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).size).toBe(0);
    for (let i = 0; i < 4; i += 1) {
      await expect(grow(gateway, 2000 + i)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("a non-operator's budget declaration binds nothing in a governed store", async () => {
    const gateway = await governed();
    // The surveyor holds write standing, so the declaration LANDS as data — but only the
    // operator's voice budgets, so it meters no one.
    await gateway.append([signClaims(budgetClaims(GARDENER, 1, SURVEYOR, 5000), SURVEYOR_SEED)]);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).size).toBe(0);
    for (let i = 0; i < 4; i += 1) {
      await expect(grow(gateway, 1000 + i)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("an ungoverned store meters no one — no lawful voice to set a budget with", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    await gateway.append([signClaims(budgetClaims(GARDENER, 1, OPERATOR, 5000), OPERATOR_SEED)]);
    expect(readBudgetPolicy(gateway.reactor, undefined).size).toBe(0);
    for (let i = 0; i < 4; i += 1) {
      await expect(grow(gateway, 1000 + i)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("a malformed budget declaration is refused at the door, for everyone", async () => {
    const gateway = await governed();
    const declares = {
      role: "declares",
      target: { kind: "entity" as const, entity: { id: BUDGET_ENTITY, context: CTX_BUDGET } },
    };
    const noCeiling: Claims = {
      timestamp: 5000,
      author: OPERATOR,
      pointers: [declares, { role: "subject", target: { kind: "primitive", value: GARDENER } }],
    };
    await expect(gateway.append([signClaims(noCeiling, OPERATOR_SEED)])).rejects.toThrow(
      /malformed law/,
    );
    const negativeCeiling: Claims = {
      timestamp: 5001,
      author: OPERATOR,
      pointers: [
        declares,
        { role: "subject", target: { kind: "primitive", value: GARDENER } },
        { role: "maxAppends", target: { kind: "primitive", value: -1 } },
      ],
    };
    await expect(gateway.append([signClaims(negativeCeiling, OPERATOR_SEED)])).rejects.toThrow(
      /malformed law/,
    );
    const noSubject: Claims = {
      timestamp: 5002,
      author: OPERATOR,
      pointers: [declares, { role: "maxAppends", target: { kind: "primitive", value: 3 } }],
    };
    await expect(gateway.append([signClaims(noSubject, OPERATOR_SEED)])).rejects.toThrow(
      /malformed law/,
    );
    await gateway.close();
  });

  it("budgetDefect leaves non-declarations alone", () => {
    expect(budgetDefect(observed(FERN, "height", 1, 1, GARDENER_SEED).claims)).toBeUndefined();
    expect(budgetDefect(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 1))).toBeUndefined();
    expect(budgetDefect(budgetClaims(GARDENER, 5, OPERATOR, 1))).toBeUndefined();
  });

  it("tolerates a dimension it does not recognize, still enforcing the one it does (forward-compat)", async () => {
    const gateway = await governed();
    // A newer store's declaration: a volume cap AND a `maxRate` cap this store cannot enforce yet.
    // The door must ACCEPT the unknown dimension (never reject a newer store's limit) and go on
    // enforcing maxAppends — this is what lets the budget vocabulary grow without a migration.
    await gateway.append([
      signClaims(
        budgetWith(
          GARDENER,
          [
            { role: "maxAppends", value: 1 },
            { role: "maxRate", value: 99 },
          ],
          5000,
        ),
        OPERATOR_SEED,
      ),
    ]);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).get(GARDENER)?.maxAppends).toBe(1);
    await expect(grow(gateway, 1001)).resolves.toMatchObject({ accepted: 1 }); // maxAppends honored
    await expect(grow(gateway, 1002)).rejects.toThrow(/over budget/); // the unknown dimension ignored
    await gateway.close();
  });

  it("a declaration bearing ONLY an unrecognized dimension leaves the author unmetered here", async () => {
    const gateway = await governed();
    // A future rate-only budget: accepted (never rejected), but a store that cannot enforce rate
    // meters nothing by it — the honest forward-compatible reading, not a silent full stop.
    await gateway.append([
      signClaims(budgetWith(GARDENER, [{ role: "maxRate", value: 1 }], 5000), OPERATOR_SEED),
    ]);
    expect(readBudgetPolicy(gateway.reactor, OPERATOR).has(GARDENER)).toBe(false);
    for (let i = 0; i < 4; i += 1) {
      await expect(grow(gateway, 2000 + i)).resolves.toMatchObject({ accepted: 1 });
    }
    await gateway.close();
  });

  it("§12's stranger caps are untouched by an author budget", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), {
      seed: OPERATOR_SEED,
      maxPublicWatches: 1,
    });
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9001), OPERATOR_SEED),
    ]);
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    // The trusted CEILING — a per-author budget — is set on the gardener...
    await setBudget(gateway, GARDENER, 1, 5000);
    await gateway.append([signClaims(publicClaims(["Plant"], OPERATOR, 10_000), OPERATOR_SEED)]);

    // ...and the stranger FLOOR still meters anonymous watches on its own §12 budget, wholly
    // independent: the first public watch takes the one slot, the second is refused there.
    const first = await gateway.subscribePublic(
      `subscription { plant(entity: "plant:a") { _hex } }`,
    );
    expect((await first.next()).done).toBe(false);
    await expect(
      gateway.subscribePublic(`subscription { plant(entity: "plant:b") { _hex } }`),
    ).rejects.toThrow(/public door/);
    await first.return(undefined);
    await gateway.close();
  });
});
