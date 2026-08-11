// T60 defect 2 — attach's lists are a real partition. installed + skipped read as covering every
// binding the store holds, but readBindingDefinitions dropped malformed candidates BEFORE attach
// saw them (a mistyped role, an unparseable emit), so a typo'd definition appeared in NEITHER
// list and a deploy check of "skipped is empty" passed while it sat inert (H7). A definition that
// a LATER definition of the same name replaced vanished the same way. Now every considered delta
// is installed, skipped, superseded, or NAMED in malformed — and the fixtures carry a re-blessed
// binding, because a fixture with one delta per name cannot tell a real partition from arithmetic
// that happens to agree.
// Two-sided, both levels: the drops are named with their reason AND stay in the store (dropped
// from the run, never from the ground); the well-formed bystanders still install or skip.
// GAP, named rather than implied: Runner.attach has no operator-facing caller in src/ — no CLI
// command and no server path reads these lists — so this rail asserts the library return value
// and never a door. The rail that would close it is a `loam` subcommand that prints the
// accounting; that command does not exist yet, and this file does not pretend to cover one.

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
      p.role === "budget"
        ? { role: "budget", target: { kind: "primitive" as const, value: "ten" } }
        : p,
    ),
  };
};

// Five binding deltas over four names. `binding:good` is defined TWICE — the ordinary re-blessed
// recipe — so the count below can tell a real partition from a fixture where every name happens
// to hold exactly one delta and the arithmetic agrees by accident.
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
    // The bystanders: the LATEST definition installs, an orphan waits — neither is accused. The
    // stale implementation is not installed, so the replacement really took.
    expect(runner.installed).toEqual(["binding:good"]);
    expect(runner.skipped).toEqual(["binding:orphan"]);
    // The replaced definition is named as replaced — not as damage, and not as nothing.
    expect(runner.superseded).toEqual([{ deltaId: oldGoodId, name: "binding:good" }]);
    // The damage is NAMED — delta id and a reason a human can act on.
    expect(runner.malformed).toHaveLength(2);
    const byId = new Map(runner.malformed.map((m) => [m.deltaId, m.reason]));
    expect(byId.get(typoId)).toMatch(/emit is neither "append"\/"supersede" nor JSON/);
    expect(byId.get(budgetId)).toMatch(/budget \(a number\)/);
    expect(byId.has(typoId) && byId.has(budgetId)).toBe(true);
    // Object level: the four lists together cover every binding delta the store holds. The
    // fixture defines one name twice, so this cannot pass on names-equal-deltas arithmetic.
    expect(bindingDeltas(gateway)).toHaveLength(5);
    expect(
      runner.installed.length +
        runner.skipped.length +
        runner.superseded.length +
        runner.malformed.length,
    ).toBe(bindingDeltas(gateway).length);
    await gateway.close();
  });

  // The order deltas ARRIVE in decides which of the two report sites fires: the loser can be
  // seen after the winner (report this delta) or before it (report the one it displaces). Both
  // are ordinary — a federated pull replays in no particular order — and a fixture that only
  // ever appends oldest-first leaves the other site free to be deleted with the rail still green.
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
    // A timestamp tie falls to the higher delta id — the loser is still named, never dropped.
    const tieA = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:a"), RUNNER, 7),
      RUNNER_SEED,
    );
    const tieB = signClaims(
      bindingDefinitionClaims(spec("binding:good", "fn:b"), RUNNER, 7),
      RUNNER_SEED,
    );
    // Looped for the same reason as above, and a sharper one: with a single arrival order, an
    // implementation that ignored the id tiebreak entirely would still name the second-appended
    // delta the loser, and whether that matches depends on how two content hashes happen to
    // fall. Under BOTH orders the loser is the lower id, and only a real tiebreak gives that.
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
      expect(runner.skipped).toEqual(["binding:good"]); // one law, counted once
      await gw.close();
    }
  });

  it("delta level: a malformed definition is dropped from the RUN, never from the store", async () => {
    const { gateway, typoId, budgetId } = await storeWithFive();
    // A real implementation map, so "dropped from the RUN" is an assertion rather than a
    // foregone conclusion: fn:typo and fn:overdrawn are ON HAND and still install nothing.
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:good": () => [], "fn:typo": () => [], "fn:overdrawn": () => [] },
    });
    expect(runner.installed).toEqual(["binding:good"]);
    expect(runner.installed).not.toContain("binding:typo");
    expect(runner.installed).not.toContain("binding:overdrawn");
    // Never from the ground: the deltas the run refused are still in the store, unstruck.
    const ids = new Set([...gateway.reactor.snapshot()].map((d) => d.id));
    expect(ids.has(typoId)).toBe(true);
    expect(ids.has(budgetId)).toBe(true);
    await gateway.close();
  });

  it("readBindingDefinitions reports through the sinks, and stays quiet on a clean store", async () => {
    const { gateway, oldGoodId } = await storeWithFive();
    const heard: MalformedBinding[] = [];
    const replaced: SupersededBinding[] = [];
    const specs = readBindingDefinitions(gateway.reactor, undefined, {
      onMalformed: (m) => heard.push(m),
      onSuperseded: (s) => replaced.push(s),
    });
    expect(specs.map((s) => s.name).sort()).toEqual(["binding:good", "binding:orphan"]);
    expect(heard).toHaveLength(2);
    expect(replaced).toEqual([{ deltaId: oldGoodId, name: "binding:good" }]);
    await gateway.close();

    // The other side: a store holding one well-formed definition per name accuses nothing and
    // reports no replacement. Both lists must be able to be EMPTY, or neither means anything.
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
