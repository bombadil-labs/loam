// T64 × T58 — the standing TRANSLATE pass under a slate window (SPEC §29.3).
//
// `translate` is a COPY EDGE, and T58's whole point is that a rendering is a copy into a fresh id no
// negation of the source can ever reach — so the pass must sign a negation of its OWN rendering when
// the source is struck, because a peer runs none of Loam's reader rules and only deltas federate.
//
// A slate reintroduces that bug from the outside. `translates` is a delta-ref, so the cite closure
// deliberately refuses an EMISSION whose source is slated — and the pass appends emissions and
// retractions as two batches. Emitting first meant a slate's refusal aborted the pass before the
// retraction batch ran, leaving every rendering whose source had been struck LIVE and still
// federating for the life of the window. Retractions now run FIRST, so no refusal downstream of them
// can strand a strike.
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: the cite predicate itself (slate-doors.test.ts), and
// whether an egress-only window SHOULD stop a pass from minting a copy — it should not, by §29.3's
// own design; the honest half of that is the receipt's non-claim, asserted in slate-receipt.test.ts.

import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { translate, translationClaims } from "../../src/federation/translate.js";
import { FERN, observed } from "../spike/garden.js";
import { BEFORE_DEADLINE, OP, OP_SEED, bootSlateStore, standSlate, strike } from "./slating.js";

// Recognize a height observation; emit a `rendered`-context copy of its value. The pass stamps every
// emission with a `translates` delta-ref back to the source, which is what the cite predicate reads.
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
    // Two sources. `retired` is rendered and then STRUCK, so the pass owes a retraction of its
    // rendering. `slated` arrives later and is condemned, so the pass's EMISSION for it is refused.
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
    // The source is struck. The rendering is now a live copy of a retired fact, and only the pass can
    // retire it — no negation of the source reaches a delta with a different id.
    await gw.append([strike(retired.id, 3000)]);

    const slated = observed(FERN, "height", 34, 4000, OP_SEED);
    await gw.append([slated]);
    await standSlate(gw, { members: [slated], closes: ["egress", "cite"] });

    // The pass runs. Its emission for the slated source is REFUSED at the cite door — which is
    // intended — and the whole append throws.
    await expect(translate(gw, { seed: OP_SEED })).rejects.toThrow(/SLATED FOR ERASURE/);

    // THE RETRACTION LANDED ANYWAY. This is the assertion the old ordering could not satisfy: with
    // emissions first, the throw aborted the pass and the stale rendering stayed live for the whole
    // window, still federating — the exact bug T58 exists to close.
    expect(gw.reactor.negationsOf(rendering.id).length).toBeGreaterThan(0);
    // OBJECT LEVEL, and at the EGRESS door a peer actually pulls: the stale rendering does not read as
    // live, because its own strike travels with it.
    const offered = gw.offeredDeltas();
    expect(offered.map((d) => d.id)).toContain(rendering.id);
    const strikeOfRendering = gw.reactor.negationsOf(rendering.id)[0]!;
    expect(offered.map((d) => d.id)).toContain(strikeOfRendering);

    // TWO-SIDED: the slated source is withheld from the offer (egress is closed over it) while the
    // retired source and its rendering are both still ON THE GROUND — a strike is not an erasure, and
    // this pass moved no bytes.
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
    // Nothing was rendered while the window stood — the cite closure did its job.
    expect(
      [...gw.reactor.snapshot()].some((d) =>
        d.claims.pointers.some((p) => p.role === "translates"),
      ),
    ).toBe(false);

    // Un-slate; the next pass finishes the work, which is the grow-only promise the report makes.
    await gw.append([strike(stood.declaration, 5000)]);
    expect(gw.slates(BEFORE_DEADLINE)).toEqual([]);
    const after = await translate(gw, { seed: OP_SEED });
    expect(after.emitted).toBe(1);
    expect(await gw.backend.holds(source.id)).toBe(true);
    await gw.close();
  });
});
