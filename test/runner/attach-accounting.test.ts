// T60 defect 2 — attach's lists are a real partition. installed + skipped read as covering every
// binding the store holds, but readBindingDefinitions dropped malformed candidates BEFORE attach
// saw them (a mistyped role, an unparseable emit), so a typo'd definition appeared in NEITHER
// list and a deploy check of "skipped is empty" passed while it sat inert (H7). Now the drops are
// a third list: every surviving binding delta is installed, skipped, or NAMED in malformed.
// Two-sided, both levels: the malformed deltas are named with their reason AND stay in the store
// (dropped from the run, never from the ground); the well-formed bystanders still install or skip.

import { describe, expect, it } from "vitest";
import type { Claims } from "@bombadil/rhizomatic";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import {
  bindingDefinitionClaims,
  CTX_BINDING,
  readBindingDefinitions,
  Runner,
  type MalformedBinding,
} from "../../src/runner/runner.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const RUNNER_SEED = "0d".repeat(32);
const RUNNER = authorForSeed(RUNNER_SEED);

const spec = (name: string, fnId: string) => ({
  name,
  fnId,
  materialization: "Plant",
  pure: true,
  budget: 10,
  emit: "supersede" as const,
});

// A definition whose emit is the classic hand-planted typo: a string that is neither
// "append"/"supersede" nor JSON. bindingDefinitionClaims carries it through verbatim.
const typoEmit = (): Claims =>
  bindingDefinitionClaims(
    { ...spec("binding:typo", "fn:typo"), emit: "supercede" as unknown as "supersede" },
    RUNNER,
    2,
  );

// A definition whose budget role carries a string — the type-gate drop.
const stringBudget = (): Claims => {
  const claims = bindingDefinitionClaims(spec("binding:overdrawn", "fn:overdrawn"), RUNNER, 3);
  return {
    ...claims,
    pointers: claims.pointers.map((p) =>
      p.role === "budget" ? { role: "budget", target: { kind: "primitive" as const, value: "ten" } } : p,
    ),
  };
};

async function storeWithFour(): Promise<{
  gateway: Gateway;
  typoId: string;
  budgetId: string;
}> {
  const gateway = await Gateway.open(new MemoryBackend());
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const good = signClaims(bindingDefinitionClaims(spec("binding:good", "fn:good"), RUNNER, 1), RUNNER_SEED);
  const orphan = signClaims(
    bindingDefinitionClaims(spec("binding:orphan", "fn:orphan"), RUNNER, 4),
    RUNNER_SEED,
  );
  const typo = signClaims(typoEmit(), RUNNER_SEED);
  const budget = signClaims(stringBudget(), RUNNER_SEED);
  await gateway.append([good, orphan, typo, budget]);
  return { gateway, typoId: typo.id, budgetId: budget.id };
}

const bindingDeltas = (gateway: Gateway) =>
  [...gateway.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_BINDING,
    ),
  );

describe("attach accounts for every binding delta in the ground", () => {
  it("installed + skipped + malformed IS the partition, with each malformed delta named and reasoned", async () => {
    const { gateway, typoId, budgetId } = await storeWithFour();
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [] },
    });
    // The bystanders: a runnable definition installs, an orphan waits — neither is accused.
    expect(runner.installed).toEqual(["binding:good"]);
    expect(runner.skipped).toEqual(["binding:orphan"]);
    // The drops are NAMED — delta id and a reason a human can act on.
    expect(runner.malformed).toHaveLength(2);
    const byId = new Map(runner.malformed.map((m) => [m.deltaId, m.reason]));
    expect(byId.get(typoId)).toMatch(/emit is neither "append"\/"supersede" nor JSON/);
    expect(byId.get(budgetId)).toMatch(/budget \(a number\)/);
    expect(byId.has(typoId) && byId.has(budgetId)).toBe(true);
    // Object level: the three lists together cover every binding delta the store holds.
    expect(runner.installed.length + runner.skipped.length + runner.malformed.length).toBe(
      bindingDeltas(gateway).length,
    );
    await gateway.close();
  });

  it("delta level: a malformed definition is dropped from the RUN, never from the store", async () => {
    const { gateway, typoId, budgetId } = await storeWithFour();
    Runner.attach(gateway, { seed: RUNNER_SEED, implementations: {} });
    const ids = new Set([...gateway.reactor.snapshot()].map((d) => d.id));
    expect(ids.has(typoId)).toBe(true);
    expect(ids.has(budgetId)).toBe(true);
    await gateway.close();
  });

  it("readBindingDefinitions reports through the sink, and stays quiet on a clean store", async () => {
    const { gateway } = await storeWithFour();
    const heard: MalformedBinding[] = [];
    const specs = readBindingDefinitions(gateway.reactor, undefined, (m) => heard.push(m));
    expect(specs.map((s) => s.name).sort()).toEqual(["binding:good", "binding:orphan"]);
    expect(heard).toHaveLength(2);
    await gateway.close();

    // The other side: a store holding only well-formed definitions accuses nothing.
    const clean = await Gateway.open(new MemoryBackend());
    clean.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    await clean.append([
      signClaims(bindingDefinitionClaims(spec("binding:good", "fn:good"), RUNNER, 1), RUNNER_SEED),
    ]);
    const silent: MalformedBinding[] = [];
    const cleanRunner = Runner.attach(clean, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [] },
    });
    expect(cleanRunner.malformed).toEqual(silent);
    await clean.close();
  });
});
