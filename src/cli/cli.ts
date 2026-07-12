// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { readFileSync, writeFileSync } from "node:fs";
import { authorForSeed } from "@bombadil/rhizomatic";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import { parseOffer } from "../federation/offer.js";
import { toWire } from "../federation/wire.js";
import { migrate } from "../migrate/migrate.js";
import { pullFrom } from "../federation/pull.js";
import { tombstonesIn } from "../gateway/erase.js";
import { assembleGenesis } from "../gateway/genesis.js";
import {
  parseRegistrationInput,
  schemaEntityFor,
  type RegistrationInput,
} from "../gateway/registration.js";
import { serve, type ServerHandle } from "../server/http.js";
import type { StoreBackend } from "../store/backend.js";
import { ArchiveBackend } from "../store/archive.js";
import { MirrorBackend } from "../store/mirror.js";
import { SqliteBackend } from "../store/sqlite.js";
import { parseArgs, rejectUnknown } from "./args.js";
import { archivePath, initHome, readSeed, storePath } from "./config.js";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

export interface RunOptions {
  readonly detach?: boolean; // serve: return the handle instead of blocking
  readonly version?: string; // override the reported version (tests)
}

const VERSION = "0.1.0";

const HELP = `loam — a general database grown on rhizomatic

usage: loam <command> [options]

commands:
  init      create a home, mint or import the operator seed, write config
  serve     boot a store and serve it (GraphQL + SSE + MCP over HTTP)
  register  define a schema from a file and register it in the home's store
  pull      land a peer's deltas — a live URL or a frozen offer file
  migrate   read an offer, re-express it in the current format, write it back
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
  rejectUnknown(parsed, new Set(["home", "store", "port", "token", "http", "archive"]), "serve");
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

  // The optional cold store (--archive, or `archive` in config.json): the sqlite primary gains
  // an archive mirror, healed BEFORE boot — boot reads the backend once, so a lost sqlite is
  // replanted from the archive's memory before the gateway ever looks. Lag is safe (union) but
  // never silent: it reaches the operator's log.
  const vault = archivePath(home, parsed.flags.get("archive"));
  let backend: StoreBackend = new SqliteBackend(path);
  if (vault !== undefined) {
    const archive = new ArchiveBackend(vault);
    const mirror = new MirrorBackend(backend, archive, {
      onLag: (err) =>
        io.err(
          `loam: the archive is lagging — ${err instanceof Error ? err.message : String(err)} (the next serve heals it)`,
        ),
    });
    let healed;
    try {
      // The law reaches the vault (SPEC §11): tombstoned ids — read straight off BOTH tiers,
      // before any reactor exists — are excluded from the union, so a cold copy can never
      // replant what the operator erased.
      const dead = tombstonesIn(
        [...(await backend.deltasSince(new Set())), ...(await archive.deltasSince(new Set()))],
        authorForSeed(seed),
      );
      healed = await mirror.heal(dead);
    } catch (err) {
      await mirror.close().catch(() => {}); // never let a close failure mask the real refusal
      throw err;
    }
    if (healed.toPrimary > 0 || healed.toMirror > 0) {
      io.out(
        `loam: healed — ${healed.toPrimary} deltas replanted from the archive, ${healed.toMirror} newly archived`,
      );
    }
    backend = mirror;
  }

  // Boot the store from its genesis (idempotent): a fresh store is born governed; an existing
  // one simply re-lands the same operator identity.
  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }));
  const server = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port,
    host: "127.0.0.1",
  });
  io.out(
    `loam: serving ${path} at ${server.url}/default${vault === undefined ? "" : `\n  archive ${vault}`}`,
  );

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
        "{ hyperschema: { name, alg?, body }, schema, roots, entity? }",
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
  let input: RegistrationInput;
  try {
    input = parseRegistrationInput(JSON.parse(raw));
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
      input.hyperschema,
      input.schema,
      input.roots,
      undefined,
      input.entity,
      input.mutations,
      input.writable,
    );
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  await gateway.close();
  io.out(
    `loam: registered ${input.hyperschema.name} at ${schemaEntityFor(input.hyperschema, input.entity)}\n` +
      `  the definition is deltas now — the next serve grows the surface from it`,
  );
  return 0;
}

// Land a peer's deltas in the home's store: one command, one door, two sources (SPEC §15).
// A URL is a live peer (`pullFrom` — a single anti-entropy step); a file is a frozen offer
// (the same body /federate serves, exported from a browser store or saved off the wire).
// Both cross through Gateway.federate: verification, trust-admission, tombstones at the door.
// No standing needed — union is union; whether the imported law BINDS is decided by whose
// operator seed this home holds, never by this command.
async function cmdPull(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseArgs(args, new Set());
  rejectUnknown(parsed, new Set(["home", "store", "token"]), "pull");
  const source = parsed.positionals[0];
  if (source === undefined) {
    io.err(
      "pull wants a source: `loam pull <url|file>` — a live peer, or a frozen offer " +
        "(the body of GET /federate, saved; a browser store's export)",
    );
    return 2;
  }
  if (parsed.positionals.length > 1) {
    io.err("pull takes exactly one source");
    return 2;
  }
  const isUrl = /^https?:\/\//i.test(source); // URI schemes are case-insensitive (RFC 3986)
  const token = parsed.flags.get("token") ?? process.env["LOAM_TOKEN"];
  if (isUrl && (token === undefined || token.length === 0)) {
    io.err(
      "pull: a live peer wants a token (--token or LOAM_TOKEN) — " +
        "federation hands over the raw substrate, and that door is the operator's",
    );
    return 2;
  }
  let offered: ReturnType<typeof parseOffer> | undefined;
  if (!isUrl) {
    let raw: string;
    try {
      raw = readFileSync(source, "utf8");
    } catch (err) {
      io.err(`pull: cannot read ${source}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    try {
      offered = parseOffer(raw);
    } catch (err) {
      io.err(`pull: ${source}: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
  }

  const home = parsed.flags.get("home") ?? defaultHome();
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const gateway = await Gateway.boot(
    new SqliteBackend(storePath(home, parsed.flags.get("store"))),
    assembleGenesis({ operatorSeed: readSeed(home) }),
  );
  let report: FederationReport;
  try {
    report = isUrl ? await pullFrom(gateway, source, token!) : await gateway.federate(offered!);
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  // The report prints BEFORE close: the deltas are durable the moment federate returns, and
  // a close failure must not swallow the news that they landed.
  io.out(
    `loam: pulled ${source}\n` +
      `  ${report.accepted} accepted, ${report.rejected} refused, of ${report.offered} offered — ` +
      `union is union; pulling again is safe`,
  );
  if (init.created) {
    // The fork is the operator's (SPEC §15): a home minted THIS run holds a brand-new seed,
    // so whatever law rode the offer is another operator's here — inert by design.
    io.out(
      "  this home minted its own operator just now, so the offer's law is another's here —\n" +
        "  same-operator continuity wants `loam init --seed <hex>` before the pull",
    );
  }
  await gateway.close();
  return 0;
}

// Re-express a frozen offer in the current on-wire format (the standing policy: every breaking
// format change ships a migration). Old deltas in, correctly-formed deltas out — schema
// definitions re-signed into the current vocabulary, each superseded original negated with a
// link to its replacement and a reason. Grow-only, so the output carries the whole history.
// Re-signing needs the seed that authored those definitions: run it against the home whose
// operator minted the store (`loam init --seed <hex>` first, with the store's original seed).
function cmdMigrate(args: readonly string[], io: IO): number {
  const parsed = parseArgs(args, new Set());
  rejectUnknown(parsed, new Set(["home", "out"]), "migrate");
  const source = parsed.positionals[0];
  if (source === undefined) {
    io.err(
      "migrate wants an input: `loam migrate <file> [--out <file>]` — a frozen offer " +
        "(a store's export, or a saved GET /federate body)",
    );
    return 2;
  }
  if (parsed.positionals.length > 1) {
    io.err("migrate takes exactly one input");
    return 2;
  }
  let deltas;
  try {
    deltas = parseOffer(readFileSync(source, "utf8"));
  } catch (err) {
    io.err(`migrate: ${source}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  let seed: string;
  try {
    seed = readSeed(home);
  } catch {
    io.err(
      `migrate: no operator seed in ${home} — the definitions are re-signed, so run\n` +
        "  `loam init --seed <hex>` with the store's ORIGINAL seed first, then migrate",
    );
    return 1;
  }
  const { deltas: migrated, report } = migrate(deltas, { seed });
  const out = JSON.stringify({ deltas: migrated.map(toWire) });
  const steps =
    report.applied.length === 0
      ? "already current — nothing to migrate"
      : report.applied.map((a) => `${a.id} (${a.superseded} superseded)`).join(", ");
  const dest = parsed.flags.get("out");
  if (dest !== undefined) {
    writeFileSync(dest, out);
    io.out(
      `loam: migrated ${source} → ${dest}\n  ${report.before} in, ${report.after} out — ${steps}`,
    );
  } else {
    io.out(out); // to stdout, so `loam migrate old.json > new.json` works
  }
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
      case "pull":
        return await cmdPull(rest, io);
      case "migrate":
        return cmdMigrate(rest, io);
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
