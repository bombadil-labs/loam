import { describe, expect, it } from "vitest";
import { leewayFits, type Leeway, type Terms } from "../../src/gateway/leeway.js";

const SEALED: Leeway = {
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};

const leeway = (over: Partial<Leeway> = {}): Leeway => ({ ...SEALED, ...over });

const terms = (over: Partial<Terms> = {}): Terms => ({
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
  ...over,
});

const refusal = (child: Leeway, parent: Leeway): string | undefined =>
  leewayFits(child, parent)?.why;

describe("§58 position 4 — a child's leeway fits its parent's DELEGATION TERMS", () => {
  describe("delegate: off means a pure namespace", () => {
    it("refuses any child leeway at all, including one identical to the parent's", () => {
      expect(refusal(SEALED, SEALED)).toMatch(/pure namespace/);
      expect(refusal(leeway({ receive: true }), SEALED)).toMatch(/pure namespace/);
    });

    it("refuses a child that sets terms where the TERMS delegate nothing further", () => {
      const parent = leeway({ delegate: terms({ receive: true, delegate: "off" }) });
      expect(leewayFits(leeway({ receive: true }), parent)).toBeUndefined();
      expect(refusal(leeway({ receive: true, delegate: terms() }), parent)).toMatch(
        /delegate nothing further/,
      );
    });
  });

  describe("a switch the terms withhold", () => {
    it("refuses a child that turns it on, and names the switch", () => {
      const parent = leeway({ delegate: terms({ receive: false }) });
      expect(refusal(leeway({ receive: true }), parent)).toMatch(/receive/);
    });

    it("admits a child that leaves it off", () => {
      const parent = leeway({ delegate: terms({ receive: false }) });
      expect(leewayFits(SEALED, parent)).toBeUndefined();
    });

    it("weighs OFFER, not only receive and publish", () => {
      const parent = leeway({ delegate: terms({ receive: true, publish: true, offer: false }) });
      expect(refusal(leeway({ offer: true }), parent)).toMatch(/offer/);
      expect(leewayFits(leeway({ receive: true, publish: true }), parent)).toBeUndefined();
    });

    it("admits a child narrower than the terms — asking for less always fits", () => {
      const parent = leeway({ delegate: terms({ receive: true, publish: true }) });
      expect(leewayFits(leeway({ receive: true }), parent)).toBeUndefined();
      expect(leewayFits(SEALED, parent)).toBeUndefined();
    });
  });

  describe("the envelope is a ceiling, not a switch", () => {
    it("refuses a child above the terms' ceiling and admits one at or below it", () => {
      const parent = leeway({ delegate: terms({ envelope: "medium" }) });
      expect(refusal(leeway({ envelope: "large" }), parent)).toMatch(/envelope/i);
      expect(leewayFits(leeway({ envelope: "medium" }), parent)).toBeUndefined();
      expect(leewayFits(leeway({ envelope: "small" }), parent)).toBeUndefined();
    });

    it("refuses a MEDIUM child under a SMALL ceiling — the tightest rung, and the default", () => {
      const parent = leeway({ delegate: terms({ envelope: "small" }) });
      expect(refusal(leeway({ envelope: "medium" }), parent)).toMatch(/envelope/i);
      expect(leewayFits(leeway({ envelope: "small" }), parent)).toBeUndefined();
    });
  });

  describe("a child's OWN delegate is compared too", () => {
    it("refuses a child whose delegate exceeds the terms' delegate", () => {
      const parent = leeway({
        delegate: terms({ receive: true, delegate: terms({ receive: false }) }),
      });
      const child = leeway({ receive: true, delegate: terms({ receive: true }) });
      expect(refusal(child, parent)).toMatch(/receive/);
    });

    it("admits a child that delegates nothing, whatever the terms allow", () => {
      const parent = leeway({
        delegate: terms({ receive: true, delegate: terms({ receive: true }) }),
      });
      expect(leewayFits(leeway({ receive: true, delegate: "off" }), parent)).toBeUndefined();
    });
  });

  describe('"same" carries the terms down without writing the recursion out', () => {
    it("admits a child whose delegate repeats the terms, and refuses one that widens them", () => {
      const inner: Terms = terms({ receive: true, delegate: "same" });
      const parent = leeway({ delegate: inner });
      expect(leewayFits(leeway({ receive: true, delegate: inner }), parent)).toBeUndefined();
      const wider = leeway({ receive: true, delegate: terms({ receive: true, publish: true }) });
      expect(refusal(wider, parent)).toMatch(/publish/);
    });

    const chain = (...levels: Partial<Terms>[]): Terms =>
      levels.reduceRight<Terms>((below, level, i) => {
        const isDeepest = i === levels.length - 1;
        return terms({ ...level, delegate: isDeepest ? (level.delegate ?? "off") : below });
      }, terms());

    const forever = (over: Partial<Terms>): Leeway =>
      leeway({ ...over, delegate: terms({ ...over, delegate: "same" }) });

    it("refuses a 'same' that outlives a ceiling narrowing at the fourth level", () => {
      const parent = leeway({
        delegate: chain(
          { receive: true, publish: true },
          { receive: true, publish: true },
          { receive: true, publish: true },
          { receive: true, publish: false, delegate: "off" },
        ),
      });
      expect(refusal(forever({ receive: true, publish: true }), parent)).toMatch(/publish/);
    });

    it("refuses a 'same' where the parent's chain ENDS — below it is a pure namespace", () => {
      const parent = leeway({
        delegate: chain({ receive: true }, { receive: true }, { receive: true, delegate: "off" }),
      });
      expect(refusal(forever({ receive: true }), parent)).toMatch(/delegate nothing further/);
    });

    it("refuses a 'same' carrying an envelope above a ceiling that narrows below", () => {
      const parent = leeway({
        delegate: chain(
          { envelope: "large" },
          { envelope: "large" },
          { envelope: "large" },
          { envelope: "small", delegate: "same" },
        ),
      });
      expect(refusal(forever({ envelope: "large" }), parent)).toMatch(/envelope/i);
    });

    it("admits a 'same' every written ceiling permits, down to the chain's own fixpoint", () => {
      const wide = { receive: true, publish: true };
      const parent = leeway({ delegate: chain(wide, wide, { ...wide, delegate: "same" }) });
      expect(leewayFits(forever(wide), parent)).toBeUndefined();
    });

    it("REVERT PROBE — the shorthand is never wider than writing the recursion out", () => {
      const parent = leeway({
        delegate: chain(
          { receive: true, publish: true },
          { receive: true, publish: true },
          { receive: true, publish: true },
          { receive: true, publish: false, delegate: "off" },
        ),
      });
      const writtenOut = leeway({
        receive: true,
        publish: true,
        delegate: chain(
          { receive: true, publish: true },
          { receive: true, publish: true },
          { receive: true, publish: true, delegate: "off" },
        ),
      });
      expect(refusal(writtenOut, parent)).toMatch(/publish/);
      expect(refusal(forever({ receive: true, publish: true }), parent)).toMatch(/publish/);
    });

    it("terminates — a self-referential 'same' resolves rather than recurring forever", () => {
      const inner: Terms = terms({ receive: true, publish: true, delegate: "same" });
      const parent = leeway({ delegate: inner });
      const child = leeway({ receive: true, publish: true, delegate: inner });
      expect(leewayFits(child, parent)).toBeUndefined();
    });
  });

  describe("the folded cases", () => {
    it("REVERT PROBE — the parent's own switches never enter the comparison", () => {
      const sealedButGenerous = leeway({
        receive: false,
        offer: false,
        publish: false,
        envelope: "small",
        delegate: terms({ receive: true, offer: true, publish: true, envelope: "large" }),
      });
      const child = leeway({ receive: true, offer: true, publish: true, envelope: "large" });
      expect(leewayFits(child, sealedButGenerous)).toBeUndefined();
    });

    it("REVERT PROBE — a sealed room may hold an open annex (Myk's fold)", () => {
      const agent1 = leeway({ receive: false, delegate: terms({ receive: true }) });
      expect(leewayFits(leeway({ receive: true }), agent1)).toBeUndefined();
    });

    it("REVERT PROBE — no escalation by nesting (the premortem's fold)", () => {
      const parent = leeway({
        delegate: terms({ receive: true, publish: false, delegate: "same" }),
      });
      const escalating = leeway({
        receive: true,
        delegate: terms({ receive: true, publish: true }),
      });
      expect(refusal(escalating, parent)).toMatch(/publish/);
    });
  });
});
