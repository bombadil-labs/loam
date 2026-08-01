// Discovery and the 401 (SPEC §37 phase 12/15) — the two RFC well-known documents an OAuth
// connector reads before any human is involved, and the `WWW-Authenticate` challenge that points a
// refused MCP caller at them. This phase MINTS NOTHING: no client, no code, no token. Those doors
// (registration, consent, the token exchange) arrive in phases 13-15, into this same file.
//
// EVERY URL COMES FROM ONE CONFIGURED STRING, `publicUrl` — never `req.headers`. Neither document
// function nor `challengeFor` reads a request at all, so a foreign `Host` or `X-Forwarded-Host` has
// nothing to act on: this is not merely tested to agree, it is structurally unable to disagree.
//
// THE CHALLENGE HEADER IS A CONSTANT OF THE SERVER, blind to the mount, the verb otherwise, and the
// token presented. `http.ts` attaches it only where the request's parsed verb is "mcp", at the two
// call sites inside its existing uniform 401 (T78/§12) — a header that differed by mount would
// reopen exactly the oracle that discipline exists to prevent.

import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse } from "node:http";
import {
  OAuthFileBusy,
  OAuthFileUnlockable,
  clientNameDefect,
  oauthPath,
  uriTextDefect,
  withOAuthFile,
  type OAuthClient,
} from "./oauth-file.js";

/** The one scope §37 ships. A scope LIST replaces it when a second one exists. */
export const CONNECTOR_SCOPE = "loam.connector";

/**
 * The issuer, and the ONE place it is computed. `protectedResourceDocument`,
 * `authorizationServerDocument` and `challengeFor` all call this rather than re-deriving it, so a
 * store configured with or without a trailing slash advertises the identical issuer everywhere.
 */
export function issuerFor(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, "");
}

/** RFC 9728: what a protected resource (this store's MCP door) tells a client about itself. */
export function protectedResourceDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    resource: issuer,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

/** RFC 8414: what this store's (not-yet-built) authorization server advertises about itself. */
export function authorizationServerDocument(publicUrl: string): Record<string, unknown> {
  const issuer = issuerFor(publicUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    // S256 and only S256: `plain` in this list would let a caller skip PKCE while the document
    // still said the word.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [CONNECTOR_SCOPE],
  };
}

/** The `WWW-Authenticate` value `http.ts` attaches to the MCP door's 401 — a constant of the server. */
export function challengeFor(publicUrl: string): string {
  return `Bearer resource_metadata="${issuerFor(publicUrl)}/.well-known/oauth-protected-resource"`;
}

// --- the public-url admission gate --------------------------------------------------------------

/**
 * May `raw` be `--public-url`? An http(s) origin, case-insensitively, with no path, query or
 * fragment beyond a single trailing slash (which `issuerFor` already strips before this runs).
 *
 * Refuses a default-port spelling ON PURPOSE (`https://x:443`, `http://x:80`): the WHATWG parser's
 * own `.origin` drops a default port, so comparing against the caller's string is exactly what
 * catches one — an operator who typed the port gets a boot refusal naming the canonical spelling,
 * the same "typo becomes a boot error, not a silent hole" trade this whole check exists for.
 */
export function publicUrlDefect(raw: string): string | undefined {
  const normalized = issuerFor(raw);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return `"${raw}" is not an absolute URL, so it names no origin`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `"${raw}" is not http or https — an OAuth issuer names an HTTP(S) origin`;
  }
  if (url.origin.toLowerCase() !== normalized.toLowerCase()) {
    return (
      `"${raw}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  return undefined;
}

/**
 * The canonical form `--public-url` resolves to, once `publicUrlDefect` has cleared it: lowercased
 * by the WHATWG parser, so a document never advertises a differently-cased issuer than the one that
 * passed the boot check.
 */
export function canonicalPublicUrl(raw: string): string {
  return new URL(issuerFor(raw)).origin;
}

/**
 * What the registration door needs (SPEC §37 phase 13). OPT-IN: absent, `makeOAuthDoors` owns only
 * the two well-known documents and `/oauth/register` resolves exactly as it did after phase 12 (an
 * unrouted OAuth path). The door mints NOTHING — no code, no token, no seed; it records a public
 * client and answers 201.
 */
export interface ConnectorRegistration {
  /** Where `oauth.json` lives — the home the operator seed lives in. */
  readonly home: string;
  /**
   * The origins a registered `redirect_uri` may sit at, as `scheme://host[:port]`. EMPTY means §37
   * is configured but fenced shut: every registration refuses and names the flag that opens it.
   * There is no "allow anything" spelling, deliberately.
   */
  readonly allowRedirectOrigins: readonly string[];
  /** Registrations this home will hold before the cap EVICTS the oldest evictable one (default 64). */
  readonly maxClients?: number;
  /** Where a local fault goes. The CALLER never sees it — it names the home's path. */
  readonly onFault?: (message: string) => void;
}

export interface OAuthOptions {
  /** The outside address this store is reached at. Every discovery URL comes from here alone. */
  readonly publicUrl: string;
  /** Connector registration (SPEC §37 phase 13), opt-in. Absent, only the well-known docs answer. */
  readonly registration?: ConnectorRegistration;
}

// --- the redirect fence -------------------------------------------------------------------------

const MAX_BODY = 16 * 1024; // a registration is a few hundred bytes; nothing here needs more
const MAX_URIS = 8;
const MAX_URI = 2048;
const DEFAULT_MAX_CLIENTS = 64;

/**
 * Is this a spelling of an origin that could ever be a redirect target? An absolute URL whose own
 * `.origin` reads back byte-for-byte (so a default-port spelling — `https://x:443` — refuses, since
 * the WHATWG parser drops the port and the stored allowlist entry would then never match a uri),
 * https unless the host is loopback.
 *
 * Applied to the CONFIGURED allowlist at boot (an operator's typo becomes a startup error, not a
 * store where every registration silently refuses) AND to each submitted uri's origin.
 */
export function redirectOriginDefect(origin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `"${origin}" is not an absolute URL, so it names no origin`;
  }
  if (url.origin !== origin) {
    return (
      `"${origin}" is not a bare origin — an origin is scheme://host[:port] and nothing else ` +
      `(this one reads as "${url.origin}")`
    );
  }
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (url.protocol !== "https:" && !loopback.has(url.hostname)) {
    return `"${origin}" is not https, and only a loopback host may be reached over http`;
  }
  return undefined;
}

/**
 * May this `redirect_uri` be REGISTERED? An absolute URL, at an allowlisted origin, with no
 * fragment, carrying no control byte, and percent-TRANSPARENT.
 *
 * `uriTextDefect` runs BEFORE `new URL()`, which strips tab, LF and CR while parsing — so a uri
 * carrying them would pass every check below and keep its raw bytes in the stored string, where a
 * future `loam grant list` prints them and forges a row. Percent-transparency matters for the same
 * exact-match reason a later phase's authorize compares the caller's uri byte-for-byte against the
 * registered one.
 */
export function redirectUriDefect(uri: string, allowed: readonly string[]): string | undefined {
  if (allowed.length === 0) {
    return (
      `this store registers no connectors: its operator has named no permitted redirect origin. ` +
      `Serve with --oauth-allow-redirect <origin> to open §37.`
    );
  }
  if (uri.length === 0 || uri.length > MAX_URI) return `a redirect_uri is 1..${MAX_URI} characters`;
  const text = uriTextDefect(uri);
  if (text !== undefined) return `"${uri}" is not a redirect target: ${text}`;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `"${uri}" is not an absolute URL`;
  }
  if (url.hash !== "" || uri.includes("#")) {
    return `"${uri}" carries a fragment, and a redirect target may not`;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    return `"${uri}" carries a percent-escape that does not decode`;
  }
  if (decoded !== uri) {
    return (
      `"${uri}" carries a percent-escape, and this door compares a redirect target as one exact ` +
      `string — it would be reached as "${decoded}", a spelling it was never registered under`
    );
  }
  if (!allowed.includes(url.origin)) {
    // Say only that this origin is not permitted — NOT the whole allowlist, and NOT the flag name.
    // This door is unauthenticated and answers with a wildcard CORS origin, so echoing the
    // operator's trust list or their config flag hands an anonymous caller store recon for free.
    // The EMPTY-allowlist case above names the flag deliberately (a store where nothing works, an
    // operator-facing hint); an off-origin refusal is an ordinary caller error and stays generic.
    return `"${uri}" is not at an origin this store permits`;
  }
  // The scheme rule again, per uri — membership in the allowlist is not a licence, so the https
  // rule survives any future path that reaches here with a list boot never vetted.
  const originDefect = redirectOriginDefect(url.origin);
  if (originDefect !== undefined) return `"${uri}" is not a permitted target: ${originDefect}`;
  return undefined;
}

export interface OAuthDoors {
  owns(pathname: string): boolean;
  handle(pathname: string, req: IncomingMessage, res: ServerResponse): void;
  /** The `WWW-Authenticate` value every MCP-door refusal carries — blind to mount, verb, token. */
  readonly challenge: string;
}

const WELL_KNOWN_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

const REGISTER_PATH = "/oauth/register";

/** Read a request body, capped — a registration is a few hundred bytes. `undefined` past the cap. */
const readBody = (req: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        over = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

export function makeOAuthDoors(options: OAuthOptions): OAuthDoors {
  const publicUrl = options.publicUrl;
  const registration = options.registration;

  const documentFor = (pathname: string): Record<string, unknown> =>
    pathname === "/.well-known/oauth-protected-resource"
      ? protectedResourceDocument(publicUrl)
      : authorizationServerDocument(publicUrl);

  const wellKnown = (pathname: string, req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, {
        allow: "GET, HEAD",
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify({ error: "this document answers GET" }));
      return;
    }
    const headers = {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(documentFor(pathname)));
  };

  // --- POST /oauth/register (RFC 7591), SPEC §37 phase 13 ---------------------------------------
  //
  // Every response is JSON with a wildcard CORS origin: the door reads NO cookie, so a wildcard
  // origin lends a caller nothing, exactly as it lends nothing on the data doors. Every refusal is
  // RFC 6749's `{ error, error_description }`, and none carries a Location.

  const home = registration?.home ?? "";
  const allowed = registration === undefined ? [] : [...registration.allowRedirectOrigins];
  const maxClients = registration?.maxClients ?? DEFAULT_MAX_CLIENTS;
  const onFault = registration?.onFault ?? ((message: string): void => void message);

  const jsonOut = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*",
    });
    res.end(JSON.stringify(body));
  };
  const refuse = (res: ServerResponse, status: number, error: string, description: string): void =>
    jsonOut(res, status, { error, error_description: description });

  const postRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse((await readBody(req)) ?? "");
    } catch {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      refuse(res, 400, "invalid_client_metadata", "the body must be a JSON object");
      return;
    }
    const body = parsed as Record<string, unknown>;
    const name = body["client_name"];
    if (typeof name !== "string") {
      refuse(res, 400, "invalid_client_metadata", "client_name is a string");
      return;
    }
    // The name reaches the operator's TERMINAL through a future `loam grant list`, and this door
    // takes no credential — so a newline forges a row. `clientNameDefect` is phase 11's shared rule.
    const nameDefect = clientNameDefect(name);
    if (nameDefect !== undefined) {
      refuse(res, 400, "invalid_client_metadata", nameDefect);
      return;
    }
    const uris = body["redirect_uris"];
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_URIS) {
      refuse(
        res,
        400,
        "invalid_redirect_uri",
        `redirect_uris is an array of 1..${MAX_URIS} absolute URLs`,
      );
      return;
    }
    // EVERY uri, not the first that passes: one honest entry carrying a hostile sibling means the
    // client holds both, and whichever authorize later accepts is the one that matters.
    const checked: string[] = [];
    for (const uri of uris) {
      if (typeof uri !== "string") {
        refuse(res, 400, "invalid_redirect_uri", "every redirect_uri is a string");
        return;
      }
      const defect = redirectUriDefect(uri, allowed);
      if (defect !== undefined) {
        refuse(res, 400, "invalid_redirect_uri", defect);
        return;
      }
      checked.push(uri);
    }

    type Registered =
      | { kind: "ok"; client: OAuthClient }
      | { kind: "full" }
      | { kind: "unreadable" }
      | { kind: "locked" };

    let outcome: Registered;
    try {
      outcome = withOAuthFile<Registered>(home, (file) => {
        // AT THE CAP, EVICT THE OLDEST EVICTABLE REGISTRATION rather than refuse. This door takes
        // no credential, so a plain cap is a lockout: a stranger fills it and the real connector is
        // refused forever, with no command that removes one. So the pressure falls on registrations
        // nobody is using, and a flood evicts its own earlier entries.
        //
        // THE PIN READS ONE SOURCE THIS PHASE: a grant record (an APPROVED connector's seed signs
        // deltas the store holds). The doors that produce a grant are phases 14/15. Phase 14 adds a
        // live-code source and phase 15 a redemption-in-flight source; adding a pin source only
        // makes eviction MORE conservative, so this phase's eviction rails stay green when they land.
        const pinned = new Set(file.grants.map((g) => g.clientId));
        let clients = [...file.clients];
        while (clients.length >= maxClients) {
          const oldest = clients
            .filter((c) => !pinned.has(c.clientId))
            .sort((a, b) => a.registeredAt - b.registeredAt)[0];
          if (oldest === undefined) return { result: { kind: "full" as const } };
          clients = clients.filter((c) => c.clientId !== oldest.clientId);
        }
        const client: OAuthClient = {
          clientId: `connector-${randomBytes(16).toString("hex")}`,
          clientName: name,
          redirectUris: checked,
          registeredAt: Date.now(),
          generation: 1,
        };
        return {
          next: { ...file, clients: [...clients, client] },
          result: { kind: "ok" as const, client },
        };
      });
    } catch (err) {
      // The DETAIL names the home's path; it goes ONLY to the operator's channel. A lock that could
      // not be taken is not a damaged file, but both are the same fixed answer to an unauthenticated
      // caller that answers with a wildcard CORS origin.
      onFault(
        `the connector doors could not register a connector in ${oauthPath(home)}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      outcome =
        err instanceof OAuthFileBusy || err instanceof OAuthFileUnlockable
          ? { kind: "locked" }
          : { kind: "unreadable" };
    }

    if (outcome.kind === "locked") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot take the lock on its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "unreadable") {
      refuse(
        res,
        503,
        "temporarily_unavailable",
        "this store cannot read its connector records, so it registers nothing",
      );
      return;
    }
    if (outcome.kind === "full") {
      refuse(
        res,
        400,
        "invalid_client_metadata",
        `this store already holds ${maxClients} connectors it will not displace — each one is ` +
          `approved. \`loam grant list\` names them.`,
      );
      return;
    }
    jsonOut(res, 201, {
      client_id: outcome.client.clientId,
      client_name: outcome.client.clientName,
      redirect_uris: outcome.client.redirectUris,
      client_id_issued_at: Math.floor(outcome.client.registeredAt / 1000),
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: CONNECTOR_SCOPE,
    });
  };

  const handleRegister = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      refuse(res, 405, "invalid_request", "registration answers POST");
      return;
    }
    // ONE GUARD over the whole handler: a fault nobody anticipated must not escape to the server's
    // generic 500, whose message carries the home's absolute path.
    try {
      await postRegister(req, res);
    } catch (err) {
      onFault(
        `a connector door failed answering ${REGISTER_PATH}: ` +
          `${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      if (!res.headersSent) {
        refuse(
          res,
          503,
          "temporarily_unavailable",
          "this store could not answer, and it says no rather than why",
        );
      } else {
        res.end();
      }
    }
  };

  return {
    owns: (pathname) =>
      WELL_KNOWN_PATHS.has(pathname) || (registration !== undefined && pathname === REGISTER_PATH),
    challenge: challengeFor(publicUrl),
    handle(pathname, req, res) {
      if (registration !== undefined && pathname === REGISTER_PATH) {
        void handleRegister(req, res);
        return;
      }
      wellKnown(pathname, req, res);
    },
  };
}
