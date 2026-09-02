// T263 — leeway, and the ONE RULE that governs what may exist below a container (SPEC §58,
// position 4). A child's leeway — its switches, its envelope, and its own `delegate` — must fit
// inside its PARENT'S DELEGATION TERMS. The parent's own switches never enter the comparison.
//
// That sentence is the whole subject of this file, and it was folded twice before it read that
// way: a premortem found escalation by nesting, and attenuating over a container's own switches
// made a sealed room with an open annex inexpressible. Both shapes have a named case below.
//
// The signature is load-bearing: the rule takes the PARENT'S LEEWAY, not its terms, so that
// ignoring `parent.receive` and reading only `parent.delegate` is the function's own doing and a
// probe can catch it. Handing it the terms directly would make the fold untestable here.
//
// Deliberately NOT here: the declaration (a leeway is a delta on the container — its own PR and
// its own rail), any act a switch gates (receive, publish, offer), and cascade on revocation.
// This file is the pure decision function and nothing else; it opens no store and writes nothing.
//
// ON RAILS-RED: this module is new, so every case here fails to compile on the base tree. That is
// an honest red and a WEAK measurement — it cannot tell a right rule from a wrong one. The
// instrument that can is `adlc hollow-test --target src/gateway/leeway.ts`, plus the three named
// revert probes at the foot of this file: each fails if one specific clause is deleted.

import { describe, expect, it } from "vitest";
import { leewayFits, type Leeway, type Terms } from "../../src/gateway/leeway.js";

/** Every switch off, no delegation — the private journal, which is the default. */
const SEALED: Leeway = {
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};

/** A leeway: what a container itself may do, and what it allows beneath it. */
const leeway = (over: Partial<Leeway> = {}): Leeway => ({ ...SEALED, ...over });

/** Terms: what may exist below. Only ever a `delegate` value, never a container's own leeway. */
const terms = (over: Partial<Terms> = {}): Terms => ({
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
  ...over,
});

/** The rule answers with a reason, or with nothing when the child fits. */
const refusal = (child: Leeway, parent: Leeway): string | undefined =>
  leewayFits(child, parent)?.why;

describe("§58 position 4 — a child's leeway fits its parent's DELEGATION TERMS", () => {
  describe("delegate: off means a pure namespace", () => {
    it("refuses any child leeway at all, including one identical to the parent's", () => {
      // "no new keys may be bound below, and every child inherits this container's leeway
      // exactly, so there is nothing to configure and nothing to attenuate."
      expect(refusal(SEALED, SEALED)).toMatch(/delegat/i);
      expect(refusal(leeway({ receive: true }), SEALED)).toMatch(/delegat/i);
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
      // The case above cannot see a rank table that collapses small into medium, because every
      // child it tries is admitted either way. This one separates the bottom two rungs, which is
      // where the default sits and therefore where a collapse would cost the most.
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

    it("terminates — a self-referential 'same' resolves rather than recurring forever", () => {
      const inner: Terms = terms({ receive: true, publish: true, delegate: "same" });
      const parent = leeway({ delegate: inner });
      const child = leeway({ receive: true, publish: true, delegate: inner });
      expect(leewayFits(child, parent)).toBeUndefined();
    });
  });

  // ── The cases the rule was folded for. Each is a revert probe: delete the named clause and
  // this case, and only this case, goes red.
  describe("the folded cases", () => {
    it("REVERT PROBE — the parent's own switches never enter the comparison", () => {
      // Compare against `parent` instead of `parent.delegate` and this goes red. A sealed parent
      // that delegates generously is the whole point of the fold.
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
      // `ada:agent1` with receive OFF and delegate {receive: on} cannot follow anything into its
      // own room, but may declare `ada:agent1:annex` with receive ON.
      const agent1 = leeway({ receive: false, delegate: terms({ receive: true }) });
      expect(leewayFits(leeway({ receive: true }), agent1)).toBeUndefined();
    });

    it("REVERT PROBE — no escalation by nesting (the premortem's fold)", () => {
      // A child may not reach, through its own delegate, anything the terms withhold. Delete the
      // recursive delegate comparison and this goes red while every case above stays green —
      // which is exactly how the escalation would have shipped.
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
