// The gateway, served. One node:http server and no framework: bearer tokens map onto the
// gateway's actor-per-request seam — transport adds AUTHENTICATION and nothing else; every
// authority question stays where step 5 put it. Mounts are separate worlds: /:mount/graphql
// (query + mutate), /:mount/subscribe (SSE — one data: frame per subscription payload), and
// /:mount/mcp (a minimal MCP JSON-RPC surface: initialize, tools/list, tools/call).
//
// WHICH worlds is a live question, not a boot-time one (T78): the handle's addMount/removeMount and
// every attached container answer at their own mount while the server runs — mounts.ts holds that
// table and its precedence. The door discipline below is unchanged by it, deliberately: a tokenless
// caller cannot tell a mount that exists from one that never did, so a mount arriving or leaving is
// not an oracle either.
//
// Bind 127.0.0.1 and terminate TLS in front; token comparison is timing-safe; a token maps to
// an explicit identity ({ actor } or { operator: true }) — never a default. The one tokenless
// path is the OPEN DOOR (SPEC §12): query + subscribe against a mount's restricted public
// surface, where the operator's surviving `loam:public` declaration opened one. CORS rides
// every response — authority is an explicit bearer header, never ambient, so a wildcard
// origin lends nothing.
//
// Custody, stated plainly: a token maps to an ACTOR SEED, so this process signs on behalf of
// its actors and is a custodian of their signing authority — a heap dump or leaked config
// discloses keys, not just replayable tokens. That is the price of server-side convenience
// mutations. The non-custodial path is the CRDT's own: a client signs its deltas itself and
// presents them; each is authorized by its own verified author (Gateway.append), and the
// server never holds the key. A future raw-append endpoint exposes that path over HTTP.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { endJson } from "./respond.js";
import {
  BodyTooLarge,
  parseBodyFields as parseAppBody,
  readBodyStrict as readBody,
} from "./body.js";
import { authorForSeed, type Delta } from "@bombadil/rhizomatic";
import { Kind, OperationTypeNode, parse, type DocumentNode } from "graphql";
import { fromWire, toWire, type WireDelta } from "../federation/wire.js";
import { buildOpenApi, handleRest } from "../surface/rest.js";
import {
  NothingPublic,
  type Gateway,
  type QueryResult,
  type RequestContext,
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
import { inboxName } from "../gateway/container.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { readSeed, readUserSeed, userSeedPath } from "../cli/config.js";
import { DOC_TOPICS } from "./docs-content.js";
import { CSP, makeUserDoors, type UserDoorOptions, type UserDoors } from "./session.js";
import { makeAdminDoor, type AdminDoor } from "./admin.js";
import { ADMIN_CONTAINER_PATH } from "./admin-pages.js";

export { type UserDoorOptions } from "./session.js";

export interface TokenIdentity {
  readonly actor?: string; // a signing seed: requests act as this identity
  readonly operator?: true; // requests act as the gateway's operator
  /**
   * Where a connection lives (SPEC §58): whose consent bound it, the container, and the inbox
   * pool inside it. Present for a bearer minted through a §58 consent; absent for an operator
   * token, a session, or a pre-§58 bearer.
   */
  readonly binding?: {
    readonly user: string;
    readonly container: string;
    readonly inbox: string;
  };
}

export interface ServeOptions {
  readonly mounts: Record<string, Gateway>;
  readonly tokens: Record<string, TokenIdentity>;
  readonly port?: number; // 0 (default) = ephemeral
  readonly host?: string; // default 127.0.0.1
  readonly maxBodyBytes?: number; // reject a request body larger than this (default 4 MiB)
  readonly maxStreams?: number; // refuse a new SSE stream past this many live (default 1024)
  readonly maxPublicStreams?: number; // the anonymous door's own smaller stream budget (default 256)
  /**
   * The outside address this store is reached at (SPEC §37 phase 12). OPT-IN: absent, the two
   * `.well-known` discovery paths resolve as an ordinary unmounted path always did, and the MCP
   * door's 401 gains no `WWW-Authenticate` header — a store an operator has not configured for
   * connectors advertises nothing about them. `Host` and `X-Forwarded-*` never affect what a
   * configured store advertises: nothing downstream of this option ever reads a request header to
   * build a URL.
   */
  readonly publicUrl?: string;
  /**
   * Connector registration (SPEC §37 phase 13), opt-in. Absent, `POST /oauth/register` resolves as
   * it did after phase 12 (an unrouted OAuth path). Present, it needs `publicUrl` too — a connector
   * finds this endpoint through the discovery document, which only exists when `publicUrl` is set —
   * and every configured redirect origin is validated at boot, so an operator's typo is a startup
   * error rather than a store where every registration silently refuses.
   */
  readonly connectors?: ConnectorRegistration;
  /**
   * The login doors (SPEC §36 phase 5). Absent, this server has none — `/login` is an
   * unresolvable name, exactly as it was before §36, and no request anywhere reads a cookie.
   */
  readonly users?: UserDoorOptions;
  /**
   * Minted client credentials (SPEC §57): the home whose `clients.json` this door honors. Read
   * PER REQUEST — the token half of §57's freshness split, so a `loam client mint` beside a
   * running server authenticates immediately and a revoke refuses on the very next request. The
   * GRANTS a mint appends are the other half: they live in the served reactor from boot and move
   * at restart. Absent, minted bearers open nothing here — a programmatic serve() states its
   * tokens in `tokens`.
   */
  readonly clients?: { readonly home: string };
}

const DEFAULT_MAX_BODY = 4 * 1024 * 1024;
const DEFAULT_MAX_STREAMS = 1024;
const DEFAULT_MAX_PUBLIC_STREAMS = 256;

export interface ServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly url: string; // http://host:port
  /**
   * Mount a gateway at `name` on the RUNNING server (T78) — the whole door set, under the same token
   * table. Refuses a malformed name, or one that already answers (a static mount, another dynamic
   * one, or an attached container's): re-pointing a live name would silently move every consumer of
   * it. An attached container needs no call here; it mounts itself (mounts.ts).
   */
  addMount(name: string, gateway: Gateway): void;
  /**
   * Take a dynamic mount down; `true` if one was there. Live SSE streams on that mount are ENDED
   * rather than left hanging, and the door goes back to answering exactly as a name that never
   * existed. Refuses a static mount and a container's own mount — the container's door lives and
   * dies with the container, so drop()/detach() is the way to close it.
   */
  removeMount(name: string): Promise<boolean>;
  /** Attached containers whose declared name no URL can reach — skipped, and said out loud. */
  unroutableMounts(): string[];
  close(): Promise<void>;
}

// What a handler needs to know about the mount it is answering for, past its first await. A mount can
// VANISH mid-request — every body read is client-paced, and drop()/removeMount() may land in that
// window — so the gateway captured at routing time is a claim about the past, not a licence.
interface MountGuard {
  /** The stream tag: which world's consumers a teardown must find. */
  readonly name: string;
  /** Does this name still resolve to the SAME gateway instance? */
  live(): boolean;
  /** Answer as an unresolvable mount would for this caller — the uniform refusal, unchanged. */
  gone(): void;
}

// A live SSE stream, tagged with the mount that opened it: close() ends them all, removeMount ends
// exactly the ones whose world just went away.
interface LiveStream {
  readonly events: AsyncGenerator<Record<string, unknown>>;
  readonly res: ServerResponse;
  readonly mount: string;
}

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();

// What GET / answers, whole: self-contained HTML (no external asset could ride a tokenless GET
// anyway), served verbatim to every caller. Editing it is safe exactly as long as it stays
// ignorant of the store it fronts — no mount names, no counts, no hint of what is declared
// public, no hint of whether accounts exist. The words say where the doors are; they never say
// which doors exist. Naming FIXED paths is fine: `/login` sits at the same address on every
// store, and where no accounts are configured it refuses exactly as any unresolved name does —
// so the sentence stays true, and constant, either way.
// The prose promises only what the store honours. History is the DEFAULT, never a guarantee: an
// erasure (SPEC §11) really removes bytes, so no line here may say the ground remembers whatever
// it was told. Federation is the same shape — a store admits what its trust policy admits (SPEC
// §8), so meeting a peer is not merging with it.
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

// CORS, everywhere and uniformly: authority here is a bearer header the caller must present
// explicitly (never a cookie, never ambient), so a wildcard origin lends nothing — it only
// lets a browser page ask, and lets it READ a refusal instead of a mute CORS error. The
// preflight is knowledge-free by the same logic that keeps refusals uniform below.
const CORS = { "access-control-allow-origin": "*" } as const;

// The MCP revisions this door speaks — every one in which a Tool may CARRY the annotations the tool
// list declares. `readOnlyHint` arrived in 2025-03-26; under 2024-11-05 a Tool is
// name/description/inputSchema and nothing else. So a client told "2024-11-05" while being handed a
// readOnlyHint has negotiated a protocol in which the field it is asked to honour does not exist —
// and that field is the second guard against a replayed write, the one the runtime holds rather than
// us. Newest first: an unrecognised or absent request is answered with the newest we speak, never
// with a revision that cannot express what we declare.
//
// These three constants live at module scope, and are EXPORTED, because two methods now answer with
// them: `initialize`, which negotiates, and `server/discover`, which announces before any
// negotiation happens. A client plans its whole session on what discover says, so the two answers
// must be the same values rather than two copies of them — an announcement the door does not honour
// is a report that can be false (H7), and no later exchange could catch it.
export const MCP_PROTOCOLS: readonly string[] = ["2025-06-18", "2025-03-26"];
export const MCP_CAPABILITIES = { tools: {}, resources: {} } as const;
export const MCP_SERVER_INFO = { name: "loam", version: "0.7.0" } as const;
// The guidance both `initialize` and `server/discover` hand a client — ONE string, same as the
// constants above: two copies would be free to drift, and a client reads whichever method it
// spoke first. Every `loam_*` name here must be a tool `tools/list` returns (a frozen rail holds
// that line); naming fewer than exist is deliberately fine.
export const MCP_INSTRUCTIONS =
  "This is a Loam store. `loam_query` reads it with GraphQL and `loam_mutate` writes " +
  "to it as your token's identity; call tools/list for their schemas. Every answer is " +
  "resolved through the store's registered schemas, so a field you cannot see MAY be a " +
  "field you are not granted — it may equally be unset, or resolved absent by the " +
  "schema. Absence is not a refusal. `loam_docs` serves this store's own manual, " +
  "compiled into the running build — call it with no arguments to list the topics.";
// Where a compiled doc topic lives as an MCP resource (§53): the same DOC_TOPICS entry `loam_docs`
// serves, addressed. One derivation, used by list and read alike, so an advertised uri always reads.
// No percent-encoding and no character guard — safe while every topic is a plain filename slug;
// build-docs owes a topic-character guard the day a second doc arrives with anything wilder.
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

// A rendered renderer route (SPEC §23): served with its own content-type (HTML on success, plain text on
// a refusal), never JSON — the door is pixels.
const sendRendered = (
  res: ServerResponse,
  out: { status: number; contentType: string; body: string },
): void => {
  res.writeHead(out.status, { "content-type": out.contentType, ...CORS });
  res.end(out.body);
};

// Parse `GET /:mount/app/<route>/<entity>` into its route + entity (both percent-decoded); undefined for
// anything but EXACTLY two non-empty segments — a missing/empty entity, or a trailing segment, refuses
// uniformly rather than serving an empty or truncated node. The caller learns nothing extra.
const appRouteOf = (pathname: string): { route: string; entity: string } | undefined => {
  const segs = pathname.split("/").slice(3);
  if (segs.length !== 2 || segs[0] === "" || segs[1] === "") return undefined;
  try {
    return { route: decodeURIComponent(segs[0]!), entity: decodeURIComponent(segs[1]!) };
  } catch {
    return undefined;
  }
};

// The floor's read GESTURE as it rides the host route (SPEC §30): `?read=<lens>:<entity>`, repeatable,
// plus every OTHER query parameter echoed verbatim into `node.state` — which is where UI state (a page
// index) lives, because a per-render realm gives it nowhere else. An unenhanced link therefore works with
// no JavaScript at all, and the floor is proven across two hosts rather than described for one.
//
// EACH `read=` COSTS A RESOLUTION. `maxPublicRenders` caps worker RENDERS, not resolutions, and a
// repeatable parameter multiplies resolutions per request — H8's full-scan cost, N times, on one GET. So
// the count is bounded here; a repeatable read parameter is precisely the shape that turns a cap into a
// suggestion.
const MAX_GESTURE_READS = 8;

// The time pin as it rides a rendered route (SPEC §26): `?asOf=<T>` renders the route against the
// ground as it stood at that millisecond. The grammar and the refusal are the REST door's, verbatim
// — one parameter, one meaning, every door — so a moment that reads as a number on `/rest` reads as
// the same number here. An absent or EMPTY value is present-tense: `Number("")` is 0, so a door that
// only tested `Number.isFinite` would pin the epoch and serve an empty page while looking healthy.
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

// A raw-bytes response (SPEC §23.7 byte-door): the BytesView's own mime as Content-Type, the bytes as
// the body — never JSON. The refusal body is a short plain-text encoded upstream, sent the same way.
const sendBytes = (
  res: ServerResponse,
  out: { status: number; contentType: string; body: Uint8Array },
): void => {
  res.writeHead(out.status, { "content-type": out.contentType, ...CORS });
  res.end(Buffer.from(out.body));
};

// Parse `GET /:mount/bytes/<ref>?from=<lens>/<entity>` (SPEC §23.7): the ref is the single path segment,
// the proof-of-read pair rides the `from` query as `lens/entity` (split on the FIRST slash — an entity id
// may itself contain slashes). Undefined for a missing/extra segment or a `from` without both halves —
// which refuses uniformly, so a malformed probe looks exactly like a miss.
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
    // The trust boundary: `lens` is a stranger's URL segment, blessed as a LensName here so the door
    // gates on it with the brand intact. serveBytesImpl re-resolves under the door's discipline.
    return {
      ref: decodeURIComponent(segs[0]!),
      lens: from.slice(0, i) as LensName,
      entity: from.slice(i + 1),
    };
  } catch {
    return undefined;
  }
};

// Parse and perform a registration request — the SAME shape the CLI file and the MCP tool take,
// { hyperschema: { name, alg?, body }, schema, roots, entity?, mutations? } (see
// parseRegistrationInput). Anything malformed throws; the caller answers 400 with the reason.
// Operator gating happens BEFORE this is called: shaping the store is constitutional.
//
// A publish can PERSIST without BINDING — valid law, written to append-only ground, that this
// store's fixpoint does not serve (a process-local binding shadowing it, a rival body under the
// same name). The outcome was discarded here, so both doors answered 200 with the name and the
// entity and said nothing about whether anything now serves it: the H7 shape, the same one the
// CLI's `register` and the admin panel's `POST /admin/register` still carry today. `bound` now
// rides the answer, and `reason` — the proximate cause the fixpoint actually caught, never a
// guess — rides it when `bound` is false. Only the operator reaches this door, so a reason naming
// the law in the way is a cure, not an oracle.
//
// `bound` is a fact about a LENS, not about a program (H6): `publishRegistration` decides it at
// (entity, lens), and one program may carry sibling readings of which some bind and some do not.
// So the answer names the lens it is reporting on, READ FROM THE OUTCOME rather than re-derived
// here — a second derivation beside the deciding one is free to drift, and a rail over a request
// this door composed itself could not see the drift. `registered` keeps its original meaning: the
// program name, what the operator typed under `hyperschema.name`, because callers already read
// it. The two coincide until a request names its schema, and that is exactly the case where a
// single name would be reporting on the wrong thing.
// The one string a caller who may not shape this store receives, from either door. It is the same
// string a tokenless stranger has always drawn, and it says nothing about WHY: root and a
// neighbour's namespace refuse identically, so nobody learns whether either is grantable to anyone
// (§12). Never branch this message on the reason.
const REGISTRATION_REFUSAL = "registration is constitutional: it requires an operator token";

/**
 * Which gateway a registration publishes on (SPEC §58 position 2).
 *
 * A BOUND connection's law lives on its own inbox pool, never in the primary — the same seam the
 * write path takes through `sinkFor`. The §47 fold is what carries it up to the served surface,
 * filtered there to the bound container's path a second time, so law that reached a pool by some
 * road other than this door still cannot be served.
 *
 * Everyone else publishes where they always did. An operator shapes the root; a connection holding
 * an explicit `register` grant keeps landing in the primary until the slice that retires that
 * grant, because nothing a connection can do today may stop working before its replacement exists.
 */
function registrationSink(gateway: Gateway, identity: TokenIdentity): Gateway {
  return identity.binding === undefined ? gateway : gateway.poolForBinding(identity.binding);
}

/**
 * SUCCESS MEANS BOUND IN THE CONTAINER'S SURFACE. A pool publish reports whether the POOL bound
 * the lens, and the pool's fixpoint is not the one a connection is served — its container's fold
 * runs the same trial against the root's law too, and can refuse what the pool accepted (a name
 * the operator already serves, a program that will not materialize beside its siblings). Report
 * the fold's answer, with its reason, rather than the pool's (H7). Everyone else's outcome is
 * already the served surface's, because their law landed in the reactor being served.
 */
function asServedTo(
  gateway: Gateway,
  identity: TokenIdentity,
  outcome: Awaited<ReturnType<typeof performRegistration>>,
): Awaited<ReturnType<typeof performRegistration>> {
  if (identity.binding === undefined || !outcome.bound) return outcome;
  const surface = gateway.boundSurface(identity.binding);
  const served = surface.registered.some(
    (r) => (r.lensName ?? r.hyperschema.name) === outcome.lens,
  );
  if (served) return outcome;
  return {
    ...outcome,
    bound: false,
    reason:
      surface.refused.get(outcome.lens) ??
      `the container's surface did not bind ${outcome.lens}, so it is written and not served`,
  };
}

// Thrown for a fence violation so a caller renders it as the AUTHORITY refusal rather than as the
// shape complaint every other throw from performRegistration becomes.
class NotPermittedToRegister extends Error {}

// How far a caller may shape this store.
//   undefined  → not at all. The authority refusal, before anything is parsed.
//   []         → the operator: the root, unfenced.
//   [p, …]     → a scoped connection: inside these prefixes and nowhere else.
//
// Read from the GROUND on every request and never cached, so a revocation binds on the very next
// call with nothing to invalidate (§7, and H2's flatten-don't-cache rule).
function registerStanding(
  gateway: Gateway,
  identity: TokenIdentity,
): readonly string[] | undefined {
  if (identity.operator === true) return [];
  // THE BINDING IS THE GRANT (§58 position 2). A bound connection names law under its own
  // container path AND ITS COLON, so `ada:journalx` — a sibling sharing the letters — is outside
  // the fence, and so is `ada:journal` itself: the fence is what lives UNDER the container.
  //
  // Unioned with any grant the connection also holds rather than replacing it, because nothing a
  // connection can do today may stop working before its replacement has landed. The slice that
  // retires `loam grant --verb=register` for connections is the one that removes this union.
  const bound = identity.binding === undefined ? [] : [`${identity.binding.container}:`];
  if (identity.actor === undefined) return bound.length === 0 ? undefined : bound;
  let author: string;
  try {
    author = authorForSeed(identity.actor);
  } catch {
    return bound.length === 0 ? undefined : bound; // an actor that names no key holds no grant
  }
  const granted = registerPrefixesOf(gateway.reactor, author, gateway.operatorAuthor);
  const prefixes = [...granted, ...bound];
  return prefixes.length === 0 ? undefined : prefixes;
}

/**
 * Which containers may this caller federate on? `[]` means UNRESTRICTED (the operator), `undefined`
 * means no standing at all, and a non-empty list is the fence.
 *
 * Same shape and same reasoning as `registerStanding` above, including reading from the GROUND on
 * every request so a revocation binds on the very next call with nothing to invalidate.
 *
 * The point of the verb: `GET /:mount/federate` demands the OPERATOR token, and that token also
 * registers root law, mints grants and reads everything — so federation cost a peer the whole store.
 * Authority here is scoped to a container instead (§28: trust is a property of a container).
 */
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
  const containers = federateContainersOf(gateway.reactor, author, gateway.operatorAuthor);
  return containers.length === 0 ? undefined : containers;
}

/**
 * May this caller act on THIS container? A whole-name match, never a prefix one — a channel lives in
 * exactly one container, and prefix-matching would admit `friends-archive` to a grant saying
 * `friends`.
 */
function federateAdmits(standing: readonly string[] | undefined, container: string): boolean {
  if (standing === undefined) return false;
  return standing.length === 0 || standing.includes(container);
}

// Does a scoped caller's registration stay inside its fence? THREE questions, and every one must
// hold. A registration carries three independently-chosen names, and each reaches a different part
// of the store, so fencing any two of them still leaves a door open:
//
//   (a) the PROGRAM name (`hyperschema.name`) — which fences the definition at
//       `hyperschema:<name>` and the binding at `registration:hyperschema:<name>`;
//   (b) the READING (`schema.name ?? hyperschema.name`, H6) — which fences the living Schema at
//       `schema:<lens>`, its frozen snapshot, and the GraphQL field the surface answers at.
//       Fencing only (a) lets a `thread:` connection publish a program named `thread:groove` whose
//       READING is `User`, taking the operator's own living Schema and the root field with it; and
//   (c) an explicit `entity`, if given, is exactly the entity the program name derives. It is the
//       one field that points somewhere no name reaches — unchecked, it plants an operator-signed
//       registration at `hyperschema:User`.
//
// `roots` is DELIBERATELY UNFENCED, and that grants no new reach. A root widens what this lens
// gathers, but every row it could reach is already listable by any tokened caller through the
// operator's own lenses, whatever roots those name — so a scoped caller reads nothing here it could
// not read anyway. What it does do is widen the shared PROGRAM MATERIALIZATION, which is a cost
// question (H8) rather than an authorization one, and belongs to whichever ticket prices it.
//
// A scoped caller may still SEND `entity`; it may only send the one it was going to get anyway.
//
// `refs` (§51) rides unfenced too, like `roots` and `writable`: it carries NAMES — this schema's
// own prop names, and the pointer roles its edge deltas wear. The mutations it derives live under
// `link<n>_<P>`, a name minted FROM the fenced lens name, so a scoped caller cannot reach a field
// its own lens does not already own; and a role is delta vocabulary, unowned like an entity id.
// The reciprocal CONTEXT is the one refs name that lands in ANOTHER entity's fold space — and it
// grants no new reach either: contexts are delta vocabulary, any writer with standing could
// already file a delta at any (entity, context) through `_claim`, and whether that bucket folds
// into anything is the READER's lens choice, never the writer's.
//
// AND THE FENCE IS NOT THE WHOLE GATE. Two fields of a registration are not namespace problems at
// all, and no prefix could ever have contained them — see `scopedRegistrationDefect` below.
function registerFenceAdmits(fence: readonly string[], input: RegistrationInput): boolean {
  const inside = (name: string): boolean => fence.some((prefix) => fenceAdmits(prefix, name));
  if (!inside(input.hyperschema.name)) return false;
  if (!inside(lensNameFor(input.hyperschema, input.schema))) return false;
  return input.entity === undefined || input.entity === schemaEntityFor(input.hyperschema);
}

// WHAT A SCOPED CALLER MAY NOT SHIP AT ALL, whatever namespace it holds. The fence above partitions
// NAMES; these two fields reach past any name, so they are refused outright rather than fenced.
//
//   `resolvers` is CODE. `resolvers[].code` is directly-runnable ESM, and `publishRegistrationImpl`
//   calls `loadResolvers` BEFORE anything persists — so merely ASKING runs it. `esm.ts` imports it
//   from a `data:` URL with no confinement, and that loader's own header states the premise it was
//   built on: only the OPERATOR's code ever loads here, so no parallel sandbox was invented. A
//   scoped grantee shipping a resolver breaks that premise and holds the gateway process — its
//   filesystem, its network, the operator seed, the store file. Nor could a grant be taken back:
//   Node's ESM registry retains a `data:` module for the life of the process, so striking the grant
//   unloads nothing. Refusing to load is the only revocation there is.
//
//   `mutations` names GRAPHQL FIELDS, in a namespace shared across every lens and keyed by nothing
//   the schema name fences. A template called `user` makes the operator's later `User` registration
//   fail `buildGqlSchema` outright — its QUERY field disappears along with its mutation — and the
//   replay orders by timestamp, so an operator EVOLVING an existing lens moves behind an earlier
//   squat. A scoped caller cannot be allowed to claim a global name first.
//
// DEFERRED, NOT FORBIDDEN FOREVER. Each wants its own ticket, its own fence, and its own rails:
// templates want a field-namespace fence of the same shape as this one, and resolvers additionally
// want the confinement `esm.ts` says was deliberately never built (§6 / §24's pools). An
// OPERATOR-token registration keeps both, unchanged.
//
// Reported as a SHAPE defect naming the field, so an authorized caller learns what to remove. That
// is safe precisely because only a caller who already cleared the authority gate can see it.
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
): Promise<{
  registered: string;
  lens: string;
  entity: string;
  bound: boolean;
  reason?: string | undefined;
  warnings?: readonly string[] | undefined;
}> {
  // SHAPE, then FENCE — and this order is safe only because the caller already cleared the
  // authority gate above. A caller with NO register standing never reaches this function, so it
  // never draws a shape complaint and cannot fingerprint the registration format by probing.
  // A caller WITH standing is entitled to the shape complaint, whatever name it sent.
  //
  // ONE family of shape complaints earns a pointer at the manual (§53): the term parser's
  // `unknown term op …`, which is the refusal a cold agent draws by guessing the algebra. The
  // parser's own words survive intact — the wrap appends, never rephrases — and ONLY that family
  // is wrapped: a fence, pred, policy, or missing-field refusal is not a grammar problem, and a
  // pointer on it would send the caller to a page that cannot help. Wrapped HERE, on Loam's side
  // of the frozen substrate, and at this door specifically — the pointer names an MCP tool, so it
  // rides the doors an MCP caller can reach (tools/call and POST /register, both through this
  // function), not the CLI's or the admin page's.
  let input: RegistrationInput;
  try {
    input = parseRegistrationInput(raw);
  } catch (err) {
    if (err instanceof Error && /^unknown term op /.test(err.message)) {
      throw new Error(`${err.message} — call loam_docs(topic: "register-grammar")`);
    }
    throw err;
  }
  if (fence.length > 0) {
    // The FIELD gate runs before the NAME gate on purpose: `resolvers` is refused whatever it is
    // called, so a caller cannot learn anything about the fence by attaching code to a name probe.
    const defect = scopedRegistrationDefect(input);
    if (defect !== undefined) throw new Error(defect);
    if (!registerFenceAdmits(fence, input)) throw new NotPermittedToRegister(REGISTRATION_REFUSAL);
  }
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
  const answer = {
    registered: input.hyperschema.name,
    lens: outcome.lens,
    entity: schemaEntityFor(input.hyperschema, input.entity),
    bound: outcome.bound,
    // Registration-time cautions (§51: an undeclared reciprocal, a writable∩refs overlap) ride
    // the response — the register door is where a schema author is listening.
    ...(outcome.warnings === undefined ? {} : { warnings: outcome.warnings }),
  };
  // The outcome pairs the two by construction (lifecycle.ts): a bound publish carries no reason,
  // an unbound one always carries one. So the answer turns on `bound` alone — a second condition
  // beside it would be free to disagree with it, and could only ever disagree by staying silent.
  return outcome.bound ? answer : { ...answer, reason: outcome.reason };
}

export async function serve(options: ServeOptions): Promise<ServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS;
  // The live table: static mounts, runtime mounts, and every attached container (mounts.ts owns the
  // precedence and the name discipline — the static names are validated here, at boot).
  const mounts = makeMountTable(options.mounts);
  const tokenEntries = Object.entries(options.tokens).map(
    ([token, identity]) => [sha(token), identity] as const,
  );
  if (tokenEntries.length === 0) {
    throw new Error("loam serve: no tokens configured — an unlockable door is a wall");
  }

  // Discovery (SPEC §37 phase 12) and connector registration (phase 13), opt-in: absent publicUrl
  // means absent doors and absent header. Registration (phase 13) rides the same doors object and
  // needs publicUrl too — a connector reaches `/oauth/register` only through the discovery document
  // that publicUrl builds.
  // ClientIds with a token redemption IN FLIGHT — the eviction pin's third source (SPEC §37 phase 15,
  // criterion 3), SHARED between the register door (which reads it) and the token door (which counts
  // into it). One map, so the two doors cannot disagree about who is mid-redemption.
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
      // Boot-validate every configured origin: a default-port spelling (`https://x:443`) that
      // `url.origin` would silently drop and never match, a path, or a non-https non-loopback
      // origin, is a startup error rather than a store that refuses every registration.
      for (const origin of options.connectors.allowRedirectOrigins) {
        const originDefect = redirectOriginDefect(origin);
        if (originDefect !== undefined) {
          throw new Error(`loam serve: --oauth-allow-redirect ${originDefect}`);
        }
      }
    }
    discovery = makeOAuthDoors({
      publicUrl: canonicalPublicUrl(options.publicUrl),
      // The spread carries `cimdAllowPrivateOrigins` along INERTLY — the register door reads no
      // CIMD field; the seam binds only where makeConsentDoor threads it below.
      ...(options.connectors === undefined
        ? {}
        : { registration: { ...options.connectors, redeeming } }),
    });
  }

  // The login doors (SPEC §36 phase 5), opt-in the same way: absent `users` means absent doors,
  // and no request anywhere reads a cookie. Built here (before listen) because they are a pure
  // function of the options — the bound-URL default for `publicUrl` is filled in after listen,
  // which is why the deps read a closure variable the post-listen block assigns.
  let userDoors: UserDoors | undefined;

  // The admin page (SPEC §40 phase A1), opt-in with `users` alone: it reads the session gate and
  // the users mount's containers, so `connectors` is not required. Built post-listen with
  // `userDoors.gate`, routed before mount resolution.
  let admin: AdminDoor | undefined;

  // The consent page (SPEC §37 phase 14), opt-in: it exists only where BOTH a login session (`users`)
  // and registered connectors (`connectors`, whose home holds `oauth.json`) are configured — one
  // supplies the phase-5 session it sits behind, the other the clients it grants and the code table
  // it mints into. Built post-listen with `userDoors.gate`, routed before mount resolution.
  let consent: ConsentDoor | undefined;

  // The token exchange (SPEC §37 phase 15), opt-in the same way: it redeems a code for a
  // per-connector seed and a bearer token, and its `resolve` is what `identify` consults to
  // authenticate that token. Built post-listen with the live gateway (it appends the operator-signed
  // write grant) and routed before mount resolution.
  let tokenExchange: TokenDoor | undefined;

  // ONE MOUNT, or no login doors (SPEC §36 phase 7). `/session/token` mints `{ operator: true }`,
  // which is authority over this whole SERVER — every mount it hosts, now or later. The role
  // binding that earns it is read from ONE mount's ground, so a second world would be handed
  // authority nobody in it granted. There is no way to say "operator of this mount" today, so
  // this refuses rather than quietly widening.
  //
  // BEFORE THE SOCKET BINDS, because it is a pure function of the options: a throw after `listen`
  // leaves a caller that catches it holding a live listener with the mounts served and the login
  // doors absent — strictly worse than not starting. It is not the whole guard: a CONTAINER
  // mounts itself and these options never see it, which is why the mint door asks the LIVE table
  // as well.
  if (options.users !== undefined) {
    // NO WORLD OTHER THAN THE DOORS' OWN — which is not the same as "exactly one mount". The
    // doors' own mount arriving later (an `addMount` of that very name) widens nothing: it is
    // the world the doors already read users from, and until it answers they honestly refuse
    // with the cannot-decide 503. Stating the guard as "exactly one at boot" instead would
    // forbid that shape, and phase 5 already rails it.
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

  // The tokens a §36 session minted (phase 7): short-lived, retired early when the session that
  // bought them is dropped. They are how a BROWSER writes — a session cookie never opens a door
  // below, so the browser asks /session/token and then presents a header like any other client.
  //
  // Keyed by digest hex rather than scanned with timingSafeEqual, so a request pays one map
  // lookup however many tokens are live. That is safe because the key is a SHA-256 OF the
  // secret: timing on a digest lookup tells an attacker nothing they could not compute, and it
  // would take a preimage to use. The static table above keeps its scan — a handful of entries
  // the operator configured.
  //
  // ONE CLOCK for this table and for the doors' own cap (`users.monotonicNow`, defaulting to the
  // same monotonic source). Two would let the doors free a cap slot for a token this table still
  // honors — the cap would stop bounding live operator authority while its refusal kept
  // promising it did.
  const usersMount = options.users?.mount;
  const sessionTokens = new Map<
    string,
    { identity: TokenIdentity; expiresAt: number; stillLive: () => boolean }
  >();
  const clock = options.users?.monotonicNow ?? ((): number => performance.now());
  // Every entry the table no longer honors, dropped. Called on mint AND on revoke — revoke runs
  // whenever a session ends, which is the event that bounds how long a lapsed entry can sit.
  // Without it an abandoned session's entry (which carries the user's SIGNING SEED) stayed
  // resident for the process's whole life, waiting on the next login by anyone: a retention the
  // working spec's own argument for reading the seed late did not keep (a P5 lens's finding).
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
    // The named digests are this session's; the sweep clears every OTHER entry the table has
    // stopped honoring, so a lapsed seed copy cannot outlive the next session ending.
    sweepSessionTokens(clock());
  };

  // A minted client's bearer (SPEC §57), resolved from the home's own records per request. Keyed
  // by digest like the session table — same argument: timing on a sha-256 lookup tells an attacker
  // nothing a preimage would not cost. Every failure is a refusal: no home configured, records
  // unreadable, digest unknown, seed file gone — none is distinguishable to the caller.
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

  // The identity a presented token names, compared timing-safely; undefined = refuse. A cookie
  // is never consulted here, and that is §36's load-bearing invariant: authority on these doors
  // is an explicit header.
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
      // A connector's bearer token (SPEC §37 phase 15): resolved by the token door, which is BOUNDED
      // — an unknown token is one in-memory miss with no file read behind it. It resolves ONLY to
      // `{ actor }`, never an operator identity. Then a MINTED CLIENT's bearer (SPEC §57): matched
      // against `clients.json` read per request — that read is the one file this ladder ever opens
      // for an unknown token (a small record file, no key derivation), and it is what lets a mint
      // authenticate and a revoke refuse with no restart. Unreadable records REFUSE rather than
      // guess, the file's own rule. Like the exchange, it resolves only to `{ actor }`.
      return tokenExchange?.resolve(digest) ?? resolveClientBearer(digest);
    }
    // TWO expiries, and BOTH bind. The token's own window is the obvious one. The second is the
    // parent SESSION's idle window: sweeping runs only when someone logs in or presents a
    // cookie, so an abandoned session's already-minted operator token would otherwise go on
    // authenticating for the rest of its TTL with nothing left to reach it. A P5 lens caught
    // that; session.ts's own header states the rule this now keeps.
    if (minted.expiresAt <= clock() || !minted.stillLive()) {
      sessionTokens.delete(digest);
      return undefined;
    }
    // AND the world it was minted into must still be the only one. Refusing to MINT while a
    // second world answers is not enough on its own: a container attaches after the fact, and a
    // token minted a moment earlier would open it — server-wide authority over a world no role
    // binding named, for the rest of its window (a P5 lens caught the overclaim). So an
    // already-minted session token stops being honored the instant a stranger appears, and
    // resumes when it goes. The operator's own configured token is untouched: it is the
    // operator's to spend, and nothing here revokes it.
    if (usersMount !== undefined && mounts.live().some((name) => name !== usersMount)) {
      return undefined;
    }
    return minted.identity;
  };

  // Is the credential that opened a long-lived response STILL live? For a configured operator
  // token the answer is always yes (nothing revokes one). For a §36 session token it is the same
  // question `identify` asks, re-asked: the digest still present, inside its own window, and its
  // parent session still inside its idle window.
  const stillAuthorized = (req: IncomingMessage): boolean => identify(req) !== undefined;

  // A bound connection's request carries its binding (SPEC §58): the library routes its writes
  // into its inbox pool and scopes its reads to the container its consent named. Every other
  // identity — the operator, an actor token, a §57 client — acts on this store as before.
  const contextFor = (identity: TokenIdentity): RequestContext | undefined =>
    identity.actor === undefined
      ? undefined
      : identity.binding === undefined
        ? { actor: identity.actor }
        : {
            actor: identity.actor,
            binding: { container: identity.binding.container, inbox: identity.binding.inbox },
          };
  // The sentence a door that resolves the store's OWN ground answers a bound connection with
  // (SPEC §58): the connection reads its container, and this door cannot scope to it yet.
  const boundDoorRefusal = (
    binding: NonNullable<TokenIdentity["binding"]>,
    door: string,
  ): { contentType: string; body: string } => ({
    contentType: "text/plain; charset=utf-8",
    body:
      `this connection is bound to ${binding.container} and reads only that container; the ` +
      `${door} resolves this store's own ground and cannot scope to it — use the query door`,
  });

  // WHOAMI (SPEC §56, T255): who does this door think the caller is, and what standing does
  // the GROUND currently grant them? Read per request like every standing check, so a
  // revocation binds on the very next call. The ANONYMOUS answer is the point: under
  // mask: drop an anonymous reader and an empty store are indistinguishable from outside,
  // and this is the sentence that separates them.
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
    // A BOUND connection's write standing is its pool's (SPEC §58): the owner-authored grant in
    // the inbox, never a store-wide grant. A pool that is not attached answers false — there is
    // nowhere for the connection to write, and the door would refuse it.
    const binding = identity.binding;
    const writeStanding = (): boolean => {
      if (gateway === undefined) return false;
      if (binding === undefined) {
        return holdsGrant(gateway.reactor, STORE_ENTITY, author, "write", gateway.operatorAuthor);
      }
      try {
        const pool = gateway.poolForBinding(binding);
        return holdsGrant(pool.reactor, STORE_ENTITY, author, "write", gateway.operatorAuthor);
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
      // THE SAME FUNCTION THE DOOR DECIDES WITH. A report of standing that re-derives it beside
      // the door is a report that can disagree with the door — and it did, once: the door admitted
      // a bound connection under its container path while this said `[]` (H7).
      registerPrefixes: gateway === undefined ? [] : (registerStanding(gateway, identity) ?? []),
      federateContainers:
        gateway === undefined
          ? []
          : federateContainersOf(gateway.reactor, author, gateway.operatorAuthor),
      masked: false,
      note:
        binding !== undefined
          ? // The note follows the STANDING this same answer reports. A revoked pool, or one this
            // store cannot attach, leaves the binding intact and the writing gone, and a sentence
            // promising a write beside `write: false` is one answer contradicting itself.
            writes
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

  // Live SSE streams, so close() — and removeMount — can end them instead of leaving clients
  // hanging. Ending the generator makes the handler's own `finally` run: it deletes and res.end()s.
  const streams = new Set<LiveStream>();
  const endStreams = async (doomed: readonly LiveStream[]): Promise<void> => {
    for (const s of doomed) {
      await s.events.return(undefined);
      s.res.end();
    }
  };

  // Both doors share these handlers; WHICH surface answers — the full one as the token's
  // identity, or the restricted public one as no identity at all — is the caller's `run`/`open`.
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
    // The body arrived on the client's clock: re-ask before reading a world that may have been
    // dropped while we waited. Answering from it would serve bytes a drop() just proved gone (H7).
    if (!guard.live()) {
      guard.gone();
      return;
    }
    // A gateway failure (nothing registered, an internal throw) is the caller's structured
    // { errors }, not a 500 leaking an internal message. The one exception: a public surface
    // gone between the transport's check and this execution (a revocation landing in the
    // window) folds back into the SAME uniform refusal every closed door answers with.
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

  // Live anonymous streams, counted apart: the public door's budget is its own, smaller one,
  // so a stranger holding streams open exhausts the stranger's allowance and never the
  // authenticated surface's.
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
      // A bound connection's refusal (SPEC §58) is standing, not shape: 403, in the library's words.
      json(res, /cannot subscribe/.test(message) ? 403 : 400, { errors: [message] });
      return;
    }
    // Opening the subscription was an await, and a teardown sweep only finds REGISTERED streams — so
    // a mount removed in that window would otherwise leave this one live on a door that is gone.
    // From here to `streams.add` there is no await, which is the other half of the argument: the
    // sweep's remove-and-snapshot is synchronous too, so it cannot interleave between them.
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
        // AUTHORITY IS RE-ASKED PER EVENT, not only at dispatch. A stream is the one door that
        // outlives its own request, so a token revoked by a logout — or lapsed, or orphaned by
        // its session dying — would otherwise go on delivering the full surface indefinitely,
        // and "signing out retires the tokens that session minted" would be true only of NEW
        // requests (a P5 lens caught exactly that). Ending the generator makes the `finally`
        // below run, so the socket closes the same way every other ending does.
        // The PUBLIC door presents no credential by design, so there is nothing to re-ask
        // there — its own surface is what bounds it.
        if (door === "token" && !stillAuthorized(req)) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "the credential that opened this stream is no longer live",
            })}\n\n`,
          );
          break;
        }
        // JSON.stringify never emits a raw newline, so no payload can break the SSE framing.
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

  /**
   * What a drop of this channel would remove, and what it would leave. TWO-SIDED by construction,
   * because a preview naming only the target cannot show over-purging — the failure that matters
   * most, and the one with no recovery.
   */
  const previewDrop = (gw: Gateway, channel: string): { purges: string[]; survives: string[] } => {
    const rows = gw.channelStatus();
    const target = rows.find((c) => c.name === channel);
    return {
      purges:
        target === undefined
          ? []
          : [`${target.name} (everything received from "${target.prefix}")`],
      survives: rows.filter((c) => c.name !== channel).map((c) => c.name),
    };
  };

  // The MCP tools: the same two verbs the gateway speaks, in JSON-RPC clothes. `annotations` are
  // part of the authority, not decoration: a shell reads `readOnlyHint: true` as a licence to cache
  // and REPLAY a call, and an explicit `false` is what makes its own machinery refuse to cache a
  // write. Both halves must be true of the handler below — see notARead.
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
        "a connection may instead hold register standing over a namespace — the operator mints it " +
        "with `loam grant <client_id> --verb=register --prefix=<ns>:` — and then every name in the " +
        "registration (the program's and the reading's) must sit under that prefix. Resolver code " +
        "never rides a scoped registration; code arrives by federation and blessing. The surface " +
        "serves the new type immediately; republishing at the same entity evolves it.",
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
    // §53 (T247). The manual rides a TOOL rather than the descriptions above because the register
    // grammar is ~10KB and a description taxes every session's context; a topic is fetched at the
    // moment it is needed — usually the moment a refusal names it.
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
    // §46 over MCP (T188). FIVE tools rather than one `federate` passthrough, because tools are the
    // unit of CONSENT: a client applies policy per tool, so an operator can auto-approve `status`
    // while `drop` always asks. One tool collapses that to allow-or-deny-all-federation, and the
    // choice becomes an agent that cannot read channel health or an agent that can reach a purge.
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
        "STAGE a channel sever. This does NOT purge anything: it returns a staged id, a link, an " +
        "expiry, and a preview of what would be removed and what would survive. A person completes " +
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
  ];

  // `gateway.query` runs whatever document it is handed — graphql executes a `mutation` operation as
  // readily as a query — so the read tool's read-only scope is a property of the DOCUMENT, checked
  // here, and nowhere else. Refuse on the operation kind rather than the text: a name, a comment or a
  // string literal can spell "mutation" in a document that only reads.
  //
  // ANY non-query operation refuses the WHOLE document, including one buried behind an operation that
  // reads. Nothing carries an operation name into this door, so a second definition cannot be shown
  // unreached — and today graphql refuses a multi-operation document for its own reasons, which is an
  // accident of the parser, not a guard.
  const notARead = (source: string): string | undefined => {
    let document: DocumentNode;
    try {
      document = parse(source);
    } catch {
      // Unparseable is not our refusal to make: the gateway answers a syntax error in its own words.
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
    // The body was client-paced: the world may have gone while it arrived (see handleGraphql).
    if (!guard.live()) {
      guard.gone();
      return;
    }
    // A notification (a request with no id) demands silence, not a reply.
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
      // The first word a real client says (MCP draft, `server/discover`): read the supported
      // protocol revisions, the capabilities and the identity in ONE call, before anything else.
      // A client that reads -32601 here may treat the connection as dead and cache that, which is
      // what two Anthropic clients did (T178).
      //
      // Every value is the store's own and the SAME value initialize answers — this method
      // announces, it does not decide. It adds no support for a newer revision: it reports what is
      // supported so a client can choose, which is precisely the honest answer to a client asking
      // for a revision the store does not speak.
      //
      // AND ANSWERING AT ALL IS ITSELF AN ANNOUNCEMENT — the one this door does not fully honour.
      // In the draft, `server/discover` is the ERA PROBE: a dual-era client that receives a
      // DiscoverResult concludes the server is MODERN and may cache that for the origin's lifetime.
      // Modern era means per-request `_meta` versioning, an MCP-Protocol-Version header, and a
      // -32022 UnsupportedProtocolVersionError. This door implements none of the three; it answers
      // discover while remaining legacy-era, so a client that stays modern and sends a newer
      // revision's `_meta` on a later call is SERVED under legacy semantics rather than refused.
      // What bounds the damage is the answer itself: `supportedVersions` lists only legacy
      // revisions, so a compliant client learns there is no mutual version. Per-request version
      // enforcement is unbuilt and is T181's; do not read this case as evidence it exists.
      case "server/discover": {
        // Silence for a notification: an id-less request is not owed a reply, and answering one
        // would be a message the client's dispatcher cannot place. (`initialize` above does NOT
        // do this — it answers a notification with `id: null`. That is the older behaviour, not a
        // house rule this case is following.)
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
      // The compiled docs again, as MCP RESOURCES (§53) — for clients that surface those. The same
      // DOC_TOPICS module answers here and in the loam_docs tool below: one compiled source, so
      // the two doors cannot disagree about the bytes.
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
          // -32002 is MCP's resource-not-found. The docs are the same for every caller, so
          // naming the real uris is a cure, not an oracle.
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
          // The same constitutional gate as POST /register: the root is the operator's, and a
          // connection holding a scoped `register` grant may shape its own namespace (§7).
          const fence = registerStanding(gateway, identity);
          if (fence === undefined) {
            reply({
              content: [{ type: "text", text: REGISTRATION_REFUSAL }],
              isError: true,
            });
            return;
          }
          try {
            const outcome = asServedTo(
              gateway,
              identity,
              await performRegistration(
                registrationSink(gateway, identity),
                params["arguments"] ?? {},
                fence,
              ),
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
          // Read-only and identical for every token — the manual is the same book on every door.
          // The bearer gate is the MCP door's own, above: no token, no page, exactly as siblings.
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

        // §46 over MCP (T188). Authority is the CONTAINER-SCOPED federate grant, never the operator
        // role — see federateStanding. A caller with no standing meets the same refusal whichever
        // channel it named, so the tool cannot be used to learn which channels exist (§12/T78).
        if (name === "loam_federate_connect") {
          const standing = federateStanding(gateway, identity);
          const into = typeof args.into === "string" ? args.into : undefined;
          const from = typeof args.from === "string" ? args.from : undefined;
          const prefix = typeof args.prefix === "string" ? args.prefix : undefined;
          // The fence is checked BEFORE the arguments are examined further, so a caller without
          // standing cannot learn which containers exist by comparing refusals (§12/T78).
          if (into === undefined || !federateAdmits(standing, into)) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "federation is not yours to open here: it wants a `federate` grant naming the " +
                    "container you are receiving into.",
                },
              ],
              isError: true,
            });
            return;
          }
          if (from === undefined || prefix === undefined) {
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
              bless: args.bless !== false,
              // The SHIPPED source builder, shared with the CLI — never a second copy.
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

        if (name === "loam_federate_drop") {
          const standing = federateStanding(gateway, identity);
          const target = gateway
            .channelStatus(args.channel)
            .find((c) => federateAdmits(standing, c.into));
          if (target === undefined) {
            reply({
              content: [
                {
                  type: "text",
                  text:
                    "federation is not yours to sever here: it wants a `federate` grant naming the " +
                    "container the channel receives into.",
                },
              ],
              isError: true,
            });
            return;
          }
          // NOTHING IS REMOVED ON THIS PATH, EVER. The tool hands the operator a link and a
          // preview; the sever itself happens on the admin page, behind the session gate a
          // connector token can never obtain (MCP callers are a TokenIdentity; the admin door sits
          // behind SessionGate — different authentication paths, not one with a flag).
          //
          // It points at the EXISTING container-drop flow rather than a parallel one. That flow is
          // already hardened in the ways this needs: a single-use confirm token bound to (user,
          // container) and consumed before the act, and — the property that matters most — the plan
          // is RECOMPUTED at confirm time, so the operator cannot approve something larger than
          // they read. A channel's pool is a separate container that page's plan resolves through
          // the channel's own sever (`dropChannel`), which retires the blessed law beside the bytes.
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
                    // The page reaches the containers under a signed-in person's own name and
                    // nothing outside them; a channel opened into a container with no parent sits
                    // outside every such reach, and only the command line severs it. Both paths
                    // are named so the link is never a promise the page cannot keep.
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
          if (standing === undefined) {
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
            .filter((c) => federateAdmits(standing, c.into));

          if (name === "loam_federate_status") {
            // Read ONCE for the whole answer: `channelApps` walks the ground to find the channels,
            // so asking it per row would make this tool quadratic in the store (H8).
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
                      // WITHHOLD EXACTLY THE ROLES THE VERDICT NAMES — no more, and no fewer.
                      //
                      // Fewer: JSON writes a NaN as `null`, and an absent field coerces to the very
                      // 0 this tool spells "never synced", so a condemned role left alone is served
                      // to an agent as health.
                      //
                      // More: blanking a fixed pair instead would withhold two good numbers from a
                      // record whose only illegible field is a TOGGLE — while serving that toggle's
                      // coerced `true`, which is the toward-health default this marker exists to
                      // stop, as fact. The sound fields pass through untouched; the CLI and the
                      // admin panel already draw this same line.
                      const blank = Object.fromEntries(
                        c.unreadable.map((role) => [role, "unreadable"]),
                      );
                      return {
                        ...c,
                        // Spelled out rather than left as a zero: a channel that has NEVER reached
                        // its peer must not read like one that is merely quiet (H9, §46 criterion 8).
                        ...(c.unreadable.includes("lastSyncedAt")
                          ? {}
                          : {
                              lastSyncedAt: c.lastSyncedAt === 0 ? "never synced" : c.lastSyncedAt,
                            }),
                        // What a peer SENT that can run, and whether any of it does (§24.6).
                        // Read-only like the rest of this tool: naming an app is not mounting it,
                        // and no connector tool mounts one — that act is the CLI's, in a person's
                        // hands. It is keyed on the channel NAME, which no illegible record can
                        // corrupt, so it is served whatever the verdict says about the rest.
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
                    "federate_set wants a `channel` you hold a federate grant for; " +
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
        // A notification we don't handle gets silence (JSON-RPC forbids replying to one);
        // an unknown request gets method-not-found.
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

  // `verb` is passed ONLY at the two call sites that can answer the MCP door specifically (SPEC
  // §37 phase 12) — every other refusal in this file calls `refused(res)` with no verb, and stays
  // exactly as it was. A header keyed on anything but the verb (the mount, whether one resolved,
  // the token presented) would reopen the mount-existence oracle T78/§12 already closed.
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

  // The front door. The bare root is the one path with no world behind it, so it is the one path
  // that can afford a human answer — and the first thing anyone does with a served store's URL is
  // open it in a browser. The greeting is a CONSTANT: one string, blind to the mount table, the
  // token presented, and every public declaration, because a front page that varied on any of
  // them would be an oracle the uniform refusals below pay to prevent. It names no mount, ever.
  const greeted = (res: ServerResponse): void => {
    // same-origin is the house policy for pages this store serves (T143): the greeting links to
    // /login, and a document policy weaker than that would leak this store's URL to wherever a
    // future link points — while no-referrer on HTML is banned outright, because it makes Chrome
    // send `Origin: null` on any form a page like this ever grows.
    // The same CSP the session pages carry: no script, no framing, no form retargeting, no base
    // rewriting. This page has no script and no form today; the header is what keeps that true of
    // whatever it grows into. And the body is a compile-time constant, identical for every caller
    // by design — so a shared cache can hold it, and cannot leak anything by holding it.
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
      // The preflight answers before anything else: it is knowledge-free (fixed headers, no
      // body, no mount resolution), and a browser cannot even present its token without it.
      if (req.method === "OPTIONS") {
        preflight(res);
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      // GET / is greeted before any identity or mount resolution — the answer is the same
      // constant for every caller, so there is nothing here for resolution to decide. Any other
      // method on the root falls through to the ordinary door discipline.
      if (req.method === "GET" && url.pathname === "/") {
        greeted(res);
        return;
      }
      // Every browser asks for the icon before anything else; 204 is the quiet true answer —
      // nothing is here, and nothing is wrong.
      if (req.method === "GET" && url.pathname === "/favicon.ico") {
        res.writeHead(204, CORS);
        res.end();
        return;
      }
      // Discovery (SPEC §37 phase 12): the two well-known documents route ahead of mount
      // resolution — they are server-level, not mount-level — and only when configured. Absent
      // `publicUrl`, these paths fall through to the ordinary "no such mount" the name always got.
      if (discovery !== undefined && discovery.owns(url.pathname)) {
        discovery.handle(url.pathname, req, res);
        return;
      }
      // The login doors (SPEC §36 phase 5), answered before mount routing — they are the store's
      // own pages, not a mount's. A bare `/login` never resolved to anything (mount doors live at
      // /:mount/:verb), so claiming the exact path shadows nobody. Absent `users`, the name falls
      // through untouched.
      if (userDoors !== undefined && userDoors.owns(url.pathname)) {
        void userDoors.handle(url.pathname, req, res);
        return;
      }
      // The admin page (SPEC §40 phase A1), answered before mount routing — the store's own page
      // over the signed-in user's containers. Absent `users`, `/admin` falls through untouched.
      if (admin !== undefined && admin.owns(url.pathname)) {
        void admin.handle(url.pathname, req, res);
        return;
      }
      // The consent page (SPEC §37 phase 14), answered before mount routing — a store's own page, not
      // a mount's. Absent `users` or `connectors`, `/oauth/authorize` falls through untouched.
      if (consent !== undefined && consent.owns(url.pathname)) {
        void consent.handle(url.pathname, req, res);
        return;
      }
      // The token exchange (SPEC §37 phase 15): a server-level door, answered before mount routing.
      // Absent `users` or `connectors`, `/oauth/token` falls through untouched.
      if (tokenExchange !== undefined && tokenExchange.owns(url.pathname)) {
        void tokenExchange.handle(url.pathname, req, res);
        return;
      }
      const [, mountName, verb] = url.pathname.split("/");
      // A malformed percent-escape resolves no mount — it must fall into the same uniform
      // refusal as any other unresolvable name, never a 500 that marks the input special.
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
      // The guard every handler carries past its first await (see MountGuard): same name, same
      // gateway instance, or the answer an absent mount gives — which is identity-shaped, so it
      // cannot become an oracle the initial refusal was not.
      const guard: MountGuard = {
        name: mountKey,
        live: () => gateway !== undefined && mounts.resolve(mountKey)?.gateway === gateway,
        gone: () =>
          identity === undefined ? refused(res) : json(res, 404, { errors: ["no such mount"] }),
      };
      if (identity === undefined) {
        // A presented-but-wrong token is refused outright — bad credentials never downgrade
        // to anonymous. A caller with NO token reaches exactly one thing: the restricted read
        // surface of a mount whose operator opened one (SPEC §12). Every other combination —
        // absent mount, nothing public, a write-shaped verb — gets the SAME refusal, so an
        // anonymous prober learns nothing about which mounts exist (no 404-vs-401 oracle).
        // On a CONTAINER mount the door's openness is the HOST's live word, not the container's
        // seeded copy of it: a separate store holds its own snapshot of `loam:public` and moves only
        // on reseed (§24.2), so asking the pool alone would leave a struck declaration open here
        // forever. Both must be open — the host decides WHETHER, the container still decides WHAT.
        // WHOAMI answers every anonymous caller UNIFORMLY, before any mount fact is consulted:
        // the anonymous answer names nothing about this store (T255), and answering only on
        // public-surfaced mounts would mint a mount-existence oracle the refusals below exist
        // to prevent.
        if (verb === "whoami" && req.headers.authorization === undefined) {
          if (req.method !== "GET") {
            refused(res, verb);
            return;
          }
          json(res, 200, whoamiFor(undefined, undefined, undefined));
          return;
        }
        if (
          req.headers.authorization !== undefined ||
          resolved === undefined ||
          gateway === undefined ||
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
          // The other doors (SPEC §17): the same smaller world, spoken in REST/OpenAPI.
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
          // A rendered route (SPEC §23), on the anonymous door: read-only, GET only, and only a
          // publicly-declared lens's LATEST version (serveRoute enforces the §17 public discipline).
          case "app": {
            const parsed = appRouteOf(url.pathname);
            if (parsed === undefined) {
              refused(res);
              return;
            }
            // The moment is parsed BEFORE the bundle loads and before any route is looked up: a
            // malformed one costs no render, and refuses identically whether or not the route
            // exists — so the refusal is no route-existence oracle. GET only, because `asOf` is a
            // READ parameter and the REST door already ignores it on a write.
            const pin: AppPin = req.method === "GET" ? appAsOfOf(url.searchParams) : {};
            if (pin.error !== undefined) {
              sendRendered(res, {
                status: 400,
                contentType: "text/plain; charset=utf-8",
                body: pin.error,
              });
              return;
            }
            await gateway.prepareRoute(parsed.route, "public"); // load the bundle before the render (worker, §23.9)
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
            // A write-enabled renderer's form POST (SPEC §23.3): the store signs as the renderer's pen,
            // never the (here anonymous) caller — and only if the operator provisioned+granted one (§12).
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
          // The byte-door (SPEC §23.7), on the anonymous door: GET raw bytes by content address, proof
          // of read — serveBytes re-resolves the named lens under the PUBLIC discipline (a declared lens
          // only) and serves the bytes only if that view actually contains them. Uniform 404 otherwise.
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
        // The settling report (T70): has every erasure this store promised settled to bytes?
        // Operator-token GET only. To ANY other identity or method the door does not exist —
        // byte-for-byte the 404 an unknown verb gets — because the outstanding list names ids the
        // operator ordered forgotten, and even that a store is STILL forgetting is the operator's
        // business alone. (register's 403 reveals its own existence on purpose: it is in every
        // mount's public shape. This door's existence is itself the operator's.)
        case "health": {
          if (req.method !== "GET" || identity.operator !== true) {
            json(res, 404, { errors: ["no such surface"] });
            return;
          }
          json(res, 200, await gateway.health());
          return;
        }
        // The artifact ASSESSMENT door (SPEC §30): may this route be published, and what would a page
        // emitted from it be permitted to do? It answers the pack door's verdict — the manifest, the
        // coordinates, the derived capability statement — or the operator's own refusal. What it does
        // NOT yet serve is the page itself; that arrives with the emission, as another field here.
        //
        // OPERATOR-ONLY, and to every other identity it does not exist — `health`'s idiom, for a
        // reason specific to this door: a page emitted from these coordinates carries the renderer's
        // BUNDLE SOURCE verbatim, which no existing door discloses (`serveRoute` discloses only the
        // bundle's output). Deciding to publish your code is the operator's, and so is every answer
        // that describes the publication.
        //
        // "DOES NOT EXIST" HAS TWO UNIFORM SHAPES, NOT ONE, and this door must match the right one per
        // caller. A single response byte-identical across an actor token, no token, and a bad token is
        // not available here and should not be: a bad or absent token never reaches this switch at all.
        // It is refused before mount resolution matters, precisely so an anonymous prober learns
        // nothing about which mounts exist.
        //
        //   token-bearing non-operator → 404, uniform ACROSS VERBS  (this door looks like every
        //                                                            unknown one)
        //   no token, or a bad token   → 401, uniform ACROSS MOUNTS (no 404-vs-401 oracle)
        //
        // Two families, both deliberate. A refusal from `packArtifact` itself is a THIRD thing and is
        // answered in full: the operator has already proved they may see this door, so hiding the
        // reason would only hide it from the one person entitled to it.
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
            // One shape for every door: the same plain-English reason a direct call throws and the CLI
            // relays, so nothing rephrases a refusal about what a renderer may be published as.
            json(res, 400, { errors: [err instanceof Error ? err.message : String(err)] });
          }
          return;
        }
        // The other doors (SPEC §17): the same registrations, spoken in REST/OpenAPI. The
        // token carries the SAME identity discipline — an actor token writes as that actor,
        // an operator token as the operator; the hooks enforce standing, not the transport.
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
        // A rendered route (SPEC §23), on the full door: GET a route's HTML, rendered from the store's
        // live view under the token's read discipline.
        case "app": {
          // A BOUND connection reads only the container its consent named (SPEC §58), and a
          // rendered route resolves the store's own view — and a write-enabled route signs as the
          // pen into the primary. Neither is the connection's, so both refuse in words rather than
          // answer beyond the binding. The public and operator doors are untouched.
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
          // The same pin, parsed the same way, at the door's OTHER call site — see the anonymous
          // branch above. Both sites or neither: one of them threading it would leave the other
          // silently answering the present to a caller who named a moment.
          const pin: AppPin = req.method === "GET" ? appAsOfOf(url.searchParams) : {};
          if (pin.error !== undefined) {
            sendRendered(res, {
              status: 400,
              contentType: "text/plain; charset=utf-8",
              body: pin.error,
            });
            return;
          }
          await gateway.prepareRoute(parsed.route); // load the bundle before the render (worker, §23.9)
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
          // A write-enabled renderer's form POST (SPEC §23.3): the store signs as the renderer's pen, not
          // the token caller — the whole point is that provenance shows the mediating code, not the user.
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
        // The byte-door (SPEC §23.7), on the full door: GET raw bytes by content address under the
        // token's own read discipline (any registered lens the token may read), proof of read.
        case "bytes": {
          if (req.method !== "GET") {
            refused(res);
            return;
          }
          // The byte door proves a read through a lens over the store's own ground (SPEC §23.7);
          // a bound connection's reads are its container's (§58), so it refuses here in words.
          if (identity.binding !== undefined) {
            const refusal = boundDoorRefusal(identity.binding, "byte door");
            // CORS like every other answer this door gives: a browser must be able to READ the
            // refusal, or a bound caller sees an opaque network error instead of the sentence.
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
          // The non-custodial door: a client signs its own deltas and presents them. The
          // token authenticates TRANSPORT only — each delta is verified and authorized by its
          // own author's standing, exactly as Gateway.append always does. The server never
          // holds the key. Stated plainly: raw deltas carry the library's FULL power — their
          // own timestamps, delta-ref pointers, negations. That is the same power standing
          // always granted through the library; whether any of it BINDS a reader is, as
          // everywhere, the reader's lens (and the documented negation interim).
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
          // A BOUND connection's batch lands in ITS inbox pool (SPEC §58), and only what its own
          // key signed may enter: the pool is the key's trust domain, and a delta another author
          // signed would ride the connection's token into a place that author was never bound to.
          // Every other bearer — the operator, a §57 client, an actor token — appends to this
          // store exactly as before; the fence is the binding's, not the door's.
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
            // A degraded gateway is the server's trouble, not the client's batch.
            // A pool mid-drop is TRANSIENT and its own sentence says to write again, so it is
            // the server's "not now" (503) rather than the client's "never" (403).
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
          // Registration is constitutional — the schema-schema mutation mechanism, served. An
          // HTTP endpoint rather than a GraphQL mutation because an empty store has no GraphQL
          // surface to mutate through; this is how it gains one.
          // AUTHORITY BEFORE SHAPE: this gate runs before the body is read, so a caller with no
          // register standing draws the same refusal whatever it sent.
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
            const done = asServedTo(
              gateway,
              identity,
              await performRegistration(registrationSink(gateway, identity), raw, fence),
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
          // Federation is an OPERATOR-level trust relationship: the offer hands a peer the raw
          // signed deltas (grants, memberships, registrations included) that the GraphQL surface
          // would never expose. So it is gated on operator identity, not mere authentication — a
          // scoped read token is not a licence to the store's whole substrate.
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

  // A bind failure must reach the caller as a REFUSAL, not as an unhandled 'error' event: the
  // promise below used to only ever resolve, so EADDRINUSE escaped the server object and Node
  // printed a raw stack trace over a CLI whose every other refusal is a sentence.
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
      // Named, or the bound address — which is right for a loopback store and wrong the moment a
      // proxy is in front. A caller's Host and X-Forwarded-* are never consulted for it.
      publicUrl: forUsers.publicUrl ?? `http://${host}:${port}`,
      ground: () => {
        const gateway = mounts.resolve(forUsers.mount)?.gateway;
        // `reactor` is read through the getter every call: erase() re-seats the gateway on a
        // fresh one, and a captured reference would keep answering from the ground before the
        // purge.
        return gateway === undefined
          ? undefined
          : { reactor: gateway.reactor, operator: gateway.operatorAuthor };
      },
      mint: mintSessionToken,
      revoke: revokeSessionTokens,
      // The worlds this server answers RIGHT NOW, other than the doors' own. A container mounts
      // itself (mounts.ts tier 3), so boot's guard cannot see it — the mint door asks here, at
      // the moment of minting, and refuses while any second world resolves.
      //
      // This compares NAMES where it means WORLDS, which is safe only because two names can
      // never point at one gateway here: the boot guard above refuses any static name but the
      // doors' own, and `addMount` refuses any runtime one — so an alias is unreachable, and
      // containers (the one tier neither guard sees) are genuinely distinct gateways.
      otherWorlds: () => mounts.live().filter((name) => name !== forUsers.mount),
    });
    // The admin page reuses the login doors' session gate and the users mount's live gateway —
    // re-asked per request, never captured, for the same reasons the doors' own ground is.
    admin = makeAdminDoor({
      gate: userDoors.gate,
      home: forUsers.home,
      ground: () => mounts.resolve(forUsers.mount)?.gateway,
      ...(forUsers.onFault === undefined ? {} : { onFault: forUsers.onFault }),
      // The connections panel joins oauth.json where a connector flow exists; absent, the panel
      // lists the subtree's inbox pools alone and says the store has no connector flow configured.
      ...(options.connectors === undefined
        ? {}
        : { connectors: { home: options.connectors.home } }),
    });
    // The consent page reuses the login doors' session gate, and reads/writes the connectors' own
    // `oauth.json` — so it opens only where both are configured. Its clock is the login doors' own
    // monotonic source, so a code's deadline and a session's idle window step together under a rail.
    if (options.connectors !== undefined) {
      consent = makeConsentDoor({
        gate: userDoors.gate,
        home: options.connectors.home,
        // The binding's side (§58): the users mount, re-asked per request like every door, and
        // the USERS' home, where a provisioned seed belongs (the connectors' home is oauth.json's).
        users: { ground: () => mounts.resolve(forUsers.mount)?.gateway, home: forUsers.home },
        ...(options.connectors.onFault === undefined
          ? {}
          : { onFault: options.connectors.onFault }),
        ...(forUsers.monotonicNow === undefined ? {} : { now: forUsers.monotonicNow }),
        ...(options.connectors.cimdAllowPrivateOrigins === undefined
          ? {}
          : { cimdAllowPrivateOrigins: options.connectors.cimdAllowPrivateOrigins }),
      });
      // The token exchange opens only where the home's operator seed is readable — the same key
      // `loam serve` opened the gateway with. Since §58 the exchange lands NO store-wide grant (a
      // connection's standing is its pool's, authored by the person's key at bind), but a store
      // whose seed cannot be read is not one that should mint connections: read once, at boot, and
      // FAIL CLOSED (the door is not opened) rather than discover it on the first redemption.
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
          // Bind the connection where consent said (§58): the person's own key — provisioned by
          // the consent page — authors the connection's write grant in the inbox pool's ground.
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
      // A session token is authority over the whole server, and the role binding that earned it
      // was read from one world. Adding a STRANGER while the login doors are open would extend
      // it to a mount no role binding named — the same rule boot applies. The doors' OWN mount
      // is not a stranger: mounting it is what makes the doors answer at all.
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
      // The door closes FIRST (a refusal throws before anything moves), and the sweep's snapshot is
      // taken in the SAME synchronous turn: a handler that has already passed its own live() check
      // is registered before this can run, and one that has not will fail that check. Splitting
      // these two statements with an await would open exactly the window they close.
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
