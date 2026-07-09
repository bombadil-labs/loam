// SPEC §2, "The function substrate": a DerivedFn is hyperview → deltas; a BindingSpec binds it
// to a materialization with purity, budget, and an emit strategy; the DerivationHost executes.
// Emissions are signed, carry provenance, supersede idempotently, replay verifiably, and a
// runaway binding suspends observably.

import { describe, expect, it } from "vitest";
import {
  DerivationHost,
  Reactor,
  VOCAB_PREFIX,
  verifyDelta,
  verifyPureDerivation,
  type BindingSpec,
  type DerivedFn,
  type HView,
  type Pointer,
} from "@bombadil/rhizomatic";
import { FERN, GARDENER_SEED, PLANT_BODY, SURVEYOR_SEED, observed } from "./garden.js";

const RUNNER_SEED = "0d".repeat(32);

// The fixture function: average the numeric height observations, file the answer under
// derived:avgHeight at the root.
const avgHeight: DerivedFn = (view: HView, root: string): Pointer[][] => {
  const heights = (view.props.get("height") ?? [])
    .flatMap((e) => e.delta.claims.pointers)
    .filter((p) => p.role === "value" && p.target.kind === "primitive")
    .map((p) => (p.target as { value: unknown }).value)
    .filter((v): v is number => typeof v === "number");
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

const spec: BindingSpec = {
  name: "binding:avgHeight",
  fnId: "fn:avgHeight",
  materialization: "plant",
  pure: true,
  budget: 10,
  emit: "supersede",
};

function world(overrides: Partial<BindingSpec> = {}): { host: DerivationHost; author: string } {
  const reactor = new Reactor();
  reactor.register("plant", PLANT_BODY, [FERN]);
  const host = new DerivationHost(reactor);
  const author = host.install({ ...spec, ...overrides }, avgHeight, RUNNER_SEED);
  return { host, author };
}

const derivedAt = (host: DerivationHost) =>
  host.reactor.materializedView("plant", FERN)?.props.get("derived:avgHeight") ?? [];

describe("spike: DerivationHost — definition, application, execution", () => {
  it("a binding fires on ingest and emits a signed, provenance-bearing delta", () => {
    const { host, author } = world();
    host.ingest(observed(FERN, "height", 30, 1000, GARDENER_SEED));
    host.ingest(observed(FERN, "height", 34, 2000, SURVEYOR_SEED));
    const entries = derivedAt(host);
    expect(entries).toHaveLength(1);
    const emitted = entries[0]!.delta;
    expect(emitted.claims.author).toBe(author);
    expect(verifyDelta(emitted)).toBe("verified");
    const value = emitted.claims.pointers.find((p) => p.role === "value");
    expect(value?.target.kind === "primitive" && value.target.value).toBe(32);
    for (const suffix of ["by", "from", "under"]) {
      expect(
        emitted.claims.pointers.some((p) => p.role === `${VOCAB_PREFIX}.derived.${suffix}`),
      ).toBe(true);
    }
  });

  it("supersede: a new input negates the prior verdict; exactly one claim lives", () => {
    const { host } = world();
    host.ingest(observed(FERN, "height", 30, 1000, GARDENER_SEED));
    const first = derivedAt(host)[0]!.delta;
    host.ingest(observed(FERN, "height", 34, 2000, SURVEYOR_SEED));
    const entries = derivedAt(host);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.delta.id).not.toBe(first.id);
    expect(host.reactor.negationsOf(first.id)).toHaveLength(1);
  });

  it("pure replay: the emitted delta reproduces from the recorded input hex", () => {
    const { host } = world();
    const seedObservation = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    host.ingest(seedObservation);
    const emitted = derivedAt(host)[0]!.delta;
    const fromHex = (
      emitted.claims.pointers.find((p) => p.role === `${VOCAB_PREFIX}.derived.from`)!.target as {
        value: string;
      }
    ).value;
    // Rebuild the pre-emission world and replay.
    const probe = new Reactor();
    probe.register("plant", PLANT_BODY, [FERN]);
    probe.ingest(seedObservation);
    expect(probe.materializedHex("plant", FERN)).toBe(fromHex);
    const view = probe.materializedView("plant", FERN)!;
    expect(verifyPureDerivation(emitted, spec, avgHeight, view, FERN, fromHex)).toBe(true);
    // A tampered function cannot pass itself off as the recorded execution.
    const liar: DerivedFn = (v, r) =>
      avgHeight(v, r).map((ptrs) =>
        ptrs.map((p) =>
          p.role === "value" && p.target.kind === "primitive" && typeof p.target.value === "number"
            ? { ...p, target: { kind: "primitive" as const, value: p.target.value + 1 } }
            : p,
        ),
      );
    expect(verifyPureDerivation(emitted, spec, liar, view, FERN, fromHex)).toBe(false);
  });

  it("the budget suspends a runaway binding, observably, and emissions stop", () => {
    const { host } = world({ name: "binding:tight", budget: 2 });
    host.ingest(observed(FERN, "height", 30, 1000, GARDENER_SEED)); // trigger 1
    host.ingest(observed(FERN, "height", 34, 2000, SURVEYOR_SEED)); // trigger 2
    expect(host.isSuspended("binding:tight")).toBe(false);
    host.ingest(observed(FERN, "height", 31, 3000, GARDENER_SEED)); // budget exceeded
    expect(host.isSuspended("binding:tight")).toBe(true);
    const suspRole = `${VOCAB_PREFIX}.derived.suspended`;
    expect(
      [...host.reactor.snapshot()].some((d) => d.claims.pointers.some((p) => p.role === suspRole)),
    ).toBe(true);
    const before = host.reactor.size;
    host.ingest(observed(FERN, "height", 33, 4000, SURVEYOR_SEED));
    expect(host.reactor.size).toBe(before + 1); // the observation lands; no emission follows
  });
});
