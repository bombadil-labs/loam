import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LEEWAY_CONTROLS } from "../../src/gateway/leeway-copy.js";

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

const flat = (s: string): string => s.replace(/\*+/g, "").replace(/\s+/g, " ").trim();

describe("§58.11 — the module is the LANDED section's five, word for word", () => {
  it("five bullets, and each one is a control's own capability and risk", () => {
    const bullets = landedBullets();
    expect(bullets, "the section carries exactly five").toHaveLength(5);
    expect(LEEWAY_CONTROLS, "and the module carries five").toHaveLength(5);
    for (const [i, control] of LEEWAY_CONTROLS.entries()) {
      const bullet = bullets[i]!;
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
      const parts = flat(`${control.label} ${control.capability} ${control.risk}`).length;
      expect(
        flat(bullet).length,
        `${control.label}: the section says no more than the control does`,
      ).toBeLessThanOrEqual(parts + 12);
    }
  });

  it("the order the record sets is the order a person reads", () => {
    const bullets = landedBullets().map((b) => /\*\*([A-Za-z]+)\*\*/.exec(b)?.[1]);
    expect(bullets).toEqual(["Receive", "Offer", "Publish", "Delegate", "Envelope"]);
    expect(LEEWAY_CONTROLS.map((c) => c.label)).toEqual(bullets);
  });
});
