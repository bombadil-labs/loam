// Per-command help (T80). The top-level help ends with "run `loam <command> --help` for a command's
// options", so every command owes an answer: its own flag list, and exit 0. The other half of the
// same promise is that a flag a command does NOT accept still fails loudly and names the offender —
// help must not be bought by swallowing typos.
//
// The expected flag names are spelled out HERE rather than read from the CLI's own table. This rail
// is the OUTSIDE contract (the README's flag table, the top-level help's promise); a table the
// implementation hands to both the help text and the assertion could empty out in step and stay
// green. Both halves land before any store is opened, so no command here needs a home on disk.
//
// Asserted at `run`'s returned exit code, which `main` assigns to process.exitCode unchanged.

import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";

// Every command, with every flag it accepts — the surface a reader is entitled to see.
const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  init: ["--home", "--seed"],
  serve: ["--home", "--store", "--port", "--token", "--http", "--archive"],
  register: ["--home", "--store"],
  pull: ["--home", "--store", "--token"],
  migrate: ["--home", "--out"],
  store: ["--home", "--store"],
  repair: ["--home", "--store"],
};

const collect = (): { io: { out(s: string): void; err(s: string): void }; lines: string[] } => {
  const lines: string[] = [];
  return { io: { out: (s) => lines.push(s), err: (s) => lines.push(s) }, lines };
};

describe("loam <command> --help", () => {
  for (const [command, flags] of Object.entries(COMMANDS)) {
    it(`${command}: prints its usage and every flag it accepts, exit 0`, async () => {
      const { io, lines } = collect();
      const code = await run([command, "--help"], io);
      expect(code, "help is a successful outcome, not an error").toBe(0);
      const printed = lines.join("\n");
      expect(printed).toContain(`loam ${command}`);
      expect(printed).toMatch(/usage:/i);
      for (const flag of flags) expect(printed, `${command} help names ${flag}`).toContain(flag);
      // The old failure: --help fell through to the value-hungry flag parser.
      expect(printed).not.toContain("needs a value");
    });

    it(`${command}: -h is the same answer`, async () => {
      const { io, lines } = collect();
      const code = await run([command, "-h"], io);
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain(`loam ${command}`);
    });

    it(`${command}: a flag it does not accept is refused, by name`, async () => {
      const { io, lines } = collect();
      // With a value, so the refusal comes from the allowlist rather than the value-hungry branch.
      const code = await run([command, "--frobnicate", "x"], io);
      expect(code, "a usage error, distinct from an internal error (1) and from success").toBe(2);
      expect(lines.join("\n")).toContain("--frobnicate");
    });

    it(`${command}: a valueless bad flag is refused, by name`, async () => {
      const { io, lines } = collect();
      const code = await run([command, "--frobnicate"], io);
      expect(code).toBe(2);
      expect(lines.join("\n")).toContain("--frobnicate");
    });
  }

  it("the top-level help still lists every command", async () => {
    const { io, lines } = collect();
    const code = await run(["--help"], io);
    expect(code).toBe(0);
    const printed = lines.join("\n");
    for (const command of Object.keys(COMMANDS)) expect(printed).toContain(command);
  });
});
