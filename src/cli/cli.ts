// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { Gateway } from "../gateway/gateway.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { serve, type ServerHandle } from "../server/http.js";
import { SqliteBackend } from "../store/sqlite.js";
import { parseArgs, rejectUnknown } from "./args.js";
import { initHome, readSeed, storePath } from "./config.js";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

export interface RunOptions {
  readonly detach?: boolean; // serve: return the handle instead of blocking
  readonly version?: string; // override the reported version (tests)
}

const VERSION = "0.0.0";

const HELP = `loam — a general database grown on rhizomatic

usage: loam <command> [options]

commands:
  init     create a home, mint or import the operator seed, write config
  serve    boot a store and serve it (GraphQL + SSE + MCP over HTTP)
  store    inspect a store

run \`loam <command> --help\` for a command's options.`;

function cmdInit(args: readonly string[], io: IO): number {
  const parsed = parseArgs(args, new Set());
  rejectUnknown(parsed, new Set(["home", "seed"]), "init");
  if (parsed.positionals.length > 0) {
    // `loam init <seed>` is the natural typo for `--seed <seed>` — refuse it, and NEVER echo
    // the value, lest a seed reach a terminal or a shell history via the error.
    io.err("init takes no positional arguments (import a seed with `loam init --seed <hex>`)");
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const result = initHome(home, parsed.flags.get("seed"));
  io.out(
    result.created
      ? `loam: initialized ${home}\n  operator ${result.operator}`
      : `loam: ${home} already initialized\n  operator ${result.operator}`,
  );
  return 0;
}

async function cmdServe(
  args: readonly string[],
  io: IO,
  options: RunOptions,
): Promise<number | ServerHandle> {
  const parsed = parseArgs(args, new Set(["http"]));
  rejectUnknown(parsed, new Set(["home", "store", "port", "token", "http"]), "serve");
  if (!parsed.booleans.has("http")) {
    io.err("serve: only --http is supported today (pass --http)");
    return 2;
  }
  const token = parsed.flags.get("token");
  if (token === undefined) {
    io.err("serve: a --token is required (an unlockable door is a wall)");
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const seed = readSeed(home);
  const path = storePath(home, parsed.flags.get("store"));
  const port = parsed.flags.get("port") === undefined ? 4321 : Number(parsed.flags.get("port"));

  // Boot the store from its genesis (idempotent): a fresh store is born governed; an existing
  // one simply re-lands the same operator identity.
  const gateway = await Gateway.boot(
    new SqliteBackend(path),
    assembleGenesis({ operatorSeed: seed }),
  );
  const server = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port,
    host: "127.0.0.1",
  });
  io.out(`loam: serving ${path} at ${server.url}/default`);

  // Closing the server also releases the gateway (and its backend file) — one shutdown, whole.
  const handle: ServerHandle = {
    ...server,
    async close(): Promise<void> {
      await server.close();
      await gateway.close();
    },
  };

  if (options.detach === true) return handle;

  // Foreground: hold until signalled, then shut down cleanly.
  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await handle.close();
  return 0;
}

async function cmdStore(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseArgs(args, new Set());
  rejectUnknown(parsed, new Set(["home", "store"]), "store");
  const home = parsed.flags.get("home") ?? defaultHome();
  const path = storePath(home, parsed.flags.get("store"));
  const backend = new SqliteBackend(path);
  const deltas = await backend.deltasSince(new Set());
  await backend.close();
  io.out(`loam store ${path}\n  ${deltas.length} deltas`);
  return 0;
}

function defaultHome(): string {
  return process.env["LOAM_HOME"] ?? ".loam";
}

// The entry point. Returns an exit code, or (serve --http --detach) a live ServerHandle.
export async function run(
  argv: readonly string[],
  io: IO,
  options: RunOptions = {},
): Promise<number | ServerHandle> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "help") {
    io.out(HELP);
    return 0;
  }
  if (command === "--version" || command === "version") {
    io.out(options.version ?? VERSION);
    return 0;
  }
  try {
    switch (command) {
      case "init":
        return cmdInit(rest, io);
      case "serve":
        return await cmdServe(rest, io, options);
      case "store":
        return await cmdStore(rest, io);
      default:
        io.err(`loam: unknown command "${command}" — run \`loam --help\``);
        return 2;
    }
  } catch (err) {
    io.err(`loam: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// The real process entry: wire stdout/stderr and exit with the code. (serve blocks, so a
// ServerHandle return here means detach was set — not reachable from the bin path.)
export async function main(argv: readonly string[]): Promise<void> {
  const result = await run(argv, {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  });
  if (typeof result === "number") process.exitCode = result;
}
