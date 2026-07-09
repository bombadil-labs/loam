// The gateway, served. One node:http server and no framework: bearer tokens map onto the
// gateway's actor-per-request seam — transport adds AUTHENTICATION and nothing else; every
// authority question stays where step 5 put it. Mounts are separate worlds: /:mount/graphql
// (query + mutate), /:mount/subscribe (SSE — one data: frame per subscription payload), and
// /:mount/mcp (a minimal MCP JSON-RPC surface: initialize, tools/list, tools/call).
//
// Bind 127.0.0.1 and terminate TLS in front; token comparison is timing-safe; a token maps to
// an explicit identity ({ actor } or { operator: true }) — never a default.
//
// Custody, stated plainly: a token maps to an ACTOR SEED, so this process signs on behalf of
// its actors and is a custodian of their signing authority — a heap dump or leaked config
// discloses keys, not just replayable tokens. That is the price of server-side convenience
// mutations. The non-custodial path is the CRDT's own: a client signs its deltas itself and
// presents them; each is authorized by its own verified author (Gateway.append), and the
// server never holds the key. A future raw-append endpoint exposes that path over HTTP.

import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parsePolicy, parseTerm, type Delta, type HyperSchema } from "@bombadil/rhizomatic";
import { fromWire, toWire, type WireDelta } from "../federation/wire.js";
import type { Gateway, QueryResult, RequestContext } from "../gateway/gateway.js";
import {
  parseClaimTemplates,
  schemaEntityFor,
  type ClaimTemplates,
} from "../gateway/registration.js";

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
}

const DEFAULT_MAX_BODY = 4 * 1024 * 1024;
const DEFAULT_MAX_STREAMS = 1024;

export interface ServerHandle {
  readonly server: Server;
  readonly port: number;
  readonly url: string; // http://host:port
  close(): Promise<void>;
}

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();

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

const json = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
};

// Parse and perform a registration request: { schema: { name, alg?, body }, policy, roots,
// entity? }. The term and policy travel as their JSON profiles (rhizomatic's own); anything
// that will not parse, or will not register, throws — the caller answers 400 with the reason.
// Operator gating happens BEFORE this is called: shaping the store is constitutional.
async function performRegistration(
  gateway: Gateway,
  raw: unknown,
): Promise<{ registered: string; entity: string }> {
  const o = raw as {
    schema?: { name?: unknown; alg?: unknown; body?: unknown };
    policy?: unknown;
    roots?: unknown;
    entity?: unknown;
    mutations?: unknown;
  } | null;
  if (o === null || typeof o !== "object" || o.schema === null || typeof o.schema !== "object") {
    throw new Error("register wants { schema: { name, alg?, body }, policy, roots, entity? }");
  }
  const { name, alg, body } = o.schema;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("register: schema.name must be a non-empty string");
  }
  if (alg !== undefined && typeof alg !== "number") {
    throw new Error("register: schema.alg must be a number when given");
  }
  if (!Array.isArray(o.roots) || o.roots.some((r) => typeof r !== "string")) {
    throw new Error("register: roots must be an array of entity ids");
  }
  if (o.entity !== undefined && typeof o.entity !== "string") {
    throw new Error("register: entity must be a string when given");
  }
  const schema: HyperSchema = { name, alg: alg ?? 1, body: parseTerm(body) };
  const policy = parsePolicy(o.policy);
  const mutations: ClaimTemplates | undefined =
    o.mutations === undefined ? undefined : parseClaimTemplates(o.mutations);
  await gateway.publishRegistration(
    schema,
    policy,
    o.roots as string[],
    undefined,
    o.entity,
    mutations,
  );
  return { registered: name, entity: schemaEntityFor(schema, o.entity) };
}

export async function serve(options: ServeOptions): Promise<ServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  const maxStreams = options.maxStreams ?? DEFAULT_MAX_STREAMS;
  // Own-property lookup only: an attacker-supplied mount name can never resolve a prototype
  // member (`__proto__`, `constructor`) into a phantom gateway.
  const mounts = new Map(Object.entries(options.mounts));
  const tokenEntries = Object.entries(options.tokens).map(
    ([token, identity]) => [sha(token), identity] as const,
  );
  if (tokenEntries.length === 0) {
    throw new Error("loam serve: no tokens configured — an unlockable door is a wall");
  }

  // The identity a presented token names, compared timing-safely; undefined = refuse.
  const identify = (req: IncomingMessage): TokenIdentity | undefined => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith("Bearer ")) return undefined;
    const presented = sha(header.slice("Bearer ".length));
    for (const [expected, identity] of tokenEntries) {
      if (timingSafeEqual(presented, expected)) return identity;
    }
    return undefined;
  };

  const contextFor = (identity: TokenIdentity): RequestContext | undefined =>
    identity.actor === undefined ? undefined : { actor: identity.actor };

  // Live SSE streams, so close() can end them instead of leaving clients hanging.
  const streams = new Set<{
    events: AsyncGenerator<Record<string, unknown>>;
    res: ServerResponse;
  }>();

  const handleGraphql = async (
    gateway: Gateway,
    identity: TokenIdentity,
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
    // A gateway failure (nothing registered, an internal throw) is the caller's structured
    // { errors }, not a 500 leaking an internal message.
    let result: QueryResult;
    try {
      result = await gateway.query(parsed.query, parsed.variables, contextFor(identity));
    } catch (err) {
      result = { errors: [err instanceof Error ? err.message : "the gateway could not answer"] };
    }
    json(res, 200, result);
  };

  const handleSubscribe = async (
    gateway: Gateway,
    identity: TokenIdentity,
    req: IncomingMessage,
    res: ServerResponse,
    search: URLSearchParams,
  ): Promise<void> => {
    const source = search.get("query");
    if (source === null) {
      json(res, 400, { errors: ["subscribe wants ?query=<subscription>"] });
      return;
    }
    if (streams.size >= maxStreams) {
      json(res, 503, { errors: ["this server is holding all the live streams it can"] });
      return;
    }
    // The actor rides through even though today's subscriptions are reads (unauthorized as
    // reads still are) — when read policy arrives it keys on this, not on a retrofit.
    void contextFor(identity);
    let events: AsyncGenerator<Record<string, unknown>>;
    try {
      events = await gateway.subscribe(source);
    } catch (err) {
      json(res, 400, { errors: [err instanceof Error ? err.message : "not a subscription"] });
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const stream = { events, res };
    streams.add(stream);
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
      streams.delete(stream);
      res.end();
    }
  };

  // The MCP tools: the same two verbs the gateway speaks, in JSON-RPC clothes.
  const MCP_TOOLS = [
    {
      name: "loam_query",
      description: "Run a GraphQL query against this Loam store; returns { data, errors }.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, variables: { type: "object" } },
        required: ["query"],
      },
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
    },
    {
      name: "loam_register",
      description:
        "Define a schema as schema-schema deltas and register it (operator token only). " +
        "The surface serves the new type immediately; republishing at the same entity evolves it.",
      inputSchema: {
        type: "object",
        properties: {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              alg: { type: "number" },
              body: { type: "object", description: "the hyperschema body, term JSON" },
            },
            required: ["name", "body"],
          },
          policy: { type: "object", description: "the policy, policy JSON" },
          roots: { type: "array", items: { type: "string" } },
          entity: { type: "string", description: "the schema entity (default schema:<name>)" },
        },
        required: ["schema", "policy", "roots"],
      },
    },
  ];

  const handleMcp = async (
    gateway: Gateway,
    identity: TokenIdentity,
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
    // A notification (a request with no id) demands silence, not a reply.
    const isNotification = rpc.id === undefined || rpc.id === null;
    const reply = (result: unknown): void =>
      json(res, 200, { jsonrpc: "2.0", id: rpc.id ?? null, result });

    switch (rpc.method) {
      case "initialize":
        reply({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "loam", version: "0.0.0" },
        });
        return;
      case "notifications/initialized":
        res.writeHead(202).end();
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
          res.writeHead(202).end();
          return;
        }
        json(res, 200, {
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          error: { code: -32601, message: `no such method ${String(rpc.method)}` },
        });
    }
  };

  const server = createServer((req, res) => {
    void (async () => {
      // Authenticate BEFORE resolving the mount: an unauthenticated caller learns nothing
      // about which mounts exist (no 404-vs-401 mount-name oracle).
      const identity = identify(req);
      if (identity === undefined) {
        json(res, 401, { errors: ["a bearer token is required, and this one opens nothing"] });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const [, mountName, verb] = url.pathname.split("/");
      const gateway =
        mountName === undefined ? undefined : mounts.get(decodeURIComponent(mountName));
      if (gateway === undefined) {
        json(res, 404, { errors: ["no such mount"] });
        return;
      }
      switch (verb) {
        case "graphql":
          await handleGraphql(gateway, identity, req, res);
          return;
        case "subscribe":
          await handleSubscribe(gateway, identity, req, res, url.searchParams);
          return;
        case "mcp":
          await handleMcp(gateway, identity, req, res);
          return;
        case "append": {
          // The non-custodial door: a client signs its own deltas and presents them. The
          // token authenticates TRANSPORT only — each delta is verified and authorized by its
          // own author's standing, exactly as Gateway.append always does. The server never
          // holds the key.
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
            json(res, /not permitted/.test(message) ? 403 : 400, { errors: [message] });
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

  return {
    server,
    port,
    url: `http://${host}:${port}`,
    async close(): Promise<void> {
      for (const s of [...streams]) {
        await s.events.return(undefined);
        s.res.end();
      }
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
