// T157 — binding install validates what install is CLAIMING. Two defects, one principle.
//
// 1. A definition naming a materialization no schema provides was reported `installed` and then
//    computed nothing, forever: `materializationFor` falls back to the raw name and attach never
//    asked whether anything answered to it. The H7 shape at the binding layer.
// 2. `emit` was gated on "JSON.parse succeeded" rather than "this is an emit strategy", so a
//    payload that merely parsed installed and failed LATER. Both measured spellings are railed
//    because they fail differently: `null` THROWS inside a later ingest, and `{}` SILENTLY
//    DEGRADES to append — no error ever, a store writing a shape its definition did not ask for.
//    The silent one is the dangerous one, so the list also carries the other spellings that reach
//    it: an empty `keyed`, an empty-string context, a non-string context, and a JSON-quoted
//    strategy name. A rail covering only the loud one leaves the whole silent class open.
//
// Two-sided throughout, at both levels. For each refusal: the bad definition is named with its
// cure AND a well-formed definition of the same shape still installs and computes; the delta is
// dropped from the RUN and never from the ground; and the bystander in the same store is
// untouched. The object-level question — what does a reader actually see at the materialization?
// — is asked every time, because "not in `installed`" is a report and "nothing computed" is the
// fact the report is about.
//
// GAP, named rather than implied: these refusals are library return values. `Runner.attach` still
// has no operator-facing caller in `src/` — no CLI command prints the accounting — so nothing here
// drives a door, and the "not an oracle" property is argued from the caller (whoever attaches a
// runner already holds the Gateway) rather than asserted. The rail that would close it is a `loam`
// subcommand that prints the report; it does not exist yet.

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

// The one implementation this file holds. It emits ONE claim, at the root, under a context of its
// own — so a keyed emit over that context has a real key to supersede on, and an append shows up
// as a second live entry rather than as nothing.
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

// A reading over the Plant PROGRAM under a name of its own — so lens name and program name are
// genuinely different and a rail can tell which one a lookup used.
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

// `bindingDefinitionClaims` carries `emit` through verbatim when it is already a string, which is
// how a hand-planted definition gets an emit that is not a strategy at all.
const withEmit = (name: string, emit: string, ts: number): Claims =>
  bindingDefinitionClaims({ ...SPEC, name, emit: emit as unknown as "append" }, RUNNER, ts);

async function plantStore(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend());
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return gateway;
}

const attach = (gateway: Gateway) =>
  Runner.attach(gateway, { seed: RUNNER_SEED, implementations: { "fn:avgHeight": avgHeight } });

// What a READER sees at the materialization the schema actually backs — the object level. Empty
// means the binding computed nothing; one entry means it superseded; two mean it appended.
const emissions = (gateway: Gateway) =>
  gateway.reactor.materializedView(gateway.materializationFor("Plant"), FERN)?.props.get(DERIVED) ??
  [];

// Two measurements, so append and supersede are DISTINGUISHABLE at the reader. One would leave
// them identical, and a fixture that cannot tell the two apart cannot see the silent defect.
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
    // The refusal: not installed, not silently skipped as somebody else's, but NAMED.
    expect(runner.installed).toEqual(["binding:avgHeight"]);
    expect(runner.skipped).toEqual([]);
    expect(runner.unbound).toHaveLength(1);
    const [refused] = runner.unbound;
    expect(refused!.name).toBe("binding:lost");
    expect(refused!.materialization).toBe("Compost");
    // The cure is in the sentence: the name that failed, and a name that would not have.
    expect(refused!.reason).toContain('"Compost"');
    expect(refused!.reason).toContain("Plant");
    expect(refused!.reason).toMatch(/compute nothing/);
    // The claim is SCOPED to what was checked — what this runner can SEE, not the whole reactor,
    // which rhizomatic gives no way to enumerate. A sentence pronouncing on the reactor would be
    // asserting a fact this code never established. And the cure names the escape hatch.
    expect(refused!.reason).toMatch(/nothing this runner can see provides/);
    expect(refused!.reason).toMatch(/RunnerOptions\.materializations/);

    // Object level: the well-formed sibling of the SAME shape still computes, so the refusal is
    // a refusal and not a blanket. 30 and 34 average to 32.
    await measureTwice(gateway);
    const entries = emissions(gateway);
    expect(entries).toHaveLength(1);
    const value = entries[0]!.delta.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);

    // Delta level: dropped from the RUN, never from the ground. The definition is still there,
    // unstruck — a later `register("Compost", …)` plus a re-attach is what repairs it.
    expect([...gateway.reactor.snapshot()].map((d) => d.id)).toContain(lost.id);
    await gateway.close();
  });

  it("with nothing registered the refusal names no alternative it cannot offer", async () => {
    // The empty store is the honest edge: there is no cure to name, so the sentence must not
    // pretend there is one. It also pins that `provided` is READ rather than assumed — a store
    // with no schemas refuses every definition, including a perfectly ordinary one.
    const bare = await Gateway.open(new MemoryBackend());
    await bare.append([signClaims(bindingDefinitionClaims(SPEC, RUNNER, 1), RUNNER_SEED)]);
    const runner = attach(bare);
    expect(runner.installed).toEqual([]);
    expect(runner.unbound.map((u) => u.name)).toEqual(["binding:avgHeight"]);
    expect(runner.unbound[0]!.reason).toMatch(/This runner can see none/);
    await bare.close();
  });

  it("the PROGRAM name binds as well as the LENS name — the check is the resolution's own lookup", async () => {
    // `materializationFor` resolves EITHER name a registration answers to, and a definition may
    // legitimately name either. A fixture whose lens name equals its program name cannot see the
    // difference (H6), so this one registers a reading called PlantClassic over the program
    // called Plant: two distinct names, both bindable, one materialization behind them.
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
    // The four-list identity is a prior ticket's frozen rail, and its fixture has no `unbound`
    // definition — so the fifth list is documented in the interface and measured nowhere. Here
    // the store holds one of each kind, and one name is defined TWICE, so the arithmetic cannot
    // pass on a fixture where names and deltas happen to agree.
    const gateway = await plantStore();
    const oldGood = signClaims(
      bindingDefinitionClaims({ ...SPEC, fnId: "fn:stale" }, RUNNER, 1),
      RUNNER_SEED,
    ); // superseded
    const good = signClaims(bindingDefinitionClaims(SPEC, RUNNER, 9), RUNNER_SEED); // installed
    const orphan = signClaims(
      bindingDefinitionClaims({ ...SPEC, name: "binding:orphan", fnId: "fn:nobody" }, RUNNER, 2),
      RUNNER_SEED,
    ); // skipped
    const lost = signClaims(
      bindingDefinitionClaims(
        { ...SPEC, name: "binding:lost", materialization: "Compost" },
        RUNNER,
        3,
      ),
      RUNNER_SEED,
    ); // unbound
    const broken = signClaims(withEmit("binding:broken", "{}", 4), RUNNER_SEED); // malformed
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
    expect(considered).toHaveLength(5); // five deltas over four names
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
    // `materializationFor` documents a pass-through for a materialization registered outside the
    // gateway, and `attach` refuses what it cannot resolve — so without a declaration that case
    // is refused, which would silently narrow a supported one. The host knows what it registered;
    // `RunnerOptions.materializations` is how it says so. Both sides are railed here, because a
    // rail that only proved the refusal would call the narrowing correct.
    const gateway = await Gateway.open(new MemoryBackend());
    gateway.reactor.register("plant", PLANT.body, [FERN]); // the host's own, not the gateway's
    await gateway.append([
      signClaims(
        bindingDefinitionClaims({ ...SPEC, materialization: "plant" }, RUNNER, 1),
        RUNNER_SEED,
      ),
    ]);

    // Undeclared: refused, and the sentence points at the declaration rather than at a schema.
    const blind = Runner.attach(gateway, {
      seed: RUNNER_SEED,
      implementations: { "fn:avgHeight": avgHeight },
    });
    expect(blind.installed).toEqual([]);
    expect(blind.unbound[0]!.reason).toMatch(/RunnerOptions\.materializations/);

    // Declared: installed, and it really computes — the object level, at the host's own name.
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
    // Every gateway-owned materialization is NUL-qualified. If a declaration could carry a NUL it
    // could name one of those and re-open exactly the hole the refusal closes, so it refuses
    // loudly rather than accepting a name it has no business honoring.
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
  // The two MEASURED spellings, plus three more roads to the same silent degradation. Written by
  // hand rather than generated, so narrowing the code cannot narrow the list. Every entry after
  // the first is the SILENT class: a key that can never match a pointer keys every emission as
  // "", and "" appends (rhizomatic's derivation.ts). They are cheap to add and each one is a
  // spelling an operator could plausibly type.
  const REFUSED: readonly [string, string][] = [
    ["null", "the one that threw inside a later ingest"],
    ["{}", "the one that silently degraded to append"],
    ['{"keyed":[]}', "append under a keyed spelling: no context can ever key an emission"],
    ['{"keyed":[""]}', "an empty context name matches no pointer, so every emission keys as empty"],
    ['{"keyed":[7]}', "a context that is not a string can never equal a pointer's context"],
    ['"append"', "the strategy name JSON-quoted: a parsed string is not one of the two bare names"],
  ];

  it("the refused list has a FLOOR — narrowing it back to the loud case cannot pass quietly", () => {
    // `it.each` over a list is only as strong as the list. Six is what round two established;
    // dropping one is then a deliberate edit to this number rather than a silent narrowing.
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
    // The cure names the admissible shapes, all three of them.
    const { reason } = runner.malformed[0]!;
    expect(reason).toMatch(/not an emit strategy/);
    expect(reason).toContain('"append"');
    expect(reason).toContain('"supersede"');
    expect(reason).toContain("keyed");

    // Object level, and this is the half that sees the SILENT defect: an ingest that used to
    // throw (null) or quietly append ({}) now completes and computes nothing at all.
    await measureTwice(gateway);
    expect(emissions(gateway)).toHaveLength(0);
    expect([...gateway.reactor.snapshot()].map((d) => d.id)).toContain(bad.id);
    await gateway.close();
  });

  it("a well-formed keyed emit still installs and keys its emissions rather than appending", async () => {
    // The other side of the refusal: JSON emit is not banned, it is CHECKED. A real keyed
    // strategy over the emitted subject's context keys every emission the same way, so the
    // second measurement supersedes the first instead of piling up beside it.
    //
    // GAP, named: this fixture has ONE emitted subject, so it separates keyed from APPEND (2
    // entries vs 1) and cannot separate keyed from wholesale `supersede` — both leave one live
    // entry. Distinguishing those two needs the count of NEGATIONS emitted, not the live count,
    // which is a rail about rhizomatic's derivation host rather than about this refusal.
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
    expect(entries).toHaveLength(1); // keyed: superseded, not appended
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
    expect(emissions(gateway)).toHaveLength(1); // the neighbour's supersede, alone
    await gateway.close();
  });
});
