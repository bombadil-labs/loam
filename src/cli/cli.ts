// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { readFileSync } from "node:fs";
import { parsePolicy, parseTerm, type HyperSchema } from "@bombadil/rhizomatic";
import { Gateway } from "../gateway/gateway.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { schemaEntityFor } from "../gateway/registration.js";
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
  init      create a home, mint or import the operator seed, write config
  serve     boot a store and serve it (GraphQL + SSE + MCP over HTTP)
  register  define a schema from a file and register it in the home's store
  store     inspect a store

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
  // The token comes from --token or the LOAM_TOKEN env (containers pass it that way).
  const token = parsed.flags.get("token") ?? process.env["LOAM_TOKEN"];
  if (token === undefined || token.length === 0) {
    io.err("serve: a token is required (--token or LOAM_TOKEN) — an unlockable door is a wall");
    return 2;
  }
  const port = parsePort(parsed.flags.get("port"));
  if (port === undefined) {
    io.err("serve: --port must be an integer in 0..65535");
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  // Boot is turnkey: an uninitialized home mints (or imports via LOAM_SEED) an operator identity
  // now, so a fresh container serves without an out-of-band `loam init`. Idempotent.
  const init = initHome(home, process.env["LOAM_SEED"]);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const seed = readSeed(home);
  const path = storePath(home, parsed.flags.get("store"));

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

// Register a schema from a file: { name, alg?, body, policy, roots, entity? } — the body and
// policy in their JSON profiles. The definition and its registration land as operator-signed
// deltas in the home's store; the next serve generates the surface from them. Offline by
// design (the store is single-writer): register before serving, or use POST /:mount/register
// against a running server.
async function cmdRegister(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseArgs(args, new Set());
  rejectUnknown(parsed, new Set(["home", "store"]), "register");
  const file = parsed.positionals[0];
  if (file === undefined) {
    io.err(
      "register wants a schema file: `loam register <schema.json>` — " +
        "{ name, alg?, body, policy, roots, entity? }",
    );
    return 2;
  }
  if (parsed.positionals.length > 1) {
    io.err("register takes exactly one file");
    return 2;
  }
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    io.err(`register: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  let spec: {
    name?: unknown;
    alg?: unknown;
    body?: unknown;
    policy?: unknown;
    roots?: unknown;
    entity?: unknown;
  };
  try {
    spec = JSON.parse(raw) as typeof spec;
  } catch (err) {
    io.err(`register: ${file} is not JSON: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  if (typeof spec.name !== "string" || spec.name.length === 0) {
    io.err("register: the file must name the schema (a non-empty `name`)");
    return 2;
  }
  if (!Array.isArray(spec.roots) || spec.roots.some((r) => typeof r !== "string")) {
    io.err("register: the file must carry `roots`, an array of entity ids");
    return 2;
  }
  if (spec.entity !== undefined && typeof spec.entity !== "string") {
    io.err("register: `entity` must be a string when given");
    return 2;
  }
  let schema: HyperSchema;
  let policy: ReturnType<typeof parsePolicy>;
  try {
    schema = {
      name: spec.name,
      alg: typeof spec.alg === "number" ? spec.alg : 1,
      body: parseTerm(spec.body),
    };
    policy = parsePolicy(spec.policy);
  } catch (err) {
    io.err(`register: ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const home = parsed.flags.get("home") ?? defaultHome();
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home, parsed.flags.get("store"))),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  try {
    await gateway.publishRegistration(
      schema,
      policy,
      spec.roots as string[],
      undefined,
      spec.entity,
    );
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  await gateway.close();
  io.out(
    `loam: registered ${spec.name} at ${schemaEntityFor(schema, spec.entity)}\n` +
      `  the definition is deltas now — the next serve grows the surface from it`,
  );
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

// A port is 0 (ephemeral) through 65535, an integer, or absent (the default). Anything else —
// a typo'd letter, a negative, a float — is refused, never silently coerced to a random port.
function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return 4321;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n <= 65535 ? n : undefined;
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
      case "register":
        return await cmdRegister(rest, io);
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
