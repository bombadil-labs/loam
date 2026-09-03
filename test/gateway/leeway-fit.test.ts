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
// ON RAILS-RED: this module is new, so every case here fails to compile on the base tree — 0 of
// the cases run. That is an honest red and a WEAK measurement: it cannot tell a right rule from a
// wrong one. Mutation is stronger but not sufficient either — a run reporting every mutant killed
// still left four clauses of this file unmeasured, including the child-side `"same"` comparison,
// because the operator set never generated the mutant that would have shown it. The probes at the
// foot carry their MEASURED red counts instead of a claim.

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
      // Matched on the phrase unique to THIS refusal. Three of the module's four sentences carry
      // the word "delegate", so /delegat/i cannot tell them apart and would pass on the wrong one.
      expect(refusal(SEALED, SEALED)).toMatch(/pure namespace/);
      expect(refusal(leeway({ receive: true }), SEALED)).toMatch(/pure namespace/);
    });

    it("refuses a child that sets terms where the TERMS delegate nothing further", () => {
      // The ceiling one level in: the parent delegates, but what it delegates ends there. A child
      // may live under it and may not configure below itself. Unrailed until now.
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
      // Drop "offer" from the module's switch list and every other case here stays green, because
      // none of them turns it on. This case is the only thing holding the third switch in.
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

    // DEPTH IS THE WHOLE POINT OF THESE FOUR. A child's `"same"` asserts its terms at every depth
    // below, so it must fit EVERY ceiling the parent wrote. A rule that walks only one ceiling
    // past the `"same"` still refuses a chain that narrows at the next level — so a three-level
    // chain proves nothing. These narrow at the FOURTH, which is the shallowest depth that can
    // tell a walk from a wave-through. Written shallower they pass either way, which is how the
    // first draft of this block was hollow.
    /** A chain of terms, outermost first; the last one written is the deepest ceiling. */
    const chain = (...levels: Partial<Terms>[]): Terms =>
      levels.reduceRight<Terms>((below, level, i) => {
        const isDeepest = i === levels.length - 1;
        return terms({ ...level, delegate: isDeepest ? (level.delegate ?? "off") : below });
      }, terms());

    /** A child whose own terms repeat these allowances forever. */
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
      // THE ADMIT HALF OF THE WALK, and the four cases below it are all refusals. Without this
      // one, a rule that walks the chain and then refuses every admit passes the whole file —
      // measured — which would make the shorthand unusable instead of too wide. That is the exact
      // inverse of the escalation, and the rails could not tell the two apart.
      // Three written levels is the shallowest chain that reaches the recursive branch: at two,
      // the `permitted === "same"` guard answers first and the case would be hollow.
      const wide = { receive: true, publish: true };
      const parent = leeway({ delegate: chain(wide, wide, { ...wide, delegate: "same" }) });
      expect(leewayFits(forever(wide), parent)).toBeUndefined();
    });

    it("REVERT PROBE — the shorthand is never wider than writing the recursion out", () => {
      // `"same"` is DEFINED as sugar for the written recursion, so any reach the written form is
      // refused must be refused through the shorthand too. This is the asymmetry that exposed the
      // escalation: the written form was refused while `"same"` was admitted, which made an
      // abbreviation more permissive than the thing it abbreviates.
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

  // ── The cases the rule was folded for. Each is a revert probe, and the counts below are
  // MEASURED against this file as it stands — 20 cases — not a claim of exclusivity. Re-measure
  // them when you add a case; an earlier revision of this comment carried the counts from a
  // 13-case version and read as measurement, which is the overclaim the header warns about.
  //   compare against `parent` instead of `parent.delegate`  → 14 red, 6 green
  //   drop the delegate comparison entirely                  →  8 red, 12 green
  //   walk the chain, then refuse every admit                →  1 red, 19 green
  // The third is the sharpest and the narrowest: exactly one case separates a rule that walks
  // the ceiling chain from one that refuses the shorthand under any written terms. Without that
  // case the inverse of the escalation ships green.
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
