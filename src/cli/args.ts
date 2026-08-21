// A tiny hand-rolled flag parser. The CLI is a handful of subcommands with a few flags each; a
// framework would be the heaviest dependency in the package. Flags are `--name value` or
// `--name` (boolean); everything else is a positional.

export interface Parsed {
  readonly flags: Map<string, string>;
  /**
   * EVERY value a flag was given, in order. `flags` keeps the last, which is what a single-valued
   * flag means and what every existing caller reads; a command that genuinely takes a SET reads
   * this instead. Splitting one value on a delimiter was the alternative and it is worse: no
   * delimiter is safe in a path, and a comma inside one silently becomes two wrong paths.
   */
  readonly repeated: Map<string, string[]>;
  readonly booleans: Set<string>;
  readonly positionals: string[];
}

// A malformed invocation, not a malfunction. `run` maps it to exit 2 — the code every other refusal
// in this CLI already uses — so a typo'd flag stays distinguishable from an internal error (1).
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
        // A boolean flag takes no value at all — `--operator=true` is not "operator absent" (T117:
        // this token used to fall through to `flags`, so a caller checking only `booleans` silently
        // read it as never having been passed). Refuse rather than guess which collection it meant.
        if (booleanFlags.has(name)) {
          throw new UsageError(
            `flag --${name} takes no value (write --${name}, not --${name}=...)`,
          );
        }
        // `--name=value`, the near-universal form, kept whole.
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
