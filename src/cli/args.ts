// A tiny hand-rolled flag parser. The CLI is a handful of subcommands with a few flags each; a
// framework would be the heaviest dependency in the package. Flags are `--name value` or
// `--name` (boolean); everything else is a positional.

export interface Parsed {
  readonly flags: Map<string, string>;
  readonly booleans: Set<string>;
  readonly positionals: string[];
}

export function parseArgs(args: readonly string[], booleanFlags: ReadonlySet<string>): Parsed {
  const flags = new Map<string, string>();
  const booleans = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (booleanFlags.has(name)) {
        booleans.add(name);
      } else {
        const value = args[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new Error(`flag --${name} needs a value`);
        }
        flags.set(name, value);
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, booleans, positionals };
}

export function rejectUnknown(parsed: Parsed, allowed: ReadonlySet<string>, command: string): void {
  for (const name of [...parsed.flags.keys(), ...parsed.booleans]) {
    if (!allowed.has(name)) throw new Error(`${command}: unknown flag --${name}`);
  }
}
