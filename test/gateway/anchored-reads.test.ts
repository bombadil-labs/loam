// Ordinary reads cost their own footprint, not the store (rhizomatic SPEC-17 P7). A cold present
// read and an as-of read both evaluate through the reactor's anchored read, never a whole-store
// evaluation, and the deltas a read touches do not grow when unrelated entities are written.
// Answers are covered by the whole suite; this rail pins the route and the footprint.

import { describe, expect, it, vi } from "vitest";
import type { AnchoredRead } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_READING, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";

const KEEPER_SEED = "d7".repeat(32);
const MOSS = "plant:moss";

async function store(bystanders: number) {
  const gw = await Gateway.open(new MemoryBackend(), { seed: KEEPER_SEED });
  await gw.append(governedBootstrap(KEEPER_SEED));
  await gw.append(garden);
  await gw.publishRegistration(
    PLANT,
    PLANT_READING,
    [],
    { actor: KEEPER_SEED },
    undefined,
    undefined,
    PLANT_WRITABLE,
  );
  await gw.append([
    observed(MOSS, "height", 3, 1000, GARDENER_SEED),
    observed(MOSS, "height", 4, 2000, GARDENER_SEED),
  ]);
  const others = Array.from({ length: bystanders }, (_, n) =>
    observed(`plant:other-${n}`, "height", n, 1000 + n, GARDENER_SEED),
  );
  if (others.length > 0) await gw.append(others);
  return gw;
}

// Read moss cold (it is no registered root), and record which evaluator ran and what it touched.
async function readMoss(bystanders: number, asOf?: number) {
  const gw = await store(bystanders);
  const whole = vi.spyOn(gw.reactor, "eval");
  const anchored = vi.spyOn(gw.reactor, "evalAnchored");
  const node = gw.resolvedNode("Plant", MOSS, asOf);
  const reads = anchored.mock.results.map((r) => r.value as AnchoredRead);
  await gw.close();
  return { node, whole: whole.mock.calls.length, reads };
}

describe("an ordinary read is anchored (SPEC-17)", () => {
  it("a cold present read runs anchored, never over the whole store", async () => {
    const { node, whole, reads } = await readMoss(0);
    expect(node.view).toMatchObject({ height: 4 });
    expect(whole).toBe(0);
    expect(reads.length).toBe(1);
    expect(reads[0]!.scope).toContain(MOSS);
  });

  it("an as-of read runs anchored and still sees the past", async () => {
    const { node, whole, reads } = await readMoss(0, 1500);
    expect(node.view).toMatchObject({ height: 3 });
    expect(whole).toBe(0);
    expect(reads.length).toBe(1);
  });

  it("2000 unrelated plants do not widen what a read touches", async () => {
    const small = await readMoss(0);
    const large = await readMoss(2000);
    expect(large.node.hex).toBe(small.node.hex);
    expect(large.reads[0]!.members).toEqual(small.reads[0]!.members);
    expect(large.reads[0]!.scope).toEqual(small.reads[0]!.scope);
  }, 60_000);
});
