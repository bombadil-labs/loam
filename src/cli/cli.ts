// The `loam` command: argument routing, help, version — every subcommand shipped. Deliberately
// a tiny hand-rolled parser (see args.ts): the surface is a handful of subcommands, and a
// framework would be the heaviest dependency in the package.
//
// `run` returns a numeric exit code, EXCEPT `serve --http` with { detach }, which returns the
// live ServerHandle so a caller (a test, or a supervisor) can drive and close it. The default
// `serve` blocks until the process is signalled.

import { randomBytes } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  type Dirent,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { Gateway, type FederationReport } from "../gateway/gateway.js";
import type { PublishOutcome } from "../gateway/lifecycle.js";
import { parseOffer } from "../federation/offer.js";
import { toWire } from "../federation/wire.js";
import { migrate } from "../migrate/migrate.js";
import { pullFrom } from "../federation/pull.js";
import { sourceFor } from "../federation/channel.js";
import {
  ERASURE_NON_CLAIMS,
  erasureStanding,
  erasureStandings,
  type ErasureStanding,
  type StandingReport,
  ESM_RESIDENCY_DISCLOSURE,
  readGrounds,
  revivedAcross,
  type ExtraReading,
  type Revival,
  type ReadingAt,
  type RevivalReport,
  receiptLedger,
  survivingTombstones,
  tombstonesIn,
  tombstoneTarget,
  UNSWEPT_AUTH_SURFACES,
  type TombstoneReceipt,
} from "../gateway/erase.js";
import type { SlateReport } from "../gateway/slate.js";
import { programMaskJson } from "../gateway/listing.js";
import { unreachableStoreReport } from "../gateway/container.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import {
  constitutionalDefect,
  CTX_GRANTS,
  grantClaims,
  grantsHeldBy,
  honoredStrikeOn,
} from "../gateway/accounts.js";
import {
  lensNameFor,
  lensOf,
  parseRegistrationInput,
  programOf,
  readRegistrations,
  schemaEntityFor,
  type Registration,
  type RegistrationInput,
} from "../gateway/registration.js";
import { STOCK_SCHEMAS, stockNames, stockSchema } from "../stock/index.js";
import { divergenceOf, entryLensName, installOrder, stockIdentityOf } from "../stock/graph.js";
import { CTX_PEN, penEntity, penRecordClaims } from "../gateway/renderers.js";
import { serve, type ServerHandle } from "../server/http.js";
import { revokeConnector } from "../server/oauth.js";
import {
  grantFor,
  readOAuthFile,
  revocationsFor,
  type OAuthFile,
  type OAuthGrant,
} from "../server/oauth-file.js";
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
  userHyperSchema,
  userRoleDefect,
  type UserRole,
} from "../server/users.js";
import { promptSecret } from "./prompt.js";
import type { StoreBackend } from "../store/backend.js";
import { ArchiveBackend } from "../store/archive.js";
import { MirrorBackend } from "../store/mirror.js";
import { SqliteBackend } from "../store/sqlite.js";
import { legibilityWarnings, reAdmit } from "../gateway/repair.js";
import { isRepairable, strandedStrikeWarnings } from "../store/quarantine.js";
import { parseArgs, rejectUnknown, UsageError, type Parsed } from "./args.js";
import {
  archivePath,
  homeDefect,
  initHome,
  isSeedHex,
  penSeedPath,
  readPenSeed,
  readPenSeeds,
  readSeed,
  readUserSeed,
  storePath,
  userSeedPath,
  readChannelToken,
  writeChannelToken,
  writePenSeed,
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

const VERSION = "0.3.0";

type CommandName =
  | "init"
  | "serve"
  | "register"
  | "pull"
  | "federate"
  | "migrate"
  | "store"
  | "repair"
  | "artifact"
  | "user"
  | "pen"
  | "grant"
  | "slate"
  | "erase"
  | "tombstones";

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
    usage: "loam register <schema.json> | --stock <name> [options]",
    flags: new Set(["home", "store", "stock"]),
    notes: [
      "The file: { hyperschema: { name, alg?, body }, schema, roots, entity?, mutations?, writable? }",
      "— the same object POST /:mount/register and the MCP loam_register tool take. The store is",
      "single-writer, so register before serving (a running server takes the same body over HTTP).",
      "",
      "--stock registers a shipped shape instead, so day one needs no hand-written gather term:",
      ...STOCK_SCHEMAS.map((s) => `  ${s.name.padEnd(8)}${s.summary}`),
      "It is an ordinary registration through the ordinary door — the very object you could have",
      "typed. So it is ungoverned in both directions, as every hand-written example is: any",
      "negation binds, whoever signed it, AND the gather names no author, so any peer's claim binds",
      "too. Single-value props are latest-wins — a peer's later timestamp takes the field and",
      "keeps it — and the list props (tags, attending, follows) hold every author's entries, which",
      "no later claim of yours displaces. A trust mask alone answers only the strikes — a store",
      "that federates wants `authoredBy` in its gather, or `byAuthorRank` in its schema. Outgrow",
      "the shelf and write one.",
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
  federate: {
    summary: "open, list, adjust, and sever federation channels (SPEC §46)",
    usage: "loam federate <open|list|set|bless-app|drop> [options]",
    flags: new Set([
      "home",
      "store",
      "token",
      "into",
      "prefix",
      "from",
      "bless",
      "receiving",
      "channel",
      "route",
      "resolvers",
      "expect",
      "pen",
      "supersede",
      "yes",
    ]),
    // `--yes` is a bare confirmation, not a value. Without this the parser demanded a value and
    // `federate drop --channel X --yes` could not be typed correctly by anyone.
    // `--pen` is the same shape: §6's second key for an app that can WRITE, asked as a word. So is
    // `--supersede`: moving a mounted route to the peer's newer code is a decision, not a default.
    booleans: new Set(["yes", "pen", "supersede"]),
    notes: [
      "Federation is container-to-container. `open` names the container you receive INTO and the",
      "PREFIX you assign the peer — the prefix is yours, never theirs, so no peer can take a name",
      "you serve. Law that arrives binds under that prefix; your own names are untouched.",
      "",
      "Each verb takes only its own flags and refuses the rest rather than dropping them:",
      "  open      --from --into --prefix --token --bless",
      "  list      (nothing beyond --home/--store)",
      "  set       --channel --receiving --bless",
      "  bless-app --channel, then EITHER --route (with --expect/--pen/--supersede)",
      "            OR --resolvers, which takes neither of those",
      "  drop      --channel --yes",
      "`--bless` and `--receiving` take exactly `true` or `false`. Any other spelling is refused,",
      "never read as `true`.",
      "",
      "  loam federate open --from https://peer.example/default --into friends --prefix alice",
      "  loam federate list",
      "  loam federate set --channel channel:friends:alice --bless false",
      "  loam federate bless-app --channel channel:friends:alice --route hello",
      "  loam federate bless-app --channel channel:friends:alice --resolvers alice:Plant",
      "  loam federate drop --channel channel:friends:alice --yes",
      "",
      "`set` is reversible: --receiving false freezes the channel and keeps what arrived,",
      "--bless false stops new law binding and leaves bound law serving. `drop` is NOT reversible:",
      "it purges that peer's pool at the bytes and needs --yes.",
      "",
      "A peer's RESOLVER code never runs on its own either. A registration whose fields are computed",
      "binds with those resolvers WITHHELD: the fields refuse and say so, and `bless-app --resolvers",
      "<lens>` is what lets that code run. Binding a name and running code are two decisions.",
      "",
      "An APP a peer sends never runs on its own. It arrives inert, `list` names it, and",
      "`bless-app` mounts that one route — the toggles above govern NAMES, never code that runs.",
      "A mounted app runs on the channel's own pool behind the probation frame, its writes stay",
      "there, and it answers the token door only. Dropping the channel takes it away. Add --pen for",
      "an app that writes: its pen must also be provisioned and granted, which is a separate act",
      "(SPEC §6, §24.7). When a peer ships new code at a route you mounted, `list` says so and",
      "--supersede is what moves the route onto it. Pass --expect <the id `list` prints> to refuse",
      "if the peer changed the app between the listing and the blessing.",
      "",
      "WHAT MOUNTING DOES NOT BOUND. The pool bounds what a peer's app may WRITE to your store. It",
      "does not bound what that code may REACH: a bundle can open a socket or read the filesystem of",
      "the machine you run this on. And only the app's RENDER runs in a worker with a time and memory",
      "limit — its module body is evaluated on the serving thread, when you bless it and again the",
      "first time a process is asked for it, with no such limit. Mount a peer's app the way you would",
      "run their program (SPEC §24.5, an open flag).",
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
  pen: {
    summary: "provision a renderer pen: mint its seed, grant it write standing (SPEC §23.3)",
    usage: "loam pen create <name> [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  create <name>    mint a signing seed at <home>/pen.<name>.seed (0600) and plant an",
      "                    operator-signed write grant for its author in the store",
      "",
      'A write-enabled renderer binding names a pen (`pen: "<name>"`), and the pen needs BOTH keys',
      "(§6): the seed file is CUSTODY — `loam serve` reads every pen.<name>.seed at boot and signs",
      "that pen's form writes with it — and the grant is AUTHORIZATION. This command provides both.",
      "The seed never enters the ground and is never printed; revocation is striking the grant",
      "(past writes stay attributed to the pen). Like every role command, this signs with",
      "<home>/operator.seed and needs only home access, never a live session.",
    ],
  },
  grant: {
    summary: "read the ledger of every author with standing; grant and revoke (SPEC §37)",
    usage: "loam grant list|revoke <client_id> | <client_id> --verb=<verb> [options]",
    flags: new Set(["home", "store", "verb", "prefix"]),
    notes: [
      "subcommands:",
      "  list                  every author with standing — users, pens, connectors, and any key",
      "                        this home cannot name; struck grants shown struck, never omitted",
      "  revoke <client_id>    bump the connector's generation and strike its write grant",
      "  <client_id> --verb=register --prefix=<p>",
      "                        let the connector register schemas whose name starts with <p>",
      "",
      "REGISTER STANDING IS SCOPED AND THE SCOPE IS MANDATORY. `--prefix` fences the connector to",
      "one entity namespace: a connector granted `thread:` may register `thread:groove` and refuses",
      "everything else, root included. The prefix is a literal prefix of the schema name — it is not",
      "case-folded, not percent-decoded, and not normalized. Registration at the root stays the",
      "operator's and no grant can hand it out. The store still signs every registration itself; the",
      "grant delegates the authority to ask, never a signing key.",
      "",
      "REVOKE BINDS AT ONCE. Bumping the generation makes every live token and in-flight code stop",
      "matching, so a running server refuses that connector on its next request with no restart. It",
      "also strikes the operator-signed write grant in the ground. It NEVER erases the connector's",
      "past deltas — those keep naming their author and keep resolving. Like every role command, this",
      "signs with <home>/operator.seed and needs only home access, never a live session.",
    ],
  },
  slate: {
    summary: "read the erasure slates staged over this store (SPEC §29)",
    usage: "loam slate list [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  list    every standing slate: who asked, when, the deadline, and the frozen condemned set",
      "",
      "A SLATE IS A PROMISE WITH A CLOCK. It names a condemned set, freezes it at one content",
      "address so it cannot grow after identification, and closes the doors its record declares.",
      "This verb READS that record. It stages nothing and destroys nothing.",
      "",
      "THE DEADLINE IS READ AT THIS MOMENT. A lapsed slate does not expire, it TIGHTENS: `read`",
      "closes too, and the block says so. And what a slate DECLARES is not always what it enforces",
      "— every closure is seeded from the member set, so a slate whose condemned set cannot be read",
      "enforces nothing. That is printed rather than implied.",
    ],
  },
  erase: {
    summary: "forget one delta at the bytes, on every tier, and leave a receipt (SPEC §11)",
    usage: 'loam erase <deltaId> --reason "<why>"',
    flags: new Set(["home", "store", "archive", "reason"]),
    notes: [
      "ERASURE IS THE INSTANCE OPERATOR'S ALONE, and running this in a home that holds",
      "operator.seed IS that authority. A data subject asks; the operator, as the controller,",
      "executes. There is no remote path — no session, however privileged, can reach this verb.",
      "",
      "--reason IS REQUIRED and has no default. The receipt is the only thing that survives the",
      "record it forgets, and a receipt that cannot say why is a receipt made less honest.",
      "",
      "WHAT IT DOES. It lands the operator-signed tombstone, purges the delta from this store, from",
      "the archive when one is named, and from every attached channel pool — then asks the BYTES,",
      "tier by tier, whether they are gone. A tier that cannot be asked has proven nothing, so the",
      "command FAILS rather than reporting a completeness it never verified. Re-running after a",
      "fault is safe and mints no second receipt.",
      "",
      "WHAT IT DOES NOT DO. It forgets ONE delta; destroying a whole identified set is a slate and",
      "its cut (§29). It purges DELTAS, so the home's own files stay — and it says which, every run.",
      "It is instance-level: it clears your ground and bars the id at your door, and it does not",
      "reach a peer who already pulled the delta.",
      "",
      "AN ARCHIVE NAMED ONLY ON `loam serve --archive` IS NOT IN THIS HOME'S CONFIG. Name it here",
      "too, or the vault keeps the bytes this command reports gone. --archive MAY BE GIVEN MORE",
      "THAN ONCE, and every value is swept alongside the one config.json names — a home can hold",
      "more than one cold tier, and naming one is not naming the others. (`loam serve` takes a",
      "single --archive and opens one mirror; this sweeps every tier it can be told about.)",
    ],
  },
  tombstones: {
    summary: "read the receipts: which ids this store forgot, for whom, and why (SPEC §11)",
    usage: "loam tombstones list | show <id> [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  list          every receipt this ground still stands behind, oldest first",
      "  show <id>     one receipt in full — by its own address, or by the id it erased",
      "",
      "A RECEIPT REMEMBERS THAT, NEVER WHAT. A tombstone holds the erased id, the author it was",
      "spoken by, the moment, and the reason the operator gave. It holds none of the content, and",
      "retaining a content address retains zero content — which is what makes keeping it honest.",
      "",
      "A STRUCK RECEIPT IS FORGIVENESS (§11): the erasure order is withdrawn and the id may return,",
      "so the receipt leaves this listing. It is never dropped silently — the count of receipts that",
      "no longer bind is disclosed, because an omission and a revocation look identical otherwise.",
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
  stock: {
    arg: "<name>",
    note: "register a shipped shape instead of a file — the shelf is listed below",
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
  reason: {
    arg: "<text>",
    note: "why this record is being forgotten — the sentence the receipt keeps",
    required: true,
  },
  role: { arg: "<role>", note: "operator | actor" },
  operator: { arg: "", note: "give the new user the operator role (default: a plain actor)" },
};

function topHelp(): string {
  const names = Object.keys(COMMANDS) as CommandName[];
  // The column fits the longest command NAME rather than a fixed ten: a name exactly as wide as the
  // pad would butt straight against its summary, which is the same defect `helpFor` already fixed
  // one level down.
  const width = Math.max(...names.map((n) => n.length)) + 2;
  const commands = names.map((name) => `  ${name.padEnd(width)}${COMMANDS[name].summary}`);
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

// A federation channel's pool needs DURABLE bytes: a separate container defaults to memory, and a
// channel that forgets its peer on restart is not federation (T189). One sqlite file per pool,
// inside the home.
//
// THE FILENAME MUST BE INJECTIVE, and folding unsafe characters to "_" is not. `channel:team a:alice`
// and `channel:team_a:alice` are distinct containers that both folded to `channel_team_a_alice`, so
// two channels shared one file — and `drop()` enumerates a store's whole contents, so severing one
// would have purged the bystander's bytes while the CLI printed "other channels are untouched".
// That is the over-purge direction, which has no recovery.
//
// So the name carries a hash of the FULL pool name. The readable slug is kept for a human reading
// `ls`, but identity lives in the digest, where the folding cannot reach it.
export function channelBackendFor(home: string, io: IO): (pool: string) => SqliteBackend {
  return (pool: string) => {
    const dir = join(home, "channels");
    mkdirSync(dir, { recursive: true });
    const slug = pool.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
    const digest = createHash("sha256").update(pool, "utf8").digest("hex").slice(0, 16);
    return openStore(join(dir, `${slug}--${digest}.sqlite`), io);
  };
}

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

  // Provisioned renderer pens (SPEC §23.3, T102): every `pen.<name>.seed` in the home, read at
  // boot — the same moment users and credentials are read — and fed to `GatewayOptions.pens` so a
  // write-enabled renderer's form POSTs have a key to sign with. A pen file that exists but cannot
  // provision is a FAULT on the operator's log, never a silent skip: silence here resurfaces as a
  // 403 on the first form submit, the exact puzzle the seed-file convention exists to end.
  const { pens, faults: penFaults } = readPenSeeds(home);
  for (const fault of penFaults) io.err(`loam: ${fault}`);

  // Boot the store from its genesis (idempotent): a fresh store is born governed; an existing
  // one simply re-lands the same operator identity.
  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }), {
    pens,
    // The serving process must reach a channel's pool that another process opened, or a bound
    // federated lens resolves over an empty ground and answers null (T189).
    channelBackend: channelBackendFor(home, io),
    // The other half of a persisted channel: the address rides its record, the credential lives
    // here (T196). A channel whose token is missing is not rebuilt, and says so rather than
    // sitting in the list reporting `receiving`.
    channelToken: (c) => {
      const held = readChannelToken(home, c);
      return held.kind === "present" ? held.seed : undefined;
    },
  });
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
      (withUsers ? `\n  login at ${publicUrlFlag ?? server.url}/login` : "") +
      // Name the provisioned pens so "is my pen provisioned" is answered at boot, not by a 403.
      (Object.keys(pens).length === 0 ? "" : `\n  pens ${Object.keys(pens).sort().join(", ")}`),
  );

  // THE STANDING INSTRUCTION (§46 story S7, T196). Channels were rebuilt at boot from their records
  // and the home's credentials; this is what makes them pull. Without it a restarted store keeps its
  // data, resumes nothing, and goes on reporting `receiving` — the report outliving the behaviour.
  //
  // Started only when there is something to poll, so a store with no channels arms no timer, and
  // named in the boot line so "is my federation live" is answered here rather than by a stale
  // `lastSyncedAt` an hour later.
  const standing =
    gateway.federationChannels.size > 0 ? gateway.keepSyncing({ everyMs: 60_000 }) : undefined;
  if (standing !== undefined) {
    io.out(`  syncing ${gateway.federationChannels.size} channel(s) every 60s`);
  }
  const unresumed = gateway.channelStatus().filter((c) => !gateway.federationChannels.has(c.name));
  for (const c of unresumed) {
    // An honest report of a channel that CANNOT sync, rather than a list that says `receiving`
    // about something nothing is polling (H9).
    io.err(
      `loam: ${c.name} will not sync — ` +
        (c.from === ""
          ? "its record carries no peer address (opened before addresses were recorded)"
          : !gateway.channelPools.has(c.name)
            ? "its pool did not open (is its file readable?)"
            : "this home holds no token for it") +
        ". Re-open it with `loam federate open` to resume.",
    );
  }

  // Closing the server also releases the gateway (and its backend file) — one shutdown, whole.
  // The serving record goes LAST: while any of this can still fail, a live pid is still true.
  const handle: ServerHandle = {
    ...server,
    async close(): Promise<void> {
      await standing?.stop();
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

// The shelf, as a sentence — every refusal that names a stock name owes the reader the full set.
// Stock names are shipped constants and public by construction, so listing them discloses nothing:
// this is a menu, not an oracle.
const stockShelf = (): string => stockNames().join(", ");

// WHERE A REGISTRATION CAME FROM — a file the operator wrote, or a shape we ship. The two differ in
// exactly one respect (how the JSON is obtained) and in no other: both hand the same `unknown` to
// the same `parseRegistrationInput`, so a stock shape has no privileged path and no weaker check.
// `origin` is only what a refusal names, so the reader knows which of the two to go fix.
interface RegistrationSource {
  readonly origin: string;
  readonly json: unknown;
  /** Set when the source is the shelf: the stock name, so the install can walk its closure. */
  readonly stockName?: string;
}

// Resolve `loam register`'s arguments to one source, or to an exit code and a said reason.
function registrationSource(parsed: Parsed, io: IO): RegistrationSource | number {
  const stock = parsed.flags.get("stock");
  const file = parsed.positionals[0];
  if (stock !== undefined && file !== undefined) {
    io.err(
      `register: --stock ${stock} and ${file} are two registrations — name one. ` +
        "A stock shape is a starting point, not an overlay on your file.",
    );
    return 2;
  }
  if (stock !== undefined) {
    const entry = stockSchema(stock);
    if (entry === undefined) {
      io.err(
        `register: no stock schema named "${stock}" — the shelf is: ${stockShelf()}. ` +
          "Or hand `loam register` a file of your own.",
      );
      return 2;
    }
    // A CLONE, deliberately: `parseRegistrationInput` passes arrays through by reference, and the
    // shelf is a module-level constant shared by every call in the process. Handing it out once
    // would let a downstream mutation rewrite the shape every later `--stock` registers.
    return {
      origin: `--stock ${entry.name}`,
      json: structuredClone(entry.registration),
      stockName: entry.name,
    };
  }
  if (file === undefined) {
    io.err(
      "register wants a schema file: `loam register <schema.json>` — " +
        "{ hyperschema: { name, alg?, body }, schema, roots, entity? } — " +
        `or a shipped shape: \`loam register --stock <name>\` (${stockShelf()})`,
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
  try {
    return { origin: file, json: JSON.parse(raw) };
  } catch (err) {
    io.err(`register: ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}

// Register a schema from a file: { name, alg?, body, policy, roots, entity? } — the body and
// policy in their JSON profiles. `--stock <name>` reads a shipped shape instead of a file, and
// changes nothing downstream of that. The definition and its registration land as operator-signed
// deltas in the home's store; the next serve generates the surface from them. Offline by
// design (the store is single-writer): register before serving, or use POST /:mount/register
// against a running server.
async function cmdRegister(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("register", args);
  const source = registrationSource(parsed, io);
  if (typeof source === "number") return source;
  let input: RegistrationInput;
  try {
    input = parseRegistrationInput(source.json);
  } catch (err) {
    io.err(`register: ${source.origin}: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  const home = parsed.flags.get("home") ?? defaultHome();
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(
    openStore(path, io),
    assembleGenesis({ operatorSeed: readSeed(home) }),
    {
      channelBackend: channelBackendFor(home, io),
      channelToken: (c) => {
        const held = readChannelToken(home, c);
        return held.kind === "present" ? held.seed : undefined;
      },
    },
  );
  let outcome: PublishOutcome;
  let evolves = false;
  try {
    // THE STOCK GRAPH (§50): a shelf entry's body may expand edges into other shelf readings, so
    // `--stock <name>` installs the entry's dependency CLOSURE, sinks first — each dependency the
    // same verbatim registration through the same validator (§42.1: what changes is only how the
    // JSON is obtained, and obtaining several files is still only that). A required lens already
    // bound is SKIPPED, keyed on the LENS name (a bespoke reading may live under any program
    // name — H6), and composed with; when the bound reading is not stock-identical, one stderr
    // line says so, naming both compared layers. Never a refusal: sovereignty stays, drift
    // becomes visible.
    if (source.stockName !== undefined) {
      // EVERY contender per lens, not latest-arbitrary: a contested lens (two entities claiming
      // one name) must not be projected down to whichever row a Map insertion kept, because the
      // pre-flight refusal below is a sovereignty decision and would otherwise decide from half
      // the picture.
      const contenders = new Map<string, Registration[]>();
      for (const r of readRegistrations(gateway.reactor, gateway.operatorAuthor)) {
        const lens = lensOf(r) as string;
        const rows = contenders.get(lens);
        if (rows === undefined) contenders.set(lens, [r]);
        else rows.push(r);
      }
      const order = installOrder(source.stockName);
      const deps = order.slice(0, -1);
      // An EVOLVE is a republish at the SAME registration entity — never mere lens membership. A
      // bespoke binding holding this lens from another entity is a contest, and the qualified
      // `does not bind` report below is that case's honest voice (§42.4); an "evolves" line there
      // would claim an act that did not happen.
      const targetEntity = schemaEntityFor(input.hyperschema, input.entity);
      evolves = (contenders.get(entryLensName(order[order.length - 1]!)) ?? []).some(
        (r) => r.entity === targetEntity,
      );
      // PRE-FLIGHT, before any delta lands — the WHOLE order, target included. The substrate
      // resolves an expand's `schema` ref by PROGRAM name and admits one reading per lens, so a
      // required lens is composable only when some contender serves it under the program name
      // the stock body references. When none does, publishing stock beside it would evict or
      // crash — the exact destruction H6 warns about — so refuse here, with the store untouched:
      // sovereignty outranks convergence when the two collide (§50). A bespoke binding that
      // SHARES the program name passes through to the ordinary §42.4 qualified outcome.
      for (const dep of order) {
        const lens = entryLensName(dep);
        const rows = contenders.get(lens);
        if (rows === undefined) continue;
        const stockProgram = programOf(dep.registration as { hyperschema: { name: string } });
        if (!rows.some((r) => programOf(r) === stockProgram)) {
          const theirs = [...new Set(rows.map((r) => programOf(r) as string))].join('", "');
          io.err(
            `register: --stock ${source.stockName} needs the reading ${lens} served by a ` +
              `program of the same name, and this store serves it from the program ` +
              `"${theirs}". Installing stock ${dep.name} beside it would evict your ` +
              `reading, so nothing was installed. To compose, republish your reading under ` +
              `the program name ${stockProgram}; to adopt stock, retire yours first.`,
          );
          await gateway.close();
          return 2;
        }
      }
      for (const dep of deps) {
        const lens = entryLensName(dep);
        const rows = contenders.get(lens);
        if (rows !== undefined) {
          io.out(`loam: ${dep.name} already bound — skipped`);
          // Compare against the contender that actually serves the reference — the pre-flight
          // proved one exists — never an arbitrary row of a contested name.
          const stockProgram = programOf(dep.registration as { hyperschema: { name: string } });
          const serving = rows.find((r) => programOf(r) === stockProgram)!;
          const differs = divergenceOf(dep, serving);
          if (differs !== undefined) {
            io.err(
              `loam: ${dep.name} is bound to a reading that is not stock ` +
                `${lens}@${stockIdentityOf(dep).schemaHash} — composing with it (differs: ${differs})`,
            );
          }
          continue;
        }
        const depInput = parseRegistrationInput(structuredClone(dep.registration));
        const depOutcome = await gateway.publishRegistration(
          depInput.hyperschema,
          depInput.schema,
          depInput.roots,
          undefined,
          depInput.entity,
          depInput.mutations,
          depInput.writable,
          depInput.resolvers,
          depInput.refs,
        );
        io.out(`loam: also installed ${dep.name}`);
        if (!depOutcome.bound) {
          io.err(
            `loam: the deltas landed, but ${dep.name} does not bind here — ${depOutcome.reason}`,
          );
        }
      }
    }
    outcome = await gateway.publishRegistration(
      input.hyperschema,
      input.schema,
      input.roots,
      undefined,
      input.entity,
      input.mutations,
      input.writable,
      input.resolvers,
      input.refs,
    );
  } catch (err) {
    await gateway.close().catch(() => {}); // never let a close failure mask the real refusal
    throw err;
  }
  await gateway.close();
  // Re-registering is the ordinary evolve path, and the report says which kind of act this was —
  // a store upgrading its stock reading should read "evolve", not a second identical "registered".
  if (evolves) {
    io.out(
      `loam: ${lensNameFor(input.hyperschema, input.schema)} was already bound — this publish evolves it`,
    );
  }
  io.out(
    `loam: registered ${input.hyperschema.name} at ${schemaEntityFor(input.hyperschema, input.entity)}\n` +
      `  the definition is deltas now — the next serve grows the surface from it`,
  );
  // Registration-time cautions (§51) have exactly one reader at this door: the operator's eyes.
  for (const warning of outcome.warnings ?? []) io.err(`loam: ${warning}`);
  // PERSISTED IS NOT BOUND. `publishRegistration` reports a publish whose replay could not bind —
  // a rival body under the same program name, a lens another entity already answers for — and the
  // deltas are down either way, so the line above stays true. What would be false is leaving the
  // operator to read "the next serve grows the surface from it" when it will not. Qualified rather
  // than blocked, exactly as the staleness warning below is: the write happened.
  if (!outcome.bound) {
    io.err(
      `loam: the deltas landed, but this registration does not bind here — ${outcome.reason}\n` +
        `  a serve of this home will not grow the surface from it until that is settled`,
    );
  }
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
// §46 — federation is container-to-container. The verbs mirror the tool surface T188 exposes to an
// agent, with ONE deliberate asymmetry: `drop` needs `--yes` here and cannot be reached at all by an
// MCP caller, because an agent staging an irreversible purge and a person confirming it are
// different acts on different surfaces.
/** `--bless` on `federate open`: absent means yes, and only the two words are understood. */
function blessFlagOf(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  if (raw === "true" || raw === "false") return raw === "true";
  throw new UsageError(
    `federate open --bless takes exactly "true" or "false", and got "${raw}" — a spelling this ` +
      "does not understand would be read as true, and this door never prints the blessing state " +
      "it settled on. Nothing was opened.",
  );
}

async function cmdFederate(args: readonly string[], io: IO): Promise<number> {
  const verb = args[0];
  const parsed = parseFor("federate", args.slice(1));
  if (verb === undefined || !["open", "list", "set", "drop", "bless-app"].includes(verb)) {
    io.err(
      "federate takes a verb: open (start receiving from a peer), list (what is standing and how " +
        "it is doing), set (freeze or unbless, both reversible), bless-app (mount one app a peer " +
        "sent, the only act that lets their code run), drop (sever and purge, not reversible) — " +
        "`loam federate --help`",
    );
    return 2;
  }
  // WHAT EACH VERB TAKES — because the parser's allowlist is per COMMAND, and `federate` is five
  // commands wearing one name. Without this, a flag one verb reads is silently accepted by all the
  // others: `bless-app --bless false` granted the resolvers and left the channel blessing, and the
  // operator was told nothing. That direction is the dangerous one — a dropped `--route` merely
  // fails to do something, while a dropped `--bless` fails to STOP something.
  const TAKES: Record<string, readonly string[]> = {
    open: ["from", "into", "prefix", "token", "bless"],
    list: [],
    set: ["channel", "receiving", "bless"],
    "bless-app": ["channel", "route", "resolvers", "expect", "pen", "supersede"],
    drop: ["channel", "yes"],
  };
  const takes = new Set(["home", "store", ...(TAKES[verb] ?? [])]);
  // BOTH PARSER MAPS. A declared boolean lands in `booleans` and never in `flags`, so reading one
  // is a check that half the names always pass.
  const strayFlags = [...parsed.flags.keys(), ...parsed.booleans]
    .filter((f) => !takes.has(f))
    .sort();
  if (strayFlags.length > 0) {
    io.err(
      `federate ${verb} does not take ${strayFlags.map((f) => `--${f}`).join(", ")} — it takes ` +
        `${[...takes]
          .sort()
          .map((f) => `--${f}`)
          .join(
            ", ",
          )}. Nothing was done: a flag this verb never reads is a request that would go ` +
        "unanswered in silence. These verbs do not share a vocabulary: `--bless` belongs to `open` " +
        "and `set`, and it decides whether a peer's law binds at all.",
    );
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const gateway = await Gateway.boot(
    openStore(storePath(home, parsed.flags.get("store")), io),
    assembleGenesis({ operatorSeed: readSeed(home) }),
    {
      channelBackend: channelBackendFor(home, io),
      channelToken: (c) => {
        const held = readChannelToken(home, c);
        return held.kind === "present" ? held.seed : undefined;
      },
    },
  );
  try {
    if (verb === "list") {
      const rows = gateway.channelStatus();
      // The container table, read ONCE for the whole listing (H8): a channel whose `into` no longer
      // resolves here is ORPHANED — the receiving container was struck, so its pool sits outside
      // every subtree and no page shows it, yet it still receives (T218).
      const containers = gateway.containers().containers;
      // Read ONCE for the whole listing. `channelApps` walks the ground to find the channels, so
      // asking it per row would make a listing quadratic in the store (H8).
      const appsByChannel = new Map<string, ReturnType<typeof gateway.channelApps>>();
      for (const a of gateway.channelApps()) {
        appsByChannel.set(a.channel, [...(appsByChannel.get(a.channel) ?? []), a]);
      }
      if (rows.length === 0) {
        io.out(
          "loam: no federation channels — `loam federate open --from <url> --into <container> --prefix <name>`",
        );
        return 0;
      }
      for (const r of rows) {
        // A RECORD THIS STORE CANNOT READ GETS NO HEALTH LINE AT ALL. Every value below is a
        // coercion, and coercion defaults toward health — an absent time reads 0, which this
        // command spells "never synced", and a NaN reaches `toISOString`, which throws and took the
        // whole listing down with it. Naming the fields is the point: a person goes and looks at
        // the record instead of at a guess.
        if (r.unreadable.length > 0) {
          io.out(
            `${r.name}\n  UNREADABLE — its record does not carry ${r.unreadable.join(", ")} in ` +
              `the shape a channel record is written in, so this command will not guess at its ` +
              `health.\n  \`federate set\` and \`federate drop\` still name it, and neither ` +
              `repairs the record: a set carries the unreadable fields forward as unreadable.`,
          );
          continue;
        }
        // "never synced" is spelled out rather than shown as a zero: a channel that has never
        // reached its peer must not read like one that is merely quiet (H9, §46 criterion 8).
        const when =
          r.lastSyncedAt === 0
            ? "never synced"
            : `last synced ${new Date(r.lastSyncedAt).toISOString()}`;
        const trouble =
          r.consecutiveFailures > 0 ? `, ${r.consecutiveFailures} failed attempt(s) since` : "";
        // An APP a peer sent is code, and no toggle above mounts it (§24.6). An operator who cannot
        // see what arrived cannot decide about it, so every arrival is named here — and the bundle's
        // address is printed so two stores can compare notes.
        //
        // FOUR STATES, NOT TWO. A single "blessed" flag said "nothing runs" while blessed code ran
        // (a peer had shipped new code at the route) and printed a remedy that throws. What an
        // operator needs to see is the pair: what the peer OFFERS, and what this store RUNS.
        // LONG ENOUGH TO PASTE INTO `--expect`. Twelve characters looked tidy and were four real
        // ones, since every id starts `1e20` — so the documented workflow (read the list, paste the
        // id) refused every time. A listing that cannot supply its own remedy is not a listing.
        const short = (h: string): string => h.slice(0, 28);
        // TWO SENTENCES PER APP: what the peer OFFERS, and what this store DOES about it — then the
        // remedy for that exact state. Every earlier shape of this printed one line that had to
        // cover several states, and each time the line was wrong for one of them and its remedy
        // refused. A remedy is part of a report's truth: printing a command that throws is a false
        // statement about the store, made on the surface a person reads before deciding.
        const apps = (appsByChannel.get(r.name) ?? []).map((a) => {
          // THE RECIPE CARRIES EVERY FLAG THE DOOR WILL DEMAND. An app that holds a pen is refused
          // without `--pen` (§6's two keys), so a recipe that omitted it was a printed command that
          // throws — and worse, it left the operator unaware that this app asks to WRITE.
          const bless =
            `\`loam federate bless-app --channel ${r.name} --route ${a.route}` +
            (a.wantsPen === undefined ? "" : " --pen");
          const offers =
            a.hash === undefined
              ? `\n  app "${a.route}" — the peer WITHDREW it`
              : `\n  app "${a.route}" — the peer offers ${short(a.hash)}`;
          // WHY IT ANSWERS NOTHING, when it does not. Each cause has a different remedy and none of
          // them is "bless it", so each says the thing that is actually in the way.
          // "MOUNTED" only when something is. A shadowed row can have no blessing at all — the
          // name is simply the operator's — and blessing it would land and still answer nothing.
          const here = a.mounted === undefined ? "nothing of it is mounted" : "it is MOUNTED here";
          const stuck =
            a.shadowed !== undefined
              ? `\n    ${here}, and "${a.serves}" answers nothing: ${a.shadowed} holds that name\n` +
                `    ${a.remedy ?? ""}`
              : a.dark === true
                ? `\n    it is MOUNTED here and answers nothing: the lens it reads is not bound ` +
                  "here\n    lift the curse on that lens, or re-bless it, and this answers again"
                : undefined;
          // WITHDRAWN FIRST. There is nothing to bless and nothing newer to move onto, so every
          // remedy below would refuse — the only act left is dropping the channel.
          if (a.hash === undefined) {
            return (
              offers +
              (stuck ??
                `\n    this store still runs the app it blessed (${short(a.serving ?? a.mounted ?? "")}) ` +
                  `at "${a.serves}"`) +
              `\n    dropping the channel is what removes it: \`loam federate drop --channel ${r.name} --yes\``
            );
          }
          if (stuck !== undefined) return offers + stuck;
          // NOTHING IS MOUNTED and nothing can be: a route of the operator's own holds that name
          // inside the pool, and the blessing door refuses it by name. `stuck` cannot speak for this
          // one — it says "it is MOUNTED here", and nothing is.
          if (a.blocked !== undefined) {
            return (
              `${offers}\n    it cannot mount: ${a.blocked} holds that name\n` +
              "    a peer's app cannot take a name your own law answers"
            );
          }
          // A pin names a delta of the PEER's store, which this one does not hold: the blessing door
          // refuses it by name, so offering the blessing here would be offering a refusal.
          if (a.unmountable !== undefined) {
            return (
              `${offers}\n    it cannot mount here: ${a.unmountable}\n` +
              "    only the peer can change that; nothing on this side will" +
              // A re-point to a pinned binding leaves an EARLIER blessing serving, and saying only
              // "it cannot mount" would leave an operator believing that route answers nothing.
              (a.serving === undefined
                ? ""
                : `\n    this store still runs the app it blessed (${short(a.serving)}) at "${a.serves}"`)
            );
          }
          // What an app ASKS FOR, said once and near the top: a pen is the one property of an
          // arrival that changes what blessing it means, rather than only what it draws.
          const asks =
            a.wantsPen === undefined
              ? ""
              : `\n    it asks to WRITE, under the pen "${a.wantsPen}" — blessing it needs --pen, ` +
                "and the pen itself needs provisioning and a grant";
          if (a.serving === undefined) {
            return `${offers}${asks}\n    ARRIVED, INERT — nothing of it runs until ${bless}\``;
          }
          if (a.blessed) return `${offers}\n    it SERVES at "${a.serves}"`;
          return (
            `${offers}${asks}\n    this store runs DIFFERENT code at "${a.serves}": ${short(a.serving)}\n` +
            `    to move it onto what the peer offers now: ${bless} --supersede\``
          );
        });
        // A LENS WHOSE RESOLVER CODE IS WITHHELD is a decision waiting on a person, exactly as an
        // inert app is — and the help points here for it, so here is where it has to appear.
        const withheld = gateway
          .withheldOn(r.name)
          .map(
            (lens) =>
              `\n  lens "${lens}" — its computed fields REFUSE: the peer's resolver code is not run here\n` +
              `    to run it: \`loam federate bless-app --channel ${r.name} --resolvers "${lens}"\``,
          );
        // ORPHANED — the receiving container is gone. A resumed sync keeps writing this peer's bytes
        // to a pool nothing reads, so the marker names the two verbs that release it: drop forgets
        // the pool whole, `set --receiving false` freezes the pull. Read from the same table every
        // row consults, so it costs no extra walk.
        const orphaned = !containers.has(r.into)
          ? `\n  orphaned — its receiving container "${r.into}" is gone: no subtree reaches this ` +
            `pool and no page shows it, yet it still receives. Release it: \`loam federate drop ` +
            `--channel ${r.name} --yes\`, or freeze the pull with \`loam federate set --channel ` +
            `${r.name} --receiving false\``
          : "";
        io.out(
          `${r.name}\n  into ${r.into}, serving the peer's law under "${r.prefix}:"\n` +
            `  ${r.receiving ? "receiving" : "FROZEN"}, ${r.blessing ? "blessing" : "NOT blessing"}\n` +
            `  ${when}${trouble}${orphaned}${withheld.join("")}${apps.join("")}`,
        );
      }
      return 0;
    }

    if (verb === "open") {
      const from = parsed.flags.get("from");
      const into = parsed.flags.get("into");
      const prefix = parsed.flags.get("prefix");
      if (from === undefined || into === undefined || prefix === undefined) {
        io.err(
          "federate open wants --from <url|file>, --into <container>, and --prefix <name>. The " +
            "prefix is YOURS: it is the namespace this store serves the peer's law under, so no " +
            "peer can take a name you already answer.",
        );
        return 2;
      }
      const token = parsed.flags.get("token") ?? process.env["LOAM_TOKEN"];
      const channel = await gateway.openChannel({
        into,
        prefix,
        from,
        // The same strictness the `set` verb keeps, for the same reason — and this door is worse to
        // guess at, because its report never prints the resulting blessing state.
        bless: blessFlagOf(parsed.flags.get("bless")),
        source: sourceFor(from, token, (f) => readFileSync(f, "utf8"), parseOffer),
      });
      // The credential is written where secrets live, so the next boot can resume this channel.
      // The address went onto its record; this is the half that must never be a delta (T196).
      if (token !== undefined) writeChannelToken(home, channel.name, token);
      const report = await channel.sync();
      io.out(
        `loam: channel ${channel.name}\n` +
          `  ${report.accepted} accepted, ${report.duplicates} already held, of ${report.offered} offered\n` +
          (report.bound.length > 0 ? `  bound ${report.bound.join(", ")}\n` : "") +
          (report.witnessed.length > 0
            ? `  ALREADY SERVED under another name, so these were NOT created: ` +
              `${report.witnessed.join(", ")}\n` +
              `    this store already answers that law through an earlier channel or your own ` +
              `registration — the peer's data is here, and it reads through the name that exists (T198)\n`
            : "") +
          (report.parked.length > 0
            ? `  PARKED (a name here is answered by different law — your decision):\n    ${report.parked.join("\n    ")}\n`
            : "") +
          "  union is union; syncing again is safe",
      );
      return 0;
    }

    const name = parsed.flags.get("channel");
    if (name === undefined) {
      io.err(`federate ${verb} wants --channel <name> — \`loam federate list\` names them`);
      return 2;
    }

    if (verb === "set") {
      const next: { receiving?: boolean; blessing?: boolean } = {};
      // EXACTLY `true` OR `false`. `!== "false"` reads `FALSE`, `0`, `no` and `off` as ON — and the
      // direction is the one that matters: an operator typing `--bless FALSE` to stop new law
      // binding would have turned it on and been told the channel was blessing, in a sentence they
      // had just asked to make false. A spelling this does not understand is a refusal.
      const toggle = (flag: string): boolean | undefined => {
        const raw = parsed.flags.get(flag);
        if (raw === undefined) return undefined;
        if (raw === "true" || raw === "false") return raw === "true";
        throw new UsageError(
          `federate set --${flag} takes exactly "true" or "false", and got "${raw}" — a spelling ` +
            "this does not understand would be read as true, which is the wrong direction to " +
            "guess in. Nothing was changed.",
        );
      };
      const receiving = toggle("receiving");
      const bless = toggle("bless");
      if (receiving !== undefined) next.receiving = receiving;
      if (bless !== undefined) next.blessing = bless;
      if (next.receiving === undefined && next.blessing === undefined) {
        io.err("federate set wants --receiving <true|false> or --bless <true|false>, or both");
        return 2;
      }
      const now = await gateway.setChannel(name, next);
      io.out(
        `loam: ${now.name} is now ${now.receiving ? "receiving" : "FROZEN"} and ` +
          `${now.blessing ? "blessing" : "NOT blessing"}\n` +
          (now.blessing ? "" : "  law already bound stays bound — this stops NEW law binding\n") +
          (now.receiving ? "" : "  what already arrived still reads — this stops NEW deltas\n"),
      );
      return 0;
    }

    if (verb === "bless-app") {
      // TWO ACTS, ONE VERB, because they are the same decision about the same channel: let a
      // peer's code run here. `--route` mounts an app; `--resolvers` lets the code behind one
      // lens's computed fields run. Neither rides the blessing toggle, and neither rides the other.
      const lens = parsed.flags.get("resolvers");
      if (lens !== undefined) {
        // THE TWO ACTS ARE SEPARATE, and the flags that belong to the other one are refused rather
        // than dropped. `--route` mounts an app; `--pen` and `--supersede` qualify that mount; and
        // `--expect` pins an app's identity, which a lens's resolver law does not have. Asked for
        // both acts at once, an operator would have got one and heard about one. BOTH parser maps
        // are read: a declared boolean lands in `booleans` and never in `flags`, so testing one is
        // a test that half the names always pass.
        const stray = ["route", "expect", "pen", "supersede"].filter(
          (f) => parsed.flags.has(f) || parsed.booleans.has(f),
        );
        if (stray.length > 0) {
          const named = stray.map((f) => `--${f}`).join(", ");
          io.err(
            `federate bless-app --resolvers does not take ${named} — ${
              stray.length === 1 ? "that flag belongs" : "those flags belong"
            } to the OTHER act, \`--route\`, which mounts an app. This one grants the resolver ` +
              "code on ONE lens, and there is no identity for it to pin: `federate list` names the " +
              "lens and nothing finer. Nothing was granted; run the two acts separately.",
          );
          return 2;
        }
        // THE NAME THE ACT USED, not the one that was typed. `--resolvers Plant` is a supported
        // form and the reader below answers prefixed names, so comparing the operator's own string
        // would be a check that can never match — a guard that passes because it is empty.
        const served = await gateway.blessChannelResolvers(name, lens);
        // READ IT BACK. The grant replaces a binding whose address is identical to the one it
        // replaces, so "it landed" and "it took the name" are different questions — and announcing
        // the first as the second is the shape this file refuses everywhere else (H7).
        if (gateway.withheldOn(name).includes(served)) {
          io.err(
            `federate bless-app: ${name} published the grant for "${served}", and its fields still ` +
              "refuse\n  the withheld binding is still what answers — nothing here should be read " +
              "as a success",
          );
          return 2;
        }
        io.out(
          `loam: ${name} now runs the peer's resolver code for "${served}"\n` +
            "  it runs on this channel's pool, in this process, and not in the render worker\n" +
            `  dropping the channel takes it with the peer's data — \`loam federate drop --channel ${name} --yes\``,
        );
        return 0;
      }
      const route = parsed.flags.get("route");
      if (route === undefined) {
        io.err(
          "federate bless-app wants --route <route>, or --resolvers <lens> — `loam federate list` " +
            "names every app a peer has sent and every lens whose resolver code is withheld, and " +
            "these are the only two ways a peer's code ever runs here",
        );
        return 2;
      }
      const expected = parsed.flags.get("expect");
      await gateway.blessChannelApp(name, route, {
        pen: parsed.booleans.has("pen"),
        supersede: parsed.booleans.has("supersede"),
        ...(expected === undefined ? {} : { expect: expected }),
      });
      // Report what the store ANSWERS WITH, not what the call returned. A blessing that landed and
      // does not serve — its lens withdrawn, say — must not be announced as a mount (H7).
      const app = gateway.channelApps(name).find((a) => a.route === route);
      if (app?.blessed !== true) {
        // NAME THE CAUSE, or name that it is unknown. The first version of this line always blamed
        // the lens, which is wrong for the commonest case: a name of the operator's own in the way.
        const why =
          app?.shadowed !== undefined
            ? `${app.shadowed} holds that name — ${app.remedy ?? "move it and this answers"}`
            : app?.dark === true
              ? "the lens it reads is not bound here — lift the curse on it, or re-bless it"
              : "check `loam federate list` for what this store says about it";
        // EXIT 2, because a script that reads 0 here reads a mount. The blessing DID land and is
        // not lost — it answers the moment what is in the way moves — and the message says so, so
        // nobody re-runs this looking for a different result.
        io.err(
          `federate bless-app: ${name} blessed the app "${route}", and "${app?.serves ?? route}" ` +
            `answers nothing\n  ${why}\n  the blessing is on the ground; it serves when that clears`,
        );
        return 2;
      }
      io.out(
        `loam: ${name} now serves the app "${route}" at "${app.serves}"\n` +
          "  it runs on this channel's pool, behind the probation frame, and its writes stay there\n" +
          `  dropping the channel takes it with the peer's data — \`loam federate drop --channel ${name} --yes\``,
      );
      return 0;
    }

    // drop
    if (!parsed.booleans.has("yes")) {
      const held = gateway.channelStatus(name)[0];
      io.err(
        `federate drop refused without --yes. This PURGES ${name} at the bytes` +
          (held === undefined
            ? ""
            : ` — everything received from "${held.prefix}" into ${held.into}`) +
          `. It cannot be undone. To stop receiving and KEEP what arrived, use ` +
          `\`loam federate set --channel ${name} --receiving false\` instead.`,
      );
      return 2;
    }
    await gateway.dropChannel(name);
    io.out(`loam: ${name} is severed and its pool is purged — other channels are untouched`);
    return 0;
  } catch (err) {
    io.err(`federate: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  } finally {
    await gateway.close();
  }
}

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
    {
      channelBackend: channelBackendFor(home, io),
      channelToken: (c) => {
        const held = readChannelToken(home, c);
        return held.kind === "present" ? held.seed : undefined;
      },
    },
  );
  let report: FederationReport;
  // Pull's own dimension: deltas the peer sent that would not even reconstruct (see PullReport).
  // The file path cannot produce it — parseOffer refuses a corrupt file whole.
  let unreconstructable = 0;
  try {
    if (isUrl) {
      const pulled = await pullFrom(gateway, source, token!);
      report = pulled;
      unreconstructable = pulled.unreconstructable;
    } else {
      report = await gateway.federate(offered!);
    }
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
  // A delta that will not reconstruct fails on the BYTES, not on timing, so every later pull
  // drops the same ones — this line is the operator's only cue. It names the count and BOTH
  // cures, because the door genuinely cannot tell a rotted offer from a peer speaking a newer
  // delta shape than this puller (PullReport carries the reasoning). Never silent, and never a
  // guessed cause: prescribing "the peer must repair it" would be H7 in a new place.
  if (unreconstructable > 0) {
    io.err(
      `loam: ${unreconstructable} of the offered deltas would not reconstruct and were ` +
        `dropped — pulling again drops the same ones. Either the peer's offer is damaged or the ` +
        `peer speaks a newer delta shape than this loam: ask for a fresh export, and compare ` +
        `both sides' versions`,
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
//
// SPLIT BY SURVIVAL, because "struck" and "never planted" are opposite answers that a surviving-set
// alone cannot tell apart: one is a standing nobody has retired, the other is a standing somebody
// DID, and re-planting the second silently un-revokes it.
interface ClaimStanding {
  readonly surviving: string[];
  readonly struck: string[];
}

function claimIdsBySurvival(
  reactor: Reactor,
  operator: string,
  entity: string,
  context: string,
  matches: (delta: Delta) => boolean,
): ClaimStanding {
  const surviving: string[] = [];
  const struck: string[] = [];
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
    const negated = reactor
      .negationsOf(id)
      .some((negId) => reactor.get(negId)?.claims.author === operator);
    (negated ? struck : surviving).push(id);
  }
  return { surviving, struck };
}

const survivingClaimIds = (
  reactor: Reactor,
  operator: string,
  entity: string,
  context: string,
  matches: (delta: Delta) => boolean,
): string[] => claimIdsBySurvival(reactor, operator, entity, context, matches).surviving;

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

// Every grant this store's own seed authored for `subject` — the CURRENT holder of a name's seed
// file, never a historical one (the working spec's §36.3.1.7 names that residual) — split by
// whether the operator has struck it. `verb` narrows to one action: a grant naming the subject is
// not the same fact as a grant naming the subject FOR WRITE, and asking the loose question of a
// pen would read an `admin` grant as write standing the door would then refuse.
const grantStanding = (
  reactor: Reactor,
  operator: string,
  subject: string,
  verb?: string,
): ClaimStanding =>
  claimIdsBySurvival(
    reactor,
    operator,
    STORE_ENTITY,
    CTX_GRANTS,
    (delta) =>
      delta.claims.author === operator &&
      delta.claims.pointers.some(
        (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === subject,
      ) &&
      (verb === undefined ||
        delta.claims.pointers.some(
          (p) => p.role === "verb" && p.target.kind === "primitive" && p.target.value === verb,
        )),
  );

const survivingGrantClaimIds = (reactor: Reactor, operator: string, subject: string): string[] =>
  grantStanding(reactor, operator, subject).surviving;

// Which author a named pen signs as, according to the ground, and the record deltas that say so.
// A record whose author no longer matches the seed file on disk is the whole point: that is a
// RE-KEY, and the author it names is the standing that must be struck.
function penRecordsFor(
  reactor: Reactor,
  operator: string,
  name: string,
): readonly { readonly id: string; readonly author: string }[] {
  const out: { id: string; author: string }[] = [];
  for (const id of survivingClaimIds(
    reactor,
    operator,
    penEntity(name),
    CTX_PEN,
    (delta) => delta.claims.author === operator,
  )) {
    const pointer = reactor.get(id)?.claims.pointers.find((p) => p.role === "author");
    if (pointer?.target.kind === "primitive" && typeof pointer.target.value === "string") {
      out.push({ id, author: pointer.target.value });
    }
  }
  return out;
}

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
      if (seedRead.kind === "present" && !isSeedHex(seedRead.seed)) {
        // The same test `loam serve` applies at boot, applied BEFORE authorForSeed can throw a
        // parser error that quotes the file — a string that fails this test may still be a key,
        // and a refusal is no place to print one. Malformed is not absent: the grant in the
        // ground names a key this file no longer derives, so striking the role alone would
        // report a partial success (H9); the whole command refuses instead.
        io.err(
          `user remove-role: ${userSeedPath(home, name)} exists but does not hold a 64-hex seed, ` +
            `so this command cannot derive which key's grants to strike — nothing was struck, and ` +
            `the file's contents are not printed here. If the key is lost, move the file aside ` +
            `and run this again: the role is struck and the orphaned grant is named in the report.`,
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

async function cmdPen(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("pen", args);
  const sub = parsed.positionals[0];
  if (sub !== "create") {
    io.err("pen wants a subcommand: `loam pen create <name>`");
    return 2;
  }
  const name = parsed.positionals[1];
  if (name === undefined) {
    io.err("pen create wants a name: `loam pen create <name>`");
    return 2;
  }
  if (parsed.positionals.length > 2) {
    io.err("pen create takes exactly one name");
    return 2;
  }
  // Checked before ANY path is built from `name` — a pen name is a single path component (the seed
  // file's own name), never a traversal. The user-name grammar is exactly that discipline.
  const nameDefect = userNameDefect(name);
  if (nameDefect !== undefined) {
    io.err(`pen create: ${nameDefect.replace("is not a user name", "is not a pen name")}`);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: true });
  if (unusable !== undefined) {
    io.err(`pen create: ${unusable}`);
    return 1;
  }
  const init = initHome(home);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);

  // The pen's THREE facts (§6). The seed file is CUSTODY; the ground's grant is AUTHORIZATION; the
  // ground's PEN RECORD says which author this NAME is supposed to sign as. Any of them can exist
  // without the others — a crash between two writes, a hand-copied file, a deleted seed — and the
  // record is what makes the third case survivable: without it, a replaced key keeps its standing
  // under an author derivable only from the file that is gone.
  //
  // Every outcome is decided from all three BEFORE anything moves, because two of them are refusals.
  const seedRead = readPenSeed(home, name);
  if (seedRead.kind === "unreadable") {
    io.err(
      `pen create: ${penSeedPath(home, name)} exists but cannot be read (${seedRead.detail}) — ` +
        `this command will not overwrite a key it cannot see. Nothing was written.`,
    );
    return 1;
  }
  if (seedRead.kind === "present" && !isSeedHex(seedRead.seed)) {
    // The same test `loam serve` applies at boot. Granting around it would mint standing for a pen
    // the next boot refuses to provision. The file is NOT quoted back: a string that fails this
    // test may still be a key, and a refusal is no place to print one.
    io.err(
      `pen create: ${penSeedPath(home, name)} exists but does not hold a 64-hex seed, which is ` +
        `what \`loam serve\` requires of a pen at boot — so this command refuses it too, rather ` +
        `than granting write standing to a pen the next boot would skip. Nothing was written, and ` +
        `the file's contents are not printed here. Move the file aside and run this again to ` +
        `provision ${name} under a fresh key.`,
    );
    return 1;
  }

  const path = storePath(home, parsed.flags.get("store"));
  const seed = readSeed(home);
  const operator = authorForSeed(seed);

  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  let penSeed: string;
  let outcome: "provisioned" | "repaired" | "re-keyed";
  const retired: { author: string; grants: number }[] = [];
  try {
    const records = penRecordsFor(gateway.reactor, operator, name);

    if (seedRead.kind === "present") {
      // ASK THE GROUND for this key's write standing rather than trusting this run's own memory,
      // and read the STRUCK grants too: a revoked pen and a never-granted one look identical to a
      // "does anything survive" question, and re-planting the first would un-revoke it silently.
      const held = authorForSeed(seedRead.seed);
      const standing = grantStanding(gateway.reactor, operator, held, "write");
      if (standing.surviving.length > 0) {
        io.err(
          `pen create: ${name} is already provisioned — ${penSeedPath(home, name)} exists and its ` +
            `author holds a write grant. Nothing was written. To retire the pen, strike its ` +
            `grant; to RE-KEY it — the answer to a leaked seed — remove ` +
            `${penSeedPath(home, name)} and run this again: the next run mints a fresh key AND ` +
            `strikes the old author's standing, so the leaked key can no longer write. Past ` +
            `writes stay attributed to the old key either way.`,
        );
        return 2;
      }
      if (standing.struck.length > 0) {
        io.err(
          `pen create: ${name} was RETIRED — ${penSeedPath(home, name)} still holds a key, but ` +
            `its author's write grant was struck on the ground, and this command will not ` +
            `resurrect a standing somebody revoked. Nothing was written. To provision ${name} ` +
            `again under a FRESH key, remove ${penSeedPath(home, name)} and run this again.`,
        );
        return 2;
      }
      penSeed = seedRead.seed;
      outcome = "repaired";
    } else {
      // The seed file lands BEFORE the grant (the `user create` ordering, for the same reason): if
      // the append then fails, a re-run finds the seed present, the grant absent, and repairs the
      // grant alone. The other order would strand a live grant whose freshly-minted key was lost.
      penSeed = randomBytes(32).toString("hex");
      try {
        writePenSeed(home, name, penSeed);
      } catch (err) {
        io.err(
          `pen create: writing ${penSeedPath(home, name)} failed: ` +
            `${err instanceof Error ? err.message : String(err)}. Nothing was written.`,
        );
        return 1;
      }
      outcome = records.length > 0 ? "re-keyed" : "provisioned";
    }
    const penAuthor = authorForSeed(penSeed);

    // A record naming a DIFFERENT author is a key this run replaces, so its standing goes with it:
    // the record, and EVERY surviving grant that author holds — any verb, because a key you are
    // replacing because it leaked must not keep signing anything at all.
    const deltas: Delta[] = [];
    let at = Date.now();
    for (const stale of records.filter((r) => r.author !== penAuthor)) {
      const held = grantStanding(gateway.reactor, operator, stale.author).surviving;
      for (const id of [stale.id, ...held]) {
        deltas.push(signClaims(makeNegationClaims(operator, at++, id), seed));
      }
      retired.push({ author: stale.author, grants: held.length });
    }
    if (!records.some((r) => r.author === penAuthor)) {
      deltas.push(signClaims(penRecordClaims(name, penAuthor, operator, at++), seed));
    }
    if (grantStanding(gateway.reactor, operator, penAuthor, "write").surviving.length === 0) {
      deltas.push(signClaims(grantClaims(STORE_ENTITY, penAuthor, "write", operator, at++), seed));
    }
    if (deltas.length > 0) await gateway.append(deltas);
  } finally {
    await gateway.close();
  }

  const struckLines = retired.map(({ author, grants }) =>
    grants === 0
      ? `  the previous key ${author} held no live grant — its record is retired`
      : `  the previous key ${author} is struck: ${grants} grant${grants === 1 ? "" : "s"} it held no longer bind${grants === 1 ? "s" : ""}`,
  );
  io.out(
    outcome === "repaired"
      ? [
          `loam: repaired pen ${name} — the seed file was already at ${penSeedPath(home, name)}`,
          ...struckLines,
          `  the missing write grant for its author is now in ${path}`,
        ].join("\n")
      : outcome === "re-keyed"
        ? [
            `loam: re-keyed pen ${name}`,
            `  a fresh seed is at ${penSeedPath(home, name)} (0600) — it never enters the ground`,
            ...struckLines,
            `  past writes stay attributed to the old key; new form POSTs are signed by the new one`,
            `  the write grant for the new author is in ${path}; the next serve reads the seed file`,
          ].join("\n")
        : `loam: provisioned pen ${name}\n` +
          `  the seed is at ${penSeedPath(home, name)} (0600) — it never enters the ground\n` +
          `  a write grant for its author is in ${path}\n` +
          `  a renderer binding names it with pen: "${name}"; the next serve reads the seed file`,
  );
  // Serve reads pen seeds at BOOT, so a live server will not see this pen until it restarts.
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

async function cmdGrant(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("grant", args);
  const sub = parsed.positionals[0];
  if (sub === undefined) {
    io.err(
      "grant wants a subcommand: `loam grant list`, `loam grant revoke <client_id>`, or " +
        "`loam grant <client_id> --verb=register --prefix=<prefix>`",
    );
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`grant ${sub}: ${unusable}`);
    return 1;
  }
  // A bare positional is a CLIENT ID being granted something — `loam grant <id> --verb=…`. The two
  // reserved words stay subcommands, so a connector whose id is literally "list" or "revoke" is
  // unreachable this way; the ids this store mints are opaque and never those two.
  if (sub !== "list" && sub !== "revoke") return cmdGrantMint(sub, parsed, home, io);
  if (sub === "list") return cmdGrantList(home, parsed, io);

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

// The connector whose actor a `--verb` grant would name, or the reason there is none.
function connectorActor(
  home: string,
  clientId: string,
  label: string,
  io: IO,
): { actor: string } | { code: number } {
  let file;
  try {
    file = readOAuthFile(home);
  } catch (err) {
    io.err(
      `${label}: ${home}'s connector records are unreadable, so this will not guess who to ` +
        `grant: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { code: 1 };
  }
  const grant = grantFor(file, clientId);
  if (grant === undefined) {
    io.err(
      `${label}: this store holds no acting identity for ${clientId} — a connector gets one when ` +
        `it first exchanges a token. \`loam grant list\` shows what this store holds.`,
    );
    return { code: 2 };
  }
  return { actor: grant.actor };
}

// `loam grant <client_id> --verb=register --prefix=<p>` — the operator hands a connection authority
// over one entity namespace. Only `register` is minted here: `write` standing is the token
// exchange's to grant (it mints the actor seed in the same breath), and `admin` is not a connector's
// to hold. The grant is one operator-signed delta, so revoking it is one strike.
async function cmdGrantMint(
  clientId: string,
  parsed: Parsed,
  home: string,
  io: IO,
): Promise<number> {
  if (parsed.positionals.length > 1) {
    io.err("grant: `loam grant <client_id> --verb=<verb>` takes exactly one client id");
    return 2;
  }
  const verb = parsed.flags.get("verb");
  if (verb === undefined) {
    io.err(
      `grant: ${clientId} is not a subcommand, so this reads as a grant and wants --verb — ` +
        "today that is `--verb=register`, with a `--prefix`",
    );
    return 2;
  }
  if (verb !== "register") {
    io.err(
      `grant: --verb=${verb} is not minted here. \`register\` is the verb an operator hands out; ` +
        "write standing comes with the token exchange, and admin is not a connector's to hold.",
    );
    return 2;
  }
  const prefix = parsed.flags.get("prefix");
  if (prefix === undefined || prefix.length === 0) {
    io.err(
      "grant: --verb=register wants a non-empty --prefix — the entity namespace the connector " +
        "may register inside. Registration at the root is the operator's and is not delegable.",
    );
    return 2;
  }
  const found = connectorActor(home, clientId, "grant", io);
  if (!("actor" in found)) return found.code;

  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `grant: ${home} has no operator identity — \`loam init\` makes one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  try {
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, found.actor, "register", operator, Date.now(), prefix),
        seed,
      ),
    ]);
  } catch (err) {
    io.err(
      `grant: the ground refused this — nothing was appended: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  } finally {
    await gateway.close();
  }
  io.out(
    `loam: granted ${clientId} register standing under "${prefix}"\n` +
      `  it may register schemas whose name starts with "${prefix}" and nothing else — not the ` +
      `root, not a neighbouring namespace\n` +
      `  the grant is in ${path}; \`loam grant revoke ${clientId}\` strikes it, and the next ` +
      `request refuses`,
  );
  // The fence re-reads standing per request, but from the SERVER's own reactor, which
  // materialized at boot — a live server sees this grant only after a restart.
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

// --- the grant ledger (T205) ---------------------------------------------------------------------
//
// Every author with standing at the store entity, on one screen. Two halves joined on the author
// key: the GROUND's grant deltas, and what the HOME knows about who holds each key — its
// `user.<name>.seed` and `pen.<name>.seed` files, and its connector records.
//
// The join is loose in BOTH directions, and that is the whole design. A grant whose subject matches
// no file and no connector record is still a row (`unattributed`): a key with standing that nothing
// here can name is the most important line on the screen, never the one to drop. And a seed file
// with no grant is still a row: custody without authorization is the question `loam pen create`
// left open — is this pen provisioned, or merely present — and an omitted row answers neither.
//
// A struck grant is SHOWN struck rather than filtered. The ledger is opened on the morning a key
// leaked, and on that morning an omission and a revocation look identical.

type LedgerKind = "user" | "pen" | "connector" | "unattributed";
const KIND_ORDER: Readonly<Record<LedgerKind, number>> = {
  user: 0,
  pen: 1,
  connector: 2,
  unattributed: 3,
};

// The cell an absent fact prints: a name nothing claims, a verb nobody granted, a key this home
// cannot derive. Never blank — a blank cell reads as an oversight rather than as an answer.
const LEDGER_NONE = "—";

/**
 * One identity the home can name, and the key it holds. `author` is ABSENT when the file or record
 * exists and this command could not derive a key from it — unknown, never "nobody" (H9) — and the
 * row still prints, carrying `note` to say why.
 */
interface HomeIdentity {
  readonly kind: "user" | "pen" | "connector";
  readonly name: string;
  readonly author?: string;
  /** Facts that ride the standing column: a connector's generation and tokens, or a fault. */
  readonly note?: string;
}

/**
 * Every identity the HOME provisions, read through the same primitives `loam serve` provisions with
 * (`readUserSeed` / `readPenSeed` / `isSeedHex`), so the ledger cannot report a pen as provisioned
 * that a boot would refuse.
 *
 * THROWS if the home cannot be listed. That is deliberate: an unlistable home makes every seed file
 * invisible, and every grant in the ground would then render `unattributed` — a ledger inventing the
 * exact alarm it exists to raise.
 */
function homeIdentities(home: string): HomeIdentity[] {
  const out: HomeIdentity[] = [];
  for (const entry of readdirSync(home).sort()) {
    const match = /^(user|pen)\.(.+)\.seed$/.exec(entry);
    if (match === null) continue;
    const kind = match[1] as "user" | "pen";
    const name = match[2] as string;
    const path = kind === "user" ? userSeedPath(home, name) : penSeedPath(home, name);
    const read = kind === "user" ? readUserSeed(home, name) : readPenSeed(home, name);
    if (read.kind === "absent") continue; // raced away between the listing and the read
    if (read.kind === "unreadable") {
      out.push({ kind, name, note: `${path} is unreadable, so its key cannot be named here` });
      continue;
    }
    if (!isSeedHex(read.seed)) {
      out.push({ kind, name, note: `${path} does not hold a 64-hex seed` });
      continue;
    }
    out.push({ kind, name, author: authorForSeed(read.seed) });
  }
  return out;
}

// The connector half of the same question. A client with no grant has registered and never
// completed a token exchange, so it has no acting identity for a grant to name yet; `standing:
// false` means its seed exists and the ground append has not landed.
function connectorIdentities(file: OAuthFile): HomeIdentity[] {
  const out: HomeIdentity[] = [];
  for (const client of file.clients) {
    const name = `${client.clientId} (${client.clientName})`;
    const tokens = file.tokens.filter((t) => t.clientId === client.clientId).length;
    const facts = `generation ${client.generation} · ${tokens} live token${tokens === 1 ? "" : "s"}`;
    const grant = grantFor(file, client.clientId);
    // EVERY key this connector ever signed with, not merely its current one. Revocation destroys the
    // key and keeps the name, so a re-keyed connector is several authors under one client id, and
    // each holds standing until its own grant is struck. Naming only the latest would strand the
    // others under `unattributed` — the same hole one re-key further along.
    const revocations = revocationsFor(file, client.clientId);
    for (const r of revocations) {
      out.push({
        kind: "connector",
        name,
        author: r.actor,
        note: `revoked ${new Date(r.revokedAt).toISOString()} · ${facts}`,
      });
    }
    if (grant !== undefined) {
      out.push({
        kind: "connector",
        name,
        author: grant.actor,
        note: grant.standing ? facts : `grant pending · ${facts}`,
      });
    } else if (revocations.length === 0) {
      // Registered and never through a token exchange: there is no key to attribute anything to.
      out.push({ kind: "connector", name, note: `no acting identity yet · ${facts}` });
    }
  }
  return out;
}

interface GroundGrant {
  readonly id: string;
  readonly subject: string;
  readonly verb: string;
  readonly granter: string; // who signed it — the operator, or an admin acting under one
  readonly at: number;
  readonly prefix?: string;
  /** When an HONORED strike retired it. Absent when nothing with standing struck it. */
  readonly struckAt?: number;
  /** A negation names it and binds nothing — struck by an author with no standing, or itself struck. */
  readonly inertStrike: boolean;
  /** Why this grant is not law at all, when it is not. Malformed law binds nothing for anyone. */
  readonly defect?: string;
}

/**
 * Every grant-shaped delta filed at the store entity, whoever signed it. Whether one BINDS is
 * `grantsHeldBy`'s question and is asked separately, because the two answers are different facts: a
 * grant nobody honours is still a row, and a row that quietly vanished is the omission this ledger
 * exists to make impossible.
 *
 * A grant-shaped delta carrying no subject or no verb names nobody and confers nothing (`grantHeld`
 * matches on both), so there is no author for it to put on the screen. Constitutional law refuses
 * such a delta at the door; only a store predating that check can hold one.
 */
function groundGrants(reactor: Reactor, operator: string): GroundGrant[] {
  const out: GroundGrant[] = [];
  for (const id of reactor.byTarget(STORE_ENTITY)) {
    const delta = reactor.get(id);
    if (delta === undefined) continue;
    const filedHere = delta.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === STORE_ENTITY &&
        p.target.entity.context === CTX_GRANTS,
    );
    if (!filedHere) continue;
    let subject: string | undefined;
    let verb: string | undefined;
    let prefix: string | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind !== "primitive" || typeof p.target.value !== "string") continue;
      if (p.role === "subject") subject = p.target.value;
      if (p.role === "verb") verb = p.target.value;
      if (p.role === "prefix") prefix = p.target.value;
    }
    if (subject === undefined || verb === undefined) continue;
    // WHICH strike, not merely whether one exists. `honoredStrikeOn` runs the constitution's own
    // walk, so an inert negation — one struck itself, or signed by an author with no standing to
    // strike — never supplies the caption. Reading `negationsOf` raw would let a writer's inert
    // strike at t1 mask the operator's lawful one at t2 and under-report the exposure window, which
    // is the one number this ledger exists to get right.
    const honored = honoredStrikeOn(reactor, id, operator);
    const defect = constitutionalDefect(delta);
    out.push({
      id,
      subject,
      verb,
      granter: delta.claims.author,
      at: delta.claims.timestamp,
      ...(prefix === undefined ? {} : { prefix }),
      ...(honored === undefined ? {} : { struckAt: honored.timestamp }),
      inertStrike: honored === undefined && reactor.negationsOf(id).length > 0,
      ...(defect === undefined ? {} : { defect }),
    });
  }
  return out;
}

/**
 * Why a grant that nothing struck still binds nothing. The reasons are genuinely different and an
 * operator acts differently on each, so one catch-all sentence would be false for two of the three:
 *
 *  - MALFORMED LAW binds nothing for anyone, the operator included, and no re-granting fixes it.
 *  - REGISTER is not delegable. An admin may mint `write` and `admin` all day; `register` from any
 *    author but the operator is refused by `grantsHeldBy` no matter how sound its chain, because the
 *    store signs registrations with the OPERATOR'S key. Saying "no chain reaches the operator" here
 *    would send an operator to repair a chain that is already intact.
 *  - Otherwise the chain really is the answer: whoever signed it holds no effective admin standing.
 */
function whyNotBinding(g: GroundGrant, operator: string): string {
  if (g.defect !== undefined) return `malformed law — ${g.defect}`;
  if (g.verb === "register" && g.granter !== operator) {
    return "register standing is the operator's alone to mint, whatever the chain says";
  }
  return "no chain of admin standing reaches the operator";
}

// An author, short enough for a column and long enough to identify: the algorithm tag in full, then
// twelve characters of the key. The abbreviation never elides the middle — an operator matching a
// key against a log matches a PREFIX.
function shortAuthor(author: string): string {
  const keyAt = author.indexOf(":") + 1;
  return author.length - keyAt <= 12 ? author : `${author.slice(0, keyAt + 12)}…`;
}

// A column-aligned table. Every column but the last is padded to its widest cell; the last carries
// free text and stays ragged, and its line is trimmed so an empty cell leaves no trail.
function ledgerTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const all = [header, ...rows];
  const last = header.length - 1;
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all.map((r) =>
    `  ${r.map((cell, i) => (i === last ? cell : cell.padEnd(widths[i]!))).join("  ")}`.trimEnd(),
  );
}

interface LedgerRow {
  readonly kind: LedgerKind;
  readonly name: string;
  readonly author: string;
  readonly verb: string;
  readonly granted: string;
  readonly standing: string;
  readonly live: boolean;
  readonly at: number;
  readonly tiebreak: string;
}

async function cmdGrantList(home: string, parsed: Parsed, io: IO): Promise<number> {
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
  let identities: HomeIdentity[];
  try {
    identities = [...homeIdentities(home), ...connectorIdentities(file)];
  } catch (err) {
    io.err(
      `grant list: ${home} could not be listed, so every seed file in it is invisible here — and ` +
        `a ledger that answered "nobody holds this key" would be worse than none: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  // The standing comes from the GROUND, through the same derivation the registration door reads — so
  // this listing cannot show an operator a standing the door would not honour, or hide one it would.
  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `grant list: ${home} has no readable operator identity, so the verbs in the ground cannot ` +
        `be resolved — and a listing that guessed them would be worse than none: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  const operator = authorForSeed(seed);
  const rows: LedgerRow[] = [];
  try {
    const grants = groundGrants(gateway.reactor, operator);
    // One pass per distinct subject, reusing the door's own derivation rather than re-deriving
    // effectiveness here: two answers to "does this bind" is one too many.
    const binding = new Set<string>();
    for (const subject of new Set(grants.map((g) => g.subject))) {
      for (const held of grantsHeldBy(gateway.reactor, subject, operator)) binding.add(held.id);
    }
    const withNote = (text: string, note?: string): string =>
      note === undefined ? text : `${text} · ${note}`;

    for (const g of grants) {
      const live = binding.has(g.id);
      // "struck" is the word an operator scans this column for, so it appears in exactly ONE answer
      // here: the one where a strike WITH STANDING actually retired the grant. Every other phrasing
      // says "strike", never "struck", or a reader grepping the ledger lands on a row that is not.
      const inert = g.inertStrike ? " · a strike names it and binds nothing" : "";
      const standing = live
        ? `live${inert}`
        : g.struckAt !== undefined
          ? `struck ${new Date(g.struckAt).toISOString()}`
          : `does not bind — ${whyNotBinding(g, operator)}${inert}`;
      const common = {
        author: shortAuthor(g.subject),
        verb: g.prefix === undefined ? g.verb : `${g.verb}("${g.prefix}")`,
        granted: new Date(g.at).toISOString(),
        live,
        at: g.at,
        tiebreak: g.id,
      };
      // Every identity holding this key gets the row — a key copied into two files holds standing
      // under both names, and naming only the first would hide the second.
      const holders = identities.filter((i) => i.author === g.subject);
      if (holders.length === 0) {
        rows.push({ kind: "unattributed", name: LEDGER_NONE, standing, ...common });
      }
      for (const h of holders) {
        rows.push({ kind: h.kind, name: h.name, standing: withNote(standing, h.note), ...common });
      }
    }

    const granted = new Set(grants.map((g) => g.subject));
    for (const i of identities) {
      if (i.author !== undefined && granted.has(i.author)) continue;
      rows.push({
        kind: i.kind,
        name: i.name,
        author: i.author === undefined ? LEDGER_NONE : shortAuthor(i.author),
        verb: LEDGER_NONE,
        granted: LEDGER_NONE,
        standing:
          i.author === undefined
            ? (i.note ?? "this home cannot name its key")
            : withNote("no grant in the ground", i.note),
        live: false,
        at: 0,
        tiebreak: i.name,
      });
    }
  } finally {
    await gateway.close();
  }

  if (rows.length === 0) {
    io.out(
      `loam: nothing holds standing here — no seed file, no connector record, no grant in the ` +
        `ground.\n  the operator ${shortAuthor(operator)} needs none`,
    );
    return 0;
  }
  rows.sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.localeCompare(b.name) ||
      a.at - b.at ||
      a.tiebreak.localeCompare(b.tiebreak),
  );
  const live = rows.filter((r) => r.live).length;
  io.out(
    `loam: the grant ledger — ${rows.length} row${rows.length === 1 ? "" : "s"}, ${live} live\n` +
      `  the operator ${shortAuthor(operator)} needs no grant and holds every standing`,
  );
  for (const line of ledgerTable(
    ["kind", "name", "author", "verb", "granted", "standing"],
    rows.map((r) => [r.kind, r.name, r.author, r.verb, r.granted, r.standing]),
  )) {
    io.out(line);
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
        {
          // Same boot-materialization trap as the mint above: the strike is in the file, and a
          // live server keeps honoring the grant it booted with until it restarts.
          const staleness = servingWarning(home, path);
          if (staleness !== undefined) io.err(`loam: ${staleness}`);
        }
        return 0;
    }
  } finally {
    await gateway.close();
  }
}

// --- the erasure surface (SPEC §11, §29; T206) ---------------------------------------------------
//
// Two readers over machinery that already exists — §29.1's slate record, printed, and the per-id
// receipts `survivingTombstones` governs admission with. Neither invents erasure semantics, and
// neither widens what any sweep can destroy.
//
// A CHANNEL'S POOL IS ITS OWN FILE, and a store that does not attach it reads smaller than it is.
// A separate container's bytes are unreadable until it is attached, and `slate list` computes its
// affected set over exactly those containers — a pool attached over empty MEMORY would answer "no
// overlap" for a wall full of condemned deltas. `serve` opens them, so these verbs do too.
//
// The cold ARCHIVE is deliberately NOT opened here. A mirror is a shadow, not a second voice:
// `deltasSince` answers from the primary, and replanting what the primary lost is `serve`'s boot
// heal, not a reader's job. The archive matters where bytes are REMOVED, not where they are read.

/** The home's operator identity, or the said reason there is none. Erasure has exactly one signer. */
function operatorSeed(home: string, label: string, io: IO): string | { code: number } {
  try {
    return readSeed(home);
  } catch (err) {
    io.err(
      `${label}: ${home} has no readable operator identity, and erasure is the instance ` +
        `operator's alone — \`loam init\` makes one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return { code: 1 };
  }
}

/**
 * A gateway over the home's store with every standing channel's own pool file attached.
 *
 * `vault` is passed ONLY by `erase`, which removes bytes. A read answers from the primary —
 * `deltasSince` does — so opening the cold tier for a listing would buy nothing and would write this
 * command's genesis into the vault.
 */
async function openTiers(
  home: string,
  seed: string,
  parsed: Parsed,
  io: IO,
  vaults: readonly string[] = [],
): Promise<{ gateway: Gateway; path: string; lagged: string[] }> {
  // A LAGGING MIRROR IS A QUALIFICATION, not a diagnostic. `MirrorBackend.append` swallows a
  // mirror-write failure into `onLag` while `purge` and `holds` on that same tier can still
  // succeed — so a run can exit 0 saying the archive was swept while the tier never took the
  // tombstone. Collected rather than printed here, so the caller can file it WITH the claim it
  // weakens, or report it as a fault, depending on how the run ends.
  const lagged: string[] = [];
  const path = storePath(home, parsed.flags.get("store"));
  // One mirror per vault, folded. `MirrorBackend` composes: purge and the byte verdict each reach
  // both sides, so a nest of them reaches every tier in the chain.
  const backend: StoreBackend = vaults.reduce<StoreBackend>(
    (below, vault) =>
      new MirrorBackend(below, new ArchiveBackend(vault), {
        onLag: (err) =>
          lagged.push(
            `the archive at ${vault} is LAGGING — ` +
              `${err instanceof Error ? err.message : String(err)}. It did not take everything this ` +
              `run appended, so its line in the sweep above is weaker than it reads; the next serve ` +
              `heals it, and an erase after that reaches it.`,
          ),
      }),
    openStore(path, io),
  );
  // `channelBackend` and NOT `channelToken`: the pool's own file has to be attached, or a channel's
  // bytes sit outside this store's reach. The TOKEN only rebuilds a live syncing Channel, and none
  // of these verbs sync — carrying it would open a network client for a command that reads a store.
  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }), {
    channelBackend: channelBackendFor(home, io),
  });
  return { gateway, path, lagged };
}

// A content address, short enough for a column and long enough to identify. The abbreviation never
// elides the middle — an operator matching an id against a log matches a PREFIX. `shortAuthor` does
// the same job for an author, where the algorithm tag has to survive.
const shortId = (id: string): string => (id.length <= 13 ? id : `${id.slice(0, 12)}…`);

/**
 * The §25 pen, said out loud — because a row it holds is OUTSIDE everything these verbs print.
 *
 * `deltasSince` sets a row the driver could not admit ASIDE rather than returning it, so the reactor
 * never sees it. Two inversions follow and neither is visible on the screens above: a set-aside
 * operator negation of a tombstone leaves a WITHDRAWN erasure printing as live, and a set-aside
 * tombstone leaves a forgotten id printing as never forgotten. The receipt listing's own copy argues
 * that an omission and a revocation must not look alike; a row the reader never saw is the same
 * failure one layer further down.
 */
interface PenReading {
  /** Which of the three states this is — an empty pen, rows in it, or a pen nobody could read. */
  readonly state: "empty" | "rows" | "unreadable";
  /** The sentence to print, absent only when the pen is empty AND readable. */
  readonly text?: string;
}

async function setAsideWarning(gw: Gateway): Promise<PenReading> {
  // EVERY STORE THESE VERBS READ, not the primary alone. `openTiers` attaches each channel's pool
  // precisely so its deltas are in scope, and a pool is its own driver with its own pen — so a
  // sentence that read only the host's would report an all-clear over a container it just brought
  // into the reading.
  const stores = [gw, ...gw.quarantinePools];
  let rows = 0;
  let stranded = 0;
  const unreadable: string[] = [];
  for (const store of stores) {
    if (!isRepairable(store.backend)) continue;
    try {
      const pen = await store.backend.quarantine();
      rows += pen.length;
      stranded += strandedStrikeWarnings(pen).length;
    } catch (err) {
      unreadable.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (unreadable.length > 0) {
    return {
      state: "unreadable",
      text:
        `a §25 quarantine could not be read, so nothing here can say whether a set-aside row ` +
        `changes what is printed: ${unreadable.join("; ")}`,
    };
  }
  if (rows === 0) return { state: "empty" };
  return {
    state: "rows",
    text:
      `${rows} row(s) sit in the §25 quarantine of this store or an attached pool, and are OUTSIDE ` +
      `everything printed here — the reader never saw them` +
      (stranded === 0
        ? ""
        : `, and ${stranded} of them claim(s) to strike something, so a withdrawal may be ` +
          `reading LIVE`) +
      ". `loam repair list` names what the pen holds.",
  };
}

// A list an operator has to act on, capped so one enormous slate cannot bury the block it sits in —
// and the remainder COUNTED rather than dropped, because a silent truncation on a compliance screen
// is the omission these readers exist to prevent.
function capped(ids: readonly string[], limit = 8, total = ids.length): string {
  if (total <= limit) return ids.join(", ");
  return `${ids.slice(0, limit).join(", ")}, and ${total - limit} more`;
}

// --- `loam slate list` ---------------------------------------------------------------------------
//
// A slate prints as a BLOCK, not a table row, and `federate list` is the precedent: a store holds a
// handful of slates, each dense with compliance facts, and every address on one must be readable in
// FULL so the operator can act on it. A table would abbreviate exactly the fields a legal record
// must not abbreviate. The receipt listing below goes the other way, for the opposite reason.

const closureList = (closes: readonly string[]): string =>
  closes.length === 0 ? "none" : closes.join(", ");

function slateBlock(s: SlateReport): string[] {
  const lines: string[] = [s.container];
  const say = (label: string, text: string): void => {
    lines.push(`  ${label.padEnd(14)}${text}`);
  };
  // The FORM is named, never guessed: a reader of a permanent compliance record must never be left
  // wondering whether an identifier is a person or a preimage (§29.1).
  say(
    "requested by",
    `${s.requestedBy} (${
      s.requestedByForm === "sealed" ? "a §11 sealed commitment, not a name" : "a plain identifier"
    })`,
  );
  say("requested at", new Date(s.requestedAt).toISOString());
  // The lapse TIGHTENS what a slate closes (§29.4) — but only over a set it can read, and only if
  // that set has anything in it. Saying "`read` is closed too" about a slate that closes nothing
  // would promise a protection this store is not delivering, on the line an operator reads first.
  // The two ways to enforce nothing get their OWN sentence: `enforcedBy` returns empty for an
  // unreadable set AND for an empty one, and only the first prints an UNRESOLVED row — so one
  // shared cross-reference would point half its readers at a line that is not on the screen.
  const idle =
    s.unresolved !== undefined
      ? " — LAPSED (§29.4), and see UNRESOLVED below: no door is closed by it"
      : " — LAPSED (§29.4), and its condemned set is EMPTY: there is nothing to close a door over";
  say(
    "deadline",
    `${new Date(s.deadline).toISOString()}${
      s.lapsed
        ? s.enforced.length === 0
          ? idle
          : " — LAPSED, so `read` is closed too (§29.4)"
        : ""
    }`,
  );
  // ZERO IS NOT UNKNOWN. A slate whose frozen set cannot be read here has a condemned set — it was
  // identified and frozen at an address that is printed on the next line — and this store merely
  // cannot resolve it. Printing "0 deltas" would tell a compliance officer nothing was ever slated,
  // which is the collapse `readFrozenTerm` refuses one layer down.
  say(
    "condemned",
    s.unresolved !== undefined
      ? `UNKNOWN — a set was frozen at ${s.version}, and this store cannot read it (see UNRESOLVED)`
      : `${s.members.length} delta${s.members.length === 1 ? "" : "s"}, frozen at ${s.version}`,
  );
  say("membership", s.membershipAt);
  say("closes", `${closureList(s.closes)} — enforcing ${closureList(s.enforced)}`);
  say("record", s.record);
  if (s.reason !== undefined) say("reason", s.reason);
  // A slate that enforces nothing is the one state an operator most needs to see: reporting
  // `closes` as though it were in force would be a claim of protection never delivered.
  if (s.unresolved !== undefined) {
    say("UNRESOLVED", `${s.unresolved} — so this slate closes no door at all`);
  }
  if (s.disagreement !== undefined) say("DISAGREEMENT", s.disagreement);
  if (s.affected.length > 0) say("affected", capped(s.affected));
  if (s.affectedUnknown.length > 0) {
    say("UNKNOWN reach", `${capped(s.affectedUnknown)} — the overlap could not be computed`);
  }
  if (s.resurfacing.length > 0) {
    say(
      "resurfacing",
      `${s.resurfacing.length} claim(s) come back to life at the cut: ${capped(s.resurfacing)}`,
    );
  }
  if (s.duplicates.length > 0) {
    // NAMED, not counted. This is the one screen whose purpose is to act before the cut, and a
    // count tells an operator a copy exists without telling them which id to slate.
    // Sliced BEFORE the map: `duplicates` grows with the ground, and building a string for every
    // one of them to print eight is the walk this screen is otherwise careful to avoid.
    say(
      "duplicates",
      `${s.duplicates.length} record(s) link to a member and must be slated by their own ids: ` +
        `${capped(
          s.duplicates.slice(0, 8).map((d) => `${d.record} (${d.role} → ${shortId(d.member)})`),
          8,
          s.duplicates.length,
        )}`,
    );
  }
  if (s.acceptsIncomplete.length > 0) {
    say("accepts", `cutting around ${capped(s.acceptsIncomplete)}, at the operator's signature`);
  }
  return lines;
}

async function cmdSlate(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("slate", args);
  const sub = parsed.positionals[0];
  if (sub !== "list") {
    io.err(
      sub === undefined
        ? "slate wants a subcommand: `loam slate list`"
        : `slate: there is no \`slate ${sub}\` — today this reads, and only reads: ` +
            "`loam slate list`. Staging a slate and cutting it are deliberate acts with no CLI verb yet.",
    );
    return 2;
  }
  if (parsed.positionals.length > 1) {
    io.err("slate list takes no arguments");
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`slate list: ${unusable}`);
    return 1;
  }
  const seed = operatorSeed(home, "slate list", io);
  if (typeof seed !== "string") return seed.code;
  const { gateway, path } = await openTiers(home, seed, parsed, io);
  let slates: SlateReport[];
  let pen: PenReading;
  try {
    slates = gateway.slates();
    pen = await setAsideWarning(gateway);
  } finally {
    await gateway.close();
  }
  // STDOUT, with the claim it qualifies. `loam slate list > proof.txt` files an absence, and the
  // sentence saying the reader never saw the set-aside rows belongs in the same file.
  if (pen.text !== undefined) io.out(`loam: ${pen.text}`);
  if (slates.length === 0) {
    // SCOPED TO THE SIGNER, because that is exactly how wide the check was: a slate is the
    // operator's alone, and `readSlates` asks about THIS home's operator key. Over a store governed
    // by another key an unqualified "nothing is staged" would be an absence never verified.
    io.out(
      `loam: no slate signed by ${shortAuthor(authorForSeed(seed))} stands over ${path} — ` +
        `nothing is staged for erasure\n` +
        `  a slate names a condemned set, freezes it at one address so it cannot grow, and starts ` +
        `the clock\n  \`loam tombstones list\` reads what this store has already forgotten`,
    );
    return 0;
  }
  const lapsed = slates.filter((s) => s.lapsed).length;
  const idle = slates.filter((s) => s.enforced.length === 0).length;
  io.out(
    `loam: ${slates.length} slate${slates.length === 1 ? "" : "s"} over ${path}` +
      `${lapsed === 0 ? "" : ` — ${lapsed} past deadline`}` +
      `${idle === 0 ? "" : `${lapsed === 0 ? " —" : ","} ${idle} closing no door`}`,
  );
  for (const s of slates) for (const line of slateBlock(s)) io.out(line);
  return 0;
}

/**
 * Cold archives inside this home that the command was NOT told about.
 *
 * `loam serve --archive <dir>` does not write that name into `config.json`, so a home can own a cold
 * tier its own configuration never mentions — and every other tier a sweep reaches is discovered
 * from the GROUND and fails closed, while this one is discovered from a flag and would fail open.
 * That asymmetry is the whole reason this exists: the archive is the tier whose retention has no
 * recovery, and a report that omitted it would be false in the one direction §11 cannot undo.
 *
 * Detected by SHAPE, from the layout `ArchiveBackend` writes and nothing else does: a fan directory
 * of two hex characters holding a file named for a content address. Three deliberate widenings, each
 * because the SWEEPER is that wide and a detector narrower than its sweeper fails OPEN:
 *
 *  - the file need not sit in its matching fan (`purge` hunts a MISFILED copy, and it is still bytes);
 *  - the `.json.<pid>.tmp` straggler an interrupted append leaves counts (`purge` hunts that too);
 *  - a fan reached through a SYMLINK counts — a `Dirent` for one answers `isDirectory()` false while
 *    the path behind it is a perfectly good vault;
 *  - a fan may be named ANYTHING. `ArchiveBackend` puts no name filter on its own root entries, so a
 *    hex-only rule here would be narrower than the sweeper on a fourth axis.
 *
 * It descends a few levels, because `--archive backup/vault` resolves inside the home and a
 * single-level probe would miss it, and it tests the home ITSELF for `--archive .`.
 *
 * NAMED GAP, and it is the honest limit: `--archive` also takes an ABSOLUTE path, so a vault parked
 * outside the home is beyond any walk this command can afford. The help text and the README say so.
 */
const ARCHIVED_FILE = /^[0-9a-f]{30,}\.json(\..*)?$/;
const VAULT_SEARCH_DEPTH = 3;

/** What the scan found, and what it could not look at. An unreadable directory is neither. */
interface VaultScan {
  readonly vaults: string[];
  /** Directories the scan could not read. A guard that called these empty would fail OPEN (H9). */
  readonly unreadable: string[];
}

// ENOENT and ENOTDIR are ANSWERS: nothing is there. Every other error means the directory exists and
// this process could not look inside it — a mode bit, a foreign uid, a mount that refuses readdir.
// `ArchiveBackend` draws exactly this line for the same directories and RETHROWS the rest, so a
// probe that swallowed them would be narrower than the sweeper it exists to guard.
function listOrFault(dir: string): { entries: Dirent[] } | { unreadable: true } {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { entries: [] } : { unreadable: true };
  }
}

/** A path's real form when it exists, and itself when it does not — one spelling per directory. */
function realOrSelf(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

function scanForVaults(home: string, named: readonly string[]): VaultScan {
  const vaults: string[] = [];
  const unreadable: string[] = [];
  // REAL paths, so an alias and its target are one directory. Two spellings of one vault would
  // otherwise make the named one still count as unnamed under its other name, and naming that one
  // would flip the refusal onto the first — no invocation could ever satisfy the guard.
  const real = realOrSelf;
  const namedReal = new Set(named.map(real));
  const seen = new Set<string>();
  const walk = (dir: string, depth: number, known?: ReturnType<typeof listOrFault>): void => {
    const here = real(dir);
    if (seen.has(here)) return; // a symlink cycle is a cycle however it is spelled
    seen.add(here);
    const isNamedHere = namedReal.has(here);
    // THE LISTING THE CALLER ALREADY PAID FOR. Every fan was read once to classify it and again to
    // recurse into it, which doubles the syscalls on a home full of directories (H8).
    const listed = known ?? listOrFault(dir);
    if ("unreadable" in listed) {
      // NAMED OR NOT. Skipping a named one let the run proceed past this pre-work guard and fail
      // LATER, after the tombstone had landed, when `ArchiveBackend` rejected the same root — the
      // one state worse than refusing. It also made this guard's own sentence false: the refusal
      // tells the operator that naming the path does not clear it, and naming it did.
      unreadable.push(dir);
      return;
    }
    // The named vault is SKIPPED AS A RESULT and still walked THROUGH. Returning here would leave a
    // second vault parked INSIDE the named one invisible to this guard — and to the sweeper, which
    // reads each fan one level and never recurses. It would also make `--archive .` (the home
    // itself) switch the whole probe off.
    // THE FANS ARE PROBED WHETHER OR NOT THIS DIRECTORY WAS NAMED. Only the CONCLUSION — "this is
    // an unnamed vault" — belongs to the unnamed case. Skipping the loop for a named vault also
    // skipped its unreadable fans, and at exactly `VAULT_SEARCH_DEPTH` the recursion below stops
    // too, so an unreadable fan under a named vault at the bound was seen by nobody: the run
    // cleared this pre-work guard and failed later, after the tombstone had landed.
    let archival = false;
    const fans = new Map<string, ReturnType<typeof listOrFault>>();
    for (const entry of listed.entries) {
      // NO NAME FILTER on the fan, because `ArchiveBackend` has none: it reads every non-file
      // entry of its root and sweeps what looks like a delta inside. A hex-only rule here would be
      // narrower than the sweeper on a fourth axis, which is the failure this whole probe exists
      // to avoid — a restored backup under `vault/restored/` is bytes the purge would reach.
      if (entry.isFile()) continue;
      const fan = listOrFault(join(dir, entry.name));
      fans.set(join(dir, entry.name), fan);
      if ("unreadable" in fan) {
        unreadable.push(join(dir, entry.name));
        continue;
      }
      if (fan.entries.some((f) => ARCHIVED_FILE.test(f.name))) archival = true;
    }
    if (archival && !isNamedHere) {
      vaults.push(dir);
      return; // a vault's own fans hold files, not vaults
    }
    if (depth === 0) return;
    for (const entry of listed.entries) {
      if (entry.isFile()) continue;
      const child = join(dir, entry.name);
      const fan = fans.get(child);
      // An unreadable fan is already recorded above; walking it would record it twice.
      if (fan !== undefined && "unreadable" in fan) continue;
      walk(child, depth - 1, fan);
    }
  };
  walk(home, VAULT_SEARCH_DEPTH);
  return { vaults: vaults.sort(), unreadable: unreadable.sort() };
}

/**
 * The masks a served door reads under that no registration names. One today: §36's login reading,
 * whose hyperschema `resolveUserView` assembles and runs itself. A mask that cannot be assembled is
 * DROPPED rather than guessed at — the reading then reports one reader fewer, which is a narrower
 * claim and not a false one, and it says so.
 */
function loginDoorReadings(seed: string, unconsulted: string[]): ExtraReading[] {
  try {
    return [
      {
        reading: "LoamUser (§36's login door)",
        policy: programMaskJson(userHyperSchema(authorForSeed(seed)).body),
        // RAW, because `resolveUserView` runs this hyperschema over the reactor's own snapshot and
        // §29 read closure never reaches it. Modelled as closed, a role binding inside a standing
        // slate's condemned set is invisible in both readings and its revival goes unsaid.
        ground: "raw" as const,
      },
    ];
  } catch (err) {
    // NOT to stderr. This says the revival check speaks for one reader fewer, which is the same
    // fact `RevivalReport.unconsulted` carries to stdout — and one screen cannot report the same
    // limitation on two streams depending on which code path noticed it.
    unconsulted.push(
      `LoamUser (§36's login door) — its reading could not be assembled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/**
 * WHERE the bytes for an id still are, asked of every store this command opened — the host AND each
 * attached pool, which is the set §11's own sweep fans into.
 *
 * `gateway.backend.holds` answers for the host alone. A refusal that probed only there would print
 * nothing while a peer's delta sat legible in `channels/*.sqlite`, and its silence would read as
 * "no tier holds it" — T40's shape, arriving through a new door. A store that cannot be ASKED is
 * named separately: unprovable is not clean (H9).
 */
async function heldWhere(
  gw: Gateway,
  id: string,
): Promise<{ held: string[]; unprovable: string[] }> {
  const held: string[] = [];
  const unprovable: string[] = [];
  const named = new Map<Gateway, string>();
  for (const [entity, pool] of gw.attachedContainers) named.set(pool, entity);
  for (const store of [gw, ...gw.quarantinePools]) {
    const label = store === gw ? "this store" : (named.get(store) ?? "an attached pool");
    try {
      if (await store.backend.holds(id)) held.push(label);
    } catch (err) {
      unprovable.push(`${label} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return { held, unprovable };
}

/**
 * What a removal brought back to life, said the same way on both exits.
 *
 * `when` is the whole reason this is one function. On the success path the revival is news the
 * operator can still act on; on the FAULT path the purge has already happened, and the fault's own
 * advice is "resolve and re-run" — so the sentence must not let a reader think a re-run undoes it.
 * Nothing does. The re-run boots on the post-purge ground, where the strike is already gone and
 * nothing appears to have come back at all, which is why this is the only run that can say it.
 */
function reportRevived(
  io: IO,
  report: RevivalReport,
  host: Gateway,
  when: "now" | "already",
  // WHETHER THE THING REMOVED WAS A WITHDRAWAL. The as-of disclosure below is about a claim a
  // strike still hides in the present ground; where no strike was destroyed there is nothing for
  // that door to serve differently, and an unconditional hedge is one nobody reads.
  removedNegation = false,
  /** How many channel lenses this store serves — see the boundary line below. */
  channels = 0,
): void {
  // The success path files a document; the fault path reports a failure. Same sentences, and the
  // stream follows which of the two this is.
  const say = (line: string): void => (when === "now" ? io.out(line) : io.err(line));
  const revived = report.revived;
  // EACH BOUNDARY NAMES ITS GROUND. Two stores can register the same lens name, so a bare list can
  // print one name as both consulted and unconsulted on one screen and leave the operator unable to
  // tell which door to go read.
  const at = (rows: readonly ReadingAt[]): string =>
    capped(
      rows.map((row) => `${row.reading}${row.ground === host ? "" : " (in an attached pool)"}`),
      4,
    );
  // THE BOUNDARIES FIRST, because they qualify the list below them — and because they are the ways
  // this check can be silent for a reason other than "nothing came back".
  if (report.reopened.length > 0) {
    say(
      `loam: THAT ERASURE REOPENED ${report.reopened.length} READING(S): ${at(report.reopened)}. ` +
        `Removing what withdrew a reading brings the reading itself back, and what it now serves ` +
        `had no BEFORE to be compared against — so this run did not look. Read those doors ` +
        `directly; the list below cannot speak for them.`,
    );
  }
  if (report.remasked.length > 0) {
    say(
      `loam: ${report.remasked.length} READING(S) NOW MASK DIFFERENTLY: ${at(report.remasked)}. ` +
        `The door was not withdrawn — its rule for whose strikes bind moved, which can un-suppress ` +
        `claims wholesale. Their before no longer describes them, so this run did not compare them.`,
    );
  }
  if (report.withdrawn.length > 0) {
    say(
      `loam: THAT ERASURE CLOSED ${report.withdrawn.length} READING(S): ${at(report.withdrawn)}. ` +
        `A registration whose definition no longer loads is dropped, so removing a hyperschema body ` +
        `removes the door with it. Nothing resurfaces where there is no longer a door — but every ` +
        `"nothing came back" below now speaks for that many readers fewer.`,
    );
  }
  // TWO READERS THIS CHECK CANNOT MODEL, said where the other boundaries are said. Both are
  // properties of the READER rather than of this store's masks, so no enumeration of registered
  // Schemas reaches either.
  if (channels > 0) {
    say(
      `loam: ${channels} channel read door(s) were not modelled. A channel lens serves the POOL's ` +
        `deltas filtered by THIS store's surviving strikes, and the check above diffs each ground ` +
        `on its own — so a claim that lives in a pool and was withdrawn from here can come back ` +
        `at that door with nothing said. Read \`loam federate list\` and check those lenses.`,
    );
  }
  if (report.unconsulted.length > 0) {
    say(
      `loam: ${report.unconsulted.length} reading(s) could not be consulted at all — ` +
        `${at(report.unconsulted)}. A hyperschema that masks two ways has no single reading, so ` +
        `the check below speaks for that many readers fewer.`,
    );
  }
  // BEFORE THE EARLY RETURN. The sentence below is about a claim that is identical in both
  // readings and live only at the as-of door — which is exactly the case where this list is EMPTY.
  // Printed after the return, the disclosure was suppressed in the only state it was written for,
  // and silence on this screen reads as "nothing came back".
  if (removedNegation) {
    say(
      `loam: and §26's AS-OF door was not read. It reconstructs the ground at a timestamp, so a ` +
        `claim still withdrawn today can read live there once the strike is destroyed — the two ` +
        `readings this run took are of the PRESENT ground and cannot see it.`,
    );
  }
  if (revived.length === 0) return;
  // WHICH READER, per claim, because a store does not have one. Naming the mask is the difference
  // between a fact and a guess, and the two shipped masks genuinely disagree about the same delta.
  // NAMES THE READINGS, never a category. A store's readers are its registered Schemas plus the
  // `drop` floor, and which of them can see a returned claim is the fact an operator acts on — an
  // adjective like "governed" describes a class this store may not contain.
  // UNDER THE MASK THAT GOVERNS THOSE READINGS, not "to" them. The live set is the whole ground a
  // mask admits; a lens ALSO has its own gather, which selects an entity and a set of pointer
  // contexts. So this names every door whose suppression rule stopped hiding the claim, and a lens
  // whose gather does not select the delta will not show it. Saying "live again to Note" about a
  // grant delta that no Note reading can ever return is a false sentence on a compliance screen.
  const where = (r: Revival): string =>
    `${r.id} — live again under the mask that governs ${capped(r.readings, 4)}${
      r.ground === host ? "" : ", in an attached pool rather than at this store's own door"
    }`;
  say(
    // NOT "that was a strike": the removed delta is whatever it was, and a grant can shrink the
    // trusted-striker set and free claims without having withdrawn any of them itself.
    // DISTINCT CLAIMS in the headline, one ROW per place each came back. A claim readable again in
    // this store and in a pool is one claim in two doors, and counting the rows would inflate the
    // number an operator reads first.
    `loam: THAT ERASURE ${when === "now" ? "BROUGHT" : "HAS ALREADY BROUGHT"} ` +
      `${new Set(revived.map((r) => r.id)).size} CLAIM(S) BACK. Removing it un-suppressed them:\n` +
      revived
        .slice(0, 8)
        .map((r) => `    ${where(r)}`)
        .join("\n") +
      (revived.length > 8 ? `\n    and ${revived.length - 8} more` : "") +
      "\n" +
      (when === "already"
        ? `  This is DONE and re-running the erase does not undo it: what was removed is gone, and ` +
          `the next run will see nothing come back.\n`
        : "") +
      `  Read them. If any should stay withdrawn, strike it again — a fresh negation is free, and ` +
      `reversible in a way an erasure is not.`,
  );
}

// --- `loam erase <deltaId> --reason "<why>"` -----------------------------------------------------
//
// One delta, one order, one receipt. This WRAPS §11's existing single-delta erase and adds no
// erasure semantics: the same single authority, the same completeness guard, the same byte verdict
// tier by tier. Nothing becomes deletable here that an embedding script could not already delete.
//
// The archive IS opened for this verb, because this is where bytes are REMOVED. A purge that swept
// only the primary would leave a cold copy at rest and report the erasure complete — the report
// false in the one direction §11 cannot recover from.

async function cmdErase(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("erase", args);
  const id = parsed.positionals[0];
  if (id === undefined) {
    io.err(
      'erase wants the id of one delta: `loam erase <deltaId> --reason "<why>"` — ' +
        "`loam tombstones list` reads the receipts it leaves",
    );
    return 2;
  }
  if (parsed.positionals.length > 1) {
    io.err(
      "erase takes exactly one delta id. §11 forgets one record per order; destroying a whole " +
        "identified set is a slate and its cut (§29), not a longer command line.",
    );
    return 2;
  }
  const reason = parsed.flags.get("reason");
  if (reason === undefined || reason.trim().length === 0) {
    io.err(
      "erase refused without --reason: a receipt that cannot say why is a receipt made less " +
        "honest, and the receipt is all that outlives the record.\n" +
        `  \`loam erase ${id} --reason "<why this record is being forgotten>"\`\n` +
        "  Nothing was erased.",
    );
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`erase: ${unusable}`);
    return 1;
  }
  const seed = operatorSeed(home, "erase", io);
  if (typeof seed !== "string") return seed.code;
  // REPEATABLE, and UNIONED with the home's own config. One home can hold more than one cold
  // tier, and a last-wins flag left such a home permanently refused: name either vault and the
  // other is still unnamed, so no invocation satisfied the guard. Two things this is NOT:
  //
  //  - not a delimited list. No delimiter is safe inside a path, and a comma in one would silently
  //    become two wrong paths — `ArchiveBackend` MKDIRS its root, so both would be created empty,
  //    both would answer "no bytes here", and the screen would report a vault as swept that this
  //    command had just invented beside it.
  //  - not a REPLACEMENT for config.json's archive. Every other tier is discovered from the ground
  //    and fails closed; dropping a configured vault because a flag was also given would be the one
  //    tier a flag can silently switch off.
  const seenVault = new Set<string>();
  const vaults = [
    archivePath(home),
    ...(parsed.repeated.get("archive") ?? []).map((one) => archivePath(home, one)),
  ]
    .filter((one): one is string => one !== undefined)
    .filter((one) => {
      const key = realOrSelf(one);
      if (seenVault.has(key)) return false; // two spellings of one vault are one vault
      seenVault.add(key);
      return true;
    });
  // BEFORE ANY WORK, the same discipline §27.7's completeness guard applies to a container store:
  // a tier this command was not told about would be a silent gap in the sweep, so it refuses rather
  // than purging the primary and calling the erasure complete.
  const scan = scanForVaults(home, vaults);
  if (scan.unreadable.length > 0) {
    io.err(
      `erase ${id} refused before any work began: ${capped(scan.unreadable)} could not be read, so ` +
        `this command cannot say whether ${home} holds a cold archive it was not told about. A ` +
        `directory that cannot be examined has proven nothing, and the tier it might be is the one ` +
        `whose retention has no recovery.\n` +
        `  This is a PERMISSIONS problem and only permissions clear it: naming that path with ` +
        `--archive does not, because a directory the sweep cannot read is not a tier this command ` +
        `can sweep either. Make it readable, or move it out of ${home}. Nothing was erased.`,
    );
    return 1;
  }
  // ABSOLUTE, because that is the only spelling `--archive` accepts back. A relative value is
  // re-resolved INSIDE the home, so a home-prefixed path pasted from this refusal becomes
  // `<home>/<home>/…`, matches nothing, and fires the same refusal again — a loop an operator
  // cannot leave by following the instruction. Absolute for an absolute `--home` too, where it
  // already worked: one spelling, not one that depends on how the home was written.
  const unnamed = scan.vaults.map((v) => resolve(v));
  if (unnamed.length > 0) {
    io.err(
      `erase ${id} refused before any work began: ${home} holds a cold archive this command was ` +
        `not told about — ${capped(unnamed)}. \`loam serve --archive <dir>\` does not write that ` +
        `name into config.json, so a sweep here would purge the primary and report a completeness ` +
        `it never verified, on the one tier whose retention has no recovery.\n` +
        `  Name it and re-run: \`loam erase ${id} --reason "…" --archive <dir>\`, REPEATING ` +
        `--archive once per vault — the value is a path and is never split, so a comma inside one ` +
        `names a directory that does not exist and this command would create it. Or move the vault ` +
        `out of ${home}. Nothing was erased.`,
    );
    return 1;
  }
  // WHICH OF THESE ALREADY EXISTED. `scanForVaults` is meticulous about an UNNAMED vault and
  // tests a named one not at all — and `ArchiveBackend` MKDIRS its root, so a mistyped `--archive`
  // becomes an empty tier that answers "no bytes here" and is then listed as swept. Recorded before
  // anything opens it, and disclosed beside the sweep.
  const invented = vaults.filter((one) => !existsSync(one));
  const { gateway, path, lagged } = await openTiers(home, seed, parsed, io, vaults);
  let done: Awaited<ReturnType<Gateway["erase"]>>;
  let pools: number;
  let revived: RevivalReport;
  let pen: PenReading;
  // Hoisted because the success screen below the try/catch reads them too.
  let wasNegation = false;
  let channelCount = 0;
  try {
    pools = gateway.quarantinePools.size;
    pen = await setAsideWarning(gateway);
    // WHAT COMES BACK, OBSERVED RATHER THAN DERIVED. The live set is read here and again after the
    // order, and the difference is the answer — see `liveEverywhere` for why no walk of the removed
    // delta's own pointers can be trusted to find it.
    // THE LOGIN DOOR'S READING IS NOT A REGISTERED ONE. `resolveUserView` runs its hyperschema
    // directly, so the store's registration table does not hold it — and a revoked role binding
    // coming back at that door is precisely the event this warning exists for.
    const doorFaults: string[] = [];
    const doors = loginDoorReadings(seed, doorFaults);
    for (const fault of doorFaults) {
      io.out(`loam: ${fault}. The revival check below speaks for one reader fewer.`);
    }
    // ONE MOMENT FOR BOTH READINGS. §29 read closure lapses on a deadline, so two clocks would
    // report a slate's own expiry as claims this erasure brought back.
    // WAS THE THING REMOVED A WITHDRAWAL? Asked while it is still here; afterwards there is
    // nothing left to ask. It decides only whether §26's as-of door is worth naming below.
    wasNegation =
      gateway.reactor.get(id)?.claims.pointers.some((p) => p.role === "negates") === true;
    // Counted while the store is open, for the boundary line about channel lenses.
    channelCount = gateway.channelStatus().length;
    const moment = Date.now();
    const before = readGrounds(gateway, doors, moment);
    // SAID BEFORE THE PURGE, not after. On a large store the two readings are the slow part of
    // this verb, and a screen that prints nothing until the end invites the one response that
    // cannot be undone: an interrupt in the middle of a sweep.
    io.out(
      `loam: reading ${before.reduce((n, g) => n + g.present.size, 0)} delta(s) across ` +
        `${before.length} ground(s) to see what this removal brings back. On a large store this ` +
        `is the slow part — let it finish; an interrupt mid-sweep is worse than the wait.`,
    );
    const cameBack = (): RevivalReport =>
      revivedAcross(before, readGrounds(gateway, doors, moment));
    try {
      done = await gateway.erase(id, { reason });
    } catch (err) {
      // 1, never 2. Every refusal the gateway raises here — nothing to erase, a container this
      // sweep cannot reach, a tier that could not be proven clean — is a state of the STORE, and 2
      // stays what a malformed invocation means. The distinction is what lets a script retry one
      // and fix the other.
      io.err(`erase ${id}: ${err instanceof Error ? err.message : String(err)}`);
      // A FAILED ERASURE STILL PURGED THE LOCAL TIERS. §11 lands the tombstone, purges, re-seats,
      // and only then reports a replica that refused — so a strike can already be gone while the
      // order reads as failed, and the claim it withdrew is already live. Said HERE because no
      // later run can say it: the re-run boots on the post-purge ground, where nothing came back.
      // A failed RE-SEAT leaves the old reactor in place, so this reading can be taken over ground
      // the purge already changed underneath it. Silence would then read as "nothing came back"
      // when the honest answer is "this could not be measured" (H9). The cheap tell is the erased
      // delta itself: if it is still in the reactor, the removal did not land here.
      // EVERY GROUND THE SWEEP TOUCHED, not the host alone. A pool re-seats in its own turn and
      // a failure there is folded into the fault list, leaving no mark on the host — so asking the
      // host only reports "measured" about a reading taken over a pool the purge changed underneath.
      if ([gateway, ...gateway.quarantinePools].some((g) => g.reactor.get(id) !== undefined)) {
        io.err(
          `loam: the removal did not complete in this store's own ground, so the revival reading ` +
            `below was taken over a ground that may not reflect the purge. Treat an empty answer ` +
            `as UNMEASURED rather than as nothing having come back.`,
        );
      }
      reportRevived(io, cameBack(), gateway, "already", wasNegation, channelCount);
      const already = survivingTombstones(gateway.reactor, gateway.operatorAuthor).find(
        (t) => tombstoneTarget(t.claims) === id,
      );
      if (already !== undefined) {
        // A receipt exists — but a receipt is a promise, and this run just failed to keep one. The
        // two states read very differently to a compliance officer, so the sweep is ASKED rather
        // than assumed: an id erased cleanly long ago, versus one whose tombstone stands over bytes
        // that are still here.
        // THE PROBE CANNOT ASK AN UNATTACHED CONTAINER, and the completeness guard fires
        // precisely because one is declared and not attached. `erasureOutstanding` walks the host,
        // its tombstones and the ATTACHED pools — so over exactly the state that made this run
        // refuse, its silence means "not asked" rather than "clean". Read as clean, this screen
        // tells a compliance officer the store forgot a record, naming the settled date, about the
        // one tier it could not look in.
        const stores = unreachableStoreReport(gateway);
        const unreachable = stores.faultEntities;
        // A KEPT CONTAINER IS NOT ASKED EITHER. `unreachableStoreReport` routes a container covered
        // by a surviving detach record to `kept` rather than to `faults`, and `erasureOutstanding`
        // walks only what is ATTACHED — so a store whose first run honestly printed KEPT OUTSIDE
        // would have its second run print a settled date with no mention of it.
        const keptNote =
          stores.kept.length === 0
            ? ""
            : ` ${stores.kept.length} container(s) were KEPT OUTSIDE this sweep at your own ` +
              `say-so, and were not asked: this speaks for the tiers this run entered.`;
        // THE SAME THREE STATES THE RECEIPT READER PRINTS. `erasureOutstanding` folds "a tier
        // refused the question" into "outstanding", so this screen asserted the sweep was NOT
        // finished over a store where nothing had been established either way — while
        // `tombstones show` called that same state UNPROVEN. One store, two answers.
        const standing = await erasureStanding(gateway, id).catch((): ErasureStanding => "unasked");
        const outstanding = standing === "held" || standing === "owed";
        const recorded = new Date(already.claims.timestamp).toISOString();
        const reader = `\`loam tombstones show ${already.id}\``;
        // THREE STATES, because two of them are not the same fact. The sweep is measurably
        // unfinished; or it is unfinished-or-not and this run cannot tell; or it settled. Only the
        // last may name a date and call the record forgotten.
        io.err(
          outstanding
            ? `loam: a receipt already names ${id}, recorded ${recorded} — and the sweep it ` +
                `promised is NOT finished. The record is not forgotten until it settles; re-run ` +
                `once the fault above is resolved. ${reader}`
            : standing === "unasked"
              ? `loam: a receipt already names ${id}, recorded ${recorded} — and this run CANNOT ` +
                `SHOW that the sweep it promised finished: a tier refused the question, so ` +
                `nothing here was measured in either direction. ${reader}`
              : unreachable.length > 0
                ? `loam: a receipt already names ${id}, recorded ${recorded} — and this run ` +
                  `CANNOT SHOW that the sweep it promised finished. ${capped(unreachable, 4)} ` +
                  `could not be reached, and an unattached container is the one tier this probe ` +
                  `cannot ask, so its silence is not an answer. Attach it and re-run before ` +
                  `calling this settled. ${reader}`
                : `loam: a receipt already names ${id}, ORDERED at ${recorded}, and this run ` +
                  `asked every tier it opened: none of them still holds it.${keptNote} ${reader}`,
        );
      }
      // "NOT HELD HERE" IS A CLAIM ABOUT THE GROUND, NOT ABOUT THE BYTES. Asked rather than
      // assumed — and the causes are LISTED, never diagnosed: this probe reaches every tier the
      // command opened, so a true answer could be a set-aside row, a cold copy no read replants, or
      // a purge that refused. Naming one of the three as the cause would be a second guess wearing
      // the authority of a measurement.
      const where = await heldWhere(gateway, id);
      if (where.held.length > 0) {
        io.err(
          `loam: and yet bytes filed under ${id} are still HELD by ${capped(where.held, 4)}. The ` +
            `refusal above speaks for the GROUND — what the reactor admitted — and this speaks for ` +
            `the disk. Three things look like this, and nothing here can tell them apart: a row set ` +
            `aside by §25 and never admitted${
              pen.state === "empty"
                ? " — though the pen is EMPTY, so not that one here"
                : pen.state === "rows"
                  ? ` — and the pen is NOT empty: ${pen.text}`
                  : ` — and the pen COULD NOT BE READ, so it is not ruled out either: ${pen.text}`
            }, a cold ` +
            `copy in an archive that no read replants (\`loam serve\` heals at boot, and an erase ` +
            `can reach it after), or a purge that refused.`,
        );
      }
      if (where.unprovable.length > 0) {
        io.err(
          `loam: and ${capped(where.unprovable, 3)} could not be asked whether ${id} is still ` +
            `there. A tier that cannot answer has proven nothing.`,
        );
      }
      // THE GUARD'S OWN ADVICE NAMES LIBRARY CALLS. `openContainer` and `detach()` are embedding
      // API, and an operator reading this in a terminal has neither — so the refusal, left alone,
      // sets up a retry loop they cannot break. Say what CAN be done from here.
      if (unreachableStoreReport(gateway).faultEntities.length > 0) {
        io.err(
          `loam: \`openContainer\` and \`detach()\` above are EMBEDDING API and no CLI verb reaches ` +
            `them. From a terminal: a federation channel's pool re-attaches on its own the next time ` +
            `any command boots this home, so if the named container is a channel, re-run this — and ` +
            `if it is not, the container was opened by an embedder, and only that embedder can ` +
            `attach or detach it. \`loam federate list\` names the channels this home holds.`,
        );
      }
      return 1;
    }
    // THE RECEIPT OUTLIVES A FAILED READING. `cameBack` walks slates, masks and every pool, and
    // any of that can throw — over a ground this erase has just changed. Thrown here, the run
    // would purge the bytes, land the tombstone, and print a stack trace instead of the receipt id
    // the operator needs to read it back. The reading is a QUALIFICATION of the claim; losing it
    // must not lose the claim.
    try {
      revived = cameBack();
    } catch (err) {
      revived = { revived: [], remasked: [], reopened: [], withdrawn: [], unconsulted: [] };
      io.out(
        `loam: the revival reading could not be taken — ` +
          `${err instanceof Error ? err.message : String(err)}. The erasure below is DONE; what ` +
          `it may have brought back was not measured, so treat the silence as UNMEASURED rather ` +
          `than as nothing having come back.`,
      );
    }
  } finally {
    await gateway.close();
  }
  const swept = [
    path,
    ...vaults.map(
      (one) => `the archive at ${one}${invented.includes(one) ? " (CREATED BY THIS RUN)" : ""}`,
    ),
    ...(pools === 0 ? [] : [`${pools} attached channel pool${pools === 1 ? "" : "s"}`]),
  ];
  io.out(
    `loam: erased ${done.erased}\n` +
      `  receipt      ${done.tombstone}${done.minted ? "" : "  (REUSED, not minted by this run)"}\n` +
      `  spoken by    ${done.spokenBy ?? `${LEDGER_NONE} this receipt does not record whose record it forgot`}\n` +
      // THE RECEIPT'S OWN SENTENCE, never the flag's. A retry after a fault REUSES the standing
      // tombstone and drops `--reason` on the floor, so echoing the argument would print one reason
      // here and a different one from `tombstones show` on the very next line.
      `  reason       ${done.reasons.length === 0 ? `${LEDGER_NONE} this receipt records none` : done.reasons.join(" · ")}\n` +
      (done.minted || done.reasons.includes(reason)
        ? ""
        : `  YOUR --reason IS NOT ON THE RECEIPT: this run reused the one an earlier run minted, and\n` +
          `  a receipt is immutable. To say something else, strike it (forgiveness, §11) and erase again.\n`) +
      `  the bytes are gone, asked tier by tier: ${swept.join(", ")}\n` +
      `  \`loam tombstones show ${done.tombstone}\` reads the receipt back` +
      // The count now spans every WALKABLE tier the byte verdict walks (T216) — a pool-resident
      // dangler is counted here, not just the primary's. It does not span a WALL: a tier the verdict
      // names `unproven` cannot be reached to enumerate its danglers, so the count omits it, as it must.
      (done.citations.length === 0
        ? ""
        : `\n  ${done.citations.length} surviving delta(s) still point at the hole: ` +
          capped(done.citations)) +
      (done.kept.length === 0
        ? ""
        : `\n  KEPT OUTSIDE this sweep, at your own say-so — a detach record covers ` +
          `${capped(done.kept)}`),
  );
  reportRevived(io, revived, gateway, "now", wasNegation, channelCount);
  // A RETRY ANSWERS FOR ITSELF ONLY. When the receipt was reused, an earlier run already purged
  // whatever it purged — this run booted on that ground, so an empty revival reading here is a
  // statement about this run and not about the erasure. The fault path carries the same caveat for
  // the same reason; silence would let a second operator read a clean screen and conclude nothing
  // ever came back.
  if (!done.minted) {
    io.out(
      `loam: this run REUSED a standing receipt, so the revival reading above answers for THIS run ` +
        `only. Whatever an earlier run freed was already free when this one started, and no run ` +
        `after the first can see it.`,
    );
  }
  // A store the sweep deliberately did not enter cannot be read for revivals either. The KEPT line
  // above names those containers; this says what the silence over them is worth.
  const looked =
    revived.reopened.length === 0 &&
    revived.remasked.length === 0 &&
    revived.unconsulted.length === 0;
  if (done.kept.length > 0) {
    io.out(
      `loam: the kept container(s) above were not entered for revivals either${
        revived.revived.length === 0
          ? `, and nothing came back in the stores this run did read`
          : ` — the claims listed above are the ones it FOUND, in the stores it read`
      }${looked ? "" : ", and the boundaries above name readings it could not compare"}. A strike ` +
        `removed from a kept store would revive there unseen.`,
    );
  }
  // WHAT THE SWEEP DOES NOT REACH, on every run. The home surfaces and the ESM tier come from the
  // same two constants `health()` reads; the erasure-wide limits come from the constant the §29.7
  // compliance receipt reads. An operator who forgets a user's record delta and reads a bare
  // "erased" would believe the home's own credential file went with it. It did not, and a copy
  // re-spoken under another id did not either — said here before anyone has to ask.
  // THE BYTE VERDICT CANNOT SEE A SET-ASIDE ROW. `holds` asks the table for the erased ID, and a
  // §25 row is precisely one whose stored claims no longer match the id it is filed under — so an
  // erased record's plaintext can be legible inside a row filed under a different id, and every
  // tier still answers "gone". The two read-only verbs already disclose the pen; the verb that
  // makes the byte claim is the one that most needs to.
  if (pen.text !== undefined) {
    io.out(
      `loam: ${pen.text}\n  AND THE VERDICT ABOVE COULD NOT SEE THEM: a byte probe asks by id, while a ` +
        `set-aside row holds another delta's claims under its own — so an erased record can still ` +
        `be legible inside one.`,
    );
  }
  // AN ARCHIVE OUTSIDE THE HOME IS THE ONE TIER THIS RUN CANNOT LOOK FOR. `--archive` takes an
  // absolute path, so `serve --archive /var/backups/vault` leaves a cold tier that config.json
  // never names and no walk of the home can find. The help text and the README both say so; the
  // screen that makes the BYTE CLAIM said nothing, which is the one place it matters.
  for (const lag of lagged) io.out(`loam: ${lag}`);
  if (invented.length > 0) {
    io.out(
      `loam: ${capped(invented, 4)} did not exist before this run and was created empty by it. An ` +
        `empty tier answers "no bytes here", so its line above proves nothing — if you meant a ` +
        `vault this store is actually served with, that vault still holds this record and this run ` +
        `did not touch it.`,
    );
  }
  // TRUE ON BOTH BRANCHES, and it used to print on only one. An archive at an ABSOLUTE path
  // outside the home is invisible to the probe whether or not another vault was named — so the
  // operator who names an in-home vault reads "asked tier by tier" as the whole answer while
  // /var/backups still holds the record. The search bound is disclosed with it: the walk reaches a
  // few levels inside the home and a vault parked deeper is equally out of sight.
  io.out(
    vaults.length === 0
      ? `loam: NO cold archive was consulted — this home's config.json names none and none was ` +
          `passed. The probe that cleared this run only looked inside ${home}, and only ` +
          `${VAULT_SEARCH_DEPTH} levels deep. If this store is served with \`--archive <path>\`, ` +
          `that vault still holds this record: re-run naming it.`
      : `loam: the archive(s) named above were swept. A vault at an ABSOLUTE path outside ${home} ` +
          `is invisible to the probe that cleared this run, as is one deeper than ` +
          `${VAULT_SEARCH_DEPTH} levels inside it — neither was looked for, and neither is covered ` +
          `by the verdict above. Name every cold tier this store is served with.`,
  );
  io.out("loam: what an erasure does NOT reach, and never claims to:");
  for (const surface of [
    ...UNSWEPT_AUTH_SURFACES,
    ...ESM_RESIDENCY_DISCLOSURE,
    ...ERASURE_NON_CLAIMS,
  ]) {
    io.out(`  ${surface}`);
  }
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) {
    io.out(`loam: ${staleness}`);
    io.out(
      "loam: for an erasure that is worse than a stale read — a running server can still SERVE " +
        "the bytes this command removed, out of the memory it booted with. Restart it.",
    );
  }
  return 0;
}

// --- `loam tombstones list | show <id>` ----------------------------------------------------------

// WHAT A STANDING RECEIPT IS WORTH, in one cell. A tombstone is a PROMISE: §11 lands it, then
// purges, then reports a replica that refused — so a receipt can stand over bytes that are still on
// this disk. Printing "forgotten at <date>" from the receipt alone states a completion nothing
// asked about, which is the overclaim these screens exist to prevent.
const SWEEP_CELL: Record<ErasureStanding, string> = {
  settled: "swept — no tier this run opened still holds it",
  held: "NOT SWEPT — a tier this run opened STILL HOLDS the bytes",
  owed: "NOT SETTLED — a store in reach has no receipt for it yet",
  unasked: "UNPROVEN — a tier refused the question, so nothing here was measured",
};

function receiptDetail(r: TombstoneReceipt, standing: ErasureStanding): string {
  const lines = [`loam: receipt ${r.tombstone}`];
  const say = (label: string, text: string): void => {
    lines.push(`  ${label.padEnd(14)}${text}`);
  };
  say("erased", r.erased);
  // A stated absence, never a blank. The door requires `spoken-by`, but replay does not, so a
  // receipt replanted from a cold copy can survive without one — and an empty cell on a compliance
  // log reads as an oversight rather than as the answer it is.
  say(
    "spoken by",
    r.spokenBy ?? `${LEDGER_NONE} this receipt does not record whose record it forgot`,
  );
  say("ordered by", `${r.orderedBy} (the instance operator — §11 admits no other signer)`);
  // ORDERED, not finished. The two are one act only when the sweep below says so.
  say("ordered at", new Date(r.at).toISOString());
  say(
    "reason",
    r.reasons.length === 0 ? "none recorded — this receipt cannot say why" : r.reasons.join(" · "),
  );
  if (r.slate !== undefined) say("slate", `${r.slate} — one member of that cut (§29.6)`);
  // THE DATE ABOVE IS THE ORDER'S, NOT THE SWEEP'S. Asked here rather than assumed, because this is
  // the screen a compliance officer reads.
  say("sweep", SWEEP_CELL[standing]);
  lines.push(
    "  the receipt remembers THAT this id was forgotten, and none of what it said — which is what",
    "  makes keeping it honest.",
  );
  return lines.join("\n");
}

/** The receipts an invocation will actually print — all of them for `list`, one row for `show`. */
function wantedRows(
  receipts: readonly TombstoneReceipt[],
  sub: "list" | "show",
  wanted: string | undefined,
): string[] {
  const rows = sub === "list" ? receipts : receipts.filter((r) => matchesReceipt(r, wanted ?? ""));
  return rows.map((r) => r.erased);
}

/**
 * Either address answers, and a PREFIX of either does too.
 *
 * The listing abbreviates every id to twelve characters, and its own closing line tells the
 * operator to run `loam tombstones show <id>`. Matching only in full made that instruction
 * unfollowable from the screen that prints it — the same shape as a refusal naming a path its own
 * flag will not take. An ambiguous prefix is refused rather than guessed.
 */
function matchesReceipt(r: TombstoneReceipt, wanted: string): boolean {
  if (wanted.length < 8) return r.tombstone === wanted || r.erased === wanted;
  return r.tombstone.startsWith(wanted) || r.erased.startsWith(wanted);
}

async function cmdTombstones(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("tombstones", args);
  const sub = parsed.positionals[0];
  if (sub !== "list" && sub !== "show") {
    io.err(
      sub === undefined
        ? "tombstones wants a subcommand: `loam tombstones list`, or `loam tombstones show <id>`"
        : `tombstones: there is no \`tombstones ${sub}\` — the reader is ` +
            "`loam tombstones list` and `loam tombstones show <id>`",
    );
    return 2;
  }
  const wanted = parsed.positionals[1];
  if (sub === "show" && wanted === undefined) {
    io.err(
      "tombstones show wants an id: `loam tombstones show <id>` — the receipt's own address, or " +
        "the id it erased",
    );
    return 2;
  }
  if (parsed.positionals.length > (sub === "show" ? 2 : 1)) {
    io.err(`tombstones ${sub} takes ${sub === "show" ? "exactly one id" : "no arguments"}`);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`tombstones ${sub}: ${unusable}`);
    return 1;
  }
  const seed = operatorSeed(home, `tombstones ${sub}`, io);
  if (typeof seed !== "string") return seed.code;
  // THE COLD TIER IS OPENED HERE, unlike in the slate reader, because this screen makes a claim
  // ABOUT THE BYTES. The archive stays shut where a verb only READS the ground — a mirror is a
  // shadow and `deltasSince` answers from the primary — but "swept" is a byte verdict, and one
  // computed without asking the vault this home's own config.json names is the overclaim this
  // whole file exists to refuse.
  //
  // UNCONDITIONALLY, exactly as `erase` opens it. A prior `existsSync` guard here failed OPEN in
  // the one direction that costs: a vault behind an unreadable parent, or an unmounted path,
  // answers "does not exist" to a stat — so the tier was skipped, no probe could throw, and every
  // row printed SWEPT about a store nobody had asked. Opened, the same directory makes `holds`
  // throw, and the cell reads UNPROVEN, which is what was actually established.
  const configured = archivePath(home);
  const cold = configured === undefined ? [] : [configured];
  const { gateway, path } = await openTiers(home, seed, parsed, io, cold);
  let ledger: { receipts: TombstoneReceipt[]; inert: number };
  let pen: PenReading;
  let standings: StandingReport;
  let outside: string[] = [];
  try {
    ledger = receiptLedger(gateway.reactor, gateway.operatorAuthor);
    pen = await setAsideWarning(gateway);
    // ASKED WHILE THE TIERS ARE STILL OPEN. `openTiers` has the host and every attached pool right
    // here; once this block closes them the screen can only repeat what the receipt says, and a
    // receipt is a promise rather than a report. One walk of the tombstone set per ground, then a
    // point lookup per id — never a scan per row.
    // ONLY WHAT THIS INVOCATION WILL PRINT. `show` names one receipt; asking the standing of
    // every receipt in the ledger to print one row is a walk per row of a screen nobody asked for.
    // `list` prints them all, so it pays for them all.
    standings = await erasureStandings(gateway, wantedRows(ledger.receipts, sub, wanted));
    const stores = unreachableStoreReport(gateway);
    outside = [...stores.faultEntities, ...stores.kept];
  } finally {
    await gateway.close();
  }
  const standingOf = (erased: string): ErasureStanding =>
    standings.standings.get(erased) ?? "unasked";
  // STDOUT, for the reason the slate reader gives: a filed absence carries its own limits.
  if (pen.text !== undefined) io.out(`loam: ${pen.text}`);
  // AND THE TIER THIS SCREEN COULD NOT ASK. `--archive <path>` never writes its name into
  // config.json, so a home can be served with a cold vault its own configuration does not mention —
  // and every "swept" below then speaks for tiers that do not include it.
  io.out(
    configured !== undefined
      ? `loam: the sweep column below asked ${path}, every attached pool, and the cold archive at ` +
          `${configured}. A vault this home is served with under \`--archive\` but does not name ` +
          `in config.json was NOT asked, and is not covered by any verdict here.`
      : `loam: the sweep column below asked ${path} and every attached pool. This home's ` +
          `config.json names no cold archive — if this store is served with \`--archive <dir>\`, ` +
          `that vault was NOT asked and may still hold what a row here calls swept.`,
  );
  // AND THE CONTAINERS THIS SWEEP WOULD NOT HAVE ENTERED. `unreachableStoreReport` routes a
  // container covered by a detach record to `kept` and an unattached one to `faults`; neither is
  // in the probe's reach, so a row can read SWEPT over bytes sitting in either. The erase screens
  // treat this disclosure as load-bearing, and this is the screen a compliance officer reads.
  if (outside.length > 0) {
    io.out(
      `loam: ${outside.length} container(s) are OUTSIDE every verdict below — ` +
        `${capped(outside, 4)}. A container kept out at your own say-so, or declared and not ` +
        `attached, is not asked by this probe, and a row can read swept while its bytes sit there.`,
    );
  }

  if (sub === "show") {
    // EITHER address answers. The operator holding a complaint has the id that was erased; the
    // operator holding an erase's own output has the receipt's address, and neither should have to
    // know which of the two this verb wanted.
    const found = ledger.receipts.filter((r) => matchesReceipt(r, wanted ?? ""));
    // AN AMBIGUOUS PREFIX IS NOT A CHOICE THIS COMMAND MAY MAKE. Two receipts under one prefix is
    // an operator asking about a row this screen cannot identify, and picking either would answer
    // a question nobody asked.
    if (found.length > 1 && !found.some((r) => r.tombstone === wanted || r.erased === wanted)) {
      io.err(
        `tombstones show: ${wanted} names ${found.length} receipts here — ` +
          `${capped(found.map((r) => shortId(r.tombstone)))}. Give more of the address.`,
      );
      return 2;
    }
    if (found.length === 0) {
      // "NOT AN ID THIS STORE FORGOT" WOULD CONTRADICT THE GROUND for a forgiven id. Striking a
      // tombstone withdraws the erasure, and the receipt leaves the surviving set — so an id this
      // store really did forget, and then forgave, reads here exactly like one it never held. The
      // count of receipts that do not bind is already in hand; the listing discloses it, and so
      // must this, or the two screens disagree about the same store.
      io.err(
        `tombstones show: no receipt STANDS for ${wanted} — not as a receipt, and not as an id ` +
          `this store is currently forgetting. \`loam tombstones list\` shows what stands.` +
          (ledger.inert <= 0
            ? ""
            : `\n  ${ledger.inert} receipt${ledger.inert === 1 ? "" : "s"} here ` +
              `${ledger.inert === 1 ? "does" : "do"} not bind — struck (forgiveness, §11) or ` +
              `malformed. If ${wanted} was forgiven, it was forgotten once and is not now, and ` +
              `this screen cannot tell that apart from an id never held.`),
      );
      // 1, not 2. The id is well formed and the invocation is correct — what is missing is a receipt
      // in THIS store, which is a state rather than a typo. Two lines up, `erase` draws the same
      // line for the same reason, and a script tells them apart by exactly this.
      return 1;
    }
    for (const r of found) io.out(receiptDetail(r, standingOf(r.erased)));
    return 0;
  }

  const withheld =
    ledger.inert <= 0
      ? ""
      : `\n  ${ledger.inert} more receipt${ledger.inert === 1 ? "" : "s"} in the ground ` +
        `${ledger.inert === 1 ? "does" : "do"} not bind — struck (forgiveness: the id may return, ` +
        `§11) or malformed. Named here rather than dropped: an omission and a revocation look ` +
        `identical on a screen that only loses the row.`;
  if (ledger.receipts.length === 0) {
    // SCOPED TO THE SIGNER, because that is exactly how wide the check was: erasure is the
    // operator's alone, and this reads THIS home's operator key. Over a store governed by another
    // key — a `--store` pointed elsewhere, a replaced seed — an unqualified "has forgotten nothing"
    // would be an absence the command never verified.
    io.out(
      `loam: ${path} has forgotten nothing — no erasure signed by ` +
        `${shortAuthor(authorForSeed(seed))} stands here${withheld}`,
    );
    return 0;
  }
  io.out(
    `loam: ${ledger.receipts.length} receipt${ledger.receipts.length === 1 ? "" : "s"} in ${path} — ` +
      `this store remembers THAT it forgot these ids, never what they said${withheld}`,
  );
  for (const line of ledgerTable(
    ["erased", "receipt", "ordered at", "sweep", "spoken by", "reason"],
    ledger.receipts.map((r) => [
      shortId(r.erased),
      shortId(r.tombstone),
      new Date(r.at).toISOString(),
      // NOT "forgotten at". The timestamp is when the ORDER was signed; whether the sweep it
      // promised finished is a separate question, and it is asked per row rather than assumed.
      standingOf(r.erased) === "settled" ? "swept" : standingOf(r.erased).toUpperCase(),
      r.spokenBy === undefined ? LEDGER_NONE : shortAuthor(r.spokenBy),
      r.reasons.length === 0 ? LEDGER_NONE : r.reasons.join(" · "),
    ]),
  )) {
    io.out(line);
  }
  // A REFUSAL THE CELL CANNOT SHOW. "Held here" outranks "unasked there", so a row can read NOT
  // SWEPT — a true sentence — while the reason it cannot be trusted further is invisible.
  const refused = ledger.receipts.filter((r) => standings.unasked.has(r.erased));
  if (refused.length > 0) {
    io.out(
      `loam: on ${refused.length} of these row(s) a tier REFUSED the question: ` +
        `${capped(refused.map((r) => shortId(r.erased)))}. Whatever the cell says, nothing about ` +
        `those tiers was established here.`,
    );
  }
  const unswept = ledger.receipts.filter((r) => standingOf(r.erased) !== "settled");
  if (unswept.length > 0) {
    io.out(
      `loam: ${unswept.length} of these receipt(s) stand over an UNFINISHED sweep: ` +
        `${capped(unswept.map((r) => shortId(r.erased)))}. A tombstone is a promise — §11 lands it, ` +
        `purges, and only then reports a tier that refused — so a receipt can stand while the bytes ` +
        `do not. \`loam erase <id> --reason "…"\` re-runs the sweep; \`loam tombstones show <id>\` ` +
        `reads one row in full.`,
    );
  }
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
      case "federate":
        return await cmdFederate(rest, io);
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
      case "pen":
        return await cmdPen(rest, io);
      case "grant":
        return await cmdGrant(rest, io);
      case "slate":
        return await cmdSlate(rest, io);
      case "erase":
        return await cmdErase(rest, io);
      case "tombstones":
        return await cmdTombstones(rest, io);
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
