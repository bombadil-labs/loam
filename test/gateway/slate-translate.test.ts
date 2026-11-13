import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { FERN, observed } from "../spike/garden.js";
import { BEFORE_DEADLINE, OP, OP_SEED, bootSlateStore, standSlate, strike } from "./slating.js";

const SPEC = {
  recognize: { hasPointer: { context: { exact: "height" } } },
  emit: {
    pointers: [
      { role: "subject", at: { from: { role: "subject" } }, context: "rendered" },
      { role: "value", value: { from: { role: "value" } } },
    ],
  },
};

describe("T64 × T58 — a cite-closed slate must not strand a rendering whose source was struck", () => {
  it("the retraction lands even when the emission batch is refused by the slate", async () => {
    const gw = await bootSlateStore();
    const retired = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([retired]);
    await gw.append([
      signClaims(translationClaims("celsius", SPEC.recognize, SPEC.emit, OP, 2000), OP_SEED),
    ]);
    const first = await translate(gw, { seed: OP_SEED });
    expect(first.emitted).toBe(1);
    const rendering = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "translates" &&
          p.target.kind === "delta" &&
          p.target.deltaRef.delta === retired.id,
      ),
    )!;
    expect(rendering).toBeDefined();
    await gw.append([strike(retired.id, 3000)]);

    const slated = observed(FERN, "height", 34, 4000, OP_SEED);
    await gw.append([slated]);
    await standSlate(gw, { members: [slated], closes: ["egress", "cite"] });

    await expect(translate(gw, { seed: OP_SEED })).rejects.toThrow(/SLATED FOR ERASURE/);

    expect(gw.reactor.negationsOf(rendering.id).length).toBeGreaterThan(0);
    const offered = gw.offeredDeltas();
    expect(offered.map((d) => d.id)).toContain(rendering.id);
    const strikeOfRendering = gw.reactor.negationsOf(rendering.id)[0]!;
    expect(offered.map((d) => d.id)).toContain(strikeOfRendering);

    expect(offered.map((d) => d.id)).not.toContain(slated.id);
    expect(await gw.backend.holds(retired.id)).toBe(true);
    expect(await gw.backend.holds(rendering.id)).toBe(true);
    expect(await gw.backend.holds(slated.id)).toBe(true);
    await gw.close();
  });

  it("with the slate gone the pass completes, emitting what the window had refused", async () => {
    const gw = await bootSlateStore();
    const source = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([source]);
    await gw.append([
      signClaims(translationClaims("celsius", SPEC.recognize, SPEC.emit, OP, 2000), OP_SEED),
    ]);
    const stood = await standSlate(gw, { members: [source], closes: ["cite"] });
    await expect(translate(gw, { seed: OP_SEED })).rejects.toThrow(/SLATED FOR ERASURE/);
    expect(
      [...gw.reactor.snapshot()].some((d) =>
        d.claims.pointers.some((p) => p.role === "translates"),
      ),
    ).toBe(false);

    await gw.append([strike(stood.declaration, 5000)]);
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    const after = await translate(gw, { seed: OP_SEED });
    expect(after.emitted).toBe(1);
    expect(await gw.backend.holds(source.id)).toBe(true);
    await gw.close();
  });
});
