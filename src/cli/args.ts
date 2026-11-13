export interface Parsed {
  readonly flags: Map<string, string>;

  readonly repeated: Map<string, string[]>;
  readonly booleans: Set<string>;
  readonly positionals: string[];
}

export class UsageError extends Error {}

export function parseArgs(args: readonly string[], booleanFlags: ReadonlySet<string>): Parsed {
  const flags = new Map<string, string>();
  const repeated = new Map<string, string[]>();
  const booleans = new Set<string>();
  const positionals: string[] = [];
  const keep = (name: string, value: string): void => {
    flags.set(name, value);
    repeated.set(name, [...(repeated.get(name) ?? []), value]);
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        const name = body.slice(0, eq);
        if (booleanFlags.has(name)) {
          throw new UsageError(
            `flag --${name} takes no value (write --${name}, not --${name}=...)`,
          );
        }
        keep(name, body.slice(eq + 1));
      } else if (booleanFlags.has(body)) {
        booleans.add(body);
      } else {
        const value = args[i + 1];
        if (value === undefined || value.startsWith("--")) {
          throw new UsageError(`flag --${body} needs a value`);
        }
        keep(body, value);
        i += 1;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, repeated, booleans, positionals };
}

export function rejectUnknown(parsed: Parsed, allowed: ReadonlySet<string>, command: string): void {
  for (const name of [...parsed.flags.keys(), ...parsed.booleans]) {
    if (!allowed.has(name)) {
      throw new UsageError(`${command}: unknown flag --${name} (run \`loam ${command} --help\`)`);
    }
  }
}
