// T150 item 3 — the per-command help lays its flag column out so a long flag cannot
// concatenate with its note, and marks the flags a command genuinely requires.
// The old failure was `--acknowledge-writableyes, I know...` and an unmarked --connector.
//
// NAMED GAP: the wrap branch (`shown.length > width`, for a flag longer than 26 chars) is
// unreachable with today's flag set, so no rail exercises it; the padding branch is what these
// assertions pin. A flag long enough to wrap is the moment this file grows its third test.

import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";

const collect = (): { io: { out(s: string): void; err(s: string): void }; lines: string[] } => {
  const lines: string[] = [];
  return { io: { out: (s) => lines.push(s), err: (s) => lines.push(s) }, lines };
};

describe("help lays the flag column out", () => {
  it("artifact: no flag concatenates with its note", async () => {
    const { io, lines } = collect();
    const code = await run(["artifact", "--help"], io);
    expect(code).toBe(0);
    const printed = lines.join("\n");
    expect(printed).not.toContain("acknowledge-writableyes");
    expect(printed).toMatch(/--acknowledge-writable\s+yes/);
    expect(printed).not.toContain("connector <name>the");
    expect(printed).toMatch(/--connector <name>\s+the connector DISPLAY NAME/);
  });

  it("artifact: a required flag is marked", async () => {
    const { io, lines } = collect();
    await run(["artifact", "--help"], io);
    expect(lines.join("\n")).toMatch(/--connector <name>[^\n]*\(required\)/);
  });

  it("a command with no long flags keeps a tidy column", async () => {
    const { io, lines } = collect();
    await run(["store", "--help"], io);
    const printed = lines.join("\n");
    expect(printed).toMatch(/--store <file>\s+the store file inside the home/);
    expect(printed).not.toContain("<file>the");
  });
});
