import { describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";

const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  init: ["--home", "--seed"],
  serve: ["--home", "--store", "--port", "--token", "--http", "--archive"],
  register: ["--home", "--store"],
  pull: ["--home", "--store", "--token"],
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
