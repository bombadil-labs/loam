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
import { type Delta, type Primitive } from "@bombadil/rhizomatic";
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
import { makeUserDoors, type UserDoorOptions, type UserDoors } from "./session.js";

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
   * The login doors (SPEC §36). Absent, this server has none — `/login` is an unresolvable mount
   * name, exactly as it was before §36, and no request anywhere reads a cookie.
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

class BodyTooLarge extends Error {
  constructor() {
    super("request body too large");
  }
}

// Read the body as bytes (so a chunk boundary never splits a multibyte character), refusing
// anything past the cap before it can exhaust memory. On overflow we stop buffering and reject,
// but let the request keep draining so the handler can answer with a clean response instead of
// resetting the socket under the client.
const readBody = (req: IncomingMessage, limit: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on("data", (c: Buffer) => {
      if (overflowed) return;
      size += c.length;
      if (size > limit) {
        overflowed = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });

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

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(text);
};

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

// Parse a rendered route's write body (SPEC §23.3): a browser `<form>` POSTs
// `application/x-www-form-urlencoded` (every value a string); a programmatic caller may POST JSON (typed
// primitives, validated like the REST write door). Either yields the field map writeRoute signs as the
// renderer's pen. Throws a plain-English reason the caller answers 400 with.
const parseAppBody = (
  bodyText: string,
  contentType: string | undefined,
): Record<string, Primitive> => {
  const out: Record<string, Primitive> = {};
  if ((contentType ?? "").includes("application/json")) {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the write body must be a JSON object of fields");
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        throw new Error(`field "${k}" wants a primitive (string | number | boolean)`);
      }
      out[k] = v;
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(bodyText)) out[k] = v; // form-urlencoded: values are strings
  return out;
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

  // Session-minted bearer tokens (SPEC §36): short-lived, held by digest, and swept as they lapse.
  // They are how a BROWSER writes — a session cookie never opens a door below, so the browser asks
  // /session/token and then presents a header like any other client. Minting one requires an already
  // authenticated session, so this list is bounded by the session table, not by the network.
  const sessionTokens: { digest: Buffer; identity: TokenIdentity; expiresAt: number }[] = [];
  const clock = options.users?.monotonicNow ?? ((): number => performance.now());
  const mintSessionToken = (identity: TokenIdentity, ttlMs: number): string => {
    const secret = randomBytes(32).toString("base64url");
    const moment = clock();
    for (let i = sessionTokens.length - 1; i >= 0; i -= 1) {
      if (sessionTokens[i]!.expiresAt <= moment) sessionTokens.splice(i, 1);
    }
    sessionTokens.push({ digest: sha(secret), identity, expiresAt: moment + ttlMs });
    return secret;
  };

  // The identity a presented token names, compared timing-safely; undefined = refuse. A cookie is
  // never consulted here, and that is §36's load-bearing invariant: authority is an explicit header.
  const identify = (req: IncomingMessage): TokenIdentity | undefined => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return undefined;
    const presented = sha(header.slice("Bearer ".length));
    for (const [expected, identity] of tokenEntries) {
      if (timingSafeEqual(presented, expected)) return identity;
    }
    const moment = clock();
    let found: TokenIdentity | undefined;
    for (let i = sessionTokens.length - 1; i >= 0; i -= 1) {
      const minted = sessionTokens[i]!;
      if (minted.expiresAt <= moment) {
        sessionTokens.splice(i, 1);
        continue;
      }
      if (timingSafeEqual(presented, minted.digest)) found = minted.identity;
    }
    return found;
  };

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

  const refused = (res: ServerResponse): void =>
    json(res, 401, { errors: ["a bearer token is required, and this one opens nothing"] });

  // The front door. The bare root is the one path with no world behind it, so it is the one path
  // that can afford a human answer — and the first thing anyone does with a served store's URL is
  // open it in a browser. The greeting is a CONSTANT: one string, blind to the mount table, the
  // token presented, and every public declaration, because a front page that varied on any of
  // them would be an oracle the uniform refusals below pay to prevent. It names no mount, ever.
  const greeted = (res: ServerResponse): void => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...CORS });
    res.end(GREETING);
  };

  // Assigned once the port is known, because the public URL defaults to the bound one. No request can
  // arrive before `listen` resolves, so the doors are in place before anything can ask for them.
  let userDoors: UserDoors | undefined;

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
      // The login doors (SPEC §36), answered BEFORE mount routing — they are the store's own pages,
      // not any world's. They carry no CORS header on purpose: they are the only doors that read a
      // cookie, and a cross-origin page must not be able to read their answers.
      if (userDoors?.owns(url.pathname) === true) {
        await userDoors.handle(url.pathname, req, res);
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
          refused(res);
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
            refused(res);
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
  const url = `http://${host}:${port}`;

  if (options.users !== undefined) {
    const forUsers = options.users;
    userDoors = makeUserDoors({
      options: forUsers,
      // Named, or the bound address — which is right for a loopback store and wrong the moment a
      // proxy is in front. A caller's Host and X-Forwarded-* are never consulted for it.
      publicUrl: forUsers.publicUrl ?? url,
      ground: () => {
        const gateway = mounts.resolve(forUsers.mount)?.gateway;
        // `reactor` is read through the getter every call: erase() re-seats the gateway on a fresh
        // one, and a captured reference would keep answering from the ground before the purge.
        return gateway === undefined
          ? undefined
          : { reactor: gateway.reactor, operator: gateway.operator };
      },
      mint: mintSessionToken,
    });
  }

  return {
    server,
    port,
    url,
    addMount(name: string, gateway: Gateway): void {
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
