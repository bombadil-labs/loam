// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
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
import {
  credentialsPath,
  entryFor,
  hashPassword,
  readCredentials,
  writeCredentials,
  type ScryptParams,
} from "../server/credentials.js";
import { clearAllRecords, clearRecord, unreadableRecordFile } from "../server/login-locks.js";
import {
  resolveUserView,
  roleClaims,
  roleOf,
  userClaims,
  userNameDefect,
  type UserRole,
} from "../server/users.js";
import { promptSecret } from "./prompt.js";
import type { StoreBackend } from "../store/backend.js";
import { ArchiveBackend } from "../store/archive.js";
import { MirrorBackend } from "../store/mirror.js";
import { SqliteBackend } from "../store/sqlite.js";
import { legibilityWarnings, reAdmit } from "../gateway/repair.js";
import { strandedStrikeWarnings } from "../store/quarantine.js";
import { parseArgs, rejectUnknown, UsageError, type Parsed } from "./args.js";
import { archivePath, initHome, readSeed, storePath } from "./config.js";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

export interface RunOptions {
  readonly detach?: boolean; // serve: return the handle instead of blocking
  readonly version?: string; // override the reported version (tests)
  /** `user create`: ask for a secret some other way than the terminal (embedders; tests). */
  readonly readSecret?: (prompt: string) => Promise<string>;
  /** `user create`: the scrypt cost, for a caller that must not pay the interactive default (tests). */
  readonly scrypt?: ScryptParams;
}

const VERSION = "0.1.0";

type CommandName =
  "init" | "serve" | "register" | "pull" | "migrate" | "store" | "repair" | "user" | "artifact";

interface CommandSpec {
  readonly summary: string; // the line the top-level help shows
  readonly usage: string; // the invocation, positionals spelled out
  readonly flags: ReadonlySet<string>; // the whole allowlist — what rejectUnknown permits
  readonly booleans?: ReadonlySet<string>; // the subset taking no value — what parseArgs is told
  readonly notes?: readonly string[]; // the prose a flag list cannot carry
}

// Each command's vocabulary, ONCE: the sets `--help` prints are the very sets the parser and the
// allowlist are handed (via parseFor), so a command's manual cannot drift from what it accepts.
const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
  init: {
    summary: "create a home, mint or import the operator seed, write config",
    usage: "loam init [options]",
    flags: new Set(["home", "seed"]),
    notes: ["The seed is written 0600 and never printed. A second init keeps the first identity."],
  },
  serve: {
    summary: "boot a store and serve it (GraphQL + SSE + MCP over HTTP)",
    usage: "loam serve --http [options]",
    flags: new Set(["home", "store", "port", "token", "http", "archive", "host", "public-url"]),
    booleans: new Set(["http"]),
    notes: [
      "A fresh home self-initializes: it mints (or, via LOAM_SEED, imports) an operator identity,",
      "so a container serves with nothing but a token.",
      "",
      "A home holding a credentials.json also opens the login doors (/login, /logout,",
      "/session/token). Behind a proxy, name the outside address with --public-url: Host and",
      "X-Forwarded-* are the caller's to write, so this server never reads them.",
    ],
  },
  register: {
    summary: "define a schema from a file and register it in the home's store",
    usage: "loam register <schema.json> [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "The file: { hyperschema: { name, alg?, body }, schema, roots, entity?, mutations?, writable? }",
      "— the same object POST /:mount/register and the MCP loam_register tool take. The store is",
      "single-writer, so register before serving (a running server takes the same body over HTTP).",
    ],
  },
  pull: {
    summary: "land a peer's deltas — a live URL or a frozen offer file",
    usage: "loam pull <url|file> [options]",
    flags: new Set(["home", "store", "token"]),
    notes: [
      "A URL is one anti-entropy step against a live peer (and wants a token); a file is a frozen",
      "offer — the body of GET /federate, saved, or a browser store's export.",
    ],
  },
  migrate: {
    summary: "read an offer, re-express it in the current format, write it back",
    usage: "loam migrate <file> [options]",
    flags: new Set(["home", "out"]),
    notes: [
      "Definitions are RE-SIGNED, so run it against the home whose operator authored them:",
      "`loam init --seed <hex>` with the store's original seed first. Without --out, to stdout.",
    ],
  },
  store: {
    summary: "inspect a store",
    usage: "loam store [options]",
    flags: new Set(["home", "store"]),
  },
  user: {
    summary: "create a login user, or clear a login delay",
    usage: "loam user create|unlock <name> [options] | loam user unlock --all [options]",
    flags: new Set(["home", "store", "operator", "all"]),
    booleans: new Set(["operator", "all"]),
    notes: [
      "subcommands:",
      "  create <name>    ask for a password twice, write the credential, plant the user deltas",
      "  unlock <name>    clear this name's failed-login record, so its next attempt waits for nothing",
      "  unlock --all     clear every login record, whatever name it holds",
      "",
      "THE LOGIN DOOR DELAYS. IT NEVER LOCKS. Each failed attempt for a name makes the next attempt",
      "for that name wait longer, up to a cap. The door always admits a correct password. So no",
      "caller can shut you out of your own store, and `unlock` is a convenience rather than a rescue.",
      "Silence for the forget window clears a record too.",
      "",
      "Use `unlock --all` when a caller filled the file with names you cannot list. It names no user.",
      "It clears every count, including a caller's own, so it hands their whole budget back.",
      "",
      "Home access IS the proof of operatorship: this command needs the home's seed, like erasure.",
      "The password hash lives in credentials.json (mode 0600) and never enters the ground, because",
      "the ground replicates. The user record and its role binding ARE deltas: facts, erasable,",
      "provenance-carrying.",
      "",
      "A user is TWO deltas, and erasure is per delta. Erasing the user record shuts the login door",
      "and stops new session tokens; the ROLE BINDING is a second delta and needs its own erasure, or",
      "it stays in the store with the user name inside its entity id.",
      "",
      "A token already minted keeps working until its short window ends. Erasure leaves",
      "credentials.json and login-locks.json alone. The health report names every one of these as a",
      "surface it does not sweep.",
    ],
  },
  artifact: {
    summary: "ask whether a route may be published as an artifact, and what it could do",
    usage: "loam artifact pack <mount>/<route>/<entity> [options]",
    flags: new Set([
      "url",
      "token",
      "connector",
      "store-address",
      "out",
      "acknowledge-pen",
      "acknowledge-writable",
    ]),
    booleans: new Set(["acknowledge-pen", "acknowledge-writable"]),
    notes: [
      "A THIN CLIENT of the gateway's own door, deliberately: the verdict is re-derived from surviving",
      "law on every call, so striking the declaration or the binding darkens it live. A CLI that read a",
      "file and decided for itself would keep approving a route whose law had been withdrawn.",
      "",
      "The door is OPERATOR-ONLY and to any other identity it does not exist — what it describes is a",
      "publication that would carry the renderer's own source, which no other door discloses.",
      "",
      "--connector is the DISPLAY NAME of the connector a published page would read through. It is the",
      "whole binding between such a page and a store: no host, no mount, and no token travel with it.",
    ],
  },
  repair: {
    summary: "list and settle a store's quarantine (SPEC §25)",
    usage: "loam repair <list|discard|re-admit|leave> [<key>] [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  list             every quarantined row + why, plus entity-id legibility warnings",
      "  discard <key>    remove a quarantined row's bytes from the origin (garbage out)",
      "  re-admit <key>   re-run admission; a row whose transient cause cleared returns",
      "  leave <key>      inaction is legal — an idempotent no-op that says so",
      "",
      "Repair is the operator's alone, like erasure (§11): it needs the home's seed.",
    ],
  },
};

// One blurb per flag NAME — a name means the same thing in every command that takes it. The LIST a
// command shows comes from its own allowlist, so a flag added there appears in its help whether or
// not anyone wrote it a blurb: an unexplained flag is still printed, never silently omitted.
const FLAG_HELP: Readonly<Record<string, { readonly arg: string; readonly note: string }>> = {
  home: { arg: "<dir>", note: "the home to work in (default $LOAM_HOME, else .loam)" },
  store: { arg: "<file>", note: "the store file inside the home (default store.sqlite)" },
  seed: { arg: "<hex>", note: "import an operator seed instead of minting one ($LOAM_SEED)" },
  port: { arg: "<n>", note: "the port to listen on — 0 for ephemeral (default 4321)" },
  host: {
    arg: "<addr>",
    note: "the address to bind (default 127.0.0.1 — loopback only; 0.0.0.0 opens the LAN)",
  },
  token: { arg: "<secret>", note: "the bearer token for the door ($LOAM_TOKEN)" },
  http: { arg: "", note: "serve over HTTP — the only transport today" },
  archive: { arg: "<dir>", note: "mirror every delta into a cold store, relative to the home" },
  out: { arg: "<file>", note: "write the output here (default stdout)" },
  operator: { arg: "", note: "give the new user the operator role (default: a plain actor)" },
  all: { arg: "", note: "unlock: clear EVERY login record, whatever name it holds" },
  "public-url": {
    arg: "<url>",
    note: "the store's address as the outside world sees it (default: the bound URL)",
  },
  url: { arg: "<base>", note: "the running gateway to ask (default http://127.0.0.1:4321)" },
  connector: { arg: "<name>", note: "the connector DISPLAY NAME a published page reads through" },
  "store-address": {
    arg: "<text>",
    note: "the store address the onboarding copy shows — text a viewer reads, never a target",
  },
  "acknowledge-pen": {
    arg: "",
    note: "yes, I know this renderer names a pen and an artifact writes as the viewer",
  },
  "acknowledge-writable": {
    arg: "",
    note: "yes, I know only the schema\u2019s writable list binds on that host",
  },
};

function topHelp(): string {
  const commands = (Object.keys(COMMANDS) as CommandName[]).map(
    (name) => `  ${name.padEnd(10)}${COMMANDS[name].summary}`,
  );
  return [
    "loam — a general database grown on rhizomatic",
    "",
    "usage: loam <command> [options]",
    "",
    "commands:",
    ...commands,
    "",
    "run `loam <command> --help` for a command's options.",
  ].join("\n");
}

function helpFor(command: CommandName): string {
  const spec = COMMANDS[command];
  const options = [...spec.flags].map((name) => {
    const { arg, note } = FLAG_HELP[name] ?? { arg: "<value>", note: "" };
    const shown =
      spec.booleans?.has(name) === true || arg === "" ? `--${name}` : `--${name} ${arg}`;
    return `  ${shown.padEnd(18)}${note}`.trimEnd();
  });
  return [
    `loam ${command} — ${spec.summary}`,
    "",
    `usage: ${spec.usage}`,
    "",
    "options:",
    ...options,
    ...(spec.notes === undefined ? [] : ["", ...spec.notes]),
  ].join("\n");
}

const isCommand = (name: string): name is CommandName => Object.hasOwn(COMMANDS, name);

// Parse a command's arguments through its OWN spec — the one the help text renders.
function parseFor(command: CommandName, args: readonly string[]): Parsed {
  const spec = COMMANDS[command];
  const parsed = parseArgs(args, spec.booleans ?? new Set());
  rejectUnknown(parsed, spec.flags, command);
  return parsed;
}

// Every store this CLI opens, opened the same way: the sqlite driver's one-time freelist scrub is
// best-effort — a second handle can refuse it and the store opens regardless — so its deferral
// rides the operator's log. A scrub nobody hears about is a §11 promise quietly left unkept.
function openStore(path: string, io: IO): SqliteBackend {
  return new SqliteBackend(path, { onScrubDeferred: (why) => io.err(why) });
}

// WHO IS SERVING THIS HOME. `loam serve` leaves a record beside config.json; the offline
// commands (pull, register) consult it so a success report can say the one thing sqlite cannot:
// a running server answers from the memory it booted with, and nothing lands in that memory
// through a second handle. Removed on clean shutdown; a crash leaves it behind, and the dead-pid
// check below is what keeps the stale record quiet.
const servingFile = (home: string): string => join(home, "serving.json");

const recordServing = (home: string, url: string, store: string): void => {
  const record = { pid: process.pid, url, store: resolve(store), startedAt: Date.now() };
  writeFileSync(servingFile(home), `${JSON.stringify(record)}\n`);
};

// The staleness probe, and its direction is the whole design (H9, inverted: this probe's SILENCE
// is what licenses the trap, so uncertainty must never read as absence). Two silences are earned —
// no record at all, and a recorded pid that is provably dead. A record that cannot be read,
// cannot be parsed, or is missing its fields WARNS: a false warning costs a sentence; a false
// silence costs an operator an afternoon of disbelieving their own store.
function servingWarning(home: string, store: string): string | undefined {
  const file = servingFile(home);
  const uncertain =
    `a server may be serving this store — ${file} exists but does not read as a serving ` +
    `record, and a maybe must not pass as a no. If one is running, it answers from the memory ` +
    `it booted with, so it will not see what just landed until it restarts`;
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    // ENOENT is the one absence this probe may trust: nothing claims to be serving.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return uncertain;
  }
  let record: { pid?: unknown; url?: unknown; store?: unknown };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return uncertain;
    record = parsed;
  } catch {
    return uncertain;
  }
  if (
    typeof record.pid !== "number" ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.store !== "string"
  ) {
    return uncertain;
  }
  // A server on a DIFFERENT store file is not this trap: the world that moved is not the one
  // being served. (Same-path spellings are resolved; a genuinely different file stays quiet.)
  if (resolve(record.store) !== resolve(store)) return undefined;
  try {
    process.kill(record.pid, 0); // signal 0: existence check, nothing delivered
  } catch (err) {
    // ESRCH is checked-and-no — a crash's leftover record. Anything else (EPERM: alive, not
    // ours) means a process is there, and a process we cannot ask is a process we warn about.
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return undefined;
  }
  const at = typeof record.url === "string" ? `, ${record.url}` : "";
  return (
    `a server is serving this store right now (pid ${record.pid}${at}) — it answers from the ` +
    `memory it booted with, so it will not see what just landed until it restarts`
  );
}

function cmdInit(args: readonly string[], io: IO): number {
  const parsed = parseFor("init", args);
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
  const parsed = parseFor("serve", args);
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
  let backend: StoreBackend = openStore(path, io);
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
    // The squatter half of the same heal (§25), which rides `mirror.lastRestore` rather than the
    // report. Reading it here is not optional bookkeeping: it is the obligation that surface carries,
    // since a signal nobody reads is a swallowed error with extra steps (H9).
    //
    // `undefined` is NOT an empty report and must not print as one — it means no heal reached the pen,
    // so nothing is known about it. Collapsing the two with `?? []` would put the exact conversion the
    // sentinel exists to refuse in the one place the obligation lives. UNREACHABLE from here today: a
    // rejected heal rethrows above, so this boot never reads a cleared surface. It is written for the
    // caller that catches — and it is untested for exactly that reason, which is worth more said than
    // dressed up in a rail that would have to fake a reachability this file does not have.
    const restore = mirror.lastRestore;
    if (restore === undefined) {
      io.err(
        `loam: the heal did not reach the store's §25 pen, so nothing is known about corrupt rows — ` +
          "a strike may be stranded and this boot cannot tell you. `loam repair list` can.",
      );
    }
    // A restore CHANGED the ground the gateway is about to boot on, so it is named per id rather than
    // counted — a restored negation un-strands a strike, and the operator should see what came back.
    for (const id of restore?.restored ?? []) {
      io.out(
        `loam: restored ${id} from the archive — a corrupt row was squatting on that id; any strike ` +
          `it carries suppresses again`,
      );
    }
    // The sweep's refusals are load-bearing: a report nobody reads is a swallowed error with
    // extra steps (H9). A refused sweep means a tombstoned id's bytes may still be at rest on
    // some tier — serve continues (refusing to boot trades a leak for an outage), but the
    // operator is told.
    for (const failure of healed.purgeFailures) {
      io.err(
        `loam: the boot sweep could not finish an erasure — bytes the operator ordered forgotten ` +
          `may still be at rest: ${failure}. Serving anyway; resolve the store fault and re-run ` +
          `the erasure (or restart) to finish the sweep.`,
      );
    }
    // Same reasoning, the other repair: a row still set aside means the store is about to serve with a
    // strike stranded — a retracted value, a revoked grant, or a tombstone reading LIVE (§25/H1).
    // Serving is still right (a legible store beats an outage), and saying nothing is not.
    for (const failure of restore?.stranded ?? []) {
      io.err(`loam: ${failure} Serving anyway; \`loam repair list\` names what the pen holds.`);
    }
    // And what heal DECLINED to plant. This one is not a fault report but a refusal: the archive holds
    // deltas this boot deliberately did not admit, because an unreadable row may be a tombstone nobody
    // could see (§11) or a set-aside strike would have been left behind its target (H1).
    for (const withheld of restore?.replantWithheld ?? []) {
      io.err(`loam: ${withheld}`);
    }
    backend = mirror;
  }

  // Boot the store from its genesis (idempotent): a fresh store is born governed; an existing
  // one simply re-lands the same operator identity.
  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }));
  // The login doors open only for a home that HAS users (SPEC §36). A store with no credentials.json
  // is exactly the store it was before §36: /login resolves no mount, and no request reads a cookie.
  const publicUrl = parsed.flags.get("public-url");
  const withUsers = existsSync(credentialsPath(home));
  const server = await serve({
    mounts: { default: gateway },
    tokens: { [token]: { operator: true } },
    port,
    host: parsed.flags.get("host") ?? "127.0.0.1",
    ...(withUsers
      ? {
          users: {
            home,
            mount: "default",
            // A local fault the CALLER must never read (it names paths and other users) still has to
            // reach someone — a report nobody hears is a swallowed error (H9).
            onFault: (message: string) => io.err(`loam: ${message}`),
            ...(publicUrl === undefined ? {} : { publicUrl }),
          },
        }
      : {}),
  });
  recordServing(home, server.url, path);
  io.out(
    `loam: serving ${path} at ${server.url}/default${vault === undefined ? "" : `\n  archive ${vault}`}` +
      (withUsers ? `\n  login at ${publicUrl ?? server.url}/login` : ""),
  );

  // Closing the server also releases the gateway (and its backend file) — one shutdown, whole.
  // The serving record goes LAST: while any of this can still fail, a live pid is still true.
  const handle: ServerHandle = {
    ...server,
    async close(): Promise<void> {
      await server.close();
      await gateway.close();
      rmSync(servingFile(home), { force: true });
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
  const parsed = parseFor("register", args);
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
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(
    openStore(path, io),
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
      input.resolvers,
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
  // The success is true and incomplete on its own: a server already holding this store will keep
  // serving the surface it booted with. The warning qualifies the report; it never blocks it.
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

// Land a peer's deltas in the home's store: one command, one door, two sources (SPEC §15).
// A URL is a live peer (`pullFrom` — a single anti-entropy step); a file is a frozen offer
// (the same body /federate serves, exported from a browser store or saved off the wire).
// Both cross through Gateway.federate: verification, trust-admission, tombstones at the door.
// No standing needed — union is union; whether the imported law BINDS is decided by whose
// operator seed this home holds, never by this command.
async function cmdPull(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("pull", args);
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
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(
    openStore(path, io),
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
  // "Accepted" is true of the FILE, not of any server already holding it open: a running serve
  // keeps answering from boot-time memory. Say so, right under the count that would otherwise lie
  // by omission — and never block; the deltas are durable whatever the server knows.
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
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
  const parsed = parseFor("migrate", args);
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
  const parsed = parseFor("store", args);
  const home = parsed.flags.get("home") ?? defaultHome();
  const path = storePath(home, parsed.flags.get("store"));
  const backend = openStore(path, io);
  const deltas = await backend.deltasSince(new Set());
  await backend.close();
  io.out(`loam store ${path}\n  ${deltas.length} deltas`);
  return 0;
}

// `loam repair` (SPEC §25): read the quarantine side channel and settle it. Repair is the
// operator's alone — like erasure (§11) — and running it in a home that holds the operator seed
// IS that authority; a home with no seed cannot repair, exactly as it cannot erase.
//
//   loam repair list                — every quarantined row + why, plus entity-id legibility warnings
//   loam repair discard   <key>     — remove a quarantined row's bytes from the origin (garbage out)
//   loam repair re-admit  <key>     — re-run admission; a row whose transient cause cleared returns
//   loam repair leave     <key>     — inaction is legal; an idempotent no-op that says so
async function cmdRepair(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("repair", args);
  const sub = parsed.positionals[0];
  if (sub === undefined) {
    io.err(
      "repair wants a subcommand: `loam repair list | discard <key> | re-admit <key> | leave <key>`",
    );
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  let seed: string;
  try {
    seed = readSeed(home);
  } catch {
    io.err(
      `repair: no operator seed in ${home} — repair is the operator's alone, like erasure; ` +
        "init the home (or point --home at the store's own) first",
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  const path = storePath(home, parsed.flags.get("store"));
  const backend = openStore(path, io);
  try {
    switch (sub) {
      case "list": {
        // The read is what fills the pen; the good deltas feed the legibility scan.
        const good = await backend.deltasSince(new Set());
        const pen = await backend.quarantine();
        const warnings = legibilityWarnings(good, operator);
        if (pen.length === 0 && warnings.length === 0) {
          io.out(
            `loam repair ${path}\n` +
              "  the quarantine is empty and every entity id is legible — nothing to settle",
          );
          return 0;
        }
        io.out(`loam repair ${path}`);
        if (pen.length > 0) {
          io.out(`  ${pen.length} quarantined row${pen.length === 1 ? "" : "s"}:`);
          for (const r of pen) {
            io.out(`    ${r.key}`);
            io.out(`      reason:  ${r.reason}`);
            io.out(`      preview: ${r.preview}`);
            for (const target of r.negates ?? []) {
              io.out(`      claims to strike: ${target} (unverified; LIVE until settled)`);
            }
          }
        }
        // §25/H1: a quarantined negation no longer suppresses its target, so a retracted value,
        // revoked grant, or tombstone reads live again — the operator must be told, loudly.
        const stranded = strandedStrikeWarnings(pen);
        if (stranded.length > 0) {
          io.out(
            `  ${stranded.length} STRANDED STRIKE warning${stranded.length === 1 ? "" : "s"}:`,
          );
          for (const w of stranded) io.out(`    ${w}`);
        }
        if (warnings.length > 0) {
          io.out(
            `  ${warnings.length} entity-id legibility warning${warnings.length === 1 ? "" : "s"} ` +
              "(an app delta points at a reserved loam: name):",
          );
          for (const w of warnings) {
            io.out(`    ${w.deltaId} by ${w.author} → ${w.reference}`);
          }
        }
        return 0;
      }
      case "discard": {
        const key = parsed.positionals[1];
        if (key === undefined) {
          io.err(
            "repair discard wants a key: `loam repair discard <key>` (from `loam repair list`)",
          );
          return 2;
        }
        await backend.deltasSince(new Set()); // fill the pen, so we only discard a quarantined row
        const pen = await backend.quarantine();
        if (!pen.some((r) => r.key === key)) {
          io.err(
            `repair discard: ${key} is not quarantined — \`loam repair list\` shows what is. ` +
              "A good ground delta is `erase`'s to forget (§11), never repair's.",
          );
          return 2;
        }
        const removed = await backend.discardRow(key);
        io.out(
          removed
            ? `loam: discarded ${key}\n  its bytes are gone from the origin; no lawful fact was forgotten`
            : `loam: ${key} was already gone`,
        );
        return 0;
      }
      case "re-admit":
      case "readmit": {
        const key = parsed.positionals[1];
        if (key === undefined) {
          io.err("repair re-admit wants a key: `loam repair re-admit <key>`");
          return 2;
        }
        const outcome = await reAdmit(backend, key);
        if (outcome === "readmitted") {
          io.out(
            `loam: re-admitted ${key}\n  it verifies now and rejoins the ground on the next read`,
          );
          return 0;
        }
        if (outcome === "still-quarantined") {
          io.out(
            `loam: ${key} still fails admission — it stays quarantined\n` +
              "  (repair never edits bytes into validity; leave it, or discard it as garbage)\n" +
              "  if a cold store holds a healthy copy of this delta, `loam serve --archive <dir>`\n" +
              "  replaces the corrupt row with it on the next boot — the one recovery that needs no\n" +
              "  re-federation, because the bytes are already yours",
          );
          return 0;
        }
        io.err(`repair re-admit: no quarantined or admitted row is filed under ${key}`);
        return 2;
      }
      case "leave": {
        const key = parsed.positionals[1];
        if (key === undefined) {
          io.err("repair leave wants a key: `loam repair leave <key>`");
          return 2;
        }
        io.out(
          `loam: left ${key} in quarantine\n` +
            "  inaction is legal — the store runs fine around it; quarantine is not a countdown",
        );
        return 0;
      }
      default:
        io.err(`repair: unknown subcommand "${sub}" — list | discard | re-admit | leave`);
        return 2;
    }
  } finally {
    await backend.close();
  }
}

// `loam user` (SPEC §36): the bootstrap door for a person, run on the box. Home access is the proof
// of operatorship — the same authority erasure and repair need — so there is no remote way in.
//
//   loam user create <name> [--operator]   ask twice, hash, plant the two deltas, write the credential
//   loam user unlock <name>                clear a name's failed-login record, and its delay with it
async function cmdUser(args: readonly string[], io: IO, options: RunOptions): Promise<number> {
  const parsed = parseFor("user", args);
  const sub = parsed.positionals[0];
  if (sub === undefined) {
    io.err(
      "user wants a subcommand: `loam user create <name> [--operator]`, " +
        "`loam user unlock <name>`, or `loam user unlock --all`",
    );
    return 2;
  }
  // `unlock --all` names no user, so it is answered before the name is demanded.
  if (sub === "unlock" && parsed.booleans.has("all")) {
    if (parsed.positionals.length > 1) {
      io.err("user unlock --all clears every record, so it takes no name");
      return 2;
    }
    return cmdUserUnlockAll(parsed.flags.get("home") ?? defaultHome(), io);
  }
  const name = parsed.positionals[1];
  if (name === undefined) {
    io.err(`user ${sub} wants a name: \`loam user ${sub} <name>\``);
    return 2;
  }
  if (parsed.positionals.length > 2) {
    io.err(`user ${sub} takes exactly one name`);
    return 2;
  }
  const defect = userNameDefect(name);
  if (defect !== undefined) {
    io.err(`user ${sub}: ${defect}`);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  switch (sub) {
    case "create":
      return await cmdUserCreate(name, parsed, home, io, options);
    case "unlock":
      return cmdUserUnlock(name, home, io);
    default:
      io.err(`user: unknown subcommand "${sub}" — create | unlock`);
      return 2;
  }
}

async function cmdUserCreate(
  name: string,
  parsed: Parsed,
  home: string,
  io: IO,
  options: RunOptions,
): Promise<number> {
  const role: UserRole = parsed.booleans.has("operator") ? "operator" : "actor";
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);

  let existing;
  try {
    existing = readCredentials(home);
  } catch (err) {
    io.err(
      `user create: ${credentialsPath(home)} is unreadable, so this command will not overwrite it: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (entryFor(existing, name) !== undefined) {
    io.err(
      `user create: ${name} already has a credential in ${home} — this command will not overwrite ` +
        `one. Remove the entry from ${credentialsPath(home)} to set that user a new password.`,
    );
    return 2;
  }

  const ask = options.readSecret ?? promptSecret;
  const password = await ask(`password for ${name}: `);
  const again = await ask("the same password again: ");
  if (password.length === 0) {
    io.err("user create: a password is required");
    return 2;
  }
  if (password !== again) {
    io.err("user create: the two passwords did not match — nothing was written");
    return 2;
  }
  const entry = await hashPassword(password, options.scrypt);

  const path = storePath(home, parsed.flags.get("store"));
  const seed = readSeed(home);
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  let known: boolean;
  let already: UserRole | undefined;
  try {
    // ASK THE GROUND, not only the credential file. The two halves of a user can come apart — a
    // credential removed by hand, or a write that failed after the deltas landed — and appending a
    // SECOND user record for the same name is the shape that outlives an erasure: the operator forgets
    // one record, `pickLatest` resolves the other, and the door stays open on a user they forgot.
    // (The append is not idempotent by content address either: these claims carry a fresh timestamp,
    // so a re-run hashes to a new delta rather than the one already there.)
    //
    // The RECORD is the question, not the role. `roleOf` also answers undefined when the record stands
    // and only the role is unreadable, and appending on that answer is the duplicate all over again.
    known = resolveUserView(gateway.reactor, gateway.operator, name) !== undefined;
    already = known ? roleOf(gateway.reactor, gateway.operator, name) : undefined;
    if (!known) {
      // THE DELTAS LAND FIRST, and the order is the recovery story. A credential written over a failed
      // append would open a door onto a user the ground never heard of, and a re-run would refuse
      // because the credential exists. This way round, a failed credential write leaves two harmless
      // facts, and the re-run above finds them and appends nothing.
      const operator = authorForSeed(seed);
      const at = Date.now();
      await gateway.append([
        signClaims(userClaims(name, operator, at), seed),
        signClaims(roleClaims(name, role, operator, at), seed),
      ]);
    }
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  await gateway.close();

  if (known && already === undefined) {
    // The record stands and no role reads from it. Repairing that means appending a role binding, which
    // is a role decision — this command does not make one on the way to writing a password.
    io.err(
      `user create: the ground holds a record for ${name} but no readable role binding, and this ` +
        `command will not add one. Nothing was written. \`loam store\` shows what is there.`,
    );
    return 2;
  }
  if (already !== undefined && already !== role) {
    // Changing a role is not this command's business, and doing it quietly on the way to writing a
    // password would be the widest possible side effect of the narrowest possible flag.
    io.err(
      `user create: the ground already binds ${name} to the ${already} role, and you asked for ` +
        `${role} — this command will not change a role. Nothing was written.`,
    );
    return 2;
  }

  // Re-read the file HERE rather than trusting the snapshot from before the prompts, the hash and the
  // boot. Another `user create` may have added an entry in that window, and writing the whole file from
  // a stale copy would drop it.
  let current;
  try {
    current = readCredentials(home);
  } catch (err) {
    io.err(
      `user create: ${credentialsPath(home)} became unreadable while this ran, so nothing was ` +
        `written: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (entryFor(current, name) !== undefined) {
    io.err(
      `user create: ${name} gained a credential while this ran, so no credential was overwritten — ` +
        (known
          ? `and the ground already knew this user, so nothing was appended either.`
          : `but the user deltas above DID land.`) +
        ` Check \`loam store\` before running this again.`,
    );
    return 2;
  }
  writeCredentials(home, { version: 1, users: { ...current.users, [name]: entry } });
  io.out(
    already === undefined
      ? `loam: created ${name} with the ${role} role\n` +
          `  the user and its role binding are deltas in ${path}\n` +
          `  the password hash is local to ${credentialsPath(home)} — it never enters the ground`
      : `loam: set a new password for ${name}, who already holds the ${role} role\n` +
          `  the ground already knew this user, so nothing was appended\n` +
          `  the password hash is local to ${credentialsPath(home)} — it never enters the ground`,
  );
  if (role !== "operator") {
    io.out("  a plain actor may sign in; only the operator role mints a session token today");
  }
  // True of the FILE, and not of a server already holding this store open — say so under the report.
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

// `loam user unlock --all` — the one cure sized to a file somebody else filled. A caller who walks
// names writes a record per name, and those names are theirs to choose, so clearing them one at a time
// is the wrong shape. Nothing here is a lockout: the door delays, and it always admits a correct
// password. This only gives back time.
function cmdUserUnlockAll(home: string, io: IO): number {
  // A RUNNING SERVER CAN RESURRECT WHAT THIS CLEARS. `noteFailure` reads and writes the file in one
  // synchronous block, which settles interleaving inside one process — but this is a separate process,
  // so a rename landing between that read and its write restores the old table after this has printed.
  // The window is microseconds and every other writer here shares the shape; under an ongoing flood
  // the cure is a losing race in any case. Said here because the line below sounds final.
  let cleared;
  try {
    cleared = clearAllRecords(home);
  } catch (err) {
    // A HOME THIS PROCESS CANNOT WRITE, most often. Reported in the command's own words, because the
    // bare errno reads as a bug in loam rather than as a permission on a directory — and because the
    // serving door is in the same position: it cannot grow or clear a count either, so those names go
    // on paying their accumulated wait until the forget window retires them.
    io.err(
      `user unlock --all: ${home} holds login records this command cannot rewrite, so none were ` +
        `cleared: ${err instanceof Error ? err.message : String(err)}. The serving door cannot ` +
        `change them either. Make the home writable, or wait out the forget window.`,
    );
    return 1;
  }
  // AN UNREADABLE FILE IS NOT AN EMPTY ONE, and this is the only command that looks at it. Reporting
  // "no login records" over a directory or a damaged file would be true about what was read and silent
  // about the reason — and the reason matters more than the count here, because a file the door cannot
  // read means no name is being charged at all.
  const unreadable = unreadableRecordFile(home);
  if (cleared === 0 && unreadable !== undefined) {
    io.err(`user unlock --all: ${unreadable}`);
    return 1;
  }
  io.out(
    cleared === 0
      ? `loam: ${home} holds no login records\n  nothing to clear`
      : `loam: cleared ${cleared} login ${cleared === 1 ? "record" : "records"}\n` +
          `  every failure count starts from zero, including a guessing caller's`,
  );
  return 0;
}

function cmdUserUnlock(name: string, home: string, io: IO): number {
  // THE RECORD FILE IS THE AUTHORITY here, and it is read FIRST — before the credential file, which may
  // be absent or damaged. A record outlives its user: erase the deltas, remove the credential entry, and
  // the record — keyed by the user NAME — is still there. The health report promises this command works
  // whether or not the user still exists, so nothing about the credential file may stand in its way.
  let cleared;
  try {
    cleared = clearRecord(home, name);
  } catch (err) {
    io.err(
      `user unlock: ${name} holds a login record this command cannot rewrite, so nothing was ` +
        `cleared: ${err instanceof Error ? err.message : String(err)}. The serving door cannot ` +
        `change it either, so ${name} keeps paying its accumulated wait until the forget window ` +
        `retires it. Make the home writable, or wait it out.`,
    );
    return 1;
  }
  if (cleared !== undefined) {
    // The COUNT and its age, never a wait. The serving door owns the policy that turns a count into a
    // wait, and this process was never told it: naming a count is a fact, naming a wait would be a
    // guess. The age is clamped at zero — a wall clock stepped backwards can leave the stamp ahead of
    // now, and "in 4 minutes" is not a report.
    const seconds = Math.round(Math.max(0, Date.now() - cleared.lastFailureAt) / 1000);
    io.out(
      `loam: cleared ${name}'s login record\n` +
        `  it held ${cleared.failures} failed ` +
        `${cleared.failures === 1 ? "attempt" : "attempts"}, the last one ${seconds}s ago\n` +
        `  the next attempt for ${name} waits for nothing`,
    );
    return 0;
  }
  // No record was found — but "not found" and "could not be read" are different answers, and only one
  // of them means the door is charging nobody. Said before the credential file is consulted, because
  // this fault is about the file this command owns.
  const unreadable = unreadableRecordFile(home);
  if (unreadable !== undefined) {
    io.err(`user unlock: ${unreadable}`);
    return 1;
  }
  let existing;
  try {
    existing = readCredentials(home);
  } catch (err) {
    // There was no record, and the credential file is unreadable, so this cannot tell a typo'd name from
    // a real user. It says which of the two it could not check.
    io.err(
      `user unlock: ${name} holds no login record, and ${credentialsPath(home)} is unreadable so ` +
        `this command cannot say whether that user exists: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (entryFor(existing, name) === undefined) {
    io.err(
      `user unlock: ${home} holds no login record and no user named ${name} — nothing was cleared. ` +
        `\`loam user create ${name}\` makes one.`,
    );
    return 2;
  }
  io.out(`loam: ${name} holds no login record\n  its next attempt already waits for nothing`);
  return 0;
}

// `loam artifact pack` — a THIN HTTP CLIENT of `GET /:mount/artifact/<route>/<entity>`, and nothing
// more. Every refusal and every word of the verdict comes from the door, so a refusal reads identically
// here, over HTTP, and from a direct call. The one shape for every door.
async function cmdArtifact(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("artifact", args);
  if (parsed.positionals[0] !== "pack") {
    io.err(`artifact: unknown subcommand "${parsed.positionals[0] ?? ""}" — pack`);
    return 2;
  }
  const target = parsed.positionals[1];
  if (target === undefined) {
    io.err("artifact pack wants a target: `loam artifact pack <mount>/<route>/<entity>`");
    return 2;
  }
  const parts = target.split("/");
  if (parts.length !== 3 || parts.some((x) => x === "")) {
    io.err(`artifact pack: "${target}" is not <mount>/<route>/<entity>`);
    return 2;
  }
  const connector = parsed.flags.get("connector");
  if (connector === undefined) {
    io.err("artifact pack wants --connector <name>: the display name a page reads through");
    return 2;
  }
  const token = parsed.flags.get("token") ?? process.env["LOAM_TOKEN"];
  if (token === undefined) {
    io.err("artifact pack wants --token (or $LOAM_TOKEN): this door is the operator's");
    return 2;
  }
  const base = (parsed.flags.get("url") ?? "http://127.0.0.1:4321").replace(/\/+$/, "");
  const query = new URLSearchParams({ connector });
  const storeAddress = parsed.flags.get("store-address");
  if (storeAddress !== undefined) query.set("store", storeAddress);
  // A boolean flag lands in `parsed.booleans`, never in `flags` (args.ts) — reading it from the wrong
  // map is silently always-false, which is a refusal the operator cannot acknowledge their way past
  // however many times they type the flag.
  if (parsed.booleans.has("acknowledge-pen")) query.set("acknowledgePen", "1");
  if (parsed.booleans.has("acknowledge-writable")) query.set("acknowledgeWritable", "1");
  const [mount, route, entity] = parts as [string, string, string];
  const url =
    `${base}/${encodeURIComponent(mount)}/artifact/` +
    `${encodeURIComponent(route)}/${encodeURIComponent(entity)}?${query.toString()}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    // The door's own words, unchanged. A CLI that rephrased a refusal would be a second source of
    // truth about what a renderer may be published as.
    let said = text;
    try {
      const body: unknown = JSON.parse(text);
      const errors = (body as { errors?: unknown }).errors;
      if (Array.isArray(errors) && errors.length > 0) said = errors.map(String).join("; ");
    } catch {
      /* not JSON: the body IS the reason */
    }
    io.err(`artifact pack: ${said}`);
    return 2;
  }
  const verdict = JSON.parse(text) as {
    page?: string;
    manifest?: readonly string[];
    capability?: readonly string[];
  };
  const out = parsed.flags.get("out");
  if (out !== undefined) {
    // The PAGE where the door served one, so `--out page.html` is a page rather than a verdict wrapping
    // one; the whole answer otherwise, so nothing is silently dropped.
    const bytes = verdict.page ?? text;
    writeFileSync(out, bytes, "utf8");
    io.out(`loam: wrote ${out} (${bytes.length} bytes)`);
  }
  io.out(`  tools: ${(verdict.manifest ?? []).join(", ")}`);
  for (const line of verdict.capability ?? []) io.out(`  ${line}`);
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
    io.out(topHelp());
    return 0;
  }
  if (command === "--version" || command === "version") {
    io.out(options.version ?? VERSION);
    return 0;
  }
  // Per-command help, answered HERE rather than in each cmd: the top-level help promises it for
  // every command, and one gate keeps a new command from forgetting to make good on that. It lands
  // before any parsing, so `--help` is never mistaken for a flag hungry for a value.
  if (isCommand(command) && rest.some((arg) => arg === "--help" || arg === "-h")) {
    io.out(helpFor(command));
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
      case "repair":
        return await cmdRepair(rest, io);
      case "user":
        return await cmdUser(rest, io, options);
      case "artifact":
        return await cmdArtifact(rest, io);
      default:
        io.err(`loam: unknown command "${command}" — run \`loam --help\``);
        return 2;
    }
  } catch (err) {
    io.err(`loam: ${err instanceof Error ? err.message : String(err)}`);
    // A malformed invocation is 2, like every hand-written refusal above; 1 stays what it always
    // meant — something went wrong inside.
    return err instanceof UsageError ? 2 : 1;
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
