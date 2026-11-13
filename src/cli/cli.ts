import { runOperatorCommand } from "./command.js";
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
import { Gateway, unreadableStoreMessage, type FederationReport } from "../gateway/gateway.js";
import type { PublishOutcome } from "../gateway/lifecycle.js";
import { parseOffer } from "../federation/offer.js";
import { pullFrom } from "../federation/pull.js";
import { sourceFor } from "../federation/channel.js";
import {
  erasureStanding,
  erasureStandings,
  type ErasureStanding,
  type StandingReport,
  readGrounds,
  revivedAcross,
  type ExtraReading,
  type Revival,
  type ReadingAt,
  type RevivalReport,
  receiptLedger,
  type ErasureReceipt,
} from "../gateway/erase.js";
import {
  ERASURE_NON_CLAIMS,
  ESM_RESIDENCY_DISCLOSURE,
  standingErasures,
  neverReturns,
  erasureTarget,
  isErasure,
  UNSWEPT_AUTH_SURFACES,
} from "../gateway/erase-law.js";
import type { SlateReport } from "../gateway/slate.js";
import { programMaskJson } from "../gateway/program-mask.js";
import { unreachableStoreReport } from "../gateway/container.js";
import { assembleGenesis } from "../gateway/genesis.js";
import { withStamp } from "../gateway/stamp.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import {
  constitutionalDefect,
  CTX_GRANTS,
  grantClaims,
  grantsNaming,
  holdsGrant,
} from "../gateway/accounts.js";
import { honoredStrikeOn, validAt } from "../gateway/grants-law.js";
import { negatedAt } from "../gateway/negation.js";
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
import { STOCK_SCHEMAS, stockNames, stockSchema, type StockSchema } from "../stock/index.js";
import { divergenceOf, entryLensName, installOrder, stockIdentityOf } from "../stock/graph.js";
import { CTX_PEN, penEntity, penRecordClaims } from "../gateway/renderers.js";
import { serve, type ServerHandle } from "../server/http.js";
import { revokeConnector } from "../server/oauth.js";
import {
  clientSeedPath,
  readClientSeed,
  readClientsFile,
  writeClientsFile,
} from "../server/clients-file.js";
import {
  grantsFor,
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
  rootClaims,
  nameStillHeld,
  rolesOf,
  userClaims,
  userEntity,
  userNameDefect,
  userHyperSchema,
  userRoleDefect,
  type UserRole,
  reservedNameDefect,
} from "../server/users.js";
import { recoverUser } from "./user-recover.js";
import { subjectKeyAt, USER_PREFIX } from "../gateway/user-root.js";
import { promptLine, promptSecret } from "./prompt.js";
import type { StoreBackend } from "../store/backend.js";
import { ArchiveBackend } from "../store/archive.js";
import { MirrorBackend } from "../store/mirror.js";
import { holdsJournals } from "../store/peer-image.js";
import { admitErasureOrders, admitLocal, openHostPeer } from "../gateway/peer-admission.js";
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
import type { Ground } from "../gateway/ground.js";

export interface IO {
  out(line: string): void;
  err(line: string): void;
}

export interface RunOptions {
  readonly detach?: boolean;
  readonly version?: string;
  readonly readSecret?: (prompt: string) => Promise<string>;
  readonly readInput?: (prompt: string) => Promise<string>;
  readonly scrypt?: ScryptParams;
  readonly syncEveryMs?: number;
}

const VERSION = "0.7.0";

type CommandName =
  | "command"
  | "init"
  | "serve"
  | "register"
  | "pull"
  | "federate"
  | "store"
  | "repair"
  | "artifact"
  | "user"
  | "pen"
  | "grant"
  | "client"
  | "slate"
  | "erase"
  | "erasures";

interface CommandSpec {
  readonly summary: string;
  readonly usage: string;
  readonly flags: ReadonlySet<string>;
  readonly booleans?: ReadonlySet<string>;
  readonly notes?: readonly string[];
}

function stockShelfLines(): string[] {
  const width = Math.max(...STOCK_SCHEMAS.map((s) => s.name.length)) + 2;
  return STOCK_SCHEMAS.map((s) => `  ${s.name.padEnd(width)}${s.summary}`);
}

const COMMANDS: Readonly<Record<CommandName, CommandSpec>> = {
  command: {
    summary: "run an operator-local signed retain or pinned evaluation",
    usage: "loam command --installation file --request file [--home directory] [--store file]",
    flags: new Set(["home", "store", "installation", "request"]),
    notes: [
      "Local operator only. No remote or bound-user mode.",
      "Retain imports ordinary facts after Loam preflight; law and control acts use existing services.",
      "Evaluation requires an explicit head, original signed definitions, pins and bindings.",
    ],
  },
  init: {
    summary: "create a home — and at a terminal, a first user and a stocked shelf with it",
    usage: "loam init [options]",
    flags: new Set(["home", "seed", "user", "password-file", "stock", "no-user", "no-stock"]),
    booleans: new Set(["no-user", "no-stock"]),
    notes: [
      "The seed is written 0600 and never printed. A second init keeps the first identity.",
      "",
      "At a terminal — or with any flag past --home/--seed — init finishes the job (§54): it",
      "creates a first user with the operator role (--user <name>, or a prompt; the password is",
      "asked twice with the echo off, or read from --password-file), registers the stock shelf",
      "(--stock takes a comma-separated selection, or `all`, the default), and prints the serve",
      "command. Piped and flagless it stays the bare two-file init, so scripts keep their",
      "contract. The shelf:",
      ...stockShelfLines(),
    ],
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
      ...stockShelfLines(),
      "It is an ordinary registration through the ordinary door — the very object you could have",
      "typed. So it is ungoverned in both directions, as every hand-written example is: any",
      "negation binds, whoever signed it, AND the gather names no author, so any peer's claim binds",
      "too. Single-value props are latest-wins — a peer's later timestamp takes the field and",
      "keeps it — and the list props (tags, attending, follows) hold every author's entries, which",
      "no later claim of yours displaces. A trust mask alone answers only the negations — a store",
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
      "law on every call, so negating the declaration or the binding darkens it live. A CLI that read a",
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
    usage: "loam user create|assign-role|remove-role|recover <name> [options]",
    flags: new Set(["home", "store", "role", "operator", "replace-seed", "abandon-attempt"]),
    booleans: new Set(["operator", "replace-seed", "abandon-attempt"]),
    notes: [
      "subcommands:",
      "  create <name> [--operator]        ask for a password twice, write the credential, plant",
      "                                     the user and role deltas; --operator also mints a key",
      "  assign-role <name> --role=<role>  grant a role (operator | actor); operator additionally",
      "                                     mints a signing key and trusts it with a grant",
      "  remove-role <name> --role=<role>  negate a role (and, for operator, its signing grant)",
      "  recover <name> [--replace-seed]   move a user to a new key: the old key keeps no standing,",
      "                                     what it wrote stays the user's own, and connections",
      "                                     must be re-authorized. --replace-seed archives a key",
      "                                     file still present; a failed run resumes when rerun;",
      "                                     --abandon-attempt recovers again when the new key",
      "                                     file of a landed recovery is lost",
      "",
      "PROOF OF OPERATORSHIP IS HOME ACCESS, ALONE. Every one of these commands signs with",
      "<home>/operator.seed — the same file `loam init`/`loam serve` read. There is no remote path",
      "that mints or changes a role; a browser session, however privileged, cannot call these.",
      "",
      "RECOVERY. A user who lost their key, or whose key was exposed: `recover <name>`. Older path:",
      "losing a user's own signing key is not losing the role: run `remove-role <name>",
      "--role=operator` (it negates the grant too, when the key file can still name it — a fault",
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
      "The seed never enters the ground and is never printed; revocation is negating the grant",
      "(past writes stay attributed to the pen). Like every role command, this signs with",
      "<home>/operator.seed and needs only home access, never a live session.",
    ],
  },
  grant: {
    summary: "read the ledger of every author with standing; grant and revoke (SPEC §37)",
    usage:
      "loam grant list|revoke <client_id> | <client_id> --verb=<verb> [--user=<name>] [options]",
    flags: new Set(["home", "store", "verb", "prefix", "user"]),
    notes: [
      "subcommands:",
      "  list                  every author with standing — users, pens, connectors, and any key",
      "                        this home cannot name; negated grants shown negated, never omitted",
      "  revoke <client_id>    bump the connector's generation and negate its write grant",
      "  <client_id> --verb=register --prefix=<p>",
      "                        record a register grant for the connector key under <p>",
      "",
      "REGISTER STANDING IS SCOPED. A bound connection may register only under its container",
      "prefix. This key grant does not widen that fence; loam_whoami reports registerPrefixes.",
      "For an unbound key, --prefix grants registration under the named namespace. A key granted",
      "`thread:` may register `thread:groove`. The prefix is mandatory and literal: it is not",
      "case-folded, percent-decoded, or normalized. Registration at the root stays the operator's",
      "and no grant can hand it out. The store signs every registration itself; the grant delegates",
      "the authority to ask, never a signing key.",
      "",
      "REVOKE BINDS AT ONCE. Bumping the generation makes every live token and in-flight code stop",
      "matching, so a running server refuses that connector on its next request with no restart. It",
      "also negates the operator-signed write grant in the ground. It NEVER erases the connector's",
      "past deltas — those keep naming their author and keep resolving. Like every role command, this",
      "signs with <home>/operator.seed and needs only home access, never a live session.",
    ],
  },
  client: {
    summary: "mint and revoke non-interactive client credentials (SPEC §57)",
    usage: "loam client mint|revoke <name> [options]",
    flags: new Set(["home", "store", "register-prefix", "federate"]),
    notes: [
      "subcommands:",
      "  mint <name>      a key, its grants, and a bearer, in one motion — for a script, a bot,",
      "                    or another agent that will write to this store as itself",
      "  revoke <name>    refuse the bearer on the very next request and negate the key's grants",
      "",
      "mint prints the bearer ONCE and records only its sha-256 digest (clients.json); the signing",
      "seed is written to client.<name>.seed (0600) and never printed. WRITE STANDING IS",
      "STORE-WIDE BY DESIGN: pointing is free, entity ids are unowned, and the fences are",
      "attribution — every delta the client appends names its own author — plus each reader's",
      "trust mask, never a door prefix. --register-prefix fences schema registration to a",
      "namespace (comma-separated for several); --federate scopes channel verbs to named",
      "containers. Both are optional; the write grant always comes.",
      "",
      "NO RESTART. The bearer binds per request, and a running server reads the grants on its next",
      "request — a mint opens doors and a revoke refuses with no restart.",
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
      "WHAT IT DOES. It lands the operator-signed erasure, purges the delta from this store, from",
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
  erasures: {
    summary: "read the receipts: which ids this store forgot, for whom, and why (SPEC §11)",
    usage: "loam erasures list | show <id> [options]",
    flags: new Set(["home", "store"]),
    notes: [
      "subcommands:",
      "  list          every receipt this ground still stands behind, oldest first",
      "  show <id>     one receipt in full — by its own address, or by the id it erased",
      "",
      "A RECEIPT REMEMBERS THAT, NEVER WHAT. An erasure holds the erased id, the author it was",
      "spoken by, the moment, and the reason the operator gave. It holds none of the content, and",
      "retaining a content address retains zero content — which is what makes keeping it honest.",
      "",
      "A NEGATED RECEIPT (§11): the erasure no longer stands, but the id stays refused",
      "forever, so the data never returns. The receipt leaves this listing. It is never dropped silently — the count of receipts that",
      "no longer bind is disclosed, because an omission and a revocation look identical otherwise.",
    ],
  },
};

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
  user: { arg: "<name>", note: "the first user to create — operator role, never invented" },
  "password-file": {
    arg: "<path>",
    note: "read the first user's password here instead of prompting (a flag would reach shell history)",
  },
  "no-user": { arg: "", note: "skip user creation — /login stays dark until `loam user create`" },
  "no-stock": {
    arg: "",
    note: "skip the stock shelf — the surface stays empty until `loam register`",
  },
};

function topHelp(): string {
  const names = Object.keys(COMMANDS) as CommandName[];
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

function parseFor(command: CommandName, args: readonly string[]): Parsed {
  const spec = COMMANDS[command];
  const parsed = parseArgs(args, spec.booleans ?? new Set());
  rejectUnknown(parsed, spec.flags, command);
  return parsed;
}

export function channelBackendFor(home: string, io: IO): (pool: string) => SqliteBackend {
  return (pool: string) => {
    const dir = join(home, "channels");
    mkdirSync(dir, { recursive: true });
    const slug = pool.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
    const digest = createHash("sha256").update(pool, "utf8").digest("hex").slice(0, 16);
    return openStore(join(dir, `${slug}--${digest}.sqlite`), io);
  };
}

const setAsideLine = (rows: number): string =>
  `${rows} unreadable row${rows === 1 ? " was" : "s were"} set aside, and what ` +
  `${rows === 1 ? "it carries does" : "they carry do"} not read — \`loam repair list\` names them`;

function openStore(path: string, io: IO): SqliteBackend {
  return new SqliteBackend(path, { onScrubDeferred: (why) => io.err(why) });
}

const servingFile = (home: string): string => join(home, "serving.json");

const recordServing = (home: string, url: string, store: string): void => {
  const record = { pid: process.pid, url, store: resolve(store), startedAt: Date.now() };
  writeFileSync(servingFile(home), `${JSON.stringify(record)}\n`);
};

function servingWarning(home: string, store: string): string | undefined {
  const who = servingProbe(home, store);
  if (who === undefined) return undefined;
  return (
    who.said +
    (who.certain ? " — it reads " : ". If one is running, it reads ") +
    "new deltas on its next request, but what it loaded at boot (pen seeds, open containers, " +
    "channels) waits for a restart"
  );
}

function servingProbe(
  home: string,
  store: string,
): { said: string; certain: boolean; url?: string } | undefined {
  const file = servingFile(home);
  const uncertain = {
    said:
      `a server may be serving this store — ${file} exists but does not read as a serving ` +
      `record, and a maybe must not pass as a no`,
    certain: false,
  };
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
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
  if (resolve(record.store) !== resolve(store)) return undefined;
  try {
    process.kill(record.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return undefined;
  }
  const url = typeof record.url === "string" ? record.url : undefined;
  return {
    said: `a server is serving this store right now (pid ${record.pid}${url === undefined ? "" : `, ${url}`})`,
    certain: true,
    ...(url === undefined ? {} : { url }),
  };
}

export function isGuidedInit(parsed: Pick<Parsed, "flags" | "booleans">, tty: boolean): boolean {
  return (
    tty ||
    parsed.flags.has("user") ||
    parsed.flags.has("password-file") ||
    parsed.flags.has("stock") ||
    parsed.booleans.has("no-user") ||
    parsed.booleans.has("no-stock")
  );
}

async function cmdInit(args: readonly string[], io: IO, options: RunOptions): Promise<number> {
  const parsed = parseFor("init", args);
  if (parsed.positionals.length > 0) {
    io.err("init takes no positional arguments (import a seed with `loam init --seed <hex>`)");
    return 2;
  }
  if (!isGuidedInit(parsed, process.stdin.isTTY === true)) {
    const home = parsed.flags.get("home") ?? defaultHome();
    const result = initHome(home, parsed.flags.get("seed"));
    io.out(
      result.created
        ? `loam: initialized ${home}\n  operator ${result.operator}`
        : `loam: ${home} already initialized\n  operator ${result.operator}`,
    );
    return 0;
  }
  return cmdInitGuided(parsed, io, options);
}

function stockSelection(chosen: string, io: IO): readonly StockSchema[] | number {
  if (chosen === "all") return STOCK_SCHEMAS;
  const picked: StockSchema[] = [];
  for (const part of chosen.split(",").map((p) => p.trim())) {
    if (part === "") {
      io.err(
        "init: --stock has an empty entry — name shelf entries separated by commas, or `all`. " +
          "Nothing was done.",
      );
      return 2;
    }
    if (part === "all") {
      io.err(
        "init: --stock `all` is the whole shelf — name entries, or `all` alone. Nothing was done.",
      );
      return 2;
    }
    const entry = stockSchema(part);
    if (entry === undefined) {
      io.err(
        `init: no stock schema named "${part}" — the shelf is: ${stockShelf()}, or \`all\`. ` +
          "Nothing was done.",
      );
      return 2;
    }
    picked.push(entry);
  }
  return picked;
}

async function installStock(
  home: string,
  selection: readonly StockSchema[],
  io: IO,
): Promise<number> {
  const order: StockSchema[] = [];
  const seen = new Set<string>();
  for (const chosen of selection) {
    for (const entry of installOrder(chosen.name)) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        order.push(entry);
      }
    }
  }
  const path = storePath(home, undefined);
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
  try {
    const contenders = new Map<string, Registration[]>();
    for (const r of readRegistrations(
      gateway.reactor,
      gateway.validityNow(),
      gateway.operatorAuthor,
    )) {
      const lens = lensOf(r) as string;
      const rows = contenders.get(lens);
      if (rows === undefined) contenders.set(lens, [r]);
      else rows.push(r);
    }
    for (const entry of order) {
      const lens = entryLensName(entry);
      const rows = contenders.get(lens);
      if (rows === undefined) continue;
      const stockProgram = programOf(entry.registration as { hyperschema: { name: string } });
      if (!rows.some((r) => programOf(r) === stockProgram)) {
        const theirs = [...new Set(rows.map((r) => programOf(r) as string))].join('", "');
        io.err(
          `init: stock ${entry.name} needs the reading ${lens} served by a program of the same ` +
            `name, and this store serves it from the program "${theirs}". Installing stock ` +
            `beside it would evict your reading, so nothing was installed. To compose, republish ` +
            `your reading under the program name ${stockProgram}; to adopt stock, retire yours first.`,
        );
        await gateway.close();
        return 2;
      }
    }
    for (const entry of order) {
      const lens = entryLensName(entry);
      const rows = contenders.get(lens);
      if (rows !== undefined) {
        io.out(`loam: ${entry.name} already bound — skipped`);
        const stockProgram = programOf(entry.registration as { hyperschema: { name: string } });
        const serving = rows.find((r) => programOf(r) === stockProgram)!;
        const differs = divergenceOf(entry, serving);
        if (differs !== undefined) {
          io.err(
            `loam: ${entry.name} is bound to a reading that is not stock ` +
              `${lens}@${stockIdentityOf(entry).schemaHash} — composing with it (differs: ${differs})`,
          );
        }
        continue;
      }
      const input = parseRegistrationInput(structuredClone(entry.registration));
      const outcome = await gateway.publishRegistration(
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
      io.out(`loam: stocked ${entry.name}`);
      for (const warning of outcome.warnings ?? []) io.err(`loam: ${warning}`);
      if (!outcome.bound) {
        throw new Error(
          `init: stock ${entry.name} landed but does not bind here — ${outcome.reason}`,
        );
      }
    }
  } catch (err) {
    await gateway.close().catch(() => {});
    throw err;
  }
  await gateway.close();
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

async function cmdInitGuided(parsed: Parsed, io: IO, options: RunOptions): Promise<number> {
  const skipUser = parsed.booleans.has("no-user");
  const skipStock = parsed.booleans.has("no-stock");
  if (parsed.flags.has("user") && skipUser) {
    io.err(
      "init: --user and --no-user contradict — name the first user, or skip creating one, " +
        "not both. Nothing was done.",
    );
    return 2;
  }
  if (parsed.flags.has("password-file") && skipUser) {
    io.err(
      "init: --password-file and --no-user contradict — that password would belong to a user " +
        "this run will not create. Nothing was done.",
    );
    return 2;
  }
  if (parsed.flags.has("stock") && skipStock) {
    io.err(
      "init: --stock and --no-stock contradict — select from the shelf, or skip it, not both. " +
        "Nothing was done.",
    );
    return 2;
  }
  const tty = process.stdin.isTTY === true;
  const named = parsed.flags.get("user");
  if (!skipUser && named === undefined && !tty && options.readInput === undefined) {
    io.err(
      "init: the guided flow creates the store's first user, and this run has no terminal to " +
        "ask a name on — pass --user <name> to name one, or --no-user to skip user creation. " +
        "Nothing was done.",
    );
    return 2;
  }
  const passwordPath = parsed.flags.get("password-file");
  if (!skipUser && passwordPath === undefined && !tty && options.readSecret === undefined) {
    io.err(
      "init: the first user's password wants a terminal to be asked on — pass " +
        "--password-file <path>, or run interactively (--no-user skips user creation). " +
        "Nothing was done.",
    );
    return 2;
  }
  let selection: readonly StockSchema[] = [];
  if (!skipStock) {
    const picked = stockSelection(parsed.flags.get("stock") ?? "all", io);
    if (typeof picked === "number") return picked;
    selection = picked;
  }
  let filePassword: string | undefined;
  if (!skipUser && passwordPath !== undefined) {
    try {
      filePassword = readFileSync(passwordPath, "utf8").replace(/[\r\n]+$/, "");
    } catch (err) {
      io.err(
        `init: cannot read --password-file ${passwordPath}: ` +
          `${err instanceof Error ? err.message : String(err)}. Nothing was done.`,
      );
      return 1;
    }
    if (filePassword.trim().length === 0) {
      io.err(
        `init: --password-file ${passwordPath} holds no password (empty, or whitespace only) — ` +
          `a password that looks blank cannot be retyped at a login form. Nothing was done.`,
      );
      return 2;
    }
  }

  const home = parsed.flags.get("home") ?? defaultHome();
  const init = initHome(home, parsed.flags.get("seed"));
  io.out(
    init.created
      ? `loam: initialized ${home}\n  operator ${init.operator}`
      : `loam: ${home} already initialized\n  operator ${init.operator}`,
  );

  let exit = 0;
  let userName: string | undefined;
  if (!skipUser) {
    const name =
      named ?? (await (options.readInput ?? promptLine)("a name for the store's first user: "));
    if (name.length === 0) {
      io.err(
        "init: a user name is required — pass --user <name>, or --no-user to skip user creation",
      );
      return 2;
    }
    const defect = userNameDefect(name) ?? reservedNameDefect(name);
    if (defect !== undefined) {
      io.err(`init: ${defect}`);
      return 2;
    }
    let dupBefore = false;
    try {
      dupBefore = entryFor(readCredentials(home), name) !== undefined;
    } catch {}
    const createParsed: Parsed = {
      flags: new Map(),
      repeated: new Map(),
      booleans: new Set(["operator"]),
      positionals: [],
    };
    const fromFile = filePassword;
    const createOptions: RunOptions =
      fromFile === undefined
        ? options
        : { ...options, readSecret: () => Promise.resolve(fromFile) };
    const code = await cmdUserCreate(name, createParsed, home, io, createOptions);
    if (code !== 0) {
      if (!dupBefore) return code;
      exit = code;
    }
    userName = name;
  }
  if (!skipStock) {
    const code = await installStock(home, selection, io);
    if (code !== 0) return code;
  }
  if (exit !== 0) return exit;
  const lines = [
    "loam: the store is ready — the next step:",
    `  loam serve --http --home ${home} --token <pick-a-secret>`,
    userName === undefined
      ? `  /login stays dark until \`loam user create <name> --operator --home ${home}\` gives it someone to be`
      : `  then sign in at http://127.0.0.1:4321/login as ${userName}`,
  ];
  if (skipStock) {
    lines.push(
      `  the surface is empty until \`loam register\` grows one — ` +
        `\`loam register --stock <name> --home ${home}\` stocks a shape`,
    );
  }
  io.out(lines.join("\n"));
  return 0;
}

export async function restoreIntoJournal(
  primary: StoreBackend,
  archive: StoreBackend,
  dead: ReadonlySet<string>,
  seed: string,
  marker?: string,
): Promise<number> {
  if (!holdsJournals(primary)) return 0;
  const resuming = marker !== undefined && existsSync(marker);
  if (!resuming) {
    if ((await primary.journalPeers()).length > 0 || (await primary.holdsAny?.()) !== false) {
      return 0;
    }
  }
  const rows = (await archive.deltasSince(new Set())).filter((d) => !dead.has(d.id));
  if (rows.length === 0) {
    if (marker !== undefined) rmSync(marker, { force: true });
    return 0;
  }
  if (marker !== undefined && !resuming) writeFileSync(marker, "");
  const { peer } = await openHostPeer(primary.journalStore(), authorForSeed(seed));
  const state = peer.journal.snapshot().base;
  const ordered = [...rows]
    .filter((d) => !state.admitted.has(d.id) && !state.refusedIds.has(d.id))
    .sort(
      (a, b) => a.claims.timestamp - b.claims.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const at = Date.now();
  for (const d of ordered) {
    const targetId = isErasure(d.claims) ? erasureTarget(d.claims) : undefined;
    if (targetId === undefined || !dead.has(targetId)) {
      await admitLocal(peer, [d], at, () => false);
    } else {
      await admitErasureOrders(
        peer,
        [{ delta: d, targetId, surfaceHoldsBytes: false }],
        "local",
        at,
      );
    }
  }
  if (marker !== undefined) rmSync(marker, { force: true });
  return ordered.length;
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
  const init = initHome(home, process.env["LOAM_SEED"]);
  if (init.created) io.out(`loam: initialized ${home}\n  operator ${init.operator}`);
  const seed = readSeed(home);
  const path = storePath(home, parsed.flags.get("store"));

  const vault = archivePath(home, parsed.flags.get("archive"));
  if (vault === undefined && existsSync(`${path}.restoring`)) {
    io.err(
      `serve: a restore of ${path} from its archive did not finish. This store holds only part of ` +
        "it, so it is not served. Serve again with `--archive <dir>` naming that archive; the " +
        "restore resumes.",
    );
    return 1;
  }
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
      const dead = neverReturns(
        [...(await backend.deltasSince(new Set())), ...(await archive.deltasSince(new Set()))],
        Date.now(),
        authorForSeed(seed),
      );
      const restored = await restoreIntoJournal(backend, archive, dead, seed, `${path}.restoring`);
      if (restored > 0) {
        io.out(`loam: healed — ${restored} deltas restored from the archive into a new journal`);
      }
      healed = await mirror.heal(dead);
    } catch (err) {
      await mirror.close().catch(() => {});
      throw err;
    }
    if (healed.toPrimary > 0 || healed.toMirror > 0) {
      io.out(
        `loam: healed — ${healed.toPrimary} deltas replanted from the archive, ${healed.toMirror} newly archived`,
      );
    }
    const restore = mirror.lastRestore;
    if (restore === undefined) {
      io.err(
        `loam: the heal did not reach the store's §25 pen, so nothing is known about corrupt rows — ` +
          "a negation may be stranded and this boot cannot tell you. `loam repair list` can.",
      );
    }
    for (const id of restore?.restored ?? []) {
      io.out(
        `loam: restored ${id} from the archive — a corrupt row was squatting on that id; any negation ` +
          `it carries suppresses again`,
      );
    }
    for (const failure of healed.purgeFailures) {
      io.err(
        `loam: the boot sweep could not finish an erasure — bytes the operator ordered forgotten ` +
          `may still be at rest: ${failure}. Serving anyway; resolve the store fault and re-run ` +
          `the erasure (or restart) to finish the sweep.`,
      );
    }
    for (const failure of restore?.stranded ?? []) {
      io.err(`loam: ${failure} Serving anyway; \`loam repair list\` names what the pen holds.`);
    }
    for (const withheld of restore?.replantWithheld ?? []) {
      io.err(`loam: ${withheld}`);
    }
    backend = mirror;
  }

  const { pens, faults: penFaults } = readPenSeeds(home);
  for (const fault of penFaults) io.err(`loam: ${fault}`);

  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }), {
    pens,
    channelBackend: channelBackendFor(home, io),
    channelToken: (c) => {
      const held = readChannelToken(home, c);
      return held.kind === "present" ? held.seed : undefined;
    },
  });
  if (gateway.rowsOutsideJournal > 0) {
    const n = gateway.rowsOutsideJournal;
    io.err(
      `loam: ${n} stored row${n === 1 ? " is" : "s are"} outside the peer journal and not ` +
        "served — a damaged row, or one written around the door.",
    );
  }
  const setAside = isRepairable(backend) ? (await backend.quarantine()).length : 0;
  if (setAside > 0) io.err(`loam: ${setAsideLine(setAside)}`);
  let server;
  try {
    server = await serve({
      mounts: { default: gateway },
      tokens: { [token]: { operator: true } },
      port,
      host: hostFlag,
      clients: { home },
      ...(publicUrlFlag === undefined ? {} : { publicUrl: publicUrlFlag }),
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
    await gateway.close().catch(() => {});
    throw err;
  }
  recordServing(home, server.url, path);
  io.out(
    `loam: serving ${path} at ${server.url}/default${vault === undefined ? "" : `\n  archive ${vault}`}` +
      (withUsers ? `\n  login at ${publicUrlFlag ?? server.url}/login` : "") +
      (Object.keys(pens).length === 0 ? "" : `\n  pens ${Object.keys(pens).sort().join(", ")}`),
  );

  const everyMs = options.syncEveryMs ?? 60_000;
  const seconds = Math.max(1, Math.round(everyMs / 1000));
  const standing = gateway.keepSyncing({ everyMs });
  io.out(
    gateway.federationChannels.size > 0
      ? `  syncing ${gateway.federationChannels.size} channel(s) every ${seconds}s`
      : `  no channels yet — polling every ${seconds}s, so one opened through this server's door is followed too; one opened by \`loam federate open\` waits for a restart`,
  );
  const unresumed = gateway.channelStatus().filter((c) => !gateway.federationChannels.has(c.name));
  for (const c of unresumed) {
    const fault = gateway.channelAttachFaults.get(c.name);
    const road =
      fault?.keyMissing === true
        ? `Restore its key in ${path}.poolkeys.json, then restart.`
        : "Re-open it with `loam federate open` to resume.";
    io.err(
      `loam: ${c.name} will not sync — ` +
        (c.from === ""
          ? "its record carries no peer address (opened before addresses were recorded)"
          : !gateway.channelPools.has(c.name)
            ? `its pool did not open: ${fault?.message ?? "no cause was recorded"}`
            : "this home holds no token for it") +
        `. ${road}`,
    );
  }

  const handle: ServerHandle = {
    ...server,
    async close(): Promise<void> {
      await standing.stop();
      await server.close();
      await gateway.close();
      rmSync(servingFile(home), { force: true });
    },
  };

  if (options.detach === true) return handle;

  await new Promise<void>((resolve) => {
    const stop = (): void => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await handle.close();
  return 0;
}

const stockShelf = (): string => stockNames().join(", ");

interface RegistrationSource {
  readonly origin: string;
  readonly json: unknown;
  readonly stockName?: string;
}

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
    if (source.stockName !== undefined) {
      const contenders = new Map<string, Registration[]>();
      for (const r of readRegistrations(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor,
      )) {
        const lens = lensOf(r) as string;
        const rows = contenders.get(lens);
        if (rows === undefined) contenders.set(lens, [r]);
        else rows.push(r);
      }
      const order = installOrder(source.stockName);
      const deps = order.slice(0, -1);
      const targetEntity = schemaEntityFor(input.hyperschema, input.entity);
      evolves = (contenders.get(entryLensName(order[order.length - 1]!)) ?? []).some(
        (r) => r.entity === targetEntity,
      );
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
    await gateway.close().catch(() => {});
    throw err;
  }
  await gateway.close();
  if (evolves) {
    io.out(
      `loam: ${lensNameFor(input.hyperschema, input.schema)} was already bound — this publish evolves it`,
    );
  }
  io.out(
    `loam: registered ${input.hyperschema.name} at ${schemaEntityFor(input.hyperschema, input.entity)}\n` +
      `  the definition is deltas now — the next serve grows the surface from it`,
  );
  for (const warning of outcome.warnings ?? []) io.err(`loam: ${warning}`);
  if (!outcome.bound) {
    io.err(
      `loam: the deltas landed, but this registration does not bind here — ${outcome.reason}\n` +
        `  a serve of this home will not grow the surface from it until that is settled`,
    );
  }
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

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
  const TAKES: Record<string, readonly string[]> = {
    open: ["from", "into", "prefix", "token", "bless"],
    list: [],
    set: ["channel", "receiving", "bless"],
    "bless-app": ["channel", "route", "resolvers", "expect", "pen", "supersede"],
    drop: ["channel", "yes"],
  };
  const takes = new Set(["home", "store", ...(TAKES[verb] ?? [])]);
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
  const path = storePath(home, parsed.flags.get("store"));
  if (verb === "drop" || verb === "set") {
    const serving = servingProbe(home, path);
    if (serving !== undefined) {
      const channel = parsed.flags.get("channel") ?? "<channel>";
      io.err(
        `federate ${verb} refused: ${serving.said}. That server holds its channels in the ` +
          "memory it booted with, " +
          (verb === "drop"
            ? "so it would go on pulling this channel and write its pool back on the next sync. "
            : "so it would go on obeying the old toggles, and its next record of this channel " +
              "would overwrite the new ones. ") +
          "Nothing was changed.\n" +
          `  Stop the server first, then run this again` +
          (verb === "drop"
            ? ", or sever it on the running server's own page: " +
              `${serving.url ?? "<server>"}/admin/container?name=${encodeURIComponent(channel)}. ` +
              "That page serves only when this home has a user, and it reaches only channels " +
              "into a signed-in person's own containers."
            : ", or set it through the running server's own door: the MCP tool loam_federate_set."),
      );
      return 2;
    }
  }
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
  try {
    if (verb === "list") {
      const rows = gateway.channelStatus();
      const containers = gateway.containers().containers;
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
        if (r.unreadable.length > 0) {
          io.out(
            `${r.name}\n  UNREADABLE — its record does not carry ${r.unreadable.join(", ")} in ` +
              `the shape a channel record is written in, so this command will not guess at its ` +
              `health.\n  \`federate set\` and \`federate drop\` still name it, and neither ` +
              `repairs the record: a set carries the unreadable fields forward as unreadable.`,
          );
          continue;
        }
        const when =
          r.lastSyncedAt === 0
            ? "never synced"
            : `last recorded sync ${new Date(r.lastSyncedAt).toISOString()}`;
        const trouble =
          r.consecutiveFailures > 0 ? `, ${r.consecutiveFailures} failed attempt(s) since` : "";
        const short = (h: string): string => h.slice(0, 28);
        const apps = (appsByChannel.get(r.name) ?? []).map((a) => {
          const bless =
            `\`loam federate bless-app --channel ${r.name} --route ${a.route}` +
            (a.wantsPen === undefined ? "" : " --pen");
          const offers =
            a.hash === undefined
              ? `\n  app "${a.route}" — the peer WITHDREW it`
              : `\n  app "${a.route}" — the peer offers ${short(a.hash)}`;
          const here = a.mounted === undefined ? "nothing of it is mounted" : "it is MOUNTED here";
          const stuck =
            a.shadowed !== undefined
              ? `\n    ${here}, and "${a.serves}" answers nothing: ${a.shadowed} holds that name\n` +
                `    ${a.remedy ?? ""}`
              : a.dark === true
                ? `\n    it is MOUNTED here and answers nothing: the lens it reads is not bound ` +
                  "here\n    lift the curse on that lens, or re-bless it, and this answers again"
                : undefined;
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
          if (a.blocked !== undefined) {
            return (
              `${offers}\n    it cannot mount: ${a.blocked} holds that name\n` +
              "    a peer's app cannot take a name your own law answers"
            );
          }
          if (a.unmountable !== undefined) {
            return (
              `${offers}\n    it cannot mount here: ${a.unmountable}\n` +
              "    only the peer can change that; nothing on this side will" +
              (a.serving === undefined
                ? ""
                : `\n    this store still runs the app it blessed (${short(a.serving)}) at "${a.serves}"`)
            );
          }
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
        const withheld = gateway
          .withheldOn(r.name)
          .map(
            (lens) =>
              `\n  lens "${lens}" — its computed fields REFUSE: the peer's resolver code is not run here\n` +
              `    to run it: \`loam federate bless-app --channel ${r.name} --resolvers "${lens}"\``,
          );
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
        bless: blessFlagOf(parsed.flags.get("bless")),
        source: sourceFor(from, token, (f) => readFileSync(f, "utf8"), parseOffer),
      });
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
      const serving = servingProbe(home, path);
      if (serving !== undefined) {
        io.err(
          `loam: ${serving.said} — it polls only the channels it booted with, so it will not ` +
            `follow ${channel.name} until it restarts. A channel opened through that server's own ` +
            "door (the MCP tool loam_federate_connect) is followed at once.",
        );
      }
      return 0;
    }

    const name = parsed.flags.get("channel");
    if (name === undefined) {
      io.err(`federate ${verb} wants --channel <name> — \`loam federate list\` names them`);
      return 2;
    }

    if (verb === "set") {
      const next: { receiving?: boolean; blessing?: boolean } = {};
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
      const lens = parsed.flags.get("resolvers");
      if (lens !== undefined) {
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
        const served = await gateway.blessChannelResolvers(name, lens);
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
      const app = gateway.channelApps(name).find((a) => a.route === route);
      if (app?.blessed !== true) {
        const why =
          app?.shadowed !== undefined
            ? `${app.shadowed} holds that name — ${app.remedy ?? "move it and this answers"}`
            : app?.dark === true
              ? "the lens it reads is not bound here — lift the curse on it, or re-bless it"
              : "check `loam federate list` for what this store says about it";
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
  const isUrl = /^https?:\/\//i.test(source);
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
    await gateway.close().catch(() => {});
    throw err;
  }
  io.out(
    `loam: pulled ${source}\n` +
      `  ${report.accepted} accepted, ${report.rejected} refused, of ${report.offered} offered — ` +
      `union is union; pulling again is safe`,
  );
  if (unreconstructable > 0) {
    io.err(
      `loam: ${unreconstructable} of the offered deltas would not reconstruct and were ` +
        `dropped — pulling again drops the same ones. Either the peer's offer is damaged or the ` +
        `peer speaks a newer delta shape than this loam: ask for a fresh export, and compare ` +
        `both sides' versions`,
    );
  }
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  if (init.created) {
    io.out(
      "  this home minted its own operator just now, so the offer's law is another's here —\n" +
        "  same-operator continuity wants `loam init --seed <hex>` before the pull",
    );
  }
  await gateway.close();
  return 0;
}

async function cmdStore(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("store", args);
  const home = parsed.flags.get("home") ?? defaultHome();
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
  let deltas: readonly unknown[];
  let setAside: number;
  try {
    deltas = await backend.deltasSince(new Set());
    setAside = (await backend.quarantine()).length;
  } finally {
    await backend.close();
  }
  if (deltas.length === 0 && setAside > 0) {
    io.err(`loam: ${unreadableStoreMessage(setAside)}`);
    return 1;
  }
  io.out(`loam store ${path}\n  ${deltas.length} deltas`);
  if (setAside > 0) io.err(`loam: ${setAsideLine(setAside)}`);
  return 0;
}

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
              io.out(`      claims to negate: ${target} (unverified; LIVE until settled)`);
            }
          }
        }
        const stranded = strandedStrikeWarnings(pen);
        if (stranded.length > 0) {
          io.out(
            `  ${stranded.length} STRANDED NEGATION warning${stranded.length === 1 ? "" : "s"}:`,
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
        await backend.deltasSince(new Set());
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
        await backend.deltasSince(new Set());
        if (!(await backend.quarantine()).some((r) => r.key === key)) {
          io.err(`repair leave: ${key} is not quarantined — \`loam repair list\` shows what is.`);
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
  if (parsed.booleans.has("acknowledge-pen")) query.set("acknowledgePen", "1");
  if (parsed.booleans.has("acknowledge-writable")) query.set("acknowledgeWritable", "1");
  const [mount, route, entity] = parts as [string, string, string];
  const url =
    `${base}/${encodeURIComponent(mount)}/artifact/` +
    `${encodeURIComponent(route)}/${encodeURIComponent(entity)}?${query.toString()}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (!res.ok) {
    let said = text;
    try {
      const body: unknown = JSON.parse(text);
      const errors = (body as { errors?: unknown }).errors;
      if (Array.isArray(errors) && errors.length > 0) said = errors.map(String).join("; ");
    } catch {}
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
    const bytes = verdict.page ?? text;
    writeFileSync(out, bytes, "utf8");
    io.out(`loam: wrote ${out} (${bytes.length} bytes)`);
  }
  io.out(`  tools: ${(verdict.manifest ?? []).join(", ")}`);
  for (const line of verdict.capability ?? []) io.out(`  ${line}`);
  return 0;
}

async function strikeRoot(
  path: string,
  seed: string,
  operator: string,
  root: string | undefined,
  io: IO,
): Promise<boolean> {
  if (root === undefined) return false;
  try {
    const gw = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
    try {
      await gw.append([
        signClaims(
          withStamp(gw.stamp(operator), (t) => makeNegationClaims(operator, t, root)),
          seed,
        ),
      ]);
      return true;
    } finally {
      await gw.close();
    }
  } catch {
    return false;
  }
}

async function cmdUser(args: readonly string[], io: IO, options: RunOptions): Promise<number> {
  const parsed = parseFor("user", args);
  const sub = parsed.positionals[0];
  if (sub !== "create" && sub !== "assign-role" && sub !== "remove-role" && sub !== "recover") {
    io.err(
      "user wants a subcommand: `loam user create <name> [--operator]`, " +
        "`loam user assign-role <name> --role=<role>`, `loam user remove-role <name> --role=<role>`, " +
        "or `loam user recover <name> [--replace-seed]`",
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
  const nameDefect = userNameDefect(name);
  if (nameDefect !== undefined) {
    io.err(`user ${sub}: ${nameDefect}`);
    return 2;
  }
  if (sub === "create") {
    const reserved = reservedNameDefect(name);
    if (reserved !== undefined) {
      io.err(`user create: ${reserved}`);
      return 2;
    }
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  if (sub === "create") return cmdUserCreate(name, parsed, home, io, options);
  if (sub === "recover") {
    const path = storePath(home, parsed.flags.get("store"));
    const serving = servingProbe(home, path);
    if (serving !== undefined) {
      io.err(
        `user recover: ${serving.said}. That server would go on accepting the old key as ${name} ` +
          `until it restarts. Stop the server, then run this again. Nothing was written.`,
      );
      return 2;
    }
    return recoverUser({
      home,
      name,
      replaceSeed: parsed.booleans.has("replace-seed"),
      abandonAttempt: parsed.booleans.has("abandon-attempt"),
      storePath: path,
      io,
      openBackend: (p) => openStore(p, io),
      channelBackend: channelBackendFor(home, io),
    });
  }
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
  let mintedKey: string | undefined;
  let mintedRoot: string | undefined;
  try {
    known =
      resolveUserView(gateway.reactor, gateway.operator, gateway.validityNow(), name) !== undefined;
    already = known
      ? rolesOf(gateway.reactor, gateway.operator, gateway.validityNow(), name)
      : new Set<UserRole>();
    if (!known) {
      const trace = nameStillHeld(gateway.reactor, operator, gateway.validityNow(), name);
      const keyFile = readUserSeed(home, name);
      const refusal = trace.held
        ? trace.notYetValid
          ? `the ground holds claims about ${name} (${trace.ids.join(", ")}) that are not valid ` +
            `until later — the host clock may have stepped back. Check the clock. Nothing was ` +
            `written.`
          : `user:${name} is still named by held claims that would pass to a new person: a ` +
            `record, role, root, recovery, grant or membership (${trace.ids.join(", ")}). ` +
            `Erase those (or finish an erasure already begun), recover the entity to the new ` +
            `person's key, or pick another name. Nothing was written.`
        : keyFile.kind === "present"
          ? `a key file for ${name} remains at ${userSeedPath(home, name)}. Erasure does not ` +
            `remove it: move it away by hand if its person is gone, or pick another name. ` +
            `Nothing was written.`
          : keyFile.kind === "unreadable"
            ? `the key file at ${userSeedPath(home, name)} cannot be read (${keyFile.detail}), so ` +
              `this command cannot tell whether a person still holds it. Nothing was written.`
            : undefined;
      if (refusal !== undefined) {
        io.err(`user create: ${refusal}`);
        await gateway.close();
        return 2;
      }
    }
    if (!known) {
      const at = Date.now();
      const deltas: Delta[] = [
        signClaims(userClaims(name, operator, at), seed),
        signClaims(roleClaims(name, role, operator, at + 1), seed),
      ];
      if (role === "operator") {
        mintedKey = randomBytes(32).toString("hex");
        const subject = authorForSeed(mintedKey);
        const root = signClaims(
          withStamp(gateway.stamp(operator), (t) => rootClaims(name, subject, operator, t)),
          seed,
        );
        mintedRoot = root.id;
        deltas.push(
          signClaims(grantClaims(STORE_ENTITY, userEntity(name), "admin", operator, at + 2), seed),
          root,
        );
      }
      await gateway.append(deltas);
    }
  } catch (err) {
    await gateway.close().catch(() => {});
    throw err;
  }
  await gateway.close();

  if (known && already.size === 0) {
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
  if (known && role === "operator") {
    const seedRead = readUserSeed(home, name);
    if (seedRead.kind !== "present") {
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

  if (mintedKey !== undefined) {
    try {
      writeUserSeed(home, name, mintedKey);
    } catch (err) {
      const struck = await strikeRoot(path, seed, operator, mintedRoot, io);
      io.err(
        `user create: ${name} now holds operator in the ground, but writing ` +
          `${userSeedPath(home, name)} failed: ${err instanceof Error ? err.message : String(err)}. ` +
          `The grant is live with no local key to use it yet — retry this command once the fault ` +
          `clears, or recover with \`loam user remove-role ${name} --role=operator\` then ` +
          `\`loam user assign-role ${name} --role=operator\`. ` +
          (struck
            ? `The root pointer naming the lost key was struck.`
            : `The root pointer still names the lost key; \`remove-role\` then \`assign-role\` re-points it.`),
      );
      return 1;
    }
  }

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

interface ClaimStanding {
  readonly surviving: string[];
  readonly struck: string[];
}

function claimIdsBySurvival(
  reactor: Ground,
  operator: string,
  entity: string,
  context: string,
  matches: (delta: Delta) => boolean,
  isStruck?: (id: string) => boolean,
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
    const negated =
      isStruck !== undefined
        ? isStruck(id)
        : reactor.negationsOf(id).some((negId) => reactor.get(negId)?.claims.author === operator);
    (negated ? struck : surviving).push(id);
  }
  return { surviving, struck };
}

const survivingClaimIds = (
  reactor: Ground,
  operator: string,
  entity: string,
  context: string,
  matches: (delta: Delta) => boolean,
): string[] => claimIdsBySurvival(reactor, operator, entity, context, matches).surviving;

const survivingRoleClaimIds = (
  reactor: Ground,
  now: number,
  operator: string,
  name: string,
  role: UserRole,
): string[] =>
  claimIdsBySurvival(
    reactor,
    operator,
    userEntity(name),
    CTX_ROLE,
    (delta) =>
      delta.claims.pointers.some(
        (p) => p.role === "role" && p.target.kind === "primitive" && p.target.value === role,
      ),
    negatedAt(reactor, now, operator),
  ).surviving;

const grantStanding = (
  reactor: Ground,
  now: number,
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
    negatedAt(reactor, now, operator),
  );

const survivingGrantClaimIds = (
  reactor: Ground,
  now: number,
  operator: string,
  subject: string,
): string[] => grantStanding(reactor, now, operator, subject).surviving;

function penRecordsFor(
  reactor: Ground,
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
    const known =
      resolveUserView(gateway.reactor, gateway.operator, gateway.validityNow(), name) !== undefined;
    if (!known) {
      io.err(
        `user ${label}: ${home}'s ground does not know ${name} — \`loam user create ${name}\` makes one`,
      );
      return 2;
    }
    const held = rolesOf(gateway.reactor, gateway.operator, gateway.validityNow(), name);

    if (mode === "assign") {
      if (held.has(role)) {
        io.err(`user assign-role: ${name} already holds ${role} — nothing was appended`);
        return 2;
      }
      const at = Date.now();
      const deltas: Delta[] = [signClaims(roleClaims(name, role, operator, at), seed)];
      let mintedKey: string | undefined;
      let assignedRoot: Delta | undefined;
      if (role === "operator") {
        mintedKey = randomBytes(32).toString("hex");
        const subject = authorForSeed(mintedKey);
        assignedRoot = signClaims(
          withStamp(gateway.stamp(operator), (t) => rootClaims(name, subject, operator, t)),
          seed,
        );
        deltas.push(
          signClaims(grantClaims(STORE_ENTITY, userEntity(name), "admin", operator, at + 1), seed),
          assignedRoot,
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
          const struck =
            assignedRoot !== undefined &&
            (await gateway
              .append([
                signClaims(
                  withStamp(gateway.stamp(operator), (t) =>
                    makeNegationClaims(operator, t, assignedRoot.id),
                  ),
                  seed,
                ),
              ])
              .then(
                () => true,
                () => false,
              ));
          if (!struck) io.err(`user assign-role: the root pointer still names the lost key.`);
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

    if (!held.has(role)) {
      io.out(`loam: ${name} does not hold ${role} — nothing was appended`);
      return 0;
    }
    let grantIds: string[] = [];
    let grantNote = "";
    if (role === "operator") {
      const seedRead = readUserSeed(home, name);
      if (seedRead.kind === "unreadable") {
        io.err(
          `user remove-role: ${userSeedPath(home, name)} could not be read ` +
            `(${seedRead.detail}) — this command will not guess whether that key is still live, ` +
            `so nothing was negated. Fix the fault and retry.`,
        );
        return 1;
      }
      if (seedRead.kind === "present" && !isSeedHex(seedRead.seed)) {
        io.err(
          `user remove-role: ${userSeedPath(home, name)} exists but does not hold a 64-hex seed, ` +
            `so this command cannot derive which key's grants to negate — nothing was negated, and ` +
            `the file's contents are not printed here. If the key is lost, move the file aside ` +
            `and run this again: the role is negated and the orphaned grant is named in the report.`,
        );
        return 1;
      }
      const now = gateway.validityNow();
      grantIds = grantStanding(gateway.reactor, now, operator, userEntity(name), "admin").surviving;
      if (seedRead.kind === "present") {
        const subject = authorForSeed(seedRead.seed);
        grantIds.push(...grantStanding(gateway.reactor, now, operator, subject, "admin").surviving);
      } else if (grantIds.length === 0) {
        grantNote =
          ` (its signing grant could not be located — ${userSeedPath(home, name)} is missing — ` +
          `and stays live; it is inert unless someone still holds that lost key)`;
      }
    }
    const roleIds = survivingRoleClaimIds(
      gateway.reactor,
      gateway.validityNow(),
      operator,
      name,
      role,
    );
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
  const reservedPen = reservedNameDefect(name);
  const nameDefect =
    userNameDefect(name) ??
    (reservedPen === undefined
      ? undefined
      : `"${name}" is reserved store-wide, so a pen cannot take it either: a person of that ` +
        `name would own containers a reader resolves as pools. Pick another name.`);
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

  const seedRead = readPenSeed(home, name);
  if (seedRead.kind === "unreadable") {
    io.err(
      `pen create: ${penSeedPath(home, name)} exists but cannot be read (${seedRead.detail}) — ` +
        `this command will not overwrite a key it cannot see. Nothing was written.`,
    );
    return 1;
  }
  if (seedRead.kind === "present" && !isSeedHex(seedRead.seed)) {
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
      const held = authorForSeed(seedRead.seed);
      const standing = grantStanding(
        gateway.reactor,
        gateway.validityNow(),
        operator,
        held,
        "write",
      );
      if (standing.surviving.length > 0) {
        const honoured = holdsGrant(
          gateway.reactor,
          gateway.validityNow(),
          STORE_ENTITY,
          held,
          "write",
          operator,
        );
        io.err(
          `pen create: ${name} is already provisioned — ${penSeedPath(home, name)} exists and ` +
            (honoured
              ? `its author holds a write grant. `
              : `the operator has not struck its author's write grant, but the door does not ` +
                `honour that grant now: it is outside its validity window, or an admin struck ` +
                `it. `) +
            `Nothing was written. To retire the pen, negate its ` +
            `grant; to RE-KEY it — the answer to a leaked seed — remove ` +
            `${penSeedPath(home, name)} and run this again: the next run mints a fresh key AND ` +
            `negates the old author's standing, so the leaked key can no longer write. Past ` +
            `writes stay attributed to the old key either way.`,
        );
        return 2;
      }
      if (standing.struck.length > 0) {
        io.err(
          `pen create: ${name} was RETIRED — ${penSeedPath(home, name)} still holds a key, but ` +
            `its author's write grant was negated on the ground, and this command will not ` +
            `resurrect a standing somebody revoked. Nothing was written. To provision ${name} ` +
            `again under a FRESH key, remove ${penSeedPath(home, name)} and run this again.`,
        );
        return 2;
      }
      penSeed = seedRead.seed;
      outcome = "repaired";
    } else {
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

    const deltas: Delta[] = [];
    let at = Date.now();
    for (const stale of records.filter((r) => r.author !== penAuthor)) {
      const held = grantStanding(
        gateway.reactor,
        gateway.validityNow(),
        operator,
        stale.author,
      ).surviving;
      for (const id of [stale.id, ...held]) {
        deltas.push(signClaims(makeNegationClaims(operator, at++, id), seed));
      }
      retired.push({ author: stale.author, grants: held.length });
    }
    if (!records.some((r) => r.author === penAuthor)) {
      deltas.push(signClaims(penRecordClaims(name, penAuthor, operator, at++), seed));
    }
    if (
      grantStanding(gateway.reactor, gateway.validityNow(), operator, penAuthor, "write").surviving
        .length === 0
    ) {
      deltas.push(signClaims(grantClaims(STORE_ENTITY, penAuthor, "write", operator, at++), seed));
    }
    if (deltas.length > 0) await gateway.append(deltas);
  } finally {
    await gateway.close();
  }

  const struckLines = retired.map(({ author, grants }) =>
    grants === 0
      ? `  the previous key ${author} held no live grant — its record is retired`
      : `  the previous key ${author}: its ${grants} grant${grants === 1 ? " is" : "s are"} negated and no longer bind${grants === 1 ? "s" : ""}`,
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

function connectorActor(
  home: string,
  clientId: string,
  label: string,
  io: IO,
  user: string | undefined,
): { actor: string; container?: string } | { code: number } {
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
  const grants = grantsFor(file, clientId);
  if (grants.length === 0) {
    io.err(
      `${label}: this store holds no acting identity for ${clientId} — a connector gets one when ` +
        `it first exchanges a token. \`loam grant list\` shows what this store holds.`,
    );
    return { code: 2 };
  }
  const grant =
    user !== undefined
      ? grants.find((g) => g.user === user)
      : grants.length === 1
        ? grants[0]
        : undefined;
  if (grant === undefined) {
    io.err(
      user !== undefined
        ? `${label}: ${clientId} holds no key for ${user}. \`loam grant list\` names whose it holds.`
        : `${label}: ${clientId} holds ${grants.length} keys, one per person who consented — say ` +
            `which with --user=<name>: ${grants.map((g) => g.user).join(", ")}`,
    );
    return { code: 2 };
  }
  return {
    actor: grant.actor,
    ...(grant.container !== undefined ? { container: grant.container } : {}),
  };
}

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
      "grant: --verb=register wants a non-empty --prefix for the key grant. " +
        "A bound connection still uses its container fence. Root registration is not delegable.",
    );
    return 2;
  }
  const found = connectorActor(home, clientId, "grant", io, parsed.flags.get("user"));
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
  if (found.container !== undefined) {
    io.out(
      `loam: recorded ${clientId} register grant under "${prefix}"\n` +
        `  this does not widen its bound registration fence "${found.container}:"\n` +
        `  the key grant is recorded in ${path}`,
    );
  } else {
    io.out(
      `loam: granted ${clientId} register standing under "${prefix}"\n` +
        `  it may register schemas whose name starts with "${prefix}" and nothing else — not the ` +
        `root, not a neighbouring namespace\n` +
        `  the grant is in ${path}; \`loam grant revoke ${clientId}\` negates it, and the next ` +
        `request refuses`,
    );
  }
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

type LedgerKind = "user" | "pen" | "connector" | "unattributed";
const KIND_ORDER: Readonly<Record<LedgerKind, number>> = {
  user: 0,
  pen: 1,
  connector: 2,
  unattributed: 3,
};

const LEDGER_NONE = "—";

interface HomeIdentity {
  readonly kind: "user" | "pen" | "connector";
  readonly name: string;
  readonly author?: string;
  readonly note?: string;

  readonly inbox?: string;
}

function homeIdentities(home: string): HomeIdentity[] {
  const out: HomeIdentity[] = [];
  for (const entry of readdirSync(home).sort()) {
    const match = /^(user|pen)\.(.+)\.seed$/.exec(entry);
    if (match === null) continue;
    const kind = match[1] as "user" | "pen";
    const name = match[2] as string;
    const path = kind === "user" ? userSeedPath(home, name) : penSeedPath(home, name);
    const read = kind === "user" ? readUserSeed(home, name) : readPenSeed(home, name);
    if (read.kind === "absent") continue;
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

function connectorIdentities(file: OAuthFile): HomeIdentity[] {
  const out: HomeIdentity[] = [];
  for (const client of file.clients) {
    const name = `${client.clientId} (${client.clientName})`;
    const grants = grantsFor(file, client.clientId);
    const factsFor = (user: string | undefined): string => {
      const tokens = file.tokens.filter(
        (t) => t.clientId === client.clientId && t.user === user,
      ).length;
      return `generation ${client.generation} · ${tokens} live token${tokens === 1 ? "" : "s"}`;
    };
    const facts = factsFor(undefined);
    const revocations = revocationsFor(file, client.clientId);
    for (const r of revocations) {
      out.push({
        kind: "connector",
        name,
        author: r.actor,
        note: `revoked ${new Date(r.revokedAt).toISOString()} · ${facts}`,
      });
    }
    for (const grant of grants) {
      const where =
        grant.user === undefined || grant.container === undefined
          ? facts
          : `${grant.user} · ${grant.container} · ${factsFor(grant.user)}`;
      out.push({
        kind: "connector",
        name,
        author: grant.actor,
        note: grant.standing ? where : `grant pending · ${where}`,
        ...(grant.inbox === undefined ? {} : { inbox: grant.inbox }),
      });
    }
    if (grants.length === 0 && revocations.length === 0) {
      out.push({ kind: "connector", name, note: `no acting identity yet · ${facts}` });
    }
  }
  return out;
}

interface GroundGrant {
  readonly id: string;
  readonly subject: string;
  readonly verb: string;
  readonly granter: string;
  readonly at: number;
  readonly prefix?: string;
  readonly struckAt?: number;
  readonly inertStrike: boolean;
  readonly outOfWindow: boolean;
  readonly defect?: string;
}

function groundGrants(reactor: Reactor, now: number, operator: string): GroundGrant[] {
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
    const honored = honoredStrikeOn(reactor, now, id, operator);
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
      outOfWindow: !validAt(delta, now),
      ...(defect === undefined ? {} : { defect }),
    });
  }
  return out;
}

function whyNotBinding(g: GroundGrant, operator: string): string {
  if (g.defect !== undefined) return `malformed law — ${g.defect}`;
  if (g.outOfWindow) return "the grant's own validity window does not hold now";
  if (g.verb === "register" && g.granter !== operator) {
    return "register standing is the operator's alone to mint, whatever the chain says";
  }
  return "no chain of admin standing reaches the operator";
}

function shortAuthor(author: string): string {
  const keyAt = author.indexOf(":") + 1;
  return author.length - keyAt <= 12 ? author : `${author.slice(0, keyAt + 12)}…`;
}

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
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }), {
    channelBackend: channelBackendFor(home, io),
  });
  const operator = authorForSeed(seed);
  const rows: LedgerRow[] = [];
  try {
    const grants = groundGrants(gateway.reactor, gateway.validityNow(), operator);
    const binding = new Set<string>();
    for (const subject of new Set(grants.map((g) => g.subject))) {
      for (const held of grantsNaming(gateway.reactor, gateway.validityNow(), subject, operator))
        binding.add(held.id);
    }
    const withNote = (text: string, note?: string): string =>
      note === undefined ? text : `${text} · ${note}`;

    for (const g of grants) {
      const live = binding.has(g.id);
      const inert = g.inertStrike ? " · a negation names it and binds nothing" : "";
      const standing = live
        ? `live${inert}`
        : g.struckAt !== undefined
          ? `negated ${new Date(g.struckAt).toISOString()}`
          : `does not bind — ${whyNotBinding(g, operator)}${inert}`;
      const named = g.subject.startsWith(USER_PREFIX)
        ? g.subject.slice(USER_PREFIX.length)
        : undefined;
      const key =
        named === undefined
          ? g.subject
          : (subjectKeyAt(gateway.reactor, gateway.validityNow(), operator, g.subject) ??
            g.subject);
      const common = {
        author: shortAuthor(key),
        verb: g.prefix === undefined ? g.verb : `${g.verb}("${g.prefix}")`,
        granted: new Date(g.at).toISOString(),
        live,
        at: g.at,
        tiebreak: g.id,
      };
      const holders = identities.filter((i) =>
        named === undefined ? i.author === g.subject : i.kind === "user" && i.name === named,
      );
      if (holders.length === 0) {
        rows.push(
          named === undefined
            ? { kind: "unattributed", name: LEDGER_NONE, standing, ...common }
            : { kind: "user", name: named, standing, ...common },
        );
      }
      for (const h of holders) {
        rows.push({ kind: h.kind, name: h.name, standing: withNote(standing, h.note), ...common });
      }
    }

    const granted = new Set(grants.map((g) => g.subject));
    for (const i of identities) {
      if (i.author !== undefined && granted.has(i.author)) continue;
      if (i.kind === "user" && granted.has(`${USER_PREFIX}${i.name}`)) continue;
      const pool = i.inbox === undefined ? undefined : gateway.connectionInboxes.get(i.inbox);
      const bound =
        pool?.gateway !== undefined &&
        i.author !== undefined &&
        holdsGrant(
          pool.gateway.reactor,
          pool.gateway.validityNow(),
          STORE_ENTITY,
          i.author,
          "write",
          pool.gateway.operatorAuthor,
        );
      const noGround =
        i.inbox === undefined
          ? "no grant in the ground"
          : bound
            ? `write in ${i.inbox}`
            : pool?.gateway === undefined
              ? `its inbox ${i.inbox} is not attached here, so its standing cannot be read`
              : `its inbox pool grants it nothing`;
      rows.push({
        kind: i.kind,
        name: i.name,
        author: i.author === undefined ? LEDGER_NONE : shortAuthor(i.author),
        verb: bound ? "write" : LEDGER_NONE,
        granted: LEDGER_NONE,
        standing:
          i.author === undefined
            ? (i.note ?? "this home cannot name its key")
            : withNote(noGround, i.note),
        live: bound,
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
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }), {
    channelBackend: channelBackendFor(home, io),
  });
  const struckGround: string[] = [];
  const struckPools: string[] = [];
  const unreachablePools: string[] = [];
  const unrevokedPools: string[] = [];
  try {
    const strike = async (grant: OAuthGrant): Promise<void> => {
      const ids = survivingGrantClaimIds(
        gateway.reactor,
        gateway.validityNow(),
        operator,
        grant.actor,
      );
      if (ids.length > 0) {
        const at = Date.now();
        await gateway.append(
          ids.map((id, i) => signClaims(makeNegationClaims(operator, at + i, id), seed)),
        );
        struckGround.push(...ids);
      }
      if (grant.inbox === undefined || grant.user === undefined) return;
      const handle = gateway.connectionInboxes.get(grant.inbox);
      const owner = readUserSeed(home, grant.user);
      if (handle === undefined || owner.kind !== "present") {
        unreachablePools.push(grant.inbox);
        return;
      }
      const revoke = (voice: { ownerSeed: string } | { asPool: true }) =>
        gateway.revokeConnection({ inbox: handle, connectionKey: grant.actor, ...voice });
      try {
        const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
        await revoke({ ownerSeed: owner.seed }).catch(async (first: unknown) => {
          if (/nothing in this inbox lets/.test(message(first))) throw first;
          await revoke({ asPool: true }).catch((second: unknown) => {
            throw /nothing in this inbox lets/.test(message(second)) ? first : second;
          });
        });
        struckPools.push(grant.inbox);
      } catch (err) {
        const said = err instanceof Error ? err.message : String(err);
        if (!/nothing in this inbox lets/.test(said))
          unrevokedPools.push(`${grant.inbox} (${said})`);
      }
    };
    const outcome = await revokeConnector(home, clientId, strike, (m) => io.err(`loam: ${m}`));
    switch (outcome.kind) {
      case "no-such-client":
        io.err(`grant revoke: this store holds no connector ${clientId} — \`loam grant list\``);
        return 2;
      case "no-such-pair":
        io.err(`grant revoke: ${clientId} holds no key for that person — \`loam grant list\``);
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
      case "revoked": {
        const struck = [
          ...(struckGround.length === 0
            ? []
            : [`${struckGround.length} store-wide write grant(s) negated in ${path}`]),
          ...(struckPools.length === 0
            ? []
            : [`the connection's own grant negated in ${struckPools.join(", ")}`]),
        ];
        io.out(
          `loam: revoked ${clientId}\n` +
            `  its tokens and codes no longer match (generation ${outcome.generation}), so it ` +
            `authenticates nowhere\n` +
            (struck.length === 0
              ? `  no grant needed negating — this connector held none this store could reach\n`
              : `  ${struck.join("; ")}\n`) +
            `  its past deltas are untouched — they keep naming their author`,
        );
        if (unreachablePools.length > 0) {
          io.err(
            `loam: could not reach ${unreachablePools.join(", ")} — the connection's own write ` +
              `grant still stands there. Revoke it from that inbox's row on the admin page.`,
          );
        }
        if (unrevokedPools.length > 0) {
          io.err(
            `loam: the connection may still write in ${unrevokedPools.join("; ")}. ` +
              `Revoke it from that inbox's row on the admin page.`,
          );
          return 1;
        }
        {
          const staleness = servingWarning(home, path);
          if (staleness !== undefined) io.err(`loam: ${staleness}`);
        }
        return 0;
      }
    }
  } finally {
    await gateway.close();
  }
}

const CLIENT_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const splitScopes = (raw: string | undefined): string[] =>
  raw === undefined
    ? []
    : raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

async function cmdClient(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("client", args);
  const sub = parsed.positionals[0];
  if (sub !== "mint" && sub !== "revoke") {
    io.err(
      "client wants a subcommand: `loam client mint <name> [--register-prefix <ns>:]` or " +
        "`loam client revoke <name>`",
    );
    return 2;
  }
  const name = parsed.positionals[1];
  if (name === undefined || parsed.positionals.length > 2) {
    io.err(`client ${sub} takes exactly one name: \`loam client ${sub} <name>\``);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`client ${sub}: ${unusable}`);
    return 1;
  }
  return sub === "mint"
    ? cmdClientMint(name, parsed, home, io)
    : cmdClientRevoke(name, parsed, home, io);
}

async function cmdClientMint(name: string, parsed: Parsed, home: string, io: IO): Promise<number> {
  if (!CLIENT_NAME_RE.test(name)) {
    io.err(
      `client mint: "${name}" is not a name a seed file can carry — start with a letter or ` +
        `digit, then letters, digits, dots, dashes, underscores, 64 at most`,
    );
    return 2;
  }
  const prefixes = splitScopes(parsed.flags.get("register-prefix"));
  if (parsed.flags.get("register-prefix") !== undefined && prefixes.length === 0) {
    io.err("client mint: --register-prefix wants a non-empty namespace, like `medialog:`");
    return 2;
  }
  const containers = splitScopes(parsed.flags.get("federate"));
  if (parsed.flags.get("federate") !== undefined && containers.length === 0) {
    io.err("client mint: --federate wants a non-empty container name");
    return 2;
  }
  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `client mint: ${home} has no operator identity — \`loam init\` makes one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  let file;
  try {
    file = readClientsFile(home);
  } catch (err) {
    io.err(
      `client mint: ${home}'s client records are unreadable, so this will not mint a second ` +
        `key over whatever they hold: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  if (file.clients.some((c) => c.name === name) || existsSync(clientSeedPath(home, name))) {
    io.err(
      `client mint: "${name}" already exists — one name, one key. ` +
        `\`loam client revoke ${name}\` retires it first.`,
    );
    return 2;
  }

  const clientSeed = randomBytes(32).toString("hex");
  const actor = authorForSeed(clientSeed);
  const bearer = randomBytes(32).toString("base64url");
  const digest = createHash("sha256").update(bearer).digest("hex");

  const path = storePath(home, parsed.flags.get("store"));
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  try {
    const at = Date.now();
    const claims = [
      grantClaims(STORE_ENTITY, actor, "write", operator, at),
      ...prefixes.map((p, i) =>
        grantClaims(STORE_ENTITY, actor, "register", operator, at + 1 + i, p),
      ),
      ...containers.map((c, i) =>
        grantClaims(STORE_ENTITY, actor, "federate", operator, at + 1 + prefixes.length + i, c),
      ),
    ];
    await gateway.append(claims.map((c) => signClaims(c, seed)));
  } catch (err) {
    io.err(
      `client mint: the ground refused this — nothing was minted: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  } finally {
    await gateway.close();
  }
  writeFileSync(clientSeedPath(home, name), `${clientSeed}\n`, { mode: 0o600 });
  writeClientsFile(home, {
    version: 1,
    clients: [...file.clients, { name, digest, actor, store: resolve(path), mintedAt: Date.now() }],
  });

  io.out(
    `loam: minted client "${name}"\n` +
      `  bearer: ${bearer}\n` +
      `  shown once — the record keeps its digest, never the bearer\n` +
      `  its key stays at ${clientSeedPath(home, name)} (0600); the seed is never printed\n` +
      `  write standing is STORE-WIDE by design: every delta it appends names its own author,\n` +
      `  and attribution plus each reader's trust mask is the fence — not a door prefix` +
      (prefixes.length === 0
        ? ""
        : `\n  register is fenced to ${prefixes.map((p) => `"${p}"`).join(", ")}`) +
      (containers.length === 0
        ? ""
        : `\n  federate is scoped to ${containers.map((c) => `"${c}"`).join(", ")}`) +
      `\n  the bearer and its grants open doors on the very next request, with no restart`,
  );
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

async function cmdClientRevoke(
  name: string,
  parsed: Parsed,
  home: string,
  io: IO,
): Promise<number> {
  let file;
  try {
    file = readClientsFile(home);
  } catch (err) {
    io.err(
      `client revoke: ${home}'s client records are unreadable, so nothing was revoked: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const record = file.clients.find((c) => c.name === name);
  let actor: string;
  if (record !== undefined) {
    actor = record.actor;
  } else {
    try {
      actor = authorForSeed(readClientSeed(home, name));
    } catch {
      io.err(`client revoke: this home holds no client "${name}"`);
      return 2;
    }
  }
  let seed: string;
  try {
    seed = readSeed(home);
  } catch (err) {
    io.err(
      `client revoke: ${home} has no operator identity — \`loam init\` makes one: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  }
  const operator = authorForSeed(seed);
  const path = storePath(home, parsed.flags.get("store"));
  if (record !== undefined && resolve(record.store) !== resolve(path)) {
    io.err(
      `client revoke: "${name}" was minted into ${record.store}, not ${resolve(path)} — ` +
        `pass --store pointing at the store that holds its grants, and nothing was revoked`,
    );
    return 2;
  }
  const gateway = await Gateway.boot(openStore(path, io), assembleGenesis({ operatorSeed: seed }));
  let struckCount = 0;
  try {
    const ids = grantsNaming(gateway.reactor, gateway.validityNow(), actor, operator).map(
      (g) => g.id,
    );
    struckCount = ids.length;
    if (record === undefined && ids.length === 0) {
      const everNamed = [...gateway.reactor.snapshot()].some((d) =>
        d.claims.pointers.some(
          (p) => p.role === "subject" && p.target.kind === "primitive" && p.target.value === actor,
        ),
      );
      if (!everNamed) {
        io.err(
          `client revoke: nothing in ${path} names this key — "${name}" has no record, so its ` +
            `grants may live in a --store the mint was given. The key file is kept so a rerun ` +
            `can reach them; nothing was revoked.`,
        );
        return 2;
      }
    }
    if (ids.length > 0) {
      const at = Date.now();
      await gateway.append(
        ids.map((id, i) => signClaims(makeNegationClaims(operator, at + i, id), seed)),
      );
    }
  } catch (err) {
    io.err(
      `client revoke: the ground refused the negation — the bearer still opens, rerun this: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return 1;
  } finally {
    await gateway.close();
  }
  writeClientsFile(home, { version: 1, clients: file.clients.filter((c) => c.name !== name) });
  rmSync(clientSeedPath(home, name), { force: true });
  io.out(
    `loam: revoked client "${name}"\n` +
      `  its bearer is refused on the very next request\n` +
      (struckCount > 0
        ? `  its ${struckCount} surviving grant${struckCount === 1 ? " is" : "s are"} negated in ${path}\n`
        : `  no standing held by this key in ${path} — nothing needed negating\n`) +
      `  its past deltas are untouched — they keep naming their author\n` +
      `  a server already running reads the negated grants on its next request, with no restart`,
  );
  const staleness = servingWarning(home, path);
  if (staleness !== undefined) io.err(`loam: ${staleness}`);
  return 0;
}

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

async function openTiers(
  home: string,
  seed: string,
  parsed: Parsed,
  io: IO,
  vaults: readonly string[] = [],
): Promise<{ gateway: Gateway; path: string; lagged: string[] }> {
  const lagged: string[] = [];
  const path = storePath(home, parsed.flags.get("store"));
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
  const gateway = await Gateway.boot(backend, assembleGenesis({ operatorSeed: seed }), {
    channelBackend: channelBackendFor(home, io),
  });
  return { gateway, path, lagged };
}

const shortId = (id: string): string => (id.length <= 13 ? id : `${id.slice(0, 12)}…`);

interface PenReading {
  readonly state: "empty" | "rows" | "unreadable";
  readonly text?: string;
}

async function setAsideWarning(gw: Gateway): Promise<PenReading> {
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
        : `, and ${stranded} of them claim(s) to negate something, so a withdrawal may be ` +
          `reading LIVE`) +
      ". `loam repair list` names what the pen holds.",
  };
}

function capped(ids: readonly string[], limit = 8, total = ids.length): string {
  if (total <= limit) return ids.join(", ");
  return `${ids.slice(0, limit).join(", ")}, and ${total - limit} more`;
}

const closureList = (closes: readonly string[]): string =>
  closes.length === 0 ? "none" : closes.join(", ");

function slateBlock(s: SlateReport): string[] {
  const lines: string[] = [s.container];
  const say = (label: string, text: string): void => {
    lines.push(`  ${label.padEnd(14)}${text}`);
  };
  say(
    "requested by",
    `${s.requestedBy} (${
      s.requestedByForm === "sealed" ? "a §11 sealed commitment, not a name" : "a plain identifier"
    })`,
  );
  say("requested at", new Date(s.requestedAt).toISOString());
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
  if (pen.text !== undefined) io.out(`loam: ${pen.text}`);
  if (slates.length === 0) {
    io.out(
      `loam: no slate signed by ${shortAuthor(authorForSeed(seed))} stands over ${path} — ` +
        `nothing is staged for erasure\n` +
        `  a slate names a condemned set, freezes it at one address so it cannot grow, and starts ` +
        `the clock\n  \`loam erasures list\` reads what this store has already forgotten`,
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

const ARCHIVED_FILE = /^[0-9a-f]{30,}\.json(\..*)?$/;
const VAULT_SEARCH_DEPTH = 3;

interface VaultScan {
  readonly vaults: string[];
  readonly unreadable: string[];
}

function listOrFault(dir: string): { entries: Dirent[] } | { unreadable: true } {
  try {
    return { entries: readdirSync(dir, { withFileTypes: true }) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { entries: [] } : { unreadable: true };
  }
}

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
  const real = realOrSelf;
  const namedReal = new Set(named.map(real));
  const seen = new Set<string>();
  const walk = (dir: string, depth: number, known?: ReturnType<typeof listOrFault>): void => {
    const here = real(dir);
    if (seen.has(here)) return;
    seen.add(here);
    const isNamedHere = namedReal.has(here);
    const listed = known ?? listOrFault(dir);
    if ("unreadable" in listed) {
      unreadable.push(dir);
      return;
    }
    let archival = false;
    const fans = new Map<string, ReturnType<typeof listOrFault>>();
    for (const entry of listed.entries) {
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
      return;
    }
    if (depth === 0) return;
    for (const entry of listed.entries) {
      if (entry.isFile()) continue;
      const child = join(dir, entry.name);
      const fan = fans.get(child);
      if (fan !== undefined && "unreadable" in fan) continue;
      walk(child, depth - 1, fan);
    }
  };
  walk(home, VAULT_SEARCH_DEPTH);
  return { vaults: vaults.sort(), unreadable: unreadable.sort() };
}

function loginDoorReadings(seed: string, unconsulted: string[]): ExtraReading[] {
  try {
    return [
      {
        reading: "LoamUser (§36's login door)",
        policy: programMaskJson(userHyperSchema(authorForSeed(seed)).body),
        ground: "raw" as const,
      },
    ];
  } catch (err) {
    unconsulted.push(
      `LoamUser (§36's login door) — its reading could not be assembled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

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

function reportRevived(
  io: IO,
  report: RevivalReport,
  host: Gateway,
  when: "now" | "already",
  removedNegation = false,
  channels = 0,
): void {
  const say = (line: string): void => (when === "now" ? io.out(line) : io.err(line));
  const revived = report.revived;
  const at = (rows: readonly ReadingAt[]): string =>
    capped(
      rows.map((row) => `${row.reading}${row.ground === host ? "" : " (in an attached pool)"}`),
      4,
    );
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
        `The door was not withdrawn — its rule for whose negations bind moved, which can un-suppress ` +
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
  if (channels > 0) {
    say(
      `loam: ${channels} channel read door(s) were not modelled. A channel lens serves the POOL's ` +
        `deltas filtered by THIS store's surviving negations, and the check above diffs each ground ` +
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
  if (removedNegation) {
    say(
      `loam: and §26's AS-OF door was not read. It reconstructs the ground at a timestamp, so a ` +
        `claim still withdrawn today can read live there once the negation is destroyed — the two ` +
        `readings this run took are of the PRESENT ground and cannot see it.`,
    );
  }
  if (revived.length === 0) return;
  const where = (r: Revival): string =>
    `${r.id} — live again under the mask that governs ${capped(r.readings, 4)}${
      r.ground === host ? "" : ", in an attached pool rather than at this store's own door"
    }`;
  say(
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
      `  Read them. If any should stay withdrawn, negate it again — a fresh negation is free, and ` +
      `reversible in a way an erasure is not.`,
  );
}

async function cmdErase(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("erase", args);
  const id = parsed.positionals[0];
  if (id === undefined) {
    io.err(
      'erase wants the id of one delta: `loam erase <deltaId> --reason "<why>"` — ' +
        "`loam erasures list` reads the receipts it leaves",
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
  const seenVault = new Set<string>();
  const vaults = [
    archivePath(home),
    ...(parsed.repeated.get("archive") ?? []).map((one) => archivePath(home, one)),
  ]
    .filter((one): one is string => one !== undefined)
    .filter((one) => {
      const key = realOrSelf(one);
      if (seenVault.has(key)) return false;
      seenVault.add(key);
      return true;
    });
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
  const invented = vaults.filter((one) => !existsSync(one));
  const { gateway, path, lagged } = await openTiers(home, seed, parsed, io, vaults);
  let done: Awaited<ReturnType<Gateway["erase"]>>;
  let pools: number;
  let revived: RevivalReport;
  let pen: PenReading;
  let wasNegation = false;
  let channelCount = 0;
  try {
    pools = gateway.quarantinePools.size;
    pen = await setAsideWarning(gateway);
    const doorFaults: string[] = [];
    const doors = loginDoorReadings(seed, doorFaults);
    for (const fault of doorFaults) {
      io.out(`loam: ${fault}. The revival check below speaks for one reader fewer.`);
    }
    wasNegation =
      gateway.reactor.get(id)?.claims.pointers.some((p) => p.role === "negates") === true;
    channelCount = gateway.channelStatus().length;
    const moment = Date.now();
    const before = readGrounds(gateway, doors, moment);
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
      io.err(`erase ${id}: ${err instanceof Error ? err.message : String(err)}`);
      const heldBy = await Promise.all(
        [gateway, ...gateway.quarantinePools].map((g) => g.backend.holds(id).catch(() => true)),
      );
      if (heldBy.some(Boolean)) {
        io.err(
          `loam: the removal did not complete in this store's own ground, so the revival reading ` +
            `below was taken over a ground that may not reflect the purge. Treat an empty answer ` +
            `as UNMEASURED rather than as nothing having come back.`,
        );
      }
      reportRevived(io, cameBack(), gateway, "already", wasNegation, channelCount);
      const already = standingErasures(
        gateway.reactor,
        gateway.validityNow(),
        gateway.operatorAuthor,
      ).find((t) => erasureTarget(t.claims) === id);
      if (already !== undefined) {
        const stores = unreachableStoreReport(gateway);
        const unreachable = stores.faultEntities;
        const keptNote =
          stores.kept.length === 0
            ? ""
            : ` ${stores.kept.length} container(s) were KEPT OUTSIDE this sweep at your own ` +
              `say-so, and were not asked: this speaks for the tiers this run entered.`;
        const standing = await erasureStanding(gateway, id).catch((): ErasureStanding => "unasked");
        const outstanding = standing === "held" || standing === "owed";
        const recorded = new Date(already.claims.timestamp).toISOString();
        const reader = `\`loam erasures show ${already.id}\``;
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
      `  receipt      ${done.erasure}${done.minted ? "" : "  (REUSED, not minted by this run)"}\n` +
      `  spoken by    ${done.spokenBy ?? `${LEDGER_NONE} this receipt does not record whose record it forgot`}\n` +
      `  reason       ${done.reasons.length === 0 ? `${LEDGER_NONE} this receipt records none` : done.reasons.join(" · ")}\n` +
      (done.minted || done.reasons.includes(reason)
        ? ""
        : `  YOUR --reason IS NOT ON THE RECEIPT: this run reused the one an earlier run minted, and\n` +
          `  a receipt is immutable. Negating it withdraws the record; the id stays refused forever (§11).\n`) +
      `  the bytes are gone, asked tier by tier: ${swept.join(", ")}\n` +
      `  \`loam erasures show ${done.erasure}\` reads the receipt back` +
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
  if (!done.minted) {
    io.out(
      `loam: this run REUSED a standing receipt, so the revival reading above answers for THIS run ` +
        `only. Whatever an earlier run freed was already free when this one started, and no run ` +
        `after the first can see it.`,
    );
  }
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
      }${looked ? "" : ", and the boundaries above name readings it could not compare"}. A negation ` +
        `removed from a kept store would revive there unseen.`,
    );
  }
  if (pen.text !== undefined) {
    io.out(
      `loam: ${pen.text}\n  AND THE VERDICT ABOVE COULD NOT SEE THEM: a byte probe asks by id, while a ` +
        `set-aside row holds another delta's claims under its own — so an erased record can still ` +
        `be legible inside one.`,
    );
  }
  for (const lag of lagged) io.out(`loam: ${lag}`);
  if (invented.length > 0) {
    io.out(
      `loam: ${capped(invented, 4)} did not exist before this run and was created empty by it. An ` +
        `empty tier answers "no bytes here", so its line above proves nothing — if you meant a ` +
        `vault this store is actually served with, that vault still holds this record and this run ` +
        `did not touch it.`,
    );
  }
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
        "the bytes this command removed: a new request does not clear them from its memory. " +
        "Restart it.",
    );
  }
  return 0;
}

const SWEEP_CELL: Record<ErasureStanding, string> = {
  settled: "swept — no tier this run opened still holds it",
  held: "NOT SWEPT — a tier this run opened STILL HOLDS the bytes",
  owed: "NOT SETTLED — a store in reach has no receipt for it yet",
  unasked: "UNPROVEN — a tier refused the question, so nothing here was measured",
};

function receiptDetail(r: ErasureReceipt, standing: ErasureStanding): string {
  const lines = [`loam: receipt ${r.erasure}`];
  const say = (label: string, text: string): void => {
    lines.push(`  ${label.padEnd(14)}${text}`);
  };
  say("erased", r.erased);
  say(
    "spoken by",
    r.spokenBy ?? `${LEDGER_NONE} this receipt does not record whose record it forgot`,
  );
  say("ordered by", `${r.orderedBy} (the instance operator — §11 admits no other signer)`);
  say("ordered at", new Date(r.at).toISOString());
  say(
    "reason",
    r.reasons.length === 0 ? "none recorded — this receipt cannot say why" : r.reasons.join(" · "),
  );
  if (r.slate !== undefined) say("slate", `${r.slate} — one member of that cut (§29.6)`);
  say("sweep", SWEEP_CELL[standing]);
  lines.push(
    "  the receipt remembers THAT this id was forgotten, and none of what it said — which is what",
    "  makes keeping it honest.",
  );
  return lines.join("\n");
}

function wantedRows(
  receipts: readonly ErasureReceipt[],
  sub: "list" | "show",
  wanted: string | undefined,
): string[] {
  const rows = sub === "list" ? receipts : receipts.filter((r) => matchesReceipt(r, wanted ?? ""));
  return rows.map((r) => r.erased);
}

function matchesReceipt(r: ErasureReceipt, wanted: string): boolean {
  if (wanted.length < 8) return r.erasure === wanted || r.erased === wanted;
  return r.erasure.startsWith(wanted) || r.erased.startsWith(wanted);
}

async function cmdErasures(args: readonly string[], io: IO): Promise<number> {
  const parsed = parseFor("erasures", args);
  const sub = parsed.positionals[0];
  if (sub !== "list" && sub !== "show") {
    io.err(
      sub === undefined
        ? "erasures wants a subcommand: `loam erasures list`, or `loam erasures show <id>`"
        : `erasures: there is no \`erasures ${sub}\` — the reader is ` +
            "`loam erasures list` and `loam erasures show <id>`",
    );
    return 2;
  }
  const wanted = parsed.positionals[1];
  if (sub === "show" && wanted === undefined) {
    io.err(
      "erasures show wants an id: `loam erasures show <id>` — the receipt's own address, or " +
        "the id it erased",
    );
    return 2;
  }
  if (parsed.positionals.length > (sub === "show" ? 2 : 1)) {
    io.err(`erasures ${sub} takes ${sub === "show" ? "exactly one id" : "no arguments"}`);
    return 2;
  }
  const home = parsed.flags.get("home") ?? defaultHome();
  const unusable = homeDefect(home, { allowMissing: false });
  if (unusable !== undefined) {
    io.err(`erasures ${sub}: ${unusable}`);
    return 1;
  }
  const seed = operatorSeed(home, `erasures ${sub}`, io);
  if (typeof seed !== "string") return seed.code;
  const configured = archivePath(home);
  const cold = configured === undefined ? [] : [configured];
  const { gateway, path } = await openTiers(home, seed, parsed, io, cold);
  let ledger: { receipts: ErasureReceipt[]; inert: number };
  let pen: PenReading;
  let standings: StandingReport;
  let outside: string[] = [];
  try {
    ledger = receiptLedger(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor);
    pen = await setAsideWarning(gateway);
    standings = await erasureStandings(gateway, wantedRows(ledger.receipts, sub, wanted));
    const stores = unreachableStoreReport(gateway);
    outside = [...stores.faultEntities, ...stores.kept];
  } finally {
    await gateway.close();
  }
  const standingOf = (erased: string): ErasureStanding =>
    standings.standings.get(erased) ?? "unasked";
  if (pen.text !== undefined) io.out(`loam: ${pen.text}`);
  io.out(
    configured !== undefined
      ? `loam: the sweep column below asked ${path}, every attached pool, and the cold archive at ` +
          `${configured}. A vault this home is served with under \`--archive\` but does not name ` +
          `in config.json was NOT asked, and is not covered by any verdict here.`
      : `loam: the sweep column below asked ${path} and every attached pool. This home's ` +
          `config.json names no cold archive — if this store is served with \`--archive <dir>\`, ` +
          `that vault was NOT asked and may still hold what a row here calls swept.`,
  );
  if (outside.length > 0) {
    io.out(
      `loam: ${outside.length} container(s) are OUTSIDE every verdict below — ` +
        `${capped(outside, 4)}. A container kept out at your own say-so, or declared and not ` +
        `attached, is not asked by this probe, and a row can read swept while its bytes sit there.`,
    );
  }

  if (sub === "show") {
    const found = ledger.receipts.filter((r) => matchesReceipt(r, wanted ?? ""));
    if (found.length > 1 && !found.some((r) => r.erasure === wanted || r.erased === wanted)) {
      io.err(
        `erasures show: ${wanted} names ${found.length} receipts here — ` +
          `${capped(found.map((r) => shortId(r.erasure)))}. Give more of the address.`,
      );
      return 2;
    }
    if (found.length === 0) {
      io.err(
        `erasures show: no receipt STANDS for ${wanted} — not as a receipt, and not as an id ` +
          `this store is currently forgetting. \`loam erasures list\` shows what stands.` +
          (ledger.inert <= 0
            ? ""
            : `\n  ${ledger.inert} receipt${ledger.inert === 1 ? "" : "s"} here ` +
              `${ledger.inert === 1 ? "does" : "do"} not bind — negated (§11) or ` +
              `malformed. If ${wanted}'s erasure was negated, the id is still refused forever, but no ` +
              `receipt stands for it, so this screen cannot tell it apart from an id never held.`),
      );
      return 1;
    }
    for (const r of found) io.out(receiptDetail(r, standingOf(r.erased)));
    return 0;
  }

  const withheld =
    ledger.inert <= 0
      ? ""
      : `\n  ${ledger.inert} more receipt${ledger.inert === 1 ? "" : "s"} in the ground ` +
        `${ledger.inert === 1 ? "does" : "do"} not bind — negated (the id stays refused, ` +
        `§11) or malformed. Named here rather than dropped: an omission and a revocation look ` +
        `identical on a screen that only loses the row.`;
  if (ledger.receipts.length === 0) {
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
      shortId(r.erasure),
      new Date(r.at).toISOString(),
      standingOf(r.erased) === "settled" ? "swept" : standingOf(r.erased).toUpperCase(),
      r.spokenBy === undefined ? LEDGER_NONE : shortAuthor(r.spokenBy),
      r.reasons.length === 0 ? LEDGER_NONE : r.reasons.join(" · "),
    ]),
  )) {
    io.out(line);
  }
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
        `${capped(unswept.map((r) => shortId(r.erased)))}. An erasure is a promise — §11 lands it, ` +
        `purges, and only then reports a tier that refused — so a receipt can stand while the bytes ` +
        `do not. \`loam erase <id> --reason "…"\` re-runs the sweep; \`loam erasures show <id>\` ` +
        `reads one row in full.`,
    );
  }
  return 0;
}

function defaultHome(): string {
  return process.env["LOAM_HOME"] ?? ".loam";
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return 4321;
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return n <= 65535 ? n : undefined;
}

export async function run(
  argv: readonly string[],
  io: IO,
  options: RunOptions = {},
): Promise<number | ServerHandle> {
  const [typed, ...rest] = argv;
  const command = typed === "tombstones" ? "erasures" : typed;
  if (command === undefined || command === "--help" || command === "help") {
    io.out(topHelp());
    return 0;
  }
  if (command === "--version" || command === "version") {
    io.out(options.version ?? VERSION);
    return 0;
  }
  if (isCommand(command) && rest.some((arg) => arg === "--help" || arg === "-h")) {
    io.out(helpFor(command));
    return 0;
  }
  try {
    switch (command) {
      case "command": {
        const parsed = parseFor("command", rest);
        if (
          parsed.positionals.length > 0 ||
          !parsed.flags.has("installation") ||
          !parsed.flags.has("request")
        )
          throw new UsageError("command requires --installation and --request files");
        const home = parsed.flags.get("home") ?? defaultHome();
        return await runOperatorCommand(
          {
            home,
            store: storePath(home, parsed.flags.get("store")),
            installation: parsed.flags.get("installation")!,
            request: parsed.flags.get("request")!,
          },
          io,
        );
      }
      case "init":
        return await cmdInit(rest, io, options);
      case "serve":
        return await cmdServe(rest, io, options);
      case "register":
        return await cmdRegister(rest, io);
      case "pull":
        return await cmdPull(rest, io);
      case "federate":
        return await cmdFederate(rest, io);
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
      case "client":
        return await cmdClient(rest, io);
      case "slate":
        return await cmdSlate(rest, io);
      case "erase":
        return await cmdErase(rest, io);
      case "erasures":
        return await cmdErasures(rest, io);
      default:
        io.err(`loam: unknown command "${command}" — run \`loam --help\``);
        return 2;
    }
  } catch (err) {
    io.err(`loam: ${err instanceof Error ? err.message : String(err)}`);
    return err instanceof UsageError ? 2 : 1;
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const result = await run(argv, {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  });
  if (typeof result === "number") process.exitCode = result;
}
