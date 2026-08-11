// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import { parseOffer } from "../federation/offer.js";
import { toWire } from "../federation/wire.js";
import { migrate } from "../migrate/migrate.js";
import { pullFrom } from "../federation/pull.js";
import { tombstonesIn } from "../gateway/erase.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { CTX_GRANTS, grantClaims } from "../gateway/accounts.js";
import {
  parseRegistrationInput,
  schemaEntityFor,
  type RegistrationInput,
} from "../gateway/registration.js";
import { serve, type ServerHandle } from "../server/http.js";
import { revokeConnector } from "../server/oauth.js";
import { grantFor, readOAuthFile, type OAuthGrant } from "../server/oauth-file.js";
import {
  credentialsPath,
  entryFor,
  hashPassword,
  readCredentials,
  writeCredentials,
  type ScryptParams,
} from "../server/credentials.js";
import {
  CTX_ROLE,
  resolveUserView,
  roleClaims,
  rolesOf,
  userClaims,
  userEntity,
  userNameDefect,
  userRoleDefect,
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
import {
  archivePath,
  homeDefect,
  initHome,
  readSeed,
  readUserSeed,
  storePath,
  userSeedPath,
  writeUserSeed,
} from "./config.js";

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
  | "init"
  | "serve"
  | "register"
  | "pull"
  | "migrate"
  | "store"
  | "repair"
  | "artifact"
  | "user"
  | "grant";

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
    flags: new Set([
      "home",
      "store",
      "port",
      "token",
      "http",
      "archive",
      "host",
      "public-url",
      "oauth-allow-redirect",
    ]),
    booleans: new Set(["http"]),
    notes: [
      "A fresh home self-initializes: it mints (or, via LOAM_SEED, imports) an operator identity,",
      "so a container serves with nothing but a token.",
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
  user: {
    summary: "provision a login user and manage role assignments (SPEC §36)",
    usage: "loam user create|assign-role|remove-role <name> [options]",
    flags: new Set(["home", "store", "role", "operator"]),
    booleans: new Set(["operator"]),
    notes: [
      "subcommands:",
      "  create <name> [--operator]        ask for a password twice, write the credential, plant",
      "                                     the user and role deltas; --operator also mints a key",
      "  assign-role <name> --role=<role>  grant a role (operator | actor); operator additionally",
      "                                     mints a signing key and trusts it with a grant",
      "  remove-role <name> --role=<role>  strike a role (and, for operator, its signing grant)",
      "",
      "PROOF OF OPERATORSHIP IS HOME ACCESS, ALONE. Every one of these commands signs with",
      "<home>/operator.seed — the same file `loam init`/`loam serve` read. There is no remote path",
      "that mints or changes a role; a browser session, however privileged, cannot call these.",
      "",
      "RECOVERY. Losing a user's own signing key is not losing the role: run `remove-role <name>",
      "--role=operator` (it strikes the grant too, when the key file can still name it — a fault",
      "reading that file refuses the whole command rather than guessing) then `assign-role <name>",
      "--role=operator` again, which mints a fresh key and files a fresh grant. Even the LAST",
      "operator may remove their own role this way and reassign it — both commands need only home",
      "access, never a live session, so the store is never lockable from a terminal that can read it.",
    ],
  },
  grant: {
    summary: "list or revoke the OAuth connectors this store has granted (SPEC §37)",
    usage: "loam grant list|revoke <client_id> [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  list                  the connectors this store holds — id, name, generation, standing",
      "  revoke <client_id>    bump the connector's generation and strike its write grant",
      "",
      "REVOKE BINDS AT ONCE. Bumping the generation makes every live token and in-flight code stop",
      "matching, so a running server refuses that connector on its next request with no restart. It",
      "also strikes the operator-signed write grant in the ground. It NEVER erases the connector's",
      "past deltas — those keep naming their author and keep resolving. Like every role command, this",
      "signs with <home>/operator.seed and needs only home access, never a live session.",
    ],
  },
};

// One blurb per flag NAME — a name means the same thing in every command that takes it. The LIST a
// command shows comes from its own allowlist, so a flag added there appears in its help whether or
// not anyone wrote it a blurb: an unexplained flag is still printed, never silently omitted.
const FLAG_HELP: Readonly<
  Record<string, { readonly arg: string; readonly note: string; readonly required?: boolean }>
> = {
  home: { arg: "<dir>", note: "the home to work in (default $LOAM_HOME, else .loam)" },
  store: {
    arg: "<file>",
    note: "the store file inside the home (default store.sqlite; an absolute path is used as-is)",
  },
  seed: { arg: "<hex>", note: "import an operator seed instead of minting one ($LOAM_SEED)" },
  port: { arg: "<n>", note: "the port to listen on — 0 for ephemeral (default 4321)" },
  host: {
    arg: "<addr>",
    note: "the address to bind (default 127.0.0.1 — loopback only; 0.0.0.0 opens the LAN)",
  },
  token: { arg: "<secret>", note: "the bearer token for the door ($LOAM_TOKEN)" },
  http: { arg: "", note: "serve over HTTP — the only transport today" },
  archive: {
    arg: "<dir>",
    note: "mirror every delta into a cold store inside the home (an absolute path is used as-is)",
  },
  "public-url": {
    arg: "<url>",
    note: "the outside http(s) address this store is reached at — opens §37 discovery",
  },
  "oauth-allow-redirect": {
    arg: "<origins>",
    note: "comma-separated origins a connector may redirect to — opens §37 registration (needs --public-url)",
  },
  out: { arg: "<file>", note: "write the output here (default stdout)" },
  url: { arg: "<base>", note: "the running gateway to ask (default http://127.0.0.1:4321)" },
  connector: {
    arg: "<name>",
    note: "the connector DISPLAY NAME a published page reads through",
    required: true,
  },
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
  role: { arg: "<role>", note: "operator | actor" },
  operator: { arg: "", note: "give the new user the operator role (default: a plain actor)" },
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
  const rows = [...spec.flags].map((name) => {
    const { arg, note, required } = FLAG_HELP[name] ?? { arg: "<value>", note: "" };
    const shown =
      spec.booleans?.has(name) === true || arg === "" ? `--${name}` : `--${name} ${arg}`;
    return { shown, note: required === true ? `${note} (required)` : note };
  });
  // The column fits the command's longest flag, capped so a very long one wraps its note to the
  // next line rather than stretching every row.
  const width =
    rows.length === 0 ? 18 : Math.min(Math.max(...rows.map((r) => r.shown.length)) + 2, 26);
  const options = rows.map(({ shown, note }) => {
    if (shown.length > width) return `  ${shown}\n${" ".repeat(width + 2)}${note}`.trimEnd();
    return `  ${shown.padEnd(width)}${note}`.trimEnd();
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
  // The login doors (SPEC §36 phase 5) open iff the home holds users, probed AT BOOT — a
  // credentials.json written under a running server waits for the next serve. The Secure-cookie
  // trap is refused before anything opens: the session cookie's `__Host-` prefix requires
  // `Secure`, and a browser discards a Secure cookie from a non-TLS, non-loopback origin — so a
  // LAN bind over plain HTTP would show a login form whose successful POST sets a cookie no
  // browser keeps. An honest refusal beats that silent loop.
  const withUsers = existsSync(credentialsPath(home));
  const hostFlag = parsed.flags.get("host") ?? "127.0.0.1";
  const publicUrlFlag = parsed.flags.get("public-url");
  const allowRedirectFlag = parsed.flags.get("oauth-allow-redirect");
  if (withUsers) {
    const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
    const tls = publicUrlFlag !== undefined && publicUrlFlag.toLowerCase().startsWith("https:");
    if (!loopback.has(hostFlag) && !tls) {
      io.err(
        `serve: this home has users, and the login doors' session cookie needs https to reach a ` +
          `browser — serve behind a TLS terminator and name it with --public-url https://…, or ` +
          `keep the loopback bind`,
      );
      return 2;
    }
  }
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
  let server;
  try {
    server = await serve({
      mounts: { default: gateway },
      tokens: { [token]: { operator: true } },
      port,
      host: hostFlag,
      ...(publicUrlFlag === undefined ? {} : { publicUrl: publicUrlFlag }),
      // Connector registration (SPEC §37 phase 13), opt-in: absent, POST /oauth/register resolves
      // as an unrouted path. serve() refuses this beside no --public-url, and boot-validates each
      // origin. The door's own fault channel is this log line — its detail names the home's path
      // and must never reach an unauthenticated caller.
      ...(allowRedirectFlag === undefined
        ? {}
        : {
            connectors: {
              home,
              allowRedirectOrigins: allowRedirectFlag
                .split(",")
                .map((o) => o.trim())
                .filter((o) => o.length > 0),
              onFault: (message: string) => io.err(`loam: ${message}`),
            },
          }),
      // A local fault the CALLER must never read (it names paths and other users) still has to
      // reach the operator; the door's own channel is this log line.
      ...(withUsers
        ? {
            users: {
              home,
              mount: "default",
              ...(publicUrlFlag === undefined ? {} : { publicUrl: publicUrlFlag }),
              onFault: (message: string) => io.err(`loam: ${message}`),
            },
          }
        : {}),
    });
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  recordServing(home, server.url, path);
  io.out(
    `loam: serving ${path} at ${server.url}/default${vault === undefined ? "" : `\n  archive ${vault}`}` +
      (withUsers ? `\n  login at ${publicUrlFlag ?? server.url}/login` : ""),
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
  // A rotten delta rots on EVERY pull — reconstruction fails on the peer's bytes, not on timing —
  // so this is the operator's only cue to get the peer a fresh export. Never silent (H7).
  if (report.unreconstructable > 0) {
    io.err(
      `loam: ${report.unreconstructable} of the offered deltas would not reconstruct and were ` +
        `dropped — the peer's offer is damaged; pulling again will drop the same ones until the ` +
        `peer repairs it`,
    );
  }
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
  // The home is only a DIRECTION to the store file: an explicit --store override never opens
  // config.json (relative values still resolve inside the home; absolute values need no home at
  // all), and an existing read-only home is fine for a command that only reads config. The refusal
  // is reserved for the one cure-naming shape the paper-cut is about: a home that cannot supply
  // config.json at all.
  let path: string;
  try {
    path = storePath(home, parsed.flags.get("store"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
      io.err(
        `store: ${home} is not a usable loam home — \`loam init --home ${home}\` or ` +
          "`loam user create` makes one",
      );
      return 1;
    }
    throw err;
  }
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

// `loam user` (SPEC §36 phase 3, T124): the bootstrap door for a person, and the role commands.
// Home access is the proof of operatorship — the same authority erasure and repair need — so
// there is no remote way in. See the working spec (.adlc/specs/36-03-*.md) for the full model;
// comments here name only what would bite a future reader of THIS file.
async function cmdUser(args: readonly string[], io: IO, options: RunOptions): Promise<number> {
  const parsed = parseFor("user", args);
  const sub = parsed.positionals[0];
  if (sub !== "create" && sub !== "assign-role" && sub !== "remove-role") {
    io.err(
      "user wants a subcommand: `loam user create <name> [--operator]`, " +
        "`loam user assign-role <name> --role=<role>`, or `loam user remove-role <name> --role=<role>`",
    );
    return 2;
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
  // Checked before ANY path is built from `name` — a name is a single path component (no `/`),
  // never a traversal, whether it reaches a credential entry key or a seed file name.
  const nameDefect = userNameDefect(name);
  if (nameDefect !== undefined) {
    io.err(`user ${sub}: ${nameDefect}`);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  if (sub === "create") return cmdUserCreate(name, parsed, home, io, options);
  return cmdUserRole(name, parsed, home, io, sub === "assign-role" ? "assign" : "remove");
}

async function cmdUserCreate(
  name: string,
  parsed: Parsed,
  home: string,
  io: IO,
  options: RunOptions,
): Promise<number> {
  if (parsed.flags.has("operator")) {
    io.err("user create: --operator takes no value (write --operator, not --operator=...)");
    return 2;
  }
  const role: UserRole = parsed.booleans.has("operator") ? "operator" : "actor";

  const unusable = homeDefect(home, { allowMissing: true });
  if (unusable !== undefined) {
    io.err(`user create: ${unusable}`);
    return 1;
  }
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);

  // The credential-existence check runs BEFORE prompting: an existing credential means this name
  // is fully provisioned already, and there is nothing a password prompt could accomplish.
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
  const credentialAlreadyPresent = entryFor(existing, name) !== undefined;
  if (credentialAlreadyPresent) {
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
  const operator = authorForSeed(seed);
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  let known: boolean;
  let already: ReadonlySet<UserRole>;
  let mintedKey: string | undefined; // set only when this call just appended a fresh operator grant
  try {
    // ASK THE GROUND, not only the credential file — the two halves of a user can come apart (a
    // credential removed by hand, or a write that failed after the deltas landed), and appending a
    // SECOND user record for the same name is the shape that outlives that: `pickLatest` would
    // resolve whichever record won, silently.
    known = resolveUserView(gateway.reactor, gateway.operator, name) !== undefined;
    already = known ? rolesOf(gateway.reactor, gateway.operator, name) : new Set<UserRole>();
    if (!known) {
      const at = Date.now();
      const deltas: Delta[] = [
        signClaims(userClaims(name, operator, at), seed),
        signClaims(roleClaims(name, role, operator, at + 1), seed),
      ];
      if (role === "operator") {
        mintedKey = randomBytes(32).toString("hex");
        const subject = authorForSeed(mintedKey);
        deltas.push(
          signClaims(grantClaims(STORE_ENTITY, subject, "admin", operator, at + 2), seed),
        );
      }
      await gateway.append(deltas);
    }
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  await gateway.close();

  if (known && already.size === 0) {
    // The record stands and no role reads from it. Repairing that means appending a role binding,
    // which is a role decision — this command does not make one on the way to writing a password.
    io.err(
      `user create: the ground holds a record for ${name} but no readable role, and this ` +
        `command will not add one. Nothing was written. \`loam store\` shows what is there.`,
    );
    return 2;
  }
  if (known && !already.has(role)) {
    io.err(
      `user create: the ground already binds ${name} to ${[...already].join(", ")}, and you asked ` +
        `for ${role} — this command will not change a role. Nothing was written.`,
    );
    return 2;
  }
  // Past this point either a fresh user just landed (mintedKey set iff role is operator), or this
  // is a REPAIR run: the ground already matches what was asked, and only the credential (never
  // seen above, by the check at the top) — and, for operator, possibly the seed file too — is
  // outstanding. `mintedKey` covers the fresh case; repair checks the seed file's own presence.
  if (known && role === "operator") {
    const seedRead = readUserSeed(home, name);
    if (seedRead.kind !== "present") {
      // Writing the credential here would report success while ${name} still cannot sign
      // anything — the same lost-key shape the role commands already name a recovery for.
      io.err(
        `user create: the ground already binds ${name} to operator, but ${userSeedPath(home, name)} ` +
          (seedRead.kind === "absent" ? "is missing" : `is unreadable (${seedRead.detail})`) +
          ` — writing only a credential would leave ${name} unable to sign anything. Nothing was ` +
          `written. Recover with \`loam user remove-role ${name} --role=operator\` then ` +
          `\`loam user assign-role ${name} --role=operator\` once the fault clears.`,
      );
      return 1;
    }
  }

  // The seed file lands BEFORE the credential (§36.3.1.3): if the credential write then fails, a
  // re-run's repair path above finds the seed already present and only has the credential left to
  // write. The other order would strand a fresh operator forever behind the top-of-command
  // "credential already exists" refusal, with no seed file ever written.
  if (mintedKey !== undefined) {
    try {
      writeUserSeed(home, name, mintedKey);
    } catch (err) {
      io.err(
        `user create: ${name} now holds operator in the ground, but writing ` +
          `${userSeedPath(home, name)} failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `The grant is live with no local key to use it yet — retry this command once the fault ` +
          `clears, or recover with \`loam user remove-role ${name} --role=operator\` then ` +
          `\`loam user assign-role ${name} --role=operator\`.`,
      );
      return 1;
    }
  }

  // Re-read the file HERE rather than trusting the snapshot from before the prompts, the hash and
  // the boot — another `user create` may have added an entry in that window.
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
        `but the deltas above DID land. Check \`loam store\` before running this again.`,
    );
    return 2;
  }
  writeCredentials(home, { version: 1, users: { ...current.users, [name]: entry } });
  io.out(
    known
      ? `loam: repaired ${name}'s credential — the ground already held the ${role} role\n` +
          `  the password hash is local to ${credentialsPath(home)} — it never enters the ground`
      : `loam: created ${name} with the ${role} role\n` +
          `  the user and role deltas are in ${path}` +
          (mintedKey !== undefined
            ? `, with a grant trusting the fresh key at ${userSeedPath(home, name)}`
            : "") +
          `\n  the password hash is local to ${credentialsPath(home)} — it never enters the ground`,
  );
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

// The surviving (non-negated-by-the-operator) claims at `entity`/`context` matching `matches` — the
// primitive this file's role commands need and `rolesOf` does not expose: WHICH deltas to strike,
// not just what a reader resolves. Single-level survival (does an OPERATOR-authored negation target
// this id), matching the trust the substrate's own `mask: {trust: ...}` already applies when
// resolving a role or a grant — this file does not re-derive a deeper chain.
function survivingClaimIds(
  reactor: Reactor,
  operator: string,
  entity: string,
  context: string,
  matches: (delta: Delta) => boolean,
): string[] {
  const out: string[] = [];
  for (const id of reactor.byTarget(entity)) {
    const delta = reactor.get(id);
    if (delta === undefined) continue;
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === entity &&
        p.target.entity.context === context,
    );
    if (!filedHere || !matches(delta)) continue;
    const struck = reactor
      .negationsOf(id)
      .some((negId) => reactor.get(negId)?.claims.author === operator);
    if (!struck) out.push(id);
  }
  return out;
}

const survivingRoleClaimIds = (
  reactor: Reactor,
  operator: string,
  name: string,
  role: UserRole,
): string[] =>
  survivingClaimIds(reactor, operator, userEntity(name), CTX_ROLE, (delta) =>
    delta.claims.pointers.some(
      (p) => p.role === "role" && p.target.kind === "primitive" && p.target.value === role,
    ),
  );

// Every SURVIVING grant this store's own seed authored for `subject` — the CURRENT holder of a
// name's seed file, never a historical one (the working spec's §36.3.1.7 names that residual).
const survivingGrantClaimIds = (reactor: Reactor, operator: string, subject: string): string[] =>
  survivingClaimIds(
    reactor,
    operator,
    STORE_ENTITY,
    CTX_GRANTS,
    (delta) =>
      delta.claims.author === operator &&
      delta.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      ),
  );

async function cmdUserRole(
  name: string,
  parsed: Parsed,
  home: string,
  io: IO,
  mode: "assign" | "remove",
): Promise<number> {
  const label = mode === "assign" ? "assign-role" : "remove-role";
  const roleArg = parsed.flags.get("role");
  if (roleArg === undefined) {
    io.err(`user ${label}: wants --role=<role>`);
    return 2;
  }
  const roleDefect = userRoleDefect(roleArg);
  if (roleDefect !== undefined) {
    io.err(`user ${label}: ${roleDefect}`);
    return 2;
  }
  const role = roleArg as UserRole;

  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`user ${label}: ${unusable}`);
    return 1;
  }
  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `user ${label}: ${home} has no operator identity yet — \`loam init\` or ` +
        `\`loam user create\` makes one: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  try {
    const known = resolveUserView(gateway.reactor, gateway.operator, name) !== undefined;
    if (!known) {
      io.err(
        `user ${label}: ${home}'s ground does not know ${name} — \`loam user create ${name}\` makes one`,
      );
      return 2;
    }
    const held = rolesOf(gateway.reactor, gateway.operator, name);

    if (mode === "assign") {
      if (held.has(role)) {
        io.err(`user assign-role: ${name} already holds ${role} — nothing was appended`);
        return 2;
      }
      const at = Date.now();
      const deltas: Delta[] = [signClaims(roleClaims(name, role, operator, at), seed)];
      let mintedKey: string | undefined;
      if (role === "operator") {
        mintedKey = randomBytes(32).toString("hex");
        const subject = authorForSeed(mintedKey);
        deltas.push(
          signClaims(grantClaims(STORE_ENTITY, subject, "admin", operator, at + 1), seed),
        );
      }
      try {
        await gateway.append(deltas);
      } catch (err) {
        io.err(
          `user assign-role: the ground refused this — nothing was appended: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return 1;
      }
      if (mintedKey !== undefined) {
        try {
          writeUserSeed(home, name, mintedKey);
        } catch (err) {
          io.err(
            `user assign-role: ${name} now holds operator in the ground, but writing ` +
              `${userSeedPath(home, name)} failed: ${err instanceof Error ? err.message : String(err)}. ` +
              `The grant is live with no local key to use it — recover with \`loam user ` +
              `remove-role ${name} --role=operator\` then \`loam user assign-role ${name} ` +
              `--role=operator\` again once the fault clears.`,
          );
          return 1;
        }
      }
      io.out(
        `loam: ${name} now holds ${role}\n` +
          (mintedKey !== undefined
            ? `  a fresh signing key was minted at ${userSeedPath(home, name)}\n` +
              `  the role binding and its grant are deltas in ${path}`
            : `  the role binding is a delta in ${path}`),
      );
      return 0;
    }

    // mode === "remove"
    if (!held.has(role)) {
      io.out(`loam: ${name} does not hold ${role} — nothing was appended`);
      return 0;
    }
    let grantIds: string[] = [];
    let grantNote = "";
    if (role === "operator") {
      const seedRead = readUserSeed(home, name);
      if (seedRead.kind === "unreadable") {
        // "Cannot determine" must never read as "safe to proceed" (H9): the file may still be
        // legible to someone else, so this refuses the WHOLE command rather than striking the
        // role alone and reporting a partial success as if it were a complete one.
        io.err(
          `user remove-role: ${userSeedPath(home, name)} could not be read ` +
            `(${seedRead.detail}) — this command will not guess whether that key is still live, ` +
            `so nothing was struck. Fix the fault and retry.`,
        );
        return 1;
      }
      if (seedRead.kind === "present") {
        const subject = authorForSeed(seedRead.seed);
        grantIds = survivingGrantClaimIds(gateway.reactor, operator, subject);
      } else {
        grantNote =
          ` (its signing grant could not be located — ${userSeedPath(home, name)} is missing — ` +
          `and stays live; it is inert unless someone still holds that lost key)`;
      }
    }
    const roleIds = survivingRoleClaimIds(gateway.reactor, operator, name, role);
    const at = Date.now();
    const targets = [...roleIds, ...grantIds];
    const negations = targets.map((id, i) =>
      signClaims(makeNegationClaims(operator, at + i, id), seed),
    );
    try {
      await gateway.append(negations);
    } catch (err) {
      io.err(
        `user remove-role: the ground refused this — nothing was appended: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
    io.out(`loam: ${name} no longer holds ${role}${grantNote}`);
    return 0;
  } finally {
    await gateway.close();
  }
}

async function cmdGrant(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("grant", args);
  const sub = parsed.positionals[0];
  if (sub !== "list" && sub !== "revoke") {
    io.err("grant wants a subcommand: `loam grant list` or `loam grant revoke <client_id>`");
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`grant ${sub}: ${unusable}`);
    return 1;
  }
  if (sub === "list") return cmdGrantList(home, io);

  const clientId = parsed.positionals[1];
  if (clientId === undefined) {
    io.err("grant revoke wants a client id: `loam grant revoke <client_id>`");
    return 2;
  }
  if (parsed.positionals.length > 2) {
    io.err("grant revoke takes exactly one client id");
    return 2;
  }
  return cmdGrantRevoke(clientId, parsed, home, io);
}

function cmdGrantList(home: string, io: IO): number {
  let file;
  try {
    file = readOAuthFile(home);
  } catch (err) {
    io.err(
      `grant list: ${home}'s connector records are unreadable, so this will not guess what is ` +
        `granted: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (file.clients.length === 0) {
    io.out("loam: this store has granted no connectors");
    return 0;
  }
  io.out(`loam: ${file.clients.length} connector${file.clients.length === 1 ? "" : "s"}`);
  for (const client of file.clients) {
    const grant = grantFor(file, client.clientId);
    const tokens = file.tokens.filter((t) => t.clientId === client.clientId).length;
    // The standing line is the honest one: a client with no grant has registered but never
    // completed a token exchange, so it can act nowhere yet.
    const standing =
      grant === undefined
        ? "no grant yet"
        : grant.standing
          ? `acts as ${grant.actor}`
          : "grant pending";
    io.out(
      `  ${client.clientId}  ${client.clientName}\n` +
        `    generation ${client.generation} · ${standing} · ${tokens} live token${tokens === 1 ? "" : "s"}`,
    );
  }
  return 0;
}

async function cmdGrantRevoke(
  clientId: string,
  parsed: Parsed,
  home: string,
  io: IO,
): Promise<number> {
  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `grant revoke: ${home} has no operator identity — \`loam init\` makes one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  try {
    // Strike every SURVIVING write grant this store's seed signed for the connector's actor. This is
    // cleanup after the file's generation bump, which is what actually kills the connector's tokens.
    const strike = async (grant: OAuthGrant): Promise<void> => {
      const ids = survivingGrantClaimIds(gateway.reactor, operator, grant.actor);
      if (ids.length === 0) return;
      const at = Date.now();
      await gateway.append(
        ids.map((id, i) => signClaims(makeNegationClaims(operator, at + i, id), seed)),
      );
    };
    const outcome = await revokeConnector(home, clientId, strike, (m) => io.err(`loam: ${m}`));
    switch (outcome.kind) {
      case "no-such-client":
        io.err(`grant revoke: this store holds no connector ${clientId} — \`loam grant list\``);
        return 2;
      case "locked":
        io.err(
          `grant revoke: this store's connector records are locked by another process, so ` +
            `nothing was revoked. Retry once it is idle.`,
        );
        return 1;
      case "unreadable":
        io.err(
          `grant revoke: this store's connector records are unreadable, so nothing was revoked.`,
        );
        return 1;
      case "revoked":
        io.out(
          `loam: revoked ${clientId}\n` +
            `  its tokens and codes no longer match (generation ${outcome.generation}), and its ` +
            `write grant is struck in ${path}\n` +
            `  its past deltas are untouched — they keep naming their author`,
        );
        return 0;
    }
  } finally {
    await gateway.close();
  }
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
      case "artifact":
        return await cmdArtifact(rest, io);
      case "user":
        return await cmdUser(rest, io, options);
      case "grant":
        return await cmdGrant(rest, io);
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
