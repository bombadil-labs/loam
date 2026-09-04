// T263 — THE FIVE CONTROLS, HELD AGAINST THE LANDED RECORD.
//
// `leeway-copy.test.ts` already holds `src/gateway/leeway-copy.ts` against the five bullets word
// for word — but it reads them from `.adlc/specs/58-a-connection-is-a-peer.md`, the WORKING spec.
// Its own header said so and named the debt: "When the landing slice moves that section to
// `spec/58-*.md`, this case must be re-pointed there — a copy rail that reads nothing is a copy
// rail that passes."
//
// THE LANDING CANNOT PAY THAT DEBT IN PLACE. That file is a frozen rail of this ticket, and
// rails-guard refuses an edit to one — correctly, since a rail that could be rewritten by the
// change it guards is not a guard. So the debt is paid in a NEW file: the same word-for-word
// comparison, against `spec/`, which is the record that outlives the draft.
//
// Both rails now stand. The old one goes vacuous the day `.adlc/specs/` is cleared, and this one
// does not — and until then the two together say the draft and the record agree.
//
// RAILS-RED on origin/main, this file copied in: 2 red, 0 green — 2 cases. Both fail because the
// landed section carries no five bullets there; that is the whole of what this slice added.
//
// REVERT PROBES, MEASURED against this file as it stands — 2 cases.
//   a bullet in the section drifts from the module's words   → 1 red, 1 green
//   the order the record sets is scrambled                   → 1 red, 1 green

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEEWAY_CONTROLS } from "../../src/gateway/leeway-copy.js";

/** The five bullets, lifted from the landed section and flattened to one line each. */
function landedBullets(): string[] {
  const spec = readFileSync("spec/58-a-connection-is-a-peer.md", "utf8");
  const from = spec.indexOf("- **Receive**");
  const to = spec.indexOf("Those five sentences are the promise");
  expect(from, "the landed section carries the five").toBeGreaterThan(-1);
  expect(to, "and closes them with its own sentence").toBeGreaterThan(from);
  return spec
    .slice(from, to)
    .split(/\n- /)
    .map((b) =>
      b
        .replace(/^- /, "")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
    )
    .filter((b) => b.length > 0);
}

/** One line, no markdown emphasis — the record italicises what the module stores as plain text. */
const flat = (s: string): string => s.replace(/\*+/g, "").replace(/\s+/g, " ").trim();

describe("§58.11 — the module is the LANDED section's five, word for word", () => {
  it("five bullets, and each one is a control's own capability and risk", () => {
    const bullets = landedBullets();
    expect(bullets, "the section carries exactly five").toHaveLength(5);
    expect(LEEWAY_CONTROLS, "and the module carries five").toHaveLength(5);
    for (const [i, control] of LEEWAY_CONTROLS.entries()) {
      const bullet = bullets[i]!;
      // EQUALITY OF THE PARTS, not containment of the whole. Containment lets a risk sentence be
      // truncated to a prefix — or emptied entirely — in the one rail whose whole job is holding
      // the promise where the record put it.
      expect(bullet, `${control.label}: the section's bullet names it`).toContain(
        `**${control.label}**`,
      );
      expect(flat(bullet), `${control.label}: its capability, entire`).toContain(
        flat(control.capability),
      );
      expect(flat(bullet), `${control.label}: its risk, entire`).toContain(flat(control.risk));
      expect(flat(control.risk).length, `${control.label}'s risk is a sentence`).toBeGreaterThan(
        40,
      );
    }
  });

  it("the order the record sets is the order a person reads", () => {
    // A person meets these five in one column. The record's order is part of what it promises:
    // the three switches, then what may exist below, then how much may run.
    const bullets = landedBullets().map((b) => /\*\*([A-Za-z]+)\*\*/.exec(b)?.[1]);
    expect(bullets).toEqual(["Receive", "Offer", "Publish", "Delegate", "Envelope"]);
    expect(LEEWAY_CONTROLS.map((c) => c.label)).toEqual(bullets);
  });
});
