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
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Kind, OperationTypeNode, parse, type DocumentNode } from "graphql";
import { fromWire, toWire, type WireDelta } from "../federation/wire.js";
import { buildOpenApi, handleRest } from "../surface/rest.js";
import {
  NothingPublic,
  type Gateway,
  type QueryResult,
  type RequestContext,
} from "../gateway/gateway.js";
import { parseRegistrationInput, schemaEntityFor, type LensName } from "../gateway/registration.js";
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
import { grantClaims } from "../gateway/accounts.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import { readSeed } from "../cli/config.js";
import { makeUserDoors, type UserDoorOptions, type UserDoors } from "./session.js";
import { makeAdminDoor, type AdminDoor } from "./admin.js";

export { type UserDoorOptions } from "./session.js";

export interface TokenIdentity {
  readonly actor?: string; // a signing seed: requests act as this identity
  readonly operator?: true; // requests act as the gateway's operator
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
// public. The words say where the doors are; they never say which doors exist.
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
  @media (prefers-color-scheme: dark) {
    body { color: #e6dfd4; background: #1f1b17; }
    code { background: #ffffff1f; }
    .quiet { color: #a89e90; }
  }
</style>
</head>
<body>
<main>
<h1>A Loam store serves here.</h1>
<p>Its doors are the mounts: <code>/&lt;mount&gt;/graphql</code> to ask,
<code>/&lt;mount&gt;/subscribe</code> to listen, <code>/&lt;mount&gt;/rest</code> and
<code>/&lt;mount&gt;/mcp</code> for the same worlds in other tongues.</p>
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
async function performRegistration(
  gateway: Gateway,
  raw: unknown,
): Promise<{ registered: string; entity: string }> {
  const input = parseRegistrationInput(raw);
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
  return {
    registered: input.hyperschema.name,
    entity: schemaEntityFor(input.hyperschema, input.entity),
  };
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
      // — an unknown token is one in-memory miss with no file read behind it, so a flood of bogus
      // tokens costs no key derivation. It resolves ONLY to `{ actor }`, never an operator identity.
      return tokenExchange?.resolve(digest);
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

  const contextFor = (identity: TokenIdentity): RequestContext | undefined =>
    identity.actor === undefined ? undefined : { actor: identity.actor };

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
      json(res, 400, { errors: [err instanceof Error ? err.message : "not a subscription"] });
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

  // The MCP revisions this door speaks — every one in which a Tool may CARRY the annotations below.
  // `readOnlyHint` arrived in 2025-03-26; under 2024-11-05 a Tool is name/description/inputSchema and
  // nothing else. So a client told "2024-11-05" while being handed a readOnlyHint has negotiated a
  // protocol in which the field it is asked to honour does not exist — and that field is the second
  // guard against a replayed write, the one the runtime holds rather than us. Newest first: an
  // unrecognised or absent request is answered with the newest we speak, never with a revision that
  // cannot express what we declare.
  const MCP_PROTOCOLS: readonly string[] = ["2025-06-18", "2025-03-26"];

  // The MCP tools: the same two verbs the gateway speaks, in JSON-RPC clothes. `annotations` are
  // part of the authority, not decoration: a shell reads `readOnlyHint: true` as a licence to cache
  // and REPLAY a call, and an explicit `false` is what makes its own machinery refuse to cache a
  // write. Both halves must be true of the handler below — see notARead.
  const MCP_TOOLS = [
    {
      name: "loam_query",
      description:
        "Run a GraphQL query against this Loam store; returns { data, errors }. " +
        "Reads only: a mutation or subscription document is refused.",
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
        "Define a schema as schema-schema deltas and register it (operator token only). " +
        "The surface serves the new type immediately; republishing at the same entity evolves it.",
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
          capabilities: { tools: {} },
          serverInfo: { name: "loam", version: "0.1.0" },
        });
        return;
      }
      case "notifications/initialized":
        res.writeHead(202, CORS).end();
        return;
      case "tools/list":
        reply({ tools: MCP_TOOLS });
        return;
      case "tools/call": {
        const params = rpc.params ?? {};
        const name = params["name"];
        if (name === "loam_register") {
          // The same constitutional gate as POST /register: shaping the store is the operator's.
          if (identity.operator !== true) {
            reply({
              content: [
                {
                  type: "text",
                  text: "registration is constitutional: it requires an operator token",
                },
              ],
              isError: true,
            });
            return;
          }
          try {
            const outcome = await performRegistration(gateway, params["arguments"] ?? {});
            reply({ content: [{ type: "text", text: JSON.stringify(outcome) }] });
          } catch (err) {
            reply({
              content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
              isError: true,
            });
          }
          return;
        }
        const args = (params["arguments"] ?? {}) as {
          query?: string;
          mutation?: string;
          variables?: Record<string, unknown>;
        };
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
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...CORS });
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
            await gateway.prepareRoute(parsed.route); // load the bundle before the render (worker, §23.9)
            if (!guard.live()) {
              guard.gone();
              return;
            }
            if (req.method === "GET") {
              sendRendered(res, await gateway.serveRoute(parsed.route, parsed.entity, "public"));
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
            (s) => gateway.subscribe(s),
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
          );
          json(res, result.status, result.body);
          return;
        }
        // A rendered route (SPEC §23), on the full door: GET a route's HTML, rendered from the store's
        // live view under the token's read discipline.
        case "app": {
          const parsed = appRouteOf(url.pathname);
          if (parsed === undefined) {
            refused(res);
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
          try {
            const receipt = await gateway.append(batch);
            json(res, 200, receipt);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // A degraded gateway is the server's trouble, not the client's batch.
            const status = /can no longer persist/.test(message)
              ? 503
              : /not permitted/.test(message)
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
          if (identity.operator !== true) {
            json(res, 403, {
              errors: ["registration is constitutional: it requires an operator token"],
            });
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
            json(res, 200, await performRegistration(gateway, raw));
          } catch (err) {
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

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, host, resolve));
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
        ...(forUsers.monotonicNow === undefined ? {} : { now: forUsers.monotonicNow }),
      });
      // The token exchange signs the operator-signed write grant with the home's own operator seed —
      // the same key `loam serve` opened the gateway with (cmdServe reads it from here). Read once, at
      // boot: a home whose seed is unreadable can register and consent but never mint a token, so the
      // door FAILS CLOSED (it is not opened) rather than throwing on the first redemption.
      const connectorHome = options.connectors.home;
      const connectorFault =
        options.connectors.onFault ?? ((message: string): void => void message);
      let operatorSeed: string | undefined;
      try {
        operatorSeed = readSeed(connectorHome);
      } catch (err) {
        connectorFault(
          `the token exchange is not open: this store's operator seed is unreadable, so it cannot ` +
            `sign a connector's write grant (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      if (operatorSeed !== undefined) {
        const seed = operatorSeed;
        const operator = authorForSeed(seed);
        tokenExchange = makeTokenDoor({
          home: connectorHome,
          redeeming,
          ...(forUsers.monotonicNow === undefined ? {} : { now: forUsers.monotonicNow }),
          onFault: connectorFault,
          // Land the operator-signed write grant in the connector's mount ground. The gateway is
          // re-asked per call (erase re-seats a reactor, a mount can vanish), never captured.
          grantStanding: async (actor: string): Promise<string> => {
            const gateway = mounts.resolve(forUsers.mount)?.gateway;
            if (gateway === undefined) {
              throw new Error(
                "the connector's mount is not resolvable, so no write grant was landed",
              );
            }
            const delta = signClaims(
              grantClaims(STORE_ENTITY, actor, "write", operator, Date.now()),
              seed,
            );
            await gateway.append([delta]);
            return delta.id;
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
