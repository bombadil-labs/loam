// Step 7's function substrate, deployed. Function DEFINITIONS live in the store as data; a
// Runner — a peer client, not a tier — reads them, installs each into a DerivationHost over the
// gateway's reactor with an implementation it holds, and routes ingest through the host so the
// bindings fire. Passive (definitions sit inert) vs animate (a runner computes them) is one
// attach call. What a binding emits persists like any other delta.

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
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";

const RUNNER_SEED = "0d".repeat(32);
const RUNNER = authorForSeed(RUNNER_SEED);

// The implementation the runner holds for fn:avgHeight — the definition in the store names it.
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

// An ungoverned store keeps the demo about the runner, not about grants.
async function plantStore(): Promise<{ gateway: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend);
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  // The function definition, planted in the store as data.
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
    // the definition is really there — inert, not absent
    expect(readBindingDefinitions(gateway.reactor).map((s) => s.name)).toEqual([
      "binding:avgHeight",
    ]);
    await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    await gateway.append([observed(FERN, "height", 34, 2000, SURVEYOR_SEED)]);
    expect(avgAt(gateway)).toHaveLength(0); // present but unrun
    await gateway.close();
  });

  it("a governed store refuses a non-operator's definition at the door", async () => {
    const OPERATOR_SEED = "0e".repeat(32);
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    // a binding definition files on ungoverned ground: only the operator may plant one
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

    // alice (write standing, no admin) strikes the definition: her negation LANDS — and the
    // definition still installs, because a writer's strike retires nothing constitutional
    await gateway.append([
      signClaims(makeNegationClaims(authorForSeed(ALICE_SEED), 3, definition.id), ALICE_SEED),
    ]);
    expect(readBindingDefinitions(gateway.reactor, OPERATOR).map((s) => s.name)).toEqual([
      "binding:avgHeight",
    ]);

    // the operator's strike, by contrast, retires it
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 4, definition.id), OPERATOR_SEED),
    ]);
    expect(readBindingDefinitions(gateway.reactor, OPERATOR)).toEqual([]);
    await gateway.close();
  });

  it("defense in depth: a definition planted while ungoverned does not install once governed", async () => {
    const OPERATOR_SEED = "0e".repeat(32);
    const backend = new MemoryBackend();
    // planted while ungoverned — welcomed, since there was no operator to answer to
    const free = await Gateway.open(backend);
    free.register(PLANT, PLANT_POLICY, [FERN]);
    await free.append([signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)]);
    await free.flush();

    // an operator opens the same store and attaches a runner: the poison does not install
    const governed = await Gateway.open(backend, { seed: OPERATOR_SEED });
    governed.register(PLANT, PLANT_POLICY, [FERN]);
    const runner = Runner.attach(governed, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(runner.installed).toEqual([]); // the operator blessed nothing
    await free.close();
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

    // reopen WITHOUT a runner: the emission is durable ground, not recomputed
    const reopened = await Gateway.open(backend);
    reopened.register(PLANT, PLANT_POLICY, [FERN]);
    const entries = reopened.reactor
      .materializedView(reopened.materializationFor("Plant"), FERN)!
      .props.get("derived:avgHeight");
    expect(entries).toHaveLength(1);
    await gateway.close();
    await reopened.close();
  });

  it("a re-blessed recipe supersedes: the latest definition per binding wins, attach installs once", async () => {
    const { gateway } = await plantStore(); // holds SPEC (budget 10) at ts 1
    // the recipe evolves: same binding name, new budget, LATER timestamp — appended between
    // two older strays, so timestamp order and ingestion order disagree and latest-by-
    // timestamp is what's actually pinned (not last-delta-seen)
    await gateway.append([
      signClaims(bindingDefinitionClaims({ ...SPEC, budget: 99 }, RUNNER, 5), RUNNER_SEED),
      signClaims(bindingDefinitionClaims({ ...SPEC, budget: 7 }, RUNNER, 3), RUNNER_SEED),
    ]);
    const specs = readBindingDefinitions(gateway.reactor);
    expect(specs).toHaveLength(1); // one binding, not two definitions of it
    expect(specs[0]!.budget).toBe(99); // the later blessing is the law
    // and attach does not die on a duplicate install
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
    expect(runner.installed).toEqual(["binding:avgHeight"]); // the one it can run
    expect(runner.skipped).toEqual(["binding:unknown"]); // the one it cannot
    await gateway.close();
  });
});
