import { describe, expect, it } from "vitest";
import type { Claims, DerivedFn, HView, Pointer, Schema } from "@bombadil/rhizomatic";
import { authorForSeed, parseSchema, signClaims } from "@bombadil/rhizomatic";
import { bindingDefinitionClaims, CTX_BINDING, Runner } from "../../src/runner/runner.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const RUNNER_SEED = "0d".repeat(32);
const RUNNER = authorForSeed(RUNNER_SEED);
const DERIVED = "derived:avgHeight";

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
      { role: "subject", target: { kind: "entity", entity: { id: root, context: DERIVED } } },
      { role: "value", target: { kind: "primitive", value: avg } },
    ],
  ];
};

const CLASSIC: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const SPEC = {
  name: "binding:avgHeight",
  fnId: "fn:avgHeight",
  materialization: "Plant",
  pure: true,
  budget: 10,
  emit: "supersede" as const,
};

const withEmit = (name: string, emit: string, ts: number): Claims =>
  bindingDefinitionClaims({ ...SPEC, name, emit: emit as unknown as "append" }, RUNNER, ts);

async function plantStore(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend());
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

const attach = (gateway: Gateway) =>
  Runner.attach(gateway, { seed: RUNNER_SEED, implementations: { "fn:avgHeight": avgHeight } });

const emissions = (gateway: Gateway) =>
  gateway.reactor.materializedView(gateway.materializationFor("Plant"), FERN)?.props.get(DERIVED) ??
  [];

async function measureTwice(gateway: Gateway): Promise<void> {
  await gateway.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
  await gateway.append([observed(FERN, "height", 34, 2000, SURVEYOR_SEED)]);
}

describe("T157/1 — a definition naming a materialization nothing provides refuses at install", () => {
  it("names the name and the cure, computes nothing, and leaves the good sibling running", async () => {
    const gateway = await plantStore();
    const lost = signClaims(
      bindingDefinitionClaims(
        { ...SPEC, name: "binding:lost", materialization: "Compost" },
        RUNNER,
        1,
      ),
      RUNNER_SEED,
    );
    const good = signClaims(bindingDefinitionClaims(SPEC, RUNNER, 2), RUNNER_SEED);
    await gateway.append([lost, good]);

    const runner = attach(gateway);
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.skipped).toEqual([]);
    expect(runner.unbound).toHaveLength(1);
    const [refused] = runner.unbound;
    expect(refused!.name).toBe("binding:lost");
    expect(refused!.materialization).toBe("Compost");
    expect(refused!.reason).toContain('"Compost"');
    expect(refused!.reason).toContain("Plant");
    expect(refused!.reason).toMatch(/compute nothing/);
    expect(refused!.reason).toMatch(/nothing this runner can see provides/);
    expect(refused!.reason).toMatch(/RunnerOptions\.materializations/);

    await measureTwice(gateway);
    const entries = emissions(gateway);
    expect(entries).toHaveLength(1);
    const value = entries[0]!.delta.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);

    expect([...gateway.reactor.snapshot()].map((d) => d.id)).toContain(lost.id);
    await gateway.close();
  });

  it("with nothing registered the refusal names no alternative it cannot offer", async () => {
    const bare = await Gateway.open(new MemoryBackend());
    await bare.append([signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)]);
    const runner = attach(bare);
    expect(runner.installed).toEqual([]);
    expect(runner.unbound.map((u) => u.name)).toEqual(["binding:avgHeight"]);
    expect(runner.unbound[0]!.reason).toMatch(/This runner can see none/);
    await bare.close();
  });

  it("the PROGRAM name binds as well as the LENS name — the check is the resolution's own lookup", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    gateway.register(PLANT, CLASSIC, [FERN], undefined, PLANT_WRITABLE);
    expect(gateway.materializationNames()).toEqual(["Plant", "PlantClassic"]);
    expect(gateway.materializationFor("Plant")).toBe(gateway.materializationFor("PlantClassic"));

    await gateway.append([
      signClaims(
        bindingDefinitionClaims(
          { ...SPEC, name: "binding:byLens", materialization: "PlantClassic" },
          RUNNER,
          1,
        ),
        RUNNER_SEED,
      ),
      signClaims(
        bindingDefinitionClaims(
          { ...SPEC, name: "binding:byProgram", materialization: "Plant" },
          RUNNER,
          2,
        ),
        RUNNER_SEED,
      ),
    ]);
    const runner = attach(gateway);
    expect(runner.installed.sort()).toEqual(["binding:byLens", "binding:byProgram"]);
    expect(runner.unbound).toEqual([]);
    await gateway.close();
  });

  it("the FIVE lists are a partition: every considered binding delta lands in exactly one", async () => {
    const gateway = await plantStore();
    const oldGood = signClaims(
      bindingDefinitionClaims({ ...SPEC, fnId: "fn:stale" }, RUNNER, 1),
      RUNNER_SEED,
    );
    const good = signClaims(bindingDefinitionClaims(SPEC, RUNNER, 9), RUNNER_SEED);
    const orphan = signClaims(
      bindingDefinitionClaims({ ...SPEC, name: "binding:orphan", fnId: "fn:nobody" }, RUNNER, 2),
      RUNNER_SEED,
    );
    const lost = signClaims(
      bindingDefinitionClaims(
        { ...SPEC, name: "binding:lost", materialization: "Compost" },
        RUNNER,
        3,
      ),
      RUNNER_SEED,
    );
    const broken = signClaims(withEmit("binding:broken", "{}", 4), RUNNER_SEED);
    await gateway.append([oldGood, good, orphan, lost, broken]);

    const runner = attach(gateway);
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.skipped).toEqual(["binding:orphan"]);
    expect(runner.unbound.map((u) => u.name)).toEqual(["binding:lost"]);
    expect(runner.superseded).toEqual([{ deltaId: oldGood.id, name: "binding:avgHeight" }]);
    expect(runner.malformed.map((m) => m.deltaId)).toEqual([broken.id]);

    const considered = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_BINDING,
      ),
    );
    expect(considered).toHaveLength(5);
    expect(
      runner.installed.length +
        runner.skipped.length +
        runner.unbound.length +
        runner.superseded.length +
        runner.malformed.length,
    ).toBe(considered.length);
    await gateway.close();
  });

  it("a HOST-registered materialization is bindable once the host declares it, and computes", async () => {
    const gateway = await Gateway.open(new MemoryBackend());
    gateway.reactor.register("plant", PLANT.body, [FERN], Date.now());
    await gateway.append([
      signClaims(
        bindingDefinitionClaims({ ...SPEC, materialization: "plant" }, RUNNER, 1),
        RUNNER_SEED,
      ),
    ]);

    const blind = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(blind.installed).toEqual([]);
    expect(blind.unbound[0]!.reason).toMatch(/RunnerOptions\.materializations/);

    const runner = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
      materializations: ["plant"],
    });
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.unbound).toEqual([]);
    await measureTwice(gateway);
    const entries = gateway.reactor.materializedView("plant", FERN)?.props.get(DERIVED) ?? [];
    expect(entries).toHaveLength(1);
    const value = entries[0]!.delta.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);
    await gateway.close();
  });

  it("a declared name may not enter the gateway's own NUL alphabet", () => {
    return Gateway.open(new MemoryBackend()).then(async (gateway) => {
      expect(() =>
        Runner.attach(gateway, {
          seed: RUNNER_SEED,
          implementations: {},
          materializations: ["Plant\u0000g1"],
        }),
      ).toThrow(/may not contain NUL/);
      await gateway.close();
    });
  });
});

describe("T157/2 — an `emit` that merely parses refuses at install", () => {
  const REFUSED: readonly [string, string][] = [
    ["null", "the one that threw inside a later ingest"],
    ["{}", "the one that silently degraded to append"],
    ['{"keyed":[]}', "append under a keyed spelling: no context can ever key an emission"],
    ['{"keyed":[""]}', "an empty context name matches no pointer, so every emission keys as empty"],
    ['{"keyed":[7]}', "a context that is not a string can never equal a pointer's context"],
    ['"append"', "the strategy name JSON-quoted: a parsed string is not one of the two bare names"],
  ];

  it("the refused list has a FLOOR — narrowing it back to the loud case cannot pass quietly", () => {
    expect(REFUSED.length).toBeGreaterThanOrEqual(6);
  });

  it.each(REFUSED)("refuses emit: %s — %s", async (emit) => {
    const gateway = await plantStore();
    const bad = signClaims(withEmit("binding:bad", emit, 1), RUNNER_SEED);
    await gateway.append([bad]);

    const runner = attach(gateway);
    expect(runner.installed).toEqual([]);
    expect(runner.malformed).toHaveLength(1);
    expect(runner.malformed[0]!.deltaId).toBe(bad.id);
    const { reason } = runner.malformed[0]!;
    expect(reason).toMatch(/not an emit strategy/);
    expect(reason).toContain('"append"');
    expect(reason).toContain('"supersede"');
    expect(reason).toContain("keyed");

    await measureTwice(gateway);
    expect(emissions(gateway)).toHaveLength(0);
    expect([...gateway.reactor.snapshot()].map((d) => d.id)).toContain(bad.id);
    await gateway.close();
  });

  it("a well-formed keyed emit still installs and keys its emissions rather than appending", async () => {
    const gateway = await plantStore();
    await gateway.append([
      signClaims(withEmit("binding:avgHeight", `{"keyed":["${DERIVED}"]}`, 1), RUNNER_SEED),
    ]);
    const runner = attach(gateway);
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.malformed).toEqual([]);
    expect(runner.unbound).toEqual([]);

    await measureTwice(gateway);
    const entries = emissions(gateway);
    expect(entries).toHaveLength(1);
    const value = entries[0]!.delta.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);
    await gateway.close();
  });

  it("a refused emit does not take its well-formed neighbours down with it", async () => {
    const gateway = await plantStore();
    await gateway.append([
      signClaims(withEmit("binding:bad", "{}", 1), RUNNER_SEED),
      signClaims(bindingDefinitionClaims(SPEC, RUNNER, 2), RUNNER_SEED),
    ]);
    const runner = attach(gateway);
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.malformed).toHaveLength(1);
    await measureTwice(gateway);
    expect(emissions(gateway)).toHaveLength(1);
    await gateway.close();
  });
});
