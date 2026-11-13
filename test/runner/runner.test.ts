import { describe, expect, it } from "vitest";
import type { DerivedFn, HView, Pointer } from "@bombadil/rhizomatic";
import {
  bindingDefinitionClaims,
  readBindingDefinitions,
  Runner,
} from "../../src/runner/runner.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { plant } from "../helpers/plant.js";

const RUNNER_SEED = "0d".repeat(32);
const RUNNER = authorForSeed(RUNNER_SEED);

const avgHeight: DerivedFn = (view: HView, root: string): Pointer[][] => {
  const heights = (view.props.get("height") ?? [])
    .flatMap((e) => e.delta.claims.pointers)
    .flatMap((p) =>
      p.role === "value" && p.target.kind === "primitive" && typeof p.target.value === "number"
        ? [p.target.value]
        : [],
    );
  if (heights.length === 0) return [];
  const avg = heights.reduce((a, b) => a + b, 0) / heights.length;
  return [
    [
      {
        role: "subject",
        target: { kind: "entity", entity: { id: root, context: "derived:avgHeight" } },
      },
      { role: "value", target: { kind: "primitive", value: avg } },
    ],
  ];
};

const SPEC = {
  name: "binding:avgHeight",
  fnId: "fn:avgHeight",
  materialization: "Plant",
  pure: true,
  budget: 10,
  emit: "supersede" as const,
};

async function plantStore(): Promise<{ gateway: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  await gateway.append([signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)]);
  return { gateway, backend };
}

const avgAt = (gateway: Gateway) =>
  gateway.reactor
    .materializedView(gateway.materializationFor("Plant"), FERN)
    ?.props.get("derived:avgHeight") ?? [];

describe("the runner: definitions in the store, execution in a peer client", () => {
  it("passive: a definition IS present in the store, yet without a runner computes nothing", async () => {
    const { gateway } = await plantStore();
    expect(
      readBindingDefinitions(gateway.reactor, gateway.validityNow()).map((s) => s.name),
    ).toEqual(["binding:avgHeight"]);
    await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gateway.append([observed(FERN, "height", 34, 2000, SURVEYOR_SEED)]);
    expect(avgAt(gateway)).toHaveLength(0);
    await gateway.close();
  });

  it("a governed store refuses a non-operator's definition at the door", async () => {
    const OPERATOR_SEED = "0e".repeat(32);
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    await expect(
      gateway.append([signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)]),
    ).rejects.toThrow(/not permitted/);
    await gateway.close();
  });

  it("a writer's strike cannot retire the operator's binding; the operator's own can", async () => {
    const OPERATOR_SEED = "0e".repeat(32);
    const OPERATOR = authorForSeed(OPERATOR_SEED);
    const { grantClaims } = await import("../../src/gateway/accounts.js");
    const { STORE_ENTITY } = await import("../../src/gateway/genesis.js");
    const { makeNegationClaims } = await import("@bombadil/rhizomatic");
    const ALICE_SEED = "a1".repeat(32);

    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const definition = signClaims(bindingDefinitionClaims(SPEC, OPERATOR, 1), OPERATOR_SEED);
    await gateway.append([
      definition,
      signClaims(
        grantClaims(STORE_ENTITY, authorForSeed(ALICE_SEED), "write", OPERATOR, 2),
        OPERATOR_SEED,
      ),
    ]);

    await gateway.append([
      signClaims(makeNegationClaims(authorForSeed(ALICE_SEED), 3, definition.id), ALICE_SEED),
    ]);
    expect(
      readBindingDefinitions(gateway.reactor, gateway.validityNow(), OPERATOR).map((s) => s.name),
    ).toEqual(["binding:avgHeight"]);

    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 4, definition.id), OPERATOR_SEED),
    ]);
    expect(readBindingDefinitions(gateway.reactor, gateway.validityNow(), OPERATOR)).toEqual([]);
    await gateway.close();
  });

  it("defense in depth: a definition planted around the door does not install once governed", async () => {
    const OPERATOR_SEED = "0e".repeat(32);
    const backend = new MemoryBackend();
    await plant(
      backend,
      [signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)],
      authorForSeed(OPERATOR_SEED),
    );

    const governed = await Gateway.open(backend, { seed: OPERATOR_SEED });
    governed.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const runner = Runner.attach(governed, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(runner.installed).toEqual([]);
    await governed.close();
  });

  it("animate: attach a runner and the same ingest fires the binding", async () => {
    const { gateway } = await plantStore();
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(runner.installed).toEqual(["binding:avgHeight"]);

    await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gateway.append([observed(FERN, "height", 34, 2000, SURVEYOR_SEED)]);
    const entries = avgAt(gateway);
    expect(entries).toHaveLength(1);
    const value = entries[0]!.delta.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);
    await gateway.close();
  });

  it("what a binding emits persists like any other delta: a fresh gateway replays it", async () => {
    const { gateway, backend } = await plantStore();
    Runner.attach(gateway, { seed: RUNNER_SEED, implementations: { "fn:avgHeight": avgHeight } });
    await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gateway.flush();

    const reopened = await Gateway.open(backend);
    reopened.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    const entries = reopened.reactor
      .materializedView(reopened.materializationFor("Plant"), FERN)!
      .props.get("derived:avgHeight");
    expect(entries).toHaveLength(1);
    await gateway.close();
    await reopened.close();
  });

  it("a re-blessed recipe supersedes: the latest definition per binding wins, attach installs once", async () => {
    const { gateway } = await plantStore();
    await gateway.append([
      signClaims(bindingDefinitionClaims({ ...SPEC, budget: 99 }, RUNNER, 5), RUNNER_SEED),
      signClaims(bindingDefinitionClaims({ ...SPEC, budget: 7 }, RUNNER, 3), RUNNER_SEED),
    ]);
    const specs = readBindingDefinitions(gateway.reactor, gateway.validityNow());
    expect(specs).toHaveLength(1);
    expect(specs[0]!.budget).toBe(99);
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    await gateway.close();
  });

  it("a definition naming an implementation the runner lacks is skipped, not fatal", async () => {
    const { gateway } = await plantStore();
    await gateway.append([
      signClaims(
        bindingDefinitionClaims(
          { ...SPEC, name: "binding:unknown", fnId: "fn:missing" },
          RUNNER,
          2,
        ),
        RUNNER_SEED,
      ),
    ]);
    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.skipped).toEqual(["binding:unknown"]);
    await gateway.close();
  });
});
