import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { endJson } from "./respond.js";
import {
  BodyTooLarge,
  parseBodyFields as parseAppBody,
  readBodyStrict as readBody,
} from "./body.js";
import { authorForSeed, type Delta, ParseError } from "@bombadil/rhizomatic";
import { Kind, OperationTypeNode, parse, type DocumentNode } from "graphql";
import { fromWire, toWire, type WireDelta } from "../federation/wire.js";
import { buildOpenApi, handleRest } from "../surface/rest.js";
import {
  NothingPublic,
  type Gateway,
  type QueryResult,
  type RequestContext,
  NUL,
} from "../gateway/gateway.js";
import {
  parseRegistrationInput,
  lensNameFor,
  schemaEntityFor,
  type LensName,
  type RegistrationInput,
} from "../gateway/registration.js";
import { parseReadGesture, type ReadGesture } from "../gateway/renderers.js";
import { makeMountTable, type ResolvedMount } from "./mounts.js";
import {
  canonicalPublicUrl,
  makeConsentDoor,
  makeOAuthDoors,
  makeTokenDoor,
  publicUrlDefect,
  redirectOriginDefect,
  type ConnectorRegistration,
  type ConsentDoor,
  type OAuthDoors,
  type TokenDoor,
} from "./oauth.js";
import { readClientsFile, readClientSeed } from "./clients-file.js";
import { sourceFor } from "../federation/channel.js";
import { parseOffer } from "../federation/offer.js";
import {
  federateContainersOf,
  fenceAdmits,
  holdsGrant,
  registerPrefixesOf,
} from "../gateway/accounts.js";
import {
  containerClaims,
  everDeclared,
  governingLeeway,
  inboxName,
  readContainerTable,
  danglingAncestor,
  treeRootsOf,
  withinSubtree,
  type ContainerTable,
} from "../gateway/container-law.js";
import { boundChannelAdmits, connectionStands } from "../gateway/connection-authority.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { readSeed, readUserSeed, userSeedPath } from "../cli/config.js";
import { DOC_TOPICS } from "./docs-content.js";
import { CSP, makeUserDoors, type UserDoorOptions, type UserDoors } from "./session.js";
import { makeAdminDoor, type AdminDoor } from "./admin.js";
import { ADMIN_CONTAINER_PATH } from "./admin-pages.js";
import { appendRefusal, mintableNameDefect } from "./refusal.js";
import { refusalKey } from "../gateway/lifecycle.js";
import type { ChannelStatus } from "../federation/channel.js";
import type { ConnectionBinding } from "../gateway/gateway.js";
import { canonicalLeewayJson, parseLeeway, type Leeway } from "../gateway/leeway.js";
import { withStamp } from "../gateway/stamp.js";

export { type UserDoorOptions } from "./session.js";

export interface TokenIdentity {
  readonly actor?: string;
  readonly operator?: true;

  readonly binding?: {
    readonly user: string;
    readonly container: string;
    readonly inbox: string;
  };
}

export interface ServeOptions {
  readonly mounts: Record<string, Gateway>;
  readonly tokens: Record<string, TokenIdentity>;
  readonly port?: number;
  readonly host?: string;
  readonly maxBodyBytes?: number;
  readonly maxStreams?: number;
  readonly maxPublicStreams?: number;

  readonly publicUrl?: string;

  readonly connectors?: ConnectorRegistration;

  readonly users?: UserDoorOptions;

  readonly clients?: { readonly home: string };
}

const DEFAULT_MAX_BODY = 4 * 1024 * 1024;
const DEFAULT_MAX_STREAMS = 1024;
const DEFAULT_MAX_PUBLIC_STREAMS = 256;

export interface ServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly url: string;

  addMount(name: string, gateway: Gateway): void;

  removeMount(name: string): Promise<boolean>;
  unroutableMounts(): string[];
  close(): Promise<void>;
}

interface MountGuard {
  readonly name: string;
  live(): boolean;
  gone(): void;
}

interface LiveStream {
  readonly events: AsyncGenerator<Record<string, unknown>>;
  readonly res: ServerResponse;
  readonly mount: string;
}

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();

const GREETING = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>a Loam store</title>
<style>
  body { margin: 0; font: 16px/1.65 ui-sans-serif, system-ui, sans-serif; color: #2b2620;
         background: #faf7f1; display: grid; min-height: 100vh; place-items: center; }
  main { max-width: 34rem; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.35rem; font-weight: 650; margin: 0 0 1rem; }
  p { margin: 0.75rem 0; }
  code { font: 0.92em ui-monospace, "Cascadia Mono", monospace; background: #00000012;
         padding: 0.1em 0.4em; border-radius: 0.3em; }
  .quiet { color: #6f675c; font-size: 0.92em; margin-top: 1.5rem; }
  a { color: #7a5a2e; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6dfd4; background: #1f1b17; }
    code { background: #ffffff1f; }
    .quiet { color: #a89e90; }
    a { color: #cfa86a; }
  }
</style>
</head>
<body>
<main>
<h1>A Loam store serves here.</h1>
<p>Loam is a database that writes by adding: signed, content-addressed deltas whose merge is
union — order-blind, idempotent, conflict-free. A claim is added rather than edited in place, so
the past stays legible by default — and an erasure is the one act that takes bytes back, on
purpose. Two stores merge what each has agreed to admit from the other. This is one of them.</p>
<p>Its doors are the mounts: <code>/&lt;mount&gt;/graphql</code> to ask,
<code>/&lt;mount&gt;/subscribe</code> to listen, <code>/&lt;mount&gt;/rest</code> and
<code>/&lt;mount&gt;/mcp</code> for the same worlds in other tongues.</p>
<p>If you are a person with a name here, <a href="/login">/login</a> is your door: sign in,
and the store meets you in pages instead of JSON.</p>
<p>What the operator has declared public answers without a token; every other door wants
<code>Authorization: Bearer &hellip;</code> — and a door that refuses you is not saying
nothing is there, only that it will not say.</p>
<p class="quiet">This page names no mounts, on purpose. Which worlds live here is between
you and your token.</p>
</main>
</body>
</html>
`;

const CORS = { "access-control-allow-origin": "*" } as const;

export const MCP_PROTOCOLS: readonly string[] = ["2025-06-18", "2025-03-26"];
export const MCP_CAPABILITIES = { tools: {}, resources: {} } as const;
export const MCP_SERVER_INFO = { name: "loam", version: "0.7.0" } as const;
export const MCP_INSTRUCTIONS =
  "This is a Loam store. `loam_query` reads it with GraphQL and `loam_mutate` writes " +
  "to it as your token's identity; call tools/list for their schemas. Every answer is " +
  "resolved through the store's registered schemas, so a field you cannot see MAY be a " +
  "field you are not granted — it may equally be unset, or resolved absent by the " +
  "schema. Absence is not a refusal. `loam_docs` serves this store's own manual, " +
  "compiled into the running build — call it with no arguments to list the topics.";
const docUri = (topic: string): string => `loam://docs/${topic}`;

const preflight = (res: ServerResponse): void => {
  res.writeHead(204, {
    ...CORS,
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  });
  res.end();
};

const json = (
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void => endJson(res, status, body, { ...CORS, ...extraHeaders });

const sendRendered = (
  res: ServerResponse,
  out: { status: number; contentType: string; body: string },
): void => {
  res.writeHead(out.status, { "content-type": out.contentType, ...CORS });
  res.end(out.body);
};

const appRouteOf = (pathname: string): { route: string; entity: string } | undefined => {
  const segs = pathname.split("/").slice(3);
  if (segs.length !== 2 || segs[0] === "" || segs[1] === "") return undefined;
  try {
    return { route: decodeURIComponent(segs[0]!), entity: decodeURIComponent(segs[1]!) };
  } catch {
    return undefined;
  }
};

const MAX_GESTURE_READS = 8;

interface AppPin {
  readonly asOf?: number;
  readonly error?: string;
}

const appAsOfOf = (params: URLSearchParams): AppPin => {
  const raw = params.get("asOf");
  if (raw === null || raw === "") return {};
  const t = Number(raw);
  if (!Number.isFinite(t)) return { error: "asOf must be a numeric timestamp (milliseconds)" };
  return { asOf: t };
};

const gestureOf = (
  params: URLSearchParams,
): { reads: ReadGesture[]; state: Record<string, string> } => {
  const reads: ReadGesture[] = [];
  const state: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key === "read") {
      const g = parseReadGesture(value);
      if (g !== undefined && reads.length < MAX_GESTURE_READS) reads.push(g);
      continue;
    }
    state[key] = value;
  }
  return { reads, state };
};

const sendBytes = (
  res: ServerResponse,
  out: { status: number; contentType: string; body: Uint8Array },
): void => {
  res.writeHead(out.status, { "content-type": out.contentType, ...CORS });
  res.end(Buffer.from(out.body));
};

const byteDoorOf = (
  pathname: string,
  params: URLSearchParams,
): { ref: string; lens: LensName; entity: string } | undefined => {
  const segs = pathname.split("/").slice(3);
  if (segs.length !== 1 || segs[0] === "") return undefined;
  const fromRaw = params.get("from");
  if (fromRaw === null || fromRaw === "") return undefined;
  try {
    const from = decodeURIComponent(fromRaw);
    const i = from.indexOf("/");
    if (i <= 0 || i >= from.length - 1) return undefined;
    return {
      ref: decodeURIComponent(segs[0]!),
      lens: from.slice(0, i) as LensName,
      entity: from.slice(i + 1),
    };
  } catch {
    return undefined;
  }
};

const REGISTRATION_REFUSAL = "registration is constitutional: it requires an operator token";

function registrationRoute(
  gateway: Gateway,
  identity: TokenIdentity,
): { pick: (input: RegistrationInput) => Gateway; toPool: boolean } {
  const route: { pick: (input: RegistrationInput) => Gateway; toPool: boolean } = {
    toPool: false,
    pick: () => gateway,
  };
  const binding = identity.binding;
  if (binding === undefined) return route;
  const own = `${binding.container}:`;
  route.pick = (input) => {
    const programInside = fenceAdmits(own, input.hyperschema.name);
    const readingInside = fenceAdmits(own, lensNameFor(input.hyperschema, input.schema));
    if (programInside !== readingInside) {
      throw new NotPermittedToRegister(REGISTRATION_REFUSAL);
    }
    if (!programInside) return gateway;
    route.toPool = true;
    return gateway.poolForBinding(binding);
  };
  return route;
}

function asServedTo(
  gateway: Gateway,
  identity: TokenIdentity,
  outcome: Awaited<ReturnType<typeof performRegistration>>,
  toPool: boolean,
): Awaited<ReturnType<typeof performRegistration>> {
  if (!toPool || identity.binding === undefined || !outcome.bound) return outcome;
  const surface = gateway.boundSurface(identity.binding);
  const inbox = identity.binding.inbox;
  const served = surface.registered.some(
    (r) => r.channel === inbox && (r.lensName ?? r.hyperschema.name) === outcome.lens,
  );
  if (served) return outcome;
  return {
    ...outcome,
    bound: false,
    reason:
      surface.refused.get(refusalKey(inbox, outcome.lens)) ??
      `the container's surface did not bind ${outcome.lens}, so it is written and not served`,
  };
}

class NotPermittedToRegister extends Error {}

function registerStanding(
  gateway: Gateway,
  identity: TokenIdentity,
): readonly string[] | undefined {
  if (identity.operator === true) return [];
  if (identity.binding !== undefined) return [`${identity.binding.container}:`];
  if (identity.actor === undefined) return undefined;
  let author: string;
  try {
    author = authorForSeed(identity.actor);
  } catch {
    return undefined;
  }
  const granted = [
    ...new Set(
      gateway
        .lawAuthors("grants")
        .flatMap((law) => registerPrefixesOf(gateway.reactor, gateway.validityNow(), author, law)),
    ),
  ];
  return granted.length === 0 ? undefined : granted;
}

function federateStanding(
  gateway: Gateway,
  identity: TokenIdentity,
): readonly string[] | undefined {
  if (identity.operator === true) return [];
  if (identity.actor === undefined) return undefined;
  let author: string;
  try {
    author = authorForSeed(identity.actor);
  } catch {
    return undefined;
  }
  const containers = [
    ...new Set(
      gateway
        .lawAuthors("grants")
        .flatMap((law) =>
          federateContainersOf(gateway.reactor, gateway.validityNow(), author, law),
        ),
    ),
  ];
  return containers.length === 0 ? undefined : containers;
}

function mintableAt(
  gateway: Gateway,
  binding: ConnectionBinding,
  table: ContainerTable,
  root: string,
  missing: readonly string[],
): string | undefined {
  const struck = missing.find((container) =>
    everDeclared(gateway.reactor, gateway.operatorAuthor, container),
  );
  if (struck !== undefined) {
    return (
      `${struck} was declared and then dropped. Making a name there would restore what the drop ` +
      `removed, so it is refused. Ask the person who dropped it.`
    );
  }
  if (danglingAncestor(table, root) !== undefined) {
    return (
      `${root} stands, but it hangs from a container that does not, so it is reachable from no ` +
      `page the person has. Nothing may be made beneath it.`
    );
  }
  if (!withinSubtree(table, root, binding.container)) {
    return (
      `${root} bears a name inside your container but does not stand inside it: its edges do not ` +
      `lead back to ${binding.container}, so nothing may be made beneath it.`
    );
  }
  return undefined;
}

const STANDING_ENDED =
  "this connection no longer stands in its container, so it shapes nothing here. Ask the person " +
  "who connected you to connect you again.";

function receiveRefusal(
  gateway: Gateway,
  binding: ConnectionBinding,
  into: string,
  prefix: string | undefined,
): string | undefined {
  const fence = `${binding.container}:`;
  if (into !== binding.container && !fenceAdmits(fence, into)) {
    return (
      "a connection receives only into its own container or a descendant of it — the path and " +
      `its colon — and ${into} is outside ${fence}`
    );
  }
  if (into !== binding.container) {
    const defect = mintableNameDefect(fence, into);
    if (defect !== undefined) {
      return `a connection receives only into a container it could name: ${defect}`;
    }
  }
  if (prefix !== undefined && !fenceAdmits(`${into}:`, prefix)) {
    return (
      "a connection assigns a peer a prefix inside the container it receives into — the path " +
      `and its colon — and ${prefix} is outside ${into}:`
    );
  }
  const table = readContainerTable(gateway.reactor, gateway.validityNow(), gateway.operatorAuthor);
  let root = into;
  while (root !== binding.container && !table.containers.has(root) && root.includes(":")) {
    root = root.slice(0, root.lastIndexOf(":"));
  }
  if (danglingAncestor(table, root) !== undefined) {
    return (
      `${root} stands, but it hangs from a container that does not, so it is reachable from no ` +
      `page the person has — a channel cannot be opened there`
    );
  }
  const governed = governingLeeway(table, into);
  const declaredHere =
    governed !== undefined &&
    (governed.at === binding.container || fenceAdmits(fence, governed.at));
  if (!declaredHere) {
    return (
      `the container ${binding.container} does not receive: no leeway is declared for it, and an ` +
      "absent leeway is every switch off"
    );
  }
  if (!governed.leeway.receive) {
    return (
      `the container ${governed.at} does not receive: the leeway in force there has its receive ` +
      "switch off"
    );
  }
  if (!table.containers.has(into)) {
    let root = into;
    while (root !== binding.container && !table.containers.has(root) && root.includes(":")) {
      root = root.slice(0, root.lastIndexOf(":"));
    }
    if (table.containers.has(root) && !withinSubtree(table, root, binding.container)) {
      return (
        `${root} bears a name inside your container but does not stand inside it: its edges do ` +
        `not lead back to ${binding.container}, so nothing may be made beneath it`
      );
    }
  }
  let anchor = into;
  while (anchor !== binding.container && !table.containers.has(anchor) && anchor.includes(":")) {
    anchor = anchor.slice(0, anchor.lastIndexOf(":"));
  }
  const homes = treeRootsOf(table, binding.container);
  if (homes.length !== 1 || !table.containers.has(homes[0]!)) {
    return (
      `the container this connection is bound to does not stand in exactly one tree, so where a ` +
      `channel would be seen is not decided. It is refused until that is settled.`
    );
  }
  if (table.containers.has(anchor)) {
    const lands = treeRootsOf(table, anchor);
    if (lands.length !== 1 || lands[0] !== homes[0]) {
      return (
        `${into} bears a name inside your container but hangs outside it: a channel opened there ` +
        `would serve a subtree that is not yours, so it is refused`
      );
    }
  }
  return undefined;
}

const CONNECTION_AGGREGATOR = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: "\u0000none" } },
  in: "input",
} as const;

function leewayFromTool(args: Record<string, unknown>): Leeway | string {
  const asked: Record<string, unknown> = { ...args };
  delete asked["name"];
  const parsed = parseLeeway(canonicalLeewayJson(fillLeeway(asked, 0)));
  return "leeway" in parsed ? parsed.leeway : parsed.defect;
}

function fillLeeway(value: unknown, depth: number): unknown {
  if (depth > 32 || typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const given = value as Record<string, unknown>;
  const delegate = given["delegate"];
  return {
    receive: false,
    offer: false,
    publish: false,
    envelope: "small",
    ...given,
    delegate:
      delegate === undefined || delegate === false
        ? "off"
        : delegate === true
          ? "same"
          : typeof delegate === "object" && delegate !== null
            ? fillLeeway(delegate, depth + 1)
            : delegate,
  };
}

function channelAdmits(
  gateway: Gateway,
  identity: TokenIdentity,
  standing: readonly string[] | undefined,
  channel: ChannelStatus,
): boolean {
  return identity.binding === undefined
    ? federateAdmits(standing, channel.into)
    : boundChannelAdmits(gateway, identity.binding, channel);
}

function federateAdmits(standing: readonly string[] | undefined, container: string): boolean {
  if (standing === undefined) return false;
  return standing.length === 0 || standing.includes(container);
}

function registerFenceAdmits(fence: readonly string[], input: RegistrationInput): boolean {
  const reading = lensNameFor(input.hyperschema, input.schema);
  if (reading.includes(NUL)) return false;
  const inside = (name: string): boolean => fence.some((prefix) => fenceAdmits(prefix, name));
  if (!inside(input.hyperschema.name)) return false;
  if (!inside(reading)) return false;
  return input.entity === undefined || input.entity === schemaEntityFor(input.hyperschema);
}

function scopedRegistrationDefect(input: RegistrationInput): string | undefined {
  if (input.resolvers !== undefined) {
    return (
      "register: `resolvers` carries executable code, and a scoped registration may not ship it — " +
      "resolvers run in the gateway process and load before anything persists. Remove the field; " +
      "an operator token may still publish resolvers."
    );
  }
  if (input.mutations !== undefined) {
    return (
      "register: `mutations` names fields in a namespace shared by every schema this store serves, " +
      "which no prefix fences — a scoped registration may not claim one. Remove the field; an " +
      "operator token may still publish mutation templates."
    );
  }
  return undefined;
}

async function performRegistration(
  gateway: Gateway,
  raw: unknown,
  fence: readonly string[],
  route: (input: RegistrationInput) => Gateway = () => gateway,
): Promise<{
  registered: string;
  lens: string;
  entity: string;
  bound: boolean;
  reason?: string | undefined;
  warnings?: readonly string[] | undefined;
}> {
  let input: RegistrationInput;
  try {
    input = parseRegistrationInput(raw);
  } catch (err) {
    if (err instanceof ParseError && err.kind === "unknown-op") {
      throw new Error(`${err.message} — call loam_docs(topic: "register-grammar")`);
    }
    throw err;
  }
  if (fence.length > 0) {
    const defect = scopedRegistrationDefect(input);
    if (defect !== undefined) throw new Error(defect);
    if (!registerFenceAdmits(fence, input)) throw new NotPermittedToRegister(REGISTRATION_REFUSAL);
  }
  const outcome = await route(input).publishRegistration(
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
  const answer = {
    registered: input.hyperschema.name,
    lens: outcome.lens,
    entity: schemaEntityFor(input.hyperschema, input.entity),
    bound: outcome.bound,
    ...(outcome.warnings === undefined ? {} : { warnings: outcome.warnings }),
  };
  return outcome.bound ? answer : { ...answer, reason: outcome.reason };
}

export async function serve(options: ServeOptions): Promise<ServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS;
  const mounts = makeMountTable(options.mounts);
  const tokenEntries = Object.entries(options.tokens).map(
    ([token, identity]) => [sha(token), identity] as const,
  );
  if (tokenEntries.length === 0) {
    throw new Error("loam serve: no tokens configured — an unlockable door is a wall");
  }

  const redeeming = new Map<string, number>();

  let discovery: OAuthDoors | undefined;
  if (options.connectors !== undefined && options.publicUrl === undefined) {
    throw new Error(
      `loam serve: connector registration (--oauth-allow-redirect) needs --public-url — a ` +
        `connector finds the registration endpoint through the discovery document, which only ` +
        `exists when the store's public URL is configured`,
    );
  }
  if (options.publicUrl !== undefined) {
    const defect = publicUrlDefect(options.publicUrl);
    if (defect !== undefined) throw new Error(`loam serve: --public-url ${defect}`);
    if (options.connectors !== undefined) {
      for (const origin of options.connectors.allowRedirectOrigins) {
        const originDefect = redirectOriginDefect(origin);
        if (originDefect !== undefined) {
          throw new Error(`loam serve: --oauth-allow-redirect ${originDefect}`);
        }
      }
    }
    discovery = makeOAuthDoors({
      publicUrl: canonicalPublicUrl(options.publicUrl),
      ...(options.connectors === undefined
        ? {}
        : { registration: { ...options.connectors, redeeming } }),
    });
  }

  let userDoors: UserDoors | undefined;

  let admin: AdminDoor | undefined;

  let consent: ConsentDoor | undefined;

  let tokenExchange: TokenDoor | undefined;

  if (options.users !== undefined) {
    const strangers = Object.keys(options.mounts).filter((name) => name !== options.users!.mount);
    if (strangers.length > 0) {
      throw new Error(
        `loam serve: the login doors mint an operator identity for the whole server, so they ` +
          `cannot be opened beside a world they do not read users from — this server hosts ` +
          `[${strangers.join(", ")}] and the doors name "${options.users.mount}". A session ` +
          `token cannot be scoped to one mount yet, so opening them here would grant authority ` +
          `over worlds no role binding named.`,
      );
    }
  }

  const usersMount = options.users?.mount;
  const sessionTokens = new Map<
    string,
    { identity: TokenIdentity; expiresAt: number; stillLive: () => boolean }
  >();
  const clock = options.users?.monotonicNow ?? ((): number => performance.now());
  const sweepSessionTokens = (moment: number): void => {
    for (const [key, minted] of sessionTokens) {
      if (minted.expiresAt <= moment || !minted.stillLive()) sessionTokens.delete(key);
    }
  };
  const mintSessionToken = (
    identity: TokenIdentity,
    ttlMs: number,
    stillLive: () => boolean,
  ): { token: string; expiresAt: number } => {
    const secret = randomBytes(32).toString("base64url");
    const moment = clock();
    sweepSessionTokens(moment);
    const expiresAt = moment + ttlMs;
    sessionTokens.set(sha(secret).toString("hex"), { identity, expiresAt, stillLive });
    return { token: secret, expiresAt };
  };
  const revokeSessionTokens = (digests: readonly string[]): void => {
    for (const digest of digests) sessionTokens.delete(digest);
    sweepSessionTokens(clock());
  };

  const resolveClientBearer = (digest: string): TokenIdentity | undefined => {
    const home = options.clients?.home;
    if (home === undefined) return undefined;
    try {
      const record = readClientsFile(home).clients.find((c) => c.digest === digest);
      if (record === undefined) return undefined;
      return { actor: readClientSeed(home, record.name) };
    } catch {
      return undefined;
    }
  };

  const identify = (req: IncomingMessage): TokenIdentity | undefined => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return undefined;
    const presented = sha(header.slice("Bearer ".length));
    for (const [expected, identity] of tokenEntries) {
      if (timingSafeEqual(presented, expected)) return identity;
    }
    const digest = presented.toString("hex");
    const minted = sessionTokens.get(digest);
    if (minted === undefined) {
      return tokenExchange?.resolve(digest) ?? resolveClientBearer(digest);
    }
    if (minted.expiresAt <= clock() || !minted.stillLive()) {
      sessionTokens.delete(digest);
      return undefined;
    }
    if (usersMount !== undefined && mounts.live().some((name) => name !== usersMount)) {
      return undefined;
    }
    return minted.identity;
  };

  const stillAuthorized = (req: IncomingMessage): boolean => identify(req) !== undefined;

  const contextFor = (identity: TokenIdentity): RequestContext | undefined =>
    identity.actor === undefined
      ? undefined
      : identity.binding === undefined
        ? { actor: identity.actor }
        : {
            actor: identity.actor,
            binding: { container: identity.binding.container, inbox: identity.binding.inbox },
          };
  const boundDoorRefusal = (
    binding: NonNullable<TokenIdentity["binding"]>,
    door: string,
  ): { contentType: string; body: string } => ({
    contentType: "text/plain; charset=utf-8",
    body:
      `this connection is bound to ${binding.container} and reads only that container; the ` +
      `${door} resolves this store's own ground and cannot scope to it — use the query door`,
  });

  const connectorInfoOf = (
    req: IncomingMessage,
  ): { clientId: string; actor: string } | undefined => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return undefined;
    return tokenExchange?.describe(sha(header.slice("Bearer ".length)).toString("hex"));
  };
  const whoamiFor = (
    gateway: Gateway | undefined,
    identity: TokenIdentity | undefined,
    connector: { clientId: string; actor: string } | undefined,
  ): Record<string, unknown> => {
    if (identity === undefined) {
      return {
        kind: "anonymous",
        author: null,
        operator: false,
        write: false,
        registerPrefixes: [],
        federateContainers: [],
        masked: true,
        note:
          "Reads on this door are masked: views fold empty for this caller. An empty answer " +
          "here is not an empty store — present a token, or sign in, to see your standing.",
      };
    }
    if (identity.operator === true) {
      return {
        kind: "operator",
        author: gateway?.operatorAuthor ?? null,
        operator: true,
        write: true,
        registerPrefixes: [],
        federateContainers: [],
        masked: false,
        note: "The operator: unfenced on every door of this store.",
      };
    }
    let author: string | undefined;
    try {
      author = identity.actor === undefined ? undefined : authorForSeed(identity.actor);
    } catch {
      author = undefined;
    }
    if (author === undefined) {
      return {
        kind: "anonymous",
        author: null,
        operator: false,
        write: false,
        registerPrefixes: [],
        federateContainers: [],
        masked: true,
        note:
          "The presented token names no key, so this caller reads as anonymous: masked, " +
          "views folding empty.",
      };
    }
    const isConnector = connector !== undefined && connector.actor === author;
    const binding = identity.binding;
    const writeStanding = (): boolean => {
      if (gateway === undefined) return false;
      if (binding === undefined) {
        return holdsGrant(
          gateway.reactor,
          gateway.validityNow(),
          STORE_ENTITY,
          author,
          "write",
          gateway.operatorAuthor,
        );
      }
      try {
        const pool = gateway.poolForBinding(binding);
        return holdsGrant(
          pool.reactor,
          pool.validityNow(),
          STORE_ENTITY,
          author,
          "write",
          pool.operatorAuthor,
        );
      } catch {
        return false;
      }
    };
    const writes = writeStanding();
    return {
      kind: isConnector ? "connector" : "actor",
      author,
      ...(isConnector ? { clientId: connector.clientId } : {}),
      ...(binding === undefined ? {} : { binding }),
      operator: false,
      write: writes,
      registerPrefixes: gateway === undefined ? [] : (registerStanding(gateway, identity) ?? []),
      federateContainers:
        gateway === undefined
          ? []
          : federateContainersOf(
              gateway.reactor,
              gateway.validityNow(),
              author,
              gateway.operatorAuthor,
            ),
      masked: false,
      note:
        binding !== undefined
          ? writes
            ? `A connection bound by ${binding.user}'s consent: it writes into its inbox ` +
              `${binding.inbox} and reads the scope of ${binding.container}.`
            : `A connection bound by ${binding.user}'s consent: it reads the scope of ` +
              `${binding.container}, and its inbox ${binding.inbox} grants it no write ` +
              `standing — revoked, or not attached here.`
          : isConnector
            ? "A connector's minted identity: it writes as its own author, inside its grants."
            : "An actor token: it acts as this key, inside this key's surviving grants.",
    };
  };

  const streams = new Set<LiveStream>();
  const endStreams = async (doomed: readonly LiveStream[]): Promise<void> => {
    for (const s of doomed) {
      await s.events.return(undefined);
      s.res.end();
    }
  };

  const handleGraphql = async (
    run: (source: string, variables?: Record<string, unknown>) => Promise<QueryResult>,
    guard: MountGuard,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    let parsed: { query?: string; variables?: Record<string, unknown> };
    try {
      parsed = JSON.parse(await readBody(req, maxBody)) as typeof parsed;
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        json(res, 413, { errors: ["request body too large"] });
        return;
      }
      json(res, 400, {
        errors: ["the body must be JSON: { query, variables? }"],
      });
      return;
    }
    if (typeof parsed?.query !== "string") {
      json(res, 400, { errors: ["the body must carry a query string"] });
      return;
    }
    if (!guard.live()) {
      guard.gone();
      return;
    }
    let result: QueryResult;
    try {
      result = await run(parsed.query, parsed.variables);
    } catch (err) {
      if (err instanceof NothingPublic) {
        refused(res);
        return;
      }
      result = { errors: [err instanceof Error ? err.message : "the gateway could not answer"] };
    }
    json(res, 200, result);
  };

  let publicStreams = 0;
  const maxPublicStreams = options.maxPublicStreams ?? DEFAULT_MAX_PUBLIC_STREAMS;

  const handleSubscribe = async (
    open: (source: string) => Promise<AsyncGenerator<Record<string, unknown>>>,
    door: "token" | "public",
    guard: MountGuard,
    req: IncomingMessage,
    res: ServerResponse,
    search: URLSearchParams,
  ): Promise<void> => {
    const source = search.get("query");
    if (source === null) {
      json(res, 400, { errors: ["subscribe wants ?query=<subscription>"] });
      return;
    }
    if (streams.size >= maxStreams || (door === "public" && publicStreams >= maxPublicStreams)) {
      json(res, 503, { errors: ["this server is holding all the live streams it can"] });
      return;
    }
    let events: AsyncGenerator<Record<string, unknown>>;
    try {
      events = await open(source);
    } catch (err) {
      if (err instanceof NothingPublic) {
        refused(res);
        return;
      }
      const message = err instanceof Error ? err.message : "not a subscription";
      json(res, /cannot subscribe/.test(message) ? 403 : 400, { errors: [message] });
      return;
    }
    if (!guard.live()) {
      await events.return(undefined);
      guard.gone();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS,
    });
    const stream: LiveStream = { events, res, mount: guard.name };
    streams.add(stream);
    if (door === "public") publicStreams += 1;
    req.on("close", () => {
      void events.return(undefined);
    });
    try {
      for await (const event of events) {
        if (door === "token" && !stillAuthorized(req)) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "the credential that opened this stream is no longer live",
            })}\n\n`,
          );
          break;
        }
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "the stream failed";
      res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      if (door === "public") publicStreams -= 1;
      streams.delete(stream);
      res.end();
    }
  };

  const previewDrop = (gw: Gateway, channel: string): { purges: string[]; survives: string[] } => {
    const rows = gw.channelStatus();
    const target = rows.find((c) => c.name === channel);
    return {
      purges:
        target === undefined
          ? []
          : [`${target.name} (everything received from "${target.prefix}")`],
      survives: [
        ...(target === undefined ? [] : [`${target.into} (the container it receives into)`]),
        ...rows.filter((c) => c.name !== channel).map((c) => c.name),
      ],
    };
  };

  const MCP_TOOLS = [
    {
      name: "loam_query",
      description:
        "Run a GraphQL query against this Loam store; returns { data, errors }. " +
        "Reads only: a mutation or subscription document is refused. Every entity field takes " +
        "asOf (a millisecond timestamp) to answer as the store stood then, and every view " +
        "carries _asOf and _forgotten — the pin, and the erasures inside that window, never " +
        "their content.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, variables: { type: "object" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "loam_mutate",
      description:
        "Run a GraphQL mutation against this Loam store as the token's identity; " +
        "returns the re-resolved view.",
      inputSchema: {
        type: "object",
        properties: { mutation: { type: "string" }, variables: { type: "object" } },
        required: ["mutation"],
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "loam_register",
      description:
        "Define a schema as schema-schema deltas and register it. The operator registers anywhere; " +
        "a bound connection registers under its container path followed by a colon. An explicit " +
        "key grant does not widen that fence. An unbound key may instead hold register standing " +
        "over granted namespace prefixes, minted with `loam grant <client_id> --verb=register " +
        "--prefix=<ns>:`. Both the program and reading names must fit the caller's " +
        "registration fence. Resolver code never rides a scoped registration; code arrives by " +
        "federation and blessing. The surface serves the new type immediately; republishing at " +
        "the same entity evolves it.",
      inputSchema: {
        type: "object",
        properties: {
          hyperschema: {
            type: "object",
            properties: {
              name: { type: "string" },
              alg: { type: "number" },
              body: { type: "object", description: "the hyperschema body, term JSON" },
            },
            required: ["name", "body"],
          },
          schema: { type: "object", description: "the resolution schema, schema JSON" },
          roots: { type: "array", items: { type: "string" } },
          entity: {
            type: "string",
            description: "the hyperschema entity (default hyperschema:<name>)",
          },
          mutations: {
            type: "object",
            description: "named claim templates (the write discipline)",
          },
          writable: {
            type: "array",
            items: { type: "string" },
            description:
              "fields that accept a surface write; omit and NONE are writable (immutable-by-default, §14/§21)",
          },
        },
        required: ["hyperschema", "schema", "roots"],
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "loam_whoami",
      description:
        "Who does this store think you are, and what standing do you hold? Call this FIRST " +
        "when a view answers empty: under mask-drop an anonymous reader and an empty store " +
        "look identical, and this tool says which you are. Returns kind (operator | " +
        "connector | actor | anonymous), your author key, and your grants - write, register " +
        "prefixes, federate containers - read fresh from the ground.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "loam_docs",
      description:
        "Read this store's own documentation. The pages are compiled into the running build, so " +
        "they describe exactly the code that is serving you. No arguments lists the topics, each " +
        "with a one-line summary; { topic } returns the full markdown. Read " +
        '"register-grammar" before composing a loam_register body.',
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "a topic name from the no-argument listing" },
        },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "loam_federate_status",
      description:
        "List this store's federation channels and how each is doing: the container it receives " +
        "into, the prefix its peer's law is served under, whether it is receiving and blessing, " +
        "when it last synced, and how many attempts have failed since. A channel that has never " +
        "synced reports so, distinctly from one that is merely quiet.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "one channel by name; omit for all" },
        },
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "loam_federate_set",
      description:
        "Adjust a channel's two REVERSIBLE toggles. `receiving` false freezes it — nothing new " +
        "arrives and everything already received still reads. `blessing` false stops NEW law " +
        "binding and leaves law already bound serving. Neither severs the channel; severing is " +
        "loam_federate_drop, which is a different act on purpose.",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          receiving: { type: "boolean" },
          blessing: { type: "boolean" },
        },
        required: ["channel"],
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "loam_federate_connect",
      description:
        "Open a federation channel: receive a peer's deltas into a container you name, under a " +
        "PREFIX you assign. The prefix is yours, never the peer's, so no peer can take a name this " +
        "store already answers. Law that arrives binds under that prefix. Works the same whether " +
        "the address came from an offer someone sent you or from a source you chose to follow.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "the peer's mount address" },
          into: { type: "string", description: "the container to receive into" },
          prefix: { type: "string", description: "the namespace YOU assign this peer" },
          token: { type: "string", description: "the peer's door token, if it wants one" },
          bless: { type: "boolean", description: "bind law that arrives (default true)" },
        },
        required: ["from", "into", "prefix"],
      },
      annotations: { readOnlyHint: false },
    },
    {
      name: "loam_federate_drop",
      description:
        "STAGE a channel sever. This does NOT purge anything: it returns a link and a preview of " +
        "what would be removed and what would survive. A person completes " +
        "it in the browser — an agent cannot, by construction. To stop receiving and KEEP what " +
        "arrived, use loam_federate_set with receiving false instead; that is reversible and this " +
        "is not.",
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string" } },
        required: ["channel"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "loam_container_declare",
      description:
        "Declare a container INSIDE your own — the path and its colon. A connection shapes its own " +
        "subtree and nothing beside it: a name one level up, a sibling, or a name that merely " +
        "shares your letters is refused with the sentence naming the rule. The new container " +
        "declares no leeway of its own, so it inherits what yours allows until you set one with " +
        "loam_container_leeway.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "the container to declare, under your own path" },
        },
        required: ["name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "loam_container_leeway",
      description:
        "Set what a container in your subtree may do: receive, offer, publish, an envelope size, " +
        "and the terms below it. THIS REPLACES THE WHOLE LEEWAY: every switch you do not name is " +
        "off, so setting one switch turns the others off. The reply echoes what now stands. A " +
        "leeway that does not fit the terms above it is refused with the sentence naming the " +
        "ceiling, and a change is a delta the next request obeys. Your own container's leeway is " +
        "the person's to set, not yours.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "a container BELOW your own" },
          receive: { type: "boolean", description: "may it follow other stores (default false)" },
          offer: { type: "boolean", description: "may its descendants be offered (default false)" },
          publish: { type: "boolean", description: "may lenses be public here (default false)" },
          envelope: {
            type: "string",
            description: "how much compute may run behind glass: small, medium or large",
          },
          delegate: {
            type: "object",
            description:
              "the terms a child may differ within: the same switches, an envelope ceiling, and " +
              "`same` to carry these terms further down. Absent means it delegates nothing.",
          },
        },
        required: ["name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "loam_container_sever",
      description:
        "STAGE the sever of a channel your container opened. This is loam_federate_drop under the " +
        "roster's name, and it PURGES NOTHING: it returns a link and a preview of what would go " +
        "and what would stay. A person completes it in the browser, because an agent cannot hold " +
        "a session. To stop receiving and KEEP what arrived, set receiving false instead; that is " +
        "reversible and this is not.",
      inputSchema: {
        type: "object",
        properties: { channel: { type: "string" } },
        required: ["channel"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "loam_container_promote_stage",
      description:
        "STAGE the promotion of one output from your container's gather into the store's own " +
        "ground. It MOVES NOTHING: it returns what would be adopted and a link where a person " +
        "completes it. Promotion re-signs a claim under the store's name, so it is a person's act " +
        "to make; you nominate, they decide.",
      inputSchema: {
        type: "object",
        properties: { delta: { type: "string", description: "the delta id to nominate" } },
        required: ["delta"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    {
      name: "loam_container_receive",
      description:
        "Follow another store INTO your own subtree: a channel into your container or one below " +
        "it, under a prefix inside it, where that container's leeway says receive is on. What " +
        "arrives is kept in a pool of its own and serves your container alone. This is the same " +
        "act as loam_federate_connect, named for the roster; an unbound caller uses that one.",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "the peer's mount address" },
          into: { type: "string", description: "your container, or one below it" },
          prefix: { type: "string", description: "the namespace YOU assign this peer" },
          token: { type: "string", description: "the peer's door token, if it wants one" },
          bless: { type: "boolean", description: "bind law that arrives (default true)" },
        },
        required: ["from", "into", "prefix"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];

  const notARead = (source: string): string | undefined => {
    let document: DocumentNode;
    try {
      document = parse(source);
    } catch {
      return undefined;
    }
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
      if (definition.operation === OperationTypeNode.MUTATION) {
        return "loam_query is the read door and this document writes: send a mutation to loam_mutate";
      }
      if (definition.operation === OperationTypeNode.SUBSCRIPTION) {
        return "loam_query answers once: a subscription belongs at GET /:mount/subscribe?query=...";
      }
    }
    return undefined;
  };

  const handleMcp = async (
    gateway: Gateway,
    identity: TokenIdentity,
    guard: MountGuard,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    let rpc: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      const parsed: unknown = JSON.parse(await readBody(req, maxBody));
      if (Array.isArray(parsed)) {
        json(res, 400, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "batch requests are not supported" },
        });
        return;
      }
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("not an object");
      }
      rpc = parsed;
    } catch (err) {
      json(res, err instanceof BodyTooLarge ? 413 : 400, {
        jsonrpc: "2.0",
        id: null,
        error:
          err instanceof BodyTooLarge
            ? { code: -32600, message: "request body too large" }
            : { code: -32700, message: "parse error" },
      });
      return;
    }
    if (!guard.live()) {
      guard.gone();
      return;
    }
    const isNotification = rpc.id === undefined || rpc.id === null;
    const reply = (result: unknown): void =>
      json(res, 200, { jsonrpc: "2.0", id: rpc.id ?? null, result });

    switch (rpc.method) {
      case "initialize": {
        const asked = (rpc.params ?? {})["protocolVersion"];
        reply({
          protocolVersion:
            typeof asked === "string" && MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
          capabilities: MCP_CAPABILITIES,
          serverInfo: MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        });
        return;
      }
      case "server/discover": {
        if (isNotification) {
          res.writeHead(202, CORS).end();
          return;
        }
        reply({
          resultType: "complete",
          supportedVersions: [...MCP_PROTOCOLS],
          capabilities: MCP_CAPABILITIES,
          instructions: MCP_INSTRUCTIONS,
          _meta: { "io.modelcontextprotocol/serverInfo": MCP_SERVER_INFO },
        });
        return;
      }
      case "notifications/initialized":
        res.writeHead(202, CORS).end();
        return;
      case "tools/list":
        reply({ tools: MCP_TOOLS });
        return;
      case "resources/list":
        reply({
          resources: DOC_TOPICS.map((d) => ({
            uri: docUri(d.topic),
            name: d.topic,
            description: d.summary,
            mimeType: "text/markdown",
          })),
        });
        return;
      case "resources/read": {
        const uri = (rpc.params ?? {})["uri"];
        const doc = DOC_TOPICS.find((d) => docUri(d.topic) === uri);
        if (doc === undefined) {
          json(res, 200, {
            jsonrpc: "2.0",
            id: rpc.id ?? null,
            error: {
              code: -32002,
              message:
                `no such resource — this store serves: ` +
                DOC_TOPICS.map((d) => docUri(d.topic)).join(", "),
            },
          });
          return;
        }
        reply({
          contents: [{ uri: docUri(doc.topic), mimeType: "text/markdown", text: doc.markdown }],
        });
        return;
      }
      case "tools/call": {
        const params = rpc.params ?? {};
        const name = params["name"];
        if (name === "loam_register") {
          const fence = registerStanding(gateway, identity);
          if (fence === undefined) {
            reply({
              content: [{ type: "text", text: REGISTRATION_REFUSAL }],
              isError: true,
            });
            return;
          }
          try {
            const route = registrationRoute(gateway, identity);
            const outcome = asServedTo(
              gateway,
              identity,
              await performRegistration(gateway, params["arguments"] ?? {}, fence, route.pick),
              route.toPool,
            );
            reply({ content: [{ type: "text", text: JSON.stringify(outcome) }] });
          } catch (err) {
            reply({
              content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            });
          }
          return;
        }
        if (name === "loam_whoami") {
          reply({
            content: [
              {
                type: "text",
                text: JSON.stringify(whoamiFor(gateway, identity, connectorInfoOf(req)), null, 1),
              },
            ],
          });
          return;
        }
        if (name === "loam_docs") {
          const topic = ((params["arguments"] ?? {}) as { topic?: unknown }).topic;
          if (topic === undefined) {
            const listing = DOC_TOPICS.map((d) => `- ${d.topic} — ${d.summary}`).join("\n");
            reply({
              content: [
                {
                  type: "text",
                  text:
                    `This store's own manual, compiled into the build that is serving you:\n\n` +
                    `${listing}\n\nCall loam_docs with { topic: "<name>" } for the full markdown.`,
                },
              ],
            });
            return;
          }
          const doc = DOC_TOPICS.find((d) => d.topic === topic);
          if (doc === undefined) {
            const asked = typeof topic === "string" ? JSON.stringify(topic) : "that";
            reply({
              content: [
                {
                  type: "text",
                  text:
                    `no topic ${asked} here — the topics are: ` +
                    `${DOC_TOPICS.map((d) => d.topic).join(", ")}. Call loam_docs with no ` +
                    `arguments for their summaries.`,
                },
              ],
              isError: true,
            });
            return;
          }
          reply({ content: [{ type: "text", text: doc.markdown }] });
          return;
        }
        const args = (params["arguments"] ?? {}) as {
          query?: string;
          mutation?: string;
          variables?: Record<string, unknown>;
          channel?: string;
          receiving?: boolean;
          blessing?: boolean;
          from?: string;
          into?: string;
          prefix?: string;
          token?: string;
          bless?: boolean;
        };

        if (name === "loam_container_declare" || name === "loam_container_leeway") {
          const asked = args as Record<string, unknown>;
          const binding = identity.binding;
          if (binding === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "the container tools are a bound connection's: they shape the container this " +
                    "connection lives in. This token is not bound to one.",
                },
              ],
              isError: true,
            });
            return;
          }
          if (!connectionStands(gateway, binding)) {
            reply({ content: [{ type: "text", text: STANDING_ENDED }], isError: true });
            return;
          }
          const fence = `${binding.container}:`;
          const nameDefect = (given: unknown): string | undefined =>
            typeof given === "string"
              ? mintableNameDefect(fence, given)
              : "this verb wants a container name.";

          if (name === "loam_container_declare") {
            const target = asked["name"];
            const defect = nameDefect(target);
            if (typeof target !== "string" || defect !== undefined) {
              reply({ content: [{ type: "text", text: defect! }], isError: true });
              return;
            }
            const table = readContainerTable(
              gateway.reactor,
              gateway.validityNow(),
              gateway.operatorAuthor,
            );
            if (table.containers.has(target)) {
              reply({
                content: [{ type: "text", text: `${target} already stands.` }],
                isError: true,
              });
              return;
            }
            const missing: string[] = [];
            let root = target;
            while (
              root !== binding.container &&
              !table.containers.has(root) &&
              root.includes(":")
            ) {
              missing.push(root);
              root = root.slice(0, root.lastIndexOf(":"));
            }
            const unmintable = mintableAt(gateway, binding, table, root, missing);
            if (unmintable !== undefined) {
              reply({ content: [{ type: "text", text: unmintable }], isError: true });
              return;
            }
            try {
              await gateway.append(
                missing.reverse().map((container) =>
                  gateway.signer!.sign(
                    withStamp(gateway.stamp(), (t) =>
                      containerClaims(
                        {
                          container,
                          trust: "curated",
                          posture: "shared",
                          membership: CONNECTION_AGGREGATOR,
                          parent: container.slice(0, container.lastIndexOf(":")),
                        },
                        gateway.operatorAuthor!,
                        t,
                      ),
                    ),
                  ),
                ),
              );
            } catch (err) {
              reply({
                content: [{ type: "text", text: appendRefusal(err) }],
                isError: true,
              });
              return;
            }
            reply({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { declared: missing, leeway: "inherited — set one with loam_container_leeway" },
                    null,
                    1,
                  ),
                },
              ],
            });
            return;
          }

          if (name === "loam_container_leeway") {
            const target = asked["name"];
            const defect = nameDefect(target);
            if (typeof target !== "string" || defect !== undefined) {
              reply({
                content: [
                  {
                    type: "text",
                    text: `${defect!} Your own container's leeway is the person's to set, on its page.`,
                  },
                ],
                isError: true,
              });
              return;
            }
            const table = readContainerTable(
              gateway.reactor,
              gateway.validityNow(),
              gateway.operatorAuthor,
            );
            const rec = table.containers.get(target);
            if (rec === undefined) {
              reply({
                content: [{ type: "text", text: `${target} is not declared. Declare it first.` }],
                isError: true,
              });
              return;
            }
            if (rec.inboxOf !== undefined) {
              reply({
                content: [
                  {
                    type: "text",
                    text:
                      `${target} takes its leeway from ${rec.inboxOf}, the container it was ` +
                      `opened into. Change it there. Nothing was changed here.`,
                  },
                ],
                isError: true,
              });
              return;
            }
            if (!withinSubtree(table, target, binding.container)) {
              reply({
                content: [
                  {
                    type: "text",
                    text:
                      `${target} bears a name inside your container but does not stand inside ` +
                      `it: its edges do not lead back to ${binding.container}, so its leeway is ` +
                      `not yours to set.`,
                  },
                ],
                isError: true,
              });
              return;
            }
            const want = leewayFromTool(asked);
            if (typeof want === "string") {
              reply({ content: [{ type: "text", text: want }], isError: true });
              return;
            }
            try {
              await gateway.append([
                gateway.signer!.sign(
                  withStamp(gateway.stamp(), (t) =>
                    containerClaims(
                      {
                        container: target,
                        trust: rec.trust,
                        posture: rec.posture,
                        ...(rec.parent === undefined ? {} : { parent: rec.parent }),
                        ...(rec.membership === undefined ? {} : { membership: rec.membership }),
                        ...(rec.membershipAt === undefined
                          ? {}
                          : { membershipAt: rec.membershipAt }),
                        ...(rec.version === undefined ? {} : { version: rec.version }),
                        leeway: want,
                      },
                      gateway.operatorAuthor!,
                      t,
                    ),
                  ),
                ),
              ]);
            } catch (err) {
              reply({ content: [{ type: "text", text: appendRefusal(err) }], isError: true });
              return;
            }
            reply({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ container: target, leeway: want }, null, 1),
                },
              ],
            });
            return;
          }
        }

        if (name === "loam_container_promote_stage") {
          const binding = identity.binding;
          if (binding === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "promotion is staged from a container: this token is not bound to one. A " +
                    "person promotes from the container's own page.",
                },
              ],
              isError: true,
            });
            return;
          }
          if (!connectionStands(gateway, binding)) {
            reply({ content: [{ type: "text", text: STANDING_ENDED }], isError: true });
            return;
          }
          const asked = args as Record<string, unknown>;
          const wanted = typeof asked["delta"] === "string" ? asked["delta"] : undefined;
          let held: Delta | undefined;
          try {
            held = gateway
              .containerScope({ containers: [binding.container] })
              .find((d) => d.id === wanted);
          } catch (err) {
            options.connectors?.onFault?.(
              `the roster's promote-stage could not read the gather of "${binding.container}": ` +
                appendRefusal(err),
            );
            reply({
              content: [
                {
                  type: "text",
                  text:
                    `${binding.container}'s gather cannot be read, so nothing was staged. A ` +
                    `person can see why on the container's own page.`,
                },
              ],
              isError: true,
            });
            return;
          }
          if (held === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    `nothing in ${binding.container}'s gather has that id, so there is nothing ` +
                    `here to nominate.`,
                },
              ],
              isError: true,
            });
            return;
          }
          if (gateway.reactor.get(held.id) !== undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "that delta already lives in the primary ground — promotion moves a " +
                    "container's own output into the primary, and there is nothing left to move.",
                },
              ],
              isError: true,
            });
            return;
          }
          reply({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    delta: held.id,
                    container: binding.container,
                    movedNothing: true,
                    wouldAdopt: { author: held.claims.author, timestamp: held.claims.timestamp },
                    confirmAt:
                      `${options.publicUrl ?? ""}${ADMIN_CONTAINER_PATH}` +
                      `?name=${encodeURIComponent(binding.container)}`,
                  },
                  null,
                  1,
                ),
              },
            ],
          });
          return;
        }

        if (name === "loam_federate_connect" || name === "loam_container_receive") {
          const standing = federateStanding(gateway, identity);
          const into = typeof args.into === "string" ? args.into : undefined;
          const from = typeof args.from === "string" ? args.from : undefined;
          const prefix = typeof args.prefix === "string" ? args.prefix : undefined;
          const refusal =
            identity.binding !== undefined
              ? !connectionStands(gateway, identity.binding)
                ? STANDING_ENDED
                : into === undefined
                  ? "federate_connect wants `from`, `into` and `prefix`."
                  : receiveRefusal(gateway, identity.binding, into, prefix)
              : into === undefined || !federateAdmits(standing, into)
                ? "federation is not yours to open here: it wants a `federate` grant naming the " +
                  "container you are receiving into."
                : undefined;
          if (refusal !== undefined) {
            reply({ content: [{ type: "text", text: refusal }], isError: true });
            return;
          }
          if (into === undefined || from === undefined || prefix === undefined) {
            reply({
              content: [
                { type: "text", text: "federate_connect wants `from`, `into` and `prefix`." },
              ],
              isError: true,
            });
            return;
          }
          try {
            const channel = await gateway.openChannel({
              into,
              prefix,
              pullsFrom: from,
              bless: args.bless !== false,
              ...(identity.binding === undefined
                ? {}
                : { openedBy: identity.binding.container, openedFrom: identity.binding.inbox }),
              source: sourceFor(
                from,
                typeof args.token === "string" ? args.token : undefined,
                () => {
                  throw new Error("a file offer is a CLI path; give this tool a URL");
                },
                parseOffer,
              ),
            });
            const report = await channel.sync();
            reply({
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ channel: channel.name, ...report }, null, 1),
                },
              ],
            });
          } catch (err) {
            reply({
              content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            });
          }
          return;
        }

        if (name === "loam_federate_drop" || name === "loam_container_sever") {
          if (typeof args.channel !== "string") {
            reply({
              content: [
                {
                  type: "text",
                  text: "this wants the `channel` to sever, by name. loam_federate_status lists them.",
                },
              ],
              isError: true,
            });
            return;
          }
          const standing = federateStanding(gateway, identity);
          const target = gateway
            .channelStatus(args.channel)
            .find((c) => channelAdmits(gateway, identity, standing, c));
          if (target === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    identity.binding === undefined
                      ? "federation is not yours to sever here: it wants a `federate` grant naming " +
                        "the container the channel receives into."
                      : "federation is not yours to sever here: a connection severs only a channel " +
                        "its own container opened; loam_federate_status names them.",
                },
              ],
              isError: true,
            });
            return;
          }
          const preview = previewDrop(gateway, target.name);
          reply({
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    channel: target.name,
                    purgedNothing: true,
                    confirmAt: `${options.publicUrl ?? ""}${ADMIN_CONTAINER_PATH}?name=${encodeURIComponent(target.name)}`,
                    cliAt: `loam federate drop --channel ${target.name} --yes`,
                    wouldPurge: preview.purges,
                    wouldSurvive: preview.survives,
                    note:
                      "Nothing has been removed. A person must complete this; this tool cannot. " +
                      "The browser page reaches containers under the signed-in person's own name " +
                      `— if "${target.into}" is not one of those, sever from the command line ` +
                      "with cliAt instead. `loam_federate_set` with receiving false stops the " +
                      "channel without destroying anything, and is reversible.",
                  },
                  null,
                  1,
                ),
              },
            ],
          });
          return;
        }

        if (name === "loam_federate_status" || name === "loam_federate_set") {
          const standing = federateStanding(gateway, identity);
          if (standing === undefined && identity.binding === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "federation is not yours to read or adjust here: it wants a `federate` grant " +
                    "naming the container you are acting on (`loam grant --verb=federate`).",
                },
              ],
              isError: true,
            });
            return;
          }
          const rows = gateway
            .channelStatus(args.channel)
            .filter((c) => channelAdmits(gateway, identity, standing, c));

          if (name === "loam_federate_status") {
            const appsByChannel = new Map<string, ReturnType<typeof gateway.channelApps>>();
            for (const a of gateway.channelApps()) {
              appsByChannel.set(a.channel, [...(appsByChannel.get(a.channel) ?? []), a]);
            }
            reply({
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    rows.map((c) => {
                      const blank = Object.fromEntries(
                        c.unreadable.map((role) => [role, "unreadable"]),
                      );
                      return {
                        ...c,
                        ...(c.unreadable.includes("lastSyncedAt")
                          ? {}
                          : {
                              lastSyncedAt: c.lastSyncedAt === 0 ? "never synced" : c.lastSyncedAt,
                            }),
                        apps: appsByChannel.get(c.name) ?? [],
                        ...blank,
                      };
                    }),
                    null,
                    1,
                  ),
                },
              ],
            });
            return;
          }

          const target = rows.find((c) => c.name === args.channel);
          if (target === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    identity.binding === undefined
                      ? "federate_set wants a `channel` you hold a federate grant for; " +
                        "loam_federate_status names the ones you may act on."
                      : "federate_set wants a `channel` your own container opened; " +
                        "loam_federate_status names the ones you may act on.",
                },
              ],
              isError: true,
            });
            return;
          }
          try {
            const now = await gateway.setChannel(target.name, {
              ...(args.receiving === undefined ? {} : { receiving: args.receiving }),
              ...(args.blessing === undefined ? {} : { blessing: args.blessing }),
            });
            reply({ content: [{ type: "text", text: JSON.stringify(now, null, 1) }] });
          } catch (err) {
            reply({
              content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            });
          }
          return;
        }
        const source = name === "loam_query" ? args.query : args.mutation;
        if ((name !== "loam_query" && name !== "loam_mutate") || typeof source !== "string") {
          json(res, 200, {
            jsonrpc: "2.0",
            id: rpc.id ?? null,
            error: { code: -32602, message: "unknown tool or missing source" },
          });
          return;
        }
        if (name === "loam_query") {
          const wrongDoor = notARead(source);
          if (wrongDoor !== undefined) {
            reply({ content: [{ type: "text", text: wrongDoor }], isError: true });
            return;
          }
        }
        let result: QueryResult;
        try {
          result = await gateway.query(source, args.variables, contextFor(identity));
        } catch (err) {
          result = { errors: [err instanceof Error ? err.message : String(err)] };
        }
        reply({
          content: [{ type: "text", text: JSON.stringify(result) }],
          ...(result.errors !== undefined && result.errors.length > 0 ? { isError: true } : {}),
        });
        return;
      }
      default:
        if (isNotification) {
          res.writeHead(202, CORS).end();
          return;
        }
        json(res, 200, {
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          error: { code: -32601, message: `no such method ${String(rpc.method)}` },
        });
    }
  };

  const refused = (res: ServerResponse, verb?: string): void =>
    json(
      res,
      401,
      { errors: ["a bearer token is required, and this one opens nothing"] },
      verb === "mcp" && discovery !== undefined
        ? {
            "www-authenticate": discovery.challenge,
            "access-control-expose-headers": "www-authenticate",
          }
        : undefined,
    );

  const greeted = (res: ServerResponse): void => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": CSP,
      "cache-control": "public, max-age=300",
      "referrer-policy": "same-origin",
      ...CORS,
    });
    res.end(GREETING);
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === "OPTIONS") {
        preflight(res);
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/") {
        greeted(res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      if (discovery !== undefined && discovery.owns(url.pathname)) {
        discovery.handle(url.pathname, req, res);
        return;
      }
      if ([userDoors, admin, consent, tokenExchange].some((d) => d?.owns(url.pathname) === true)) {
        const users = options.users === undefined ? undefined : mounts.resolve(options.users.mount);
        await users?.gateway.refresh();
      }
      if (userDoors !== undefined && userDoors.owns(url.pathname)) {
        void userDoors.handle(url.pathname, req, res);
        return;
      }
      if (admin !== undefined && admin.owns(url.pathname)) {
        void admin.handle(url.pathname, req, res);
        return;
      }
      if (consent !== undefined && consent.owns(url.pathname)) {
        void consent.handle(url.pathname, req, res);
        return;
      }
      if (tokenExchange !== undefined && tokenExchange.owns(url.pathname)) {
        void tokenExchange.handle(url.pathname, req, res);
        return;
      }
      const [, mountName, verb] = url.pathname.split("/");
      let mountKey = "";
      let resolved: ResolvedMount | undefined;
      try {
        mountKey = mountName === undefined ? "" : decodeURIComponent(mountName);
        resolved = mountName === undefined ? undefined : mounts.resolve(mountKey);
      } catch {
        resolved = undefined;
      }
      const gateway = resolved?.gateway;
      const identity = identify(req);
      const guard: MountGuard = {
        name: mountKey,
        live: () => gateway !== undefined && mounts.resolve(mountKey)?.gateway === gateway,
        gone: () =>
          identity === undefined ? refused(res) : json(res, 404, { errors: ["no such mount"] }),
      };
      const refreshViews = async (): Promise<void> => {
        await resolved?.host?.refresh();
        await gateway?.refresh();
      };
      if (identity === undefined) {
        if (verb === "whoami" && req.headers.authorization === undefined) {
          if (req.method !== "GET") {
            refused(res, verb);
            return;
          }
          json(res, 200, whoamiFor(undefined, undefined, undefined));
          return;
        }
        try {
          await refreshViews();
        } catch {
          refused(res, verb);
          return;
        }
        if (
          req.headers.authorization !== undefined ||
          resolved === undefined ||
          gateway === undefined ||
          !guard.live() ||
          (resolved.host !== undefined && !resolved.host.hasPublicSurface()) ||
          !gateway.hasPublicSurface()
        ) {
          refused(res, verb);
          return;
        }
        switch (verb) {
          case "graphql":
            await handleGraphql((s, v) => gateway.queryPublic(s, v), guard, req, res);
            return;
          case "subscribe":
            await handleSubscribe(
              (s) => gateway.subscribePublic(s),
              "public",
              guard,
              req,
              res,
              url.searchParams,
            );
            return;
          case "openapi.json":
            json(res, 200, buildOpenApi(gateway, "public", mountName ?? ""));
            return;
          case "rest": {
            let body: string | undefined;
            try {
              body =
                req.method === "POST" || req.method === "DELETE"
                  ? await readBody(req, maxBody)
                  : undefined;
            } catch (err) {
              json(res, err instanceof BodyTooLarge ? 413 : 400, {
                errors: [err instanceof Error ? err.message : String(err)],
              });
              return;
            }
            if (!guard.live()) {
              guard.gone();
              return;
            }
            const result = await handleRest(
              gateway,
              "public",
              req.method ?? "GET",
              url.pathname.split("/").slice(3),
              body,
              undefined,
              url.searchParams.get("asOf") ?? undefined,
            );
            json(res, result.status, result.body);
            return;
          }
          case "app": {
            const parsed = appRouteOf(url.pathname);
            if (parsed === undefined) {
              refused(res);
              return;
            }
            const pin: AppPin = req.method === "GET" ? appAsOfOf(url.searchParams) : {};
            if (pin.error !== undefined) {
              sendRendered(res, {
                status: 400,
                contentType: "text/plain; charset=utf-8",
                body: pin.error,
              });
              return;
            }
            await gateway.prepareRoute(parsed.route, "public");
            if (!guard.live()) {
              guard.gone();
              return;
            }
            if (req.method === "GET") {
              sendRendered(
                res,
                await gateway.serveRoute(
                  parsed.route,
                  parsed.entity,
                  "public",
                  undefined,
                  pin.asOf,
                ),
              );
              return;
            }
            if (req.method === "POST") {
              let fields;
              try {
                fields = parseAppBody(await readBody(req, maxBody), req.headers["content-type"]);
              } catch (err) {
                sendRendered(res, {
                  status: err instanceof BodyTooLarge ? 413 : 400,
                  contentType: "text/plain; charset=utf-8",
                  body: err instanceof Error ? err.message : "bad request",
                });
                return;
              }
              sendRendered(
                res,
                await gateway.writeRoute(parsed.route, parsed.entity, fields, "public"),
              );
              return;
            }
            refused(res);
            return;
          }
          case "bytes": {
            if (req.method !== "GET") {
              refused(res);
              return;
            }
            const parsed = byteDoorOf(url.pathname, url.searchParams);
            if (parsed === undefined) {
              refused(res);
              return;
            }
            sendBytes(res, gateway.serveBytes(parsed.ref, parsed.lens, parsed.entity, "public"));
            return;
          }
          default:
            refused(res, verb);
            return;
        }
      }
      if (gateway === undefined) {
        json(res, 404, { errors: ["no such mount"] });
        return;
      }
      await refreshViews();
      if (!guard.live()) {
        guard.gone();
        return;
      }
      switch (verb) {
        case "graphql":
          await handleGraphql((s, v) => gateway.query(s, v, contextFor(identity)), guard, req, res);
          return;
        case "subscribe":
          await handleSubscribe(
            (s) => gateway.subscribe(s, undefined, contextFor(identity)),
            "token",
            guard,
            req,
            res,
            url.searchParams,
          );
          return;
        case "mcp":
          await handleMcp(gateway, identity, guard, req, res);
          return;
        case "whoami": {
          if (req.method !== "GET") {
            json(res, 404, { errors: ["no such surface"] });
            return;
          }
          json(res, 200, whoamiFor(gateway, identity, connectorInfoOf(req)));
          return;
        }
        case "health": {
          if (req.method !== "GET" || identity.operator !== true) {
            json(res, 404, { errors: ["no such surface"] });
            return;
          }
          json(res, 200, await gateway.health());
          return;
        }
        case "artifact": {
          if (req.method !== "GET" || identity.operator !== true) {
            json(res, 404, { errors: ["no such surface"] });
            return;
          }
          const parsed = appRouteOf(url.pathname);
          if (parsed === undefined) {
            json(res, 404, { errors: ["no such surface"] });
            return;
          }
          const store = url.searchParams.get("store");
          try {
            const packed = gateway.packArtifact(parsed.route, parsed.entity, {
              server: url.searchParams.get("connector") ?? "",
              ...(store === null ? {} : { storeAddress: store }),
              ...(url.searchParams.get("acknowledgePen") === "1" ? { acknowledgePen: true } : {}),
              ...(url.searchParams.get("acknowledgeWritable") === "1"
                ? { acknowledgeWritable: true }
                : {}),
            });
            json(res, 200, packed);
          } catch (err) {
            json(res, 400, { errors: [err instanceof Error ? err.message : String(err)] });
          }
          return;
        }
        case "openapi.json":
          json(res, 200, buildOpenApi(gateway, "full", mountName ?? ""));
          return;
        case "rest": {
          let body: string | undefined;
          try {
            body =
              req.method === "POST" || req.method === "DELETE"
                ? await readBody(req, maxBody)
                : undefined;
          } catch (err) {
            json(res, err instanceof BodyTooLarge ? 413 : 400, {
              errors: [err instanceof Error ? err.message : String(err)],
            });
            return;
          }
          if (!guard.live()) {
            guard.gone();
            return;
          }
          const result = await handleRest(
            gateway,
            "full",
            req.method ?? "GET",
            url.pathname.split("/").slice(3),
            body,
            contextFor(identity)?.actor,
            url.searchParams.get("asOf") ?? undefined,
            contextFor(identity)?.binding,
          );
          json(res, result.status, result.body);
          return;
        }
        case "app": {
          if (identity.binding !== undefined) {
            sendRendered(res, {
              status: 403,
              ...boundDoorRefusal(identity.binding, "rendered route"),
            });
            return;
          }
          const parsed = appRouteOf(url.pathname);
          if (parsed === undefined) {
            refused(res);
            return;
          }
          const pin: AppPin = req.method === "GET" ? appAsOfOf(url.searchParams) : {};
          if (pin.error !== undefined) {
            sendRendered(res, {
              status: 400,
              contentType: "text/plain; charset=utf-8",
              body: pin.error,
            });
            return;
          }
          await gateway.prepareRoute(parsed.route);
          if (!guard.live()) {
            guard.gone();
            return;
          }
          if (req.method === "GET") {
            sendRendered(
              res,
              await gateway.serveRoute(
                parsed.route,
                parsed.entity,
                "full",
                gestureOf(url.searchParams),
                pin.asOf,
              ),
            );
            return;
          }
          if (req.method === "POST") {
            let fields;
            try {
              fields = parseAppBody(await readBody(req, maxBody), req.headers["content-type"]);
            } catch (err) {
              sendRendered(res, {
                status: err instanceof BodyTooLarge ? 413 : 400,
                contentType: "text/plain; charset=utf-8",
                body: err instanceof Error ? err.message : "bad request",
              });
              return;
            }
            sendRendered(
              res,
              await gateway.writeRoute(parsed.route, parsed.entity, fields, "full"),
            );
            return;
          }
          refused(res);
          return;
        }
        case "bytes": {
          if (req.method !== "GET") {
            refused(res);
            return;
          }
          if (identity.binding !== undefined) {
            const refusal = boundDoorRefusal(identity.binding, "byte door");
            res.writeHead(403, { "content-type": refusal.contentType, ...CORS });
            res.end(refusal.body);
            return;
          }
          const parsed = byteDoorOf(url.pathname, url.searchParams);
          if (parsed === undefined) {
            refused(res);
            return;
          }
          sendBytes(res, gateway.serveBytes(parsed.ref, parsed.lens, parsed.entity, "full"));
          return;
        }
        case "append": {
          let parsed: { deltas?: WireDelta[] };
          try {
            parsed = JSON.parse(await readBody(req, maxBody)) as typeof parsed;
          } catch (err) {
            if (err instanceof BodyTooLarge) {
              json(res, 413, { errors: ["request body too large"] });
              return;
            }
            json(res, 400, { errors: ["the body must be JSON: { deltas: [...] }"] });
            return;
          }
          if (!Array.isArray(parsed?.deltas) || parsed.deltas.length === 0) {
            json(res, 400, { errors: ["append wants { deltas: [...] }, at least one"] });
            return;
          }
          if (!guard.live()) {
            guard.gone();
            return;
          }
          const batch: Delta[] = [];
          for (const wire of parsed.deltas) {
            try {
              batch.push(fromWire(wire));
            } catch (err) {
              json(res, 400, {
                errors: [
                  `a delta would not reconstruct: ${err instanceof Error ? err.message : String(err)}`,
                ],
              });
              return;
            }
          }
          const bound = identity.binding;
          if (bound !== undefined) {
            let key: string | undefined;
            try {
              key = identity.actor === undefined ? undefined : authorForSeed(identity.actor);
            } catch {
              key = undefined;
            }
            const foreign =
              key === undefined ? batch[0] : batch.find((d) => d.claims.author !== key);
            if (foreign !== undefined) {
              json(res, 403, {
                errors: [
                  `a bound connection appends only what its own key signed: ${foreign.id} is ` +
                    `authored by ${foreign.claims.author}, not ${key ?? "a key this token names"} ` +
                    `— refused`,
                ],
              });
              return;
            }
          }
          try {
            const sink = bound === undefined ? gateway : gateway.poolForBinding(bound);
            const receipt = await sink.append(batch);
            json(res, 200, receipt);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const status = /can no longer persist|being dropped/.test(message)
              ? 503
              : /not permitted|was erased|refused/.test(message)
                ? 403
                : 400;
            json(res, status, { errors: [message] });
          }
          return;
        }
        case "register": {
          const fence = registerStanding(gateway, identity);
          if (fence === undefined) {
            json(res, 403, { errors: [REGISTRATION_REFUSAL] });
            return;
          }
          let raw: unknown;
          try {
            raw = JSON.parse(await readBody(req, maxBody));
          } catch (err) {
            if (err instanceof BodyTooLarge) {
              json(res, 413, { errors: ["request body too large"] });
              return;
            }
            json(res, 400, {
              errors: ["the body must be JSON: { schema, policy, roots, entity? }"],
            });
            return;
          }
          if (!guard.live()) {
            guard.gone();
            return;
          }
          try {
            const route = registrationRoute(gateway, identity);
            const done = asServedTo(
              gateway,
              identity,
              await performRegistration(gateway, raw, fence, route.pick),
              route.toPool,
            );
            json(res, 200, done);
          } catch (err) {
            if (err instanceof NotPermittedToRegister) {
              json(res, 403, { errors: [err.message] });
              return;
            }
            json(res, 400, { errors: [err instanceof Error ? err.message : String(err)] });
          }
          return;
        }
        case "federate":
          if (identity.operator !== true) {
            json(res, 403, { errors: ["federation requires an operator token"] });
            return;
          }
          json(res, 200, { deltas: gateway.offeredDeltas().map(toWire) });
          return;
        default:
          json(res, 404, { errors: ["no such surface"] });
      }
    })().catch((err: unknown) => {
      if (!res.headersSent) {
        json(res, 500, { errors: [err instanceof Error ? err.message : String(err)] });
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener("error", onError);
      const where = `${host}:${options.port ?? 0}`;
      reject(
        err.code === "EADDRINUSE"
          ? new Error(
              `${where} is already in use — another process is serving there. Stop it, or choose ` +
                `another port with --port (0 picks a free one).`,
            )
          : err.code === "EACCES"
            ? new Error(
                `${where} is not yours to bind — ports below 1024 need privilege. Choose a higher ` +
                  `port with --port.`,
              )
            : err,
      );
    };
    server.once("error", onError);
    server.listen(options.port ?? 0, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  if (options.users !== undefined) {
    const forUsers = options.users;
    userDoors = makeUserDoors({
      options: forUsers,
      publicUrl: forUsers.publicUrl ?? `http://${host}:${port}`,
      ground: () => {
        const gateway = mounts.resolve(forUsers.mount)?.gateway;
        return gateway === undefined
          ? undefined
          : { reactor: gateway.reactor, operator: gateway.operatorAuthor };
      },
      mint: mintSessionToken,
      revoke: revokeSessionTokens,
      otherWorlds: () => mounts.live().filter((name) => name !== forUsers.mount),
    });
    admin = makeAdminDoor({
      gate: userDoors.gate,
      home: forUsers.home,
      ground: () => mounts.resolve(forUsers.mount)?.gateway,
      ...(forUsers.onFault === undefined ? {} : { onFault: forUsers.onFault }),
      ...(options.connectors === undefined
        ? {}
        : { connectors: { home: options.connectors.home } }),
    });
    if (options.connectors !== undefined) {
      consent = makeConsentDoor({
        gate: userDoors.gate,
        home: options.connectors.home,
        users: { ground: () => mounts.resolve(forUsers.mount)?.gateway, home: forUsers.home },
        ...(options.connectors.onFault === undefined
          ? {}
          : { onFault: options.connectors.onFault }),
        ...(forUsers.monotonicNow === undefined ? {} : { now: forUsers.monotonicNow }),
        ...(options.connectors.cimdAllowPrivateOrigins === undefined
          ? {}
          : { cimdAllowPrivateOrigins: options.connectors.cimdAllowPrivateOrigins }),
      });
      const connectorHome = options.connectors.home;
      const connectorFault =
        options.connectors.onFault ?? ((message: string): void => void message);
      let operatorSeed: string | undefined;
      try {
        operatorSeed = readSeed(connectorHome);
      } catch (err) {
        connectorFault(
          `the token exchange is not open: this store's operator seed is unreadable, so it cannot ` +
            `mint a connection (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (operatorSeed !== undefined) {
        tokenExchange = makeTokenDoor({
          home: connectorHome,
          redeeming,
          ...(forUsers.monotonicNow === undefined ? {} : { now: forUsers.monotonicNow }),
          onFault: connectorFault,
          bind: async ({ user, container, actor }): Promise<string> => {
            const gateway = mounts.resolve(forUsers.mount)?.gateway;
            if (gateway === undefined) {
              throw new Error("the connector's mount is not resolvable, so nothing was bound");
            }
            const owner = readUserSeed(forUsers.home, user);
            if (owner.kind !== "present") {
              connectorFault(
                `cannot bind ${actor} into ${container}: ${userSeedPath(forUsers.home, user)} ` +
                  (owner.kind === "absent" ? "does not exist" : owner.detail),
              );
              throw new Error(`no signing key for ${user} on this store, so nothing was bound`);
            }
            await gateway.bindConnection({
              container,
              connectionKey: actor,
              ownerSeed: owner.seed,
              ownerName: user,
            });
            return inboxName(container, actor);
          },
        });
      }
    }
  }

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    addMount(name: string, gateway: Gateway): void {
      if (userDoors !== undefined && name !== options.users?.mount) {
        throw new Error(
          `addMount refused: this server has the login doors open, and a session token is ` +
            `server-wide authority — mounting "${name}" would extend it to a world no role ` +
            `binding named. Take the login doors down, or run that world on its own server.`,
        );
      }
      mounts.add(name, gateway);
    },
    async removeMount(name: string): Promise<boolean> {
      const removed = mounts.remove(name);
      await endStreams([...streams].filter((s) => s.mount === name));
      return removed;
    },
    unroutableMounts(): string[] {
      return mounts.unroutable();
    },
    async close(): Promise<void> {
      await endStreams([...streams]);
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
