import { describe, expect, it } from "vitest";
import type { Claims } from "@bombadil/rhizomatic";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import {
  bindingDefinitionClaims,
  CTX_BINDING,
  readBindingDefinitions,
  Runner,
  type MalformedBinding,
  type SupersededBinding,
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

const typoEmit = (): Claims =>
  bindingDefinitionClaims(
    { ...spec("binding:typo", "fn:typo"), emit: "supercede" as unknown as "supersede" },
    RUNNER,
    2,
  );

const stringBudget = (): Claims => {
  const claims = bindingDefinitionClaims(spec("binding:overdrawn", "fn:overdrawn"), RUNNER, 3);
  return {
    ...claims,
    pointers: claims.pointers.map((p) =>
      p.role === "budget"
        ? { role: "budget", target: { kind: "primitive" as const, value: "ten" } }
        : p,
    ),
  };
};

async function storeWithFive(): Promise<{
  gateway: Gateway;
  typoId: string;
  budgetId: string;
  oldGoodId: string;
}> {
  const gateway = await Gateway.open(new MemoryBackend());
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  const oldGood = signClaims(
    bindingDefinitionClaims(spec("binding:good", "fn:stale"), RUNNER, 1),
    RUNNER_SEED,
  );
  const good = signClaims(
    bindingDefinitionClaims(spec("binding:good", "fn:good"), RUNNER, 5),
    RUNNER_SEED,
  );
  const orphan = signClaims(
    bindingDefinitionClaims(spec("binding:orphan", "fn:orphan"), RUNNER, 4),
    RUNNER_SEED,
  );
  const typo = signClaims(typoEmit(), RUNNER_SEED);
  const budget = signClaims(stringBudget(), RUNNER_SEED);
  await gateway.append([oldGood, good, orphan, typo, budget]);
  return { gateway, typoId: typo.id, budgetId: budget.id, oldGoodId: oldGood.id };
}

const bindingDeltas = (gateway: Gateway) =>
  [...gateway.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) => p.target.kind === "entity" && p.target.entity.context === CTX_BINDING,
    ),
  );

describe("attach accounts for every binding delta in the ground", () => {
  it("installed + skipped + superseded + malformed IS the partition, each drop named and reasoned", async () => {
    const { gateway, typoId, budgetId, oldGoodId } = await storeWithFive();
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [] },
    });
    expect(runner.installed).toEqual(["binding:good"]);
    expect(runner.skipped).toEqual(["binding:orphan"]);
    expect(runner.superseded).toEqual([{ deltaId: oldGoodId, name: "binding:good" }]);
    expect(runner.malformed).toHaveLength(2);
    const byId = new Map(runner.malformed.map((m) => [m.deltaId, m.reason]));
    expect(byId.get(typoId)).toMatch(/emit is neither "append"\/"supersede" nor JSON/);
    expect(byId.get(budgetId)).toMatch(/budget \(a number\)/);
    expect(byId.has(typoId) && byId.has(budgetId)).toBe(true);
    expect(bindingDeltas(gateway)).toHaveLength(5);
    expect(
      runner.installed.length +
        runner.skipped.length +
        runner.superseded.length +
        runner.malformed.length,
    ).toBe(bindingDeltas(gateway).length);
    await gateway.close();
  });

  it("either arrival order reports the replaced definition, and a timestamp tie is broken by id", async () => {
    const newer = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:good"), RUNNER, 5),
      RUNNER_SEED,
    );
    const older = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:stale"), RUNNER, 1),
      RUNNER_SEED,
    );
    for (const arrival of [
      [newer, older],
      [older, newer],
    ]) {
      const gw = await Gateway.open(new MemoryBackend());
      gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
      await gw.append(arrival);
      const runner = Runner.attach(gw, {
        seed: RUNNER_SEED,
        implementations: { "fn:good": () => [], "fn:stale": () => [] },
      });
      expect(runner.installed).toEqual(["binding:good"]);
      expect(runner.superseded).toEqual([{ deltaId: older.id, name: "binding:good" }]);
      await gw.close();
    }
    const tieA = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:a"), RUNNER, 7),
      RUNNER_SEED,
    );
    const tieB = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:b"), RUNNER, 7),
      RUNNER_SEED,
    );
    const lowerId = tieA.id < tieB.id ? tieA : tieB;
    for (const arrival of [
      [tieA, tieB],
      [tieB, tieA],
    ]) {
      const gw = await Gateway.open(new MemoryBackend());
      gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
      await gw.append(arrival);
      const runner = Runner.attach(gw, { seed: RUNNER_SEED, implementations: {} });
      expect(runner.superseded).toEqual([{ deltaId: lowerId.id, name: "binding:good" }]);
      expect(runner.skipped).toEqual(["binding:good"]);
      await gw.close();
    }
  });

  it("delta level: a malformed definition is dropped from the RUN, never from the store", async () => {
    const { gateway, typoId, budgetId } = await storeWithFive();
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [], "fn:typo": () => [], "fn:overdrawn": () => [] },
    });
    expect(runner.installed).toEqual(["binding:good"]);
    expect(runner.installed).not.toContain("binding:typo");
    expect(runner.installed).not.toContain("binding:overdrawn");
    const ids = new Set([...gateway.reactor.snapshot()].map((d) => d.id));
    expect(ids.has(typoId)).toBe(true);
    expect(ids.has(budgetId)).toBe(true);
    await gateway.close();
  });

  it("readBindingDefinitions reports through the sinks, and stays quiet on a clean store", async () => {
    const { gateway, oldGoodId } = await storeWithFive();
    const heard: MalformedBinding[] = [];
    const replaced: SupersededBinding[] = [];
    const specs = readBindingDefinitions(gateway.reactor, gateway.validityNow(), undefined, {
      onMalformed: (m) => heard.push(m),
      onSuperseded: (s) => replaced.push(s),
    });
    expect(specs.map((s) => s.name).sort()).toEqual(["binding:good", "binding:orphan"]);
    expect(heard).toHaveLength(2);
    expect(replaced).toEqual([{ deltaId: oldGoodId, name: "binding:good" }]);
    await gateway.close();

    const clean = await Gateway.open(new MemoryBackend());
    clean.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    await clean.append([
      signClaims(bindingDefinitionClaims(spec("binding:good", "fn:good"), RUNNER, 1), RUNNER_SEED),
    ]);
    const cleanRunner = Runner.attach(clean, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [] },
    });
    expect(cleanRunner.malformed).toEqual([]);
    expect(cleanRunner.superseded).toEqual([]);
    await clean.close();
  });
});
